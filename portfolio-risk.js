// Shared pure calculations for the classic browser app and server ESM test hooks.
// No account state, fetch, storage, or clock reads belong in this module.
(function (root) {
  'use strict';
  const QUOTE_TOLERANCE_MS = 120000; // Product display tolerance, not an exchange guarantee.
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const positive = value => number(value) !== null && value > 0;
  const market = value => ['TWSE', 'TPEx'].includes(value) ? value : null;
  const officialCloseSource = quote => quote?.sourceKind === 'daily-close' && ['TWSE OpenAPI', 'TPEx OpenAPI'].includes(quote.source);
  const isoDay = ms => new Date(ms + 28800000).toISOString().slice(0, 10);
  function quoteStamp(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/);
    if (!match) return null;
    const [, y, m, d, h, minute, second, fraction, zone] = match;
    const day = `${y}-${m}-${d}`;
    const calendar = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== day || Number(h || 0) > 23 || Number(minute || 0) > 59 || Number(second || 0) > 59) return null;
    const ms = Date.parse(`${day}T${h || '00'}:${minute || '00'}:${second || '00'}${fraction ? `.${fraction}` : ''}${zone || '+08:00'}`);
    return Number.isFinite(ms) ? { ms, day: isoDay(ms), timed: h !== undefined } : null;
  }
  function portfolioQuoteEvidence(quote, { asOf, session, quoteToleranceMs = QUOTE_TOLERANCE_MS } = {}) {
    const now = quoteStamp(asOf), stamp = quoteStamp(quote?.asOf);
    const fail = reason => ({ valid: false, reason, quoteAsOf: quote?.asOf || null, quoteMode: null, recency: 'unknown' });
    if (!positive(quote?.price)) return fail('quote-missing');
    if (!now || !stamp) return fail('quote-date-unknown');
    if (stamp.ms > now.ms) return fail('quote-future');
    const minute = new Date(now.ms + 28800000).getUTCHours() * 60 + new Date(now.ms + 28800000).getUTCMinutes();
    const weekday = new Date(now.ms + 28800000).getUTCDay();
    const trading = session?.date === now.day && typeof session.tradingDay === 'boolean' ? session.tradingDay : weekday === 0 || weekday === 6 ? false : null;
    const intraday = trading !== false && minute >= 540 && minute <= 815;
    const live = ['realtime', 'broker-realtime'].includes(quote.sourceKind) && quote.priceStale !== true;
    if (intraday) {
      if (!live || !stamp.timed || stamp.day !== now.day || now.ms - stamp.ms > quoteToleranceMs) return fail('quote-stale');
      return { valid: true, quoteAsOf: quote.asOf, quoteMode: 'realtime', recency: 'within-tolerance' };
    }
    const officialClose = officialCloseSource(quote);
    // A historical official close remains a dated reference. Weekday arithmetic cannot
    // certify the latest trading day across holidays, so recency remains explicit.
    if (!officialClose && !(live && stamp.timed)) return fail('quote-source-unknown');
    return { valid: true, quoteAsOf: quote.asOf, quoteMode: officialClose ? 'close' : 'last-trade', recency: stamp.day === now.day && trading === true && minute > 815 ? 'same-day' : 'unknown' };
  }
  function calculatePortfolioPlanRisk({ positions = [], plans = [], quotes = [], capitalBasis, costPolicy, asOf, session, quoteToleranceMs } = {}) {
    const snapshot = quoteStamp(asOf), day = snapshot?.day;
    const grouped = new Map();
    for (const p of positions) {
      if (!positive(p?.shares)) continue;
      const row = grouped.get(p.code) || { code: p.code, shares: 0, markets: new Set(), marketConflict: false };
      row.shares += p.shares;
      if (market(p.exchange)) row.markets.add(p.exchange);
      if (p.marketConflict) row.marketConflict = true;
      grouped.set(p.code, row);
    }
    const result = { asOf: asOf || null, basis: 'gross-mark-to-stop', knownRiskCash: null, riskPct: null,
      coverage: { shares: 0, coveredShares: 0, unknownShares: 0, pricedValue: 0, totalValue: null, marketValuePct: null },
      breached: [], unknown: [], concentration: { denominatorKnown: false, byCode: [], byIndustry: [] }, positions: [] };
    let riskCash = 0, coveredValue = 0, allPriced = true;
    for (const group of grouped.values()) {
      const matches = quotes.filter(q => q.code === group.code);
      const markets = new Set(group.markets);
      for (const q of matches) if ((q.official === true || officialCloseSource(q)) && market(q.exchange)) markets.add(q.exchange);
      const exchange = markets.size === 1 ? [...markets][0] : null;
      const reasons = [];
      if (markets.size > 1 || group.marketConflict) reasons.push('market-conflict');
      else if (!exchange) reasons.push('market-unknown');
      const candidates = matches.filter(q => q.exchange === exchange);
      const quote = candidates.length === 1 ? candidates[0] : null;
      const evidence = portfolioQuoteEvidence(quote, { asOf, session, quoteToleranceMs });
      if (!evidence.valid) reasons.push(evidence.reason);
      const valueKnown = reasons.length === 0;
      const value = valueKnown ? group.shares * quote.price : null;
      if (value === null) allPriced = false; else result.coverage.pricedValue += value;
      const matchingPlans = plans.filter(p => p.code === group.code && (!exchange || p.exchange === exchange) && p.status === 'active');
      const current = matchingPlans.filter(p => quoteStamp(p.expiresOn) && day && p.expiresOn >= day);
      const row = { code: group.code, exchange, shares: group.shares, coveredShares: 0, unknownShares: group.shares, value, riskCash: null,
        planIds: (current.length ? current : matchingPlans).map(p => p.planId), ...evidence, reasons, industry: quote?.industry || null };
      if (current.length > 1) reasons.push('plan-conflict');
      else if (!current.length) reasons.push(matchingPlans.length ? 'plan-expired' : 'stop-missing');
      else {
        const p = current[0]; row.stopPrice = p.stopPrice;
        row.importedHistoryUnverified = p.provenance?.kind === 'imported';
        if (!positive(p.stopPrice)) reasons.push('stop-missing');
        if (!positive(p.quantity) || !Number.isInteger(p.quantity)) reasons.push('quantity-unknown');
        if (positive(p.stopPrice) && valueKnown && quote.price <= p.stopPrice) {
          reasons.push('stop-breached'); result.breached.push({ code: group.code, planIds: row.planIds, price: quote.price, stopPrice: p.stopPrice });
        }
        if (costPolicy?.basis !== 'gross-mark-to-stop') reasons.push('risk-basis-unknown');
        if (!reasons.length) {
          row.coveredShares = Math.min(group.shares, p.quantity);
          row.unknownShares = group.shares - row.coveredShares;
          row.riskCash = (quote.price - p.stopPrice) * row.coveredShares;
          riskCash += row.riskCash; coveredValue += quote.price * row.coveredShares;
          if (row.unknownShares) reasons.push('quantity-uncovered');
        }
      }
      result.coverage.shares += group.shares;
      result.coverage.coveredShares += row.coveredShares;
      if (row.unknownShares) result.unknown.push({ code: row.code, shares: row.unknownShares, reasons: [...reasons], planIds: row.planIds });
      result.positions.push(row);
    }
    const c = result.coverage;
    c.unknownShares = c.shares - c.coveredShares;
    c.totalValue = allPriced ? c.pricedValue : null;
    c.marketValuePct = allPriced && c.totalValue > 0 ? coveredValue / c.totalValue * 100 : null;
    result.knownRiskCash = c.coveredShares > 0 || c.shares === 0 ? riskCash : null;
    result.riskPct = result.knownRiskCash !== null && positive(capitalBasis) ? result.knownRiskCash / capitalBasis * 100 : null;
    result.concentration.denominatorKnown = allPriced;
    const industryGroups = new Map();
    for (const row of result.positions) {
      result.concentration.byCode.push({ code: row.code, value: row.value, pct: allPriced && c.totalValue > 0 ? row.value / c.totalValue * 100 : null });
      const industry = row.industry;
      const group = industryGroups.get(industry) || { industry, knownValue: 0, value: 0, pct: null, codes: [] };
      group.codes.push(row.code);
      if (row.value === null) group.value = null;
      else { group.knownValue += row.value; if (group.value !== null) group.value += row.value; }
      industryGroups.set(industry, group);
    }
    result.concentration.byIndustry = [...industryGroups.values()].map(group => ({ ...group, pct: allPriced && c.totalValue > 0 ? group.value / c.totalValue * 100 : null }));
    return result;
  }
  function calculateNewPositionSize({ capital, riskPct, entry, stop, availableCash = null, costPolicy, unitShares = 1 } = {}) {
    if (![capital, riskPct, entry, stop].every(positive) || entry <= stop || ![1, 1000].includes(unitShares)) return null;
    if (number(costPolicy?.feeDiscount) === null || costPolicy.feeDiscount < 0 || number(costPolicy?.minFee) === null || costPolicy.minFee < 0) return null;
    if (availableCash !== null && (number(availableCash) === null || availableCash < 0)) return null;
    const budget = capital * riskPct / 100, perShareLoss = entry - stop + entry * 0.00471;
    const buyFee = shares => shares ? Math.max(costPolicy.minFee, Math.round(shares * entry * 0.001425 * costPolicy.feeDiscount)) : 0;
    const initialRisk = shares => shares * perShareLoss + Math.max(0, buyFee(shares) - shares * entry * 0.000855);
    const cash = shares => shares * entry + buyFee(shares);
    let low = 0, high = Math.min(Math.floor(budget / perShareLoss / unitShares), Math.floor(Number.MAX_SAFE_INTEGER / entry / unitShares));
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2), shares = mid * unitShares;
      if (initialRisk(shares) <= budget && (availableCash === null || cash(shares) <= availableCash)) low = mid; else high = mid - 1;
    }
    const shares = low * unitShares;
    return { shares, lots: Math.floor(shares / 1000), unitShares, budget, requiredCash: cash(shares), buyFee: buyFee(shares), initialRiskCash: initialRisk(shares), cashChecked: availableCash !== null, availableCash, costBasis: 'round-trip-0.471pct-plus-buy-fee-excess' };
  }
  root.Stock1Risk = Object.freeze({ calculatePortfolioPlanRisk, calculateNewPositionSize, portfolioQuoteEvidence, QUOTE_TOLERANCE_MS });
})(globalThis);
