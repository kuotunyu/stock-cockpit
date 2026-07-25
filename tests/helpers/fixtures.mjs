// 測試 fixtures 工廠：所有日期都以「相對今天的位移」動態產生（自備獨立日期運算，
// 不依賴受測程式），欄位名 1:1 對齊 server.mjs 消費端（getSurveillanceBoard 等）。
// 任何一天執行測試，分類結果都是確定的。

// ---- 獨立日期運算（勿改用 server.mjs 的函式：fixtures 必須是獨立的真值來源）----
const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
});
export function compactToday(offsetDays = 0) {
  const parts = Object.fromEntries(taipeiDateFormatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  const d = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
// 交易日位移（週末感知）。compactToday 是純日曆位移，對「備份檔名用今天」「不可填未來成交日」
// 這類測試才正確；但**前向驗證類**測試的前提是「今天是交易日、昨天是上一個交易日」，
// 用日曆位移在週六日會產生無效前提（引擎正確地回 pending，測試卻期待 win）→ 每個週末整套轉紅。
// 這裡只跳過週六日：offset 0 = 最近一個平日（週末往回退到週五），負數往前數 N 個平日。
// 國定假日仍由各測試自行 mock holidaySchedule 決定，不在這裡猜。
export function compactTradingDay(offsetTradingDays = 0) {
  const parts = Object.fromEntries(taipeiDateFormatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  const d = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const isWeekend = (date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate() - 1);
  const step = offsetTradingDays >= 0 ? 1 : -1;
  for (let moved = 0; moved < Math.abs(offsetTradingDays); moved += 1) {
    do { d.setUTCDate(d.getUTCDate() + step); } while (isWeekend(d));
  }
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

// "20260702" → "115/07/02"（TWSE 處置期間格式）
export function rocSlash(compact) {
  return `${Number(compact.slice(0, 4)) - 1911}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`;
}
// "20260702" → "1150702"（TPEx 處置期間格式）
export function rocCompact(compact) {
  return `${Number(compact.slice(0, 4)) - 1911}${compact.slice(4, 8)}`;
}
// 相對月份 → 民國 5 碼年月（月營收「資料年月」格式，例 "11505"）
export function rocYearMonth(offsetMonths = 0) {
  const today = compactToday();
  const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(4, 6)) - 1 + offsetMonths, 1));
  return `${d.getUTCFullYear() - 1911}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---- 處置看板 8 來源的列工廠（欄位名核對自 server.mjs:1473–1601 消費端）----
export const twsePunishRow = ({ code, startOff, endOff, detail = "每五分鐘撮合一次", reason = "股價波動異常" }) => ({
  Code: code,
  Name: `測${code}`,
  DispositionPeriod: `${rocSlash(compactToday(startOff))}～${rocSlash(compactToday(endOff))}`,
  Detail: detail,
  ReasonsOfDisposition: reason,
});
export const tpexDisposalRow = ({ code, startOff, endOff, cond = "約每二十分鐘撮合一次" }) => ({
  SecuritiesCompanyCode: code,
  CompanyName: `櫃${code}`,
  DispositionPeriod: `${rocCompact(compactToday(startOff))}~${rocCompact(compactToday(endOff))}`,
  DisposalCondition: cond,
  DispositionReasons: "價量異常",
});
export const twseNoticeRow = ({ code, count = 1, reason = "近期價量異常" }) => ({
  Code: code,
  Name: `測${code}`,
  NumberOfAnnouncement: String(count),
  TradingInfoForAttention: reason,
});
export const tpexWarningRow = ({ code, reason = "週轉率過高" }) => ({
  SecuritiesCompanyCode: code,
  CompanyName: `櫃${code}`,
  TradingInformation: reason,
});
export const bfiauuRow = ({ code, name, value }) => ({
  Code: code,
  Name: name || `測${code}`,
  TradeValue: Number(value).toLocaleString("en-US"), // TWSE 逐筆帶千分位
});
export const tpexBlockRow = ({ code, name, value, dateOff = 0 }) => ({
  Code: code,
  Name: name || `櫃${code}`,
  TradeValue: String(value),
  Date: compactToday(dateOff),
});
export const twt85uRow = ({ code, name, periodic = false }) => ({
  Code: code,
  Name: name || `測${code}`,
  PeriodicCallAuctionTrading: periodic ? "**" : "  ",
});
export const tpexCmodeRow = ({ code, name, altered = "Ｙ", periodic = "", dateOff = 0, suspension = "" }) => ({
  Date: rocCompact(compactToday(dateOff)), // 實際 API 是 ROC 7 碼（例 "1150625"）
  SecuritiesCompanyCode: code,
  CompanyName: name || `櫃${code}`,
  AlteredTrading: altered,
  PeriodicTrading: periodic,
  ManagedStock: "",
  MatchingFrequency: periodic ? "030" : "",
  SuspensionOfTrading: suspension, // 停止交易旗標：官方值是全形「Ｙ」
  " FinancialAnnouncements": "Ｙ", // 官方欄位名真的帶前導空白
});

// ---- 停牌/下市名單（getRiskSets 的 halted/delisted 來源；欄名核對自 2026-07-02 實測）----
// TWSE 暫停交易：清單含「已恢復」的歷史列，消費端必須做日期窗。resumeOff = null → 尚無恢復日。
export const twtawuRow = ({ code, haltOff = 0, resumeOff = null }) => ({
  Number: "1",
  Code: code,
  Name: `測${code}`,
  TradingHaltDate: rocCompact(compactToday(haltOff)),
  TradingHaltTime: "090000",
  TradingResumptionDate: resumeOff === null ? "" : rocCompact(compactToday(resumeOff)),
  TradingResumptionTime: resumeOff === null ? "" : "090000",
});
// TPEx 歷史暫停交易：DateOfResumedTrading 空字串＝仍停牌中。
export const tpexSpendiRow = ({ code, haltOff = 0, resumeOff = null }) => ({
  Date: String(Number(compactToday(0).slice(0, 4)) - 1911), // 官方此欄只有民國年
  Serial: "1",
  SecuritiesCompanyCode: code,
  CompanyName: `櫃${code}`,
  DateOfSuspendedTrading: rocCompact(compactToday(haltOff)),
  TimeOfSuspendedTrading: "0900",
  DateOfResumedTrading: resumeOff === null ? "" : rocCompact(compactToday(resumeOff)),
  TimeOfResumedTrading: "",
});
// TWSE 終止上市：DelistingDate 是斜線民國（"115/06/23"）；含 2001 年以來全部下市股。
export const suspendListingRow = ({ code, dateOff = -30 }) => ({
  DelistingDate: rocSlash(compactToday(dateOff)),
  Company: `測${code}`,
  Code: code,
});

// ---- 基本面四來源（欄名核對自 2026-07-02 實測；TWSE/TPEx 常不一致、還有官方拼錯欄位）----
// 月營收：TWSE t187ap05_L 與 TPEx mopsfin_t187ap05_O 欄名完全相同（都是中文）。
export const revenueRow = ({ code, ymOff = -1, revenue = 1000000, mom = 1.5, yoy = 10.2, cumYoy = 8.8 }) => ({
  出表日期: rocCompact(compactToday(0)),
  資料年月: rocYearMonth(ymOff),
  公司代號: code,
  公司名稱: `測${code}`,
  產業別: "24",
  "營業收入-當月營收": String(revenue),
  "營業收入-上月營收": String(Math.round(revenue / (1 + mom / 100))),
  "營業收入-去年當月營收": String(Math.round(revenue / (1 + yoy / 100))),
  "營業收入-上月比較增減(%)": String(mom),
  "營業收入-去年同月增減(%)": String(yoy),
  "累計營業收入-當月累計營收": String(revenue * 5),
  "累計營業收入-去年累計營收": String(Math.round((revenue * 5) / (1 + cumYoy / 100))),
  "累計營業收入-前期比較增減(%)": String(cumYoy),
  備註: "",
});
// 季 EPS：TWSE 版（公司代號＋基本每股盈餘(元)＋年度）
export const epsRowTwse = ({ code, yearOff = 0, quarter = 1, eps = 5.5 }) => ({
  出表日期: rocCompact(compactToday(0)),
  年度: String(Number(compactToday().slice(0, 4)) + yearOff - 1911),
  季別: String(quarter),
  公司代號: code,
  公司名稱: `測${code}`,
  產業別: "24",
  "基本每股盈餘(元)": String(eps),
  普通股每股面額: "新台幣 10.0000元",
  營業收入: "1000000",
  營業利益: "300000",
  營業外收入及支出: "1000",
  稅後淨利: "250000",
});
// 季 EPS：TPEx 版（SecuritiesCompanyCode＋基本每股盈餘（無「(元)」）＋Year）
export const epsRowTpex = ({ code, yearOff = 0, quarter = 1, eps = 1.2 }) => ({
  Date: rocCompact(compactToday(0)),
  Year: String(Number(compactToday().slice(0, 4)) + yearOff - 1911),
  季別: String(quarter),
  SecuritiesCompanyCode: code,
  CompanyName: `櫃${code}`,
  產業別: "24",
  基本每股盈餘: String(eps),
  普通股每股面額: "新台幣 10.0000元",
  營業收入: "500000",
  營業利益: "100000",
  營業外收入及支出: "500",
  稅後淨利: "80000",
});
// 估值：TWSE BWIBBU_ALL（pe: null → 官方虧損股給空字串）
export const bwibbuRow = ({ code, pe = 15.5, dividendYield = 3.2, pbr = 1.8, dateOff = -1 }) => ({
  Date: rocCompact(compactToday(dateOff)),
  Code: code,
  Name: `測${code}`,
  PEratio: pe === null ? "" : String(pe),
  DividendYield: String(dividendYield),
  PBratio: String(pbr),
});
// 估值：TPEx peratio_analysis（多每股股利 DividendPerShare）
export const peratioRow = ({ code, pe = 20.1, dps = 3.0, dividendYield = 2.5, pbr = 2.2, dateOff = -1 }) => ({
  Date: rocCompact(compactToday(dateOff)),
  SecuritiesCompanyCode: code,
  CompanyName: `櫃${code}`,
  PriceEarningRatio: pe === null ? "" : String(pe),
  DividendPerShare: String(dps),
  YieldRatio: String(dividendYield),
  PriceBookRatio: String(pbr),
});
// 除權息預告：TWSE TWT48U_ALL（Exdividend 值＝「息」/「權」）
export const twt48uRow = ({ code, exOff = 5, kind = "息", cash = 2.5, stockRatio = 0 }) => ({
  Date: rocCompact(compactToday(exOff)),
  Code: code,
  Name: `測${code}`,
  Exdividend: kind,
  StockDividendRatio: String(stockRatio),
  SubscriptionRatio: "0",
  SubscriptionPricePerShare: "0",
  CashDividend: String(cash),
});
// 除權息預告：TPEx（官方欄名就拼錯 Rrights；值是「除息/除權」全名）
export const exrightPrepostRow = ({ code, exOff = 5, kind = "除息", cash = 1.5, stockRatio = 0 }) => ({
  ExRrightsExDividendDate: rocCompact(compactToday(exOff)),
  SecuritiesCompanyCode: code,
  CompanyName: `櫃${code}`,
  ExRrightsExDividend: kind,
  StockDividendRatio: String(stockRatio),
  SubscriptionRatioToNewSharesIssued: "0",
  SubscriptionPricePerShare: "0",
  CashDividend: String(cash),
});

// 公司基本資料（發行股數＋產業／簡稱共用同一官方端點）。
export const twseCompanyProfileRow = ({ code, name, shares = 1000000000, industry = "24" }) => ({
  "公司代號": code,
  "公司簡稱": name || `測${code}`,
  "產業別": industry,
  "已發行普通股數或TDR原股發行股數": String(shares),
});
export const tpexCompanyProfileRow = ({ code, name, shares = 500000000, industry = "24" }) => ({
  SecuritiesCompanyCode: code,
  CompanyAbbreviation: name || `櫃${code}`,
  SecuritiesIndustryCode: industry,
  IssueShares: String(shares),
});

// ---- 一鍵接好基本面需要的 10 條路由（4 維度 ×2 市場＋公司基本資料 ×2）----
// overrides: { twseRevenue:[], tpexRevenue:[], twseEps:[], tpexEps:[], bwibbu:[], tpexPeratio:[],
//              twt48u:[], tpexExright:[], twseCompanyMeta:[], tpexCompanyMeta:[] }
export function fundamentalsRoutes(overrides = {}) {
  const o = overrides;
  return [
    { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap05_L/, reply: () => o.twseRevenue || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap05_O/, reply: () => o.tpexRevenue || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap14_L/, reply: () => o.twseEps || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap14_O/, reply: () => o.tpexEps || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/BWIBBU_ALL/, reply: () => o.bwibbu || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_peratio_analysis/, reply: () => o.tpexPeratio || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/TWT48U_ALL/, reply: () => o.twt48u || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_exright_prepost/, reply: () => o.tpexExright || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/, reply: () => o.twseCompanyMeta || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/, reply: () => o.tpexCompanyMeta || [] },
  ];
}

// ---- 整批收盤（enrich 用 reference）----
export const stockDayAllRow = ({ code, name, close = 100, open = 99, high = 101, low = 98, volume = 1500000, dateOff = 0 }) => ({
  Date: compactToday(dateOff),
  Code: code,
  Name: name || `測${code}`,
  ClosingPrice: String(close),
  OpeningPrice: String(open),
  HighestPrice: String(high),
  LowestPrice: String(low),
  Change: "1.0000",
  TradeVolume: String(volume),
  TradeValue: String(volume * close),
  Transaction: "1000",
});
export const tpexDailyCloseRow = ({ code, name, close = 50, open = 49, high = 51, low = 48, volume = 800000, dateOff = 0 }) => ({
  Date: compactToday(dateOff),
  SecuritiesCompanyCode: code,
  CompanyName: name || `櫃${code}`,
  Close: String(close),
  Open: String(open),
  High: String(high),
  Low: String(low),
  Change: "0.5",
  TradingShares: String(volume),
  TransactionAmount: String(volume * close),
  TransactionNumber: "500",
});

// ---- TWSE MIS 即時報價列（normalizeMisQuote 消費端：z/pz/oz/y/o/h/l/s/v/d/t/ex/c/n）----
// z="-" 表示目前無最新成交價（官方真的會回 "-"），是 priceStale 語意的關鍵輸入。
export const misQuoteRow = ({ code, name, z = "-", pz = "-", oz = "-", y = "-", o = "-", h = "-", l = "-", s = "-", v = "-", dateOff = 0, t = "13:30:00", ex = "tse" } = {}) => ({
  c: code,
  n: name || `測${code}`,
  z: String(z),
  pz: String(pz),
  oz: String(oz),
  y: String(y),
  o: String(o),
  h: String(h),
  l: String(l),
  s: String(s),
  v: String(v),
  d: compactToday(dateOff),
  t,
  ex,
});

// ---- 台指期（TAIFEX MIS getQuoteList 列＋日報表列；normalizeTaifexMisTx / normalizeTxFuture 消費端）----
export const taifexMisRow = ({ symbolId = "TXFG6-F", last = 23000, ref = 22900, diff = 100, diffRate = 0.44, dateOff = 0, time = "134500", volume = 50000 } = {}) => ({
  SymbolID: symbolId,
  CLastPrice: String(last),
  CRefPrice: String(ref),
  CDiff: String(diff),
  CDiffRate: String(diffRate),
  CDate: compactToday(dateOff),
  CTime: time,
  CTotalVolume: String(volume),
});
export const taifexDailyRow = ({ last = 22800, change = -50, pct = "-0.22%", dateOff = 0, session = "一般", month = "202607" } = {}) => ({
  Date: `${compactToday(dateOff).slice(0, 4)}/${compactToday(dateOff).slice(4, 6)}/${compactToday(dateOff).slice(6, 8)}`,
  Contract: "TX",
  "ContractMonth(Week)": month,
  TradingSession: session,
  Last: String(last),
  Change: String(change),
  "%": pct,
  Volume: "80000",
  SettlementPrice: String(last),
});

// ---- 三大法人買賣超（陣列列；索引 1:1 對齊 normalizeTwse/TpexInstitutionalRow）----
// TWSE T86：19 欄（0 代號、1 名稱、2-4 外資買/賣/淨、5-7 外資自營、8-10 投信、11 自營淨、
// 12-14 自營自行、15-17 自營避險、18 合計）。數字帶千分位（官方格式）。
// 官方 T86：row[4] 外陸資（**不含**外資自營商）、row[7] 外資自營商、row[10] 投信、row[11] 自營商、
// row[18] 三大法人合計（**含**外資自營商）。foreignDealerNet 以前寫死 "0"，測試因此看不出
// 「四格相加 ≠ 合計」這個差異（D-32），改為可帶入並讓預設值反映真實恆等式。
export const t86Row = ({ code, name, foreignNet = 1000000, foreignDealerNet = 30000, trustNet = 500000, dealerNet = -200000, totalNet = 1330000 } = {}) => [
  code, name || `測${code}`,
  "5,000,000", "4,000,000", Number(foreignNet).toLocaleString("en-US"),
  "0", "0", Number(foreignDealerNet).toLocaleString("en-US"),
  "800,000", "300,000", Number(trustNet).toLocaleString("en-US"),
  Number(dealerNet).toLocaleString("en-US"),
  "100,000", "250,000", "-150,000",
  "60,000", "110,000", "-50,000",
  Number(totalNet).toLocaleString("en-US"),
];
// TPEx 三大法人：24 欄（0 代號、1 名稱、2-4 外資、5-7 外資自營、8-10 外資合計、11-13 投信、
// 14-16 自營自行、17-19 自營避險、20-22 自營合計、23 總計）。
export const tpexInstiRow = ({ code, name, foreignNet = 80000, trustNet = 20000, dealerNet = 5000, totalNet = 105000 } = {}) => [
  code, name || `櫃${code}`,
  "500,000", "420,000", Number(foreignNet).toLocaleString("en-US"),
  "0", "0", "0",
  "500,000", "420,000", Number(foreignNet).toLocaleString("en-US"),
  "50,000", "30,000", Number(trustNet).toLocaleString("en-US"),
  "20,000", "18,000", "2,000",
  "8,000", "5,000", "3,000",
  "28,000", "23,000", Number(dealerNet).toLocaleString("en-US"),
  Number(totalNet).toLocaleString("en-US"),
];

// ---- 融資融券餘額（陣列列；索引對齊 normalizeTwse/TpexMarginRow）----
// TWSE MI_MARGN：消費 0 代號、1 名稱、5 融資前日、6 融資今日、7 融資限額、11 融券前日、12 融券今日。
export const twseMarginRow = ({ code, name, marginPrev = 10000, marginBalance = 12000, marginLimit = 50000, shortPrev = 800, shortBalance = 1000 } = {}) => [
  code, name || `測${code}`,
  "3,000", "1,000", "0",
  Number(marginPrev).toLocaleString("en-US"), Number(marginBalance).toLocaleString("en-US"), Number(marginLimit).toLocaleString("en-US"),
  "0", "200", "0",
  Number(shortPrev).toLocaleString("en-US"), Number(shortBalance).toLocaleString("en-US"),
  "0", "0", "註記",
];
// TPEx 融資融券：消費 0 代號、1 名稱、2 融資前日、6 融資今日、8 資使用率(%)、10 融券前日、14 融券今日。
export const tpexMarginRow = ({ code, name, marginPrev = 5000, marginBalance = 6000, usagePct = 12.5, shortPrev = 300, shortBalance = 450 } = {}) => [
  code, name || `櫃${code}`,
  Number(marginPrev).toLocaleString("en-US"), "1,500", "500", "0",
  Number(marginBalance).toLocaleString("en-US"), "48,000", String(usagePct), "0",
  Number(shortPrev).toLocaleString("en-US"), "200", "50", "0",
  Number(shortBalance).toLocaleString("en-US"), "9,000",
];

// ---- 確定性 OHLCV 產生器（技術分析／swing 測試用；線性趨勢＋固定波形，無亂數）----
export function candles({ n = 120, base = 100, drift = 0.5, wobble = 2, volBase = 5000 } = {}) {
  const rows = [];
  const start = new Date();
  start.setDate(start.getDate() - n);
  for (let i = 0; i < n; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const mid = base + drift * i + Math.sin(i / 5) * wobble;
    const open = mid - 0.4;
    const close = mid + 0.4;
    const high = mid + wobble * 0.8;
    const low = mid - wobble * 0.8;
    const volumeLots = volBase + (i % 7) * 500;
    rows.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: volumeLots,
      volumeLots, // swing 特徵（avgVol5/20）吃這個欄位
      tradeValue: Math.round(volumeLots * 1000 * close), // 流動性評分用
    });
  }
  return rows;
}

// ---- 一鍵接好處置看板＋風險名單需要的路由（處置／停牌／reference／MIS）----
// overrides: { twsePunish:[rows], tpexDisposal:[], twseNotice:[], tpexWarning:[],
//              bfiauu:[], tpexBlock:[], twt85u:[], tpexCmode:[],
//              twtawu:[], tpexSpendi:[], suspendListing:[],
//              reference:[stockDayAllRows], tpexReference:[rows], misQuotes:[misQuoteRows] }
export function surveillanceRoutes(overrides = {}) {
  const o = overrides;
  return [
    { match: /openapi\.twse\.com\.tw\/v1\/announcement\/punish/, reply: () => o.twsePunish || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/TWTAWU/, reply: () => o.twtawu || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/company\/suspendListingCsvAndHtml/, reply: () => o.suspendListing || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_spendi_history/, reply: () => o.tpexSpendi || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/announcement\/notice/, reply: () => o.twseNotice || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/announcement\/BFIAUU/, reply: () => o.bfiauu || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/TWT85U/, reply: () => o.twt85u || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_disposal_information/, reply: () => o.tpexDisposal || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_trading_warning_information/, reply: () => o.tpexWarning || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_daily_qutoes_block/, reply: () => o.tpexBlock || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_cmode/, reply: () => o.tpexCmode || [] },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: () => o.reference || [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: () => o.tpexReference || [] },
    { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: () => ({ msgArray: o.misQuotes || [] }) },
  ];
}
