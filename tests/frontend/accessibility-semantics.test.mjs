import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test("all authored tablists expose tabs, selected state, and one roving tab stop", () => {
  app.evalIn("render()");
  const lists = json(`[...document.querySelectorAll('[role="tablist"]')].map((list) => {
    const tabs = [...list.querySelectorAll(':scope > button')];
    return {
      count: tabs.length,
      roles: tabs.map((tab) => tab.getAttribute('role')),
      selected: tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
      tabStops: tabs.filter((tab) => tab.tabIndex === 0).length,
    };
  })`);
  assert.ok(lists.length >= 6);
  for (const list of lists) {
    assert.ok(list.count > 0);
    assert.ok(list.roles.every((role) => role === "tab"));
    assert.equal(list.selected, 1);
    assert.equal(list.tabStops, 1);
  }
});

test("tab keyboard navigation moves focus and activates the next tab", () => {
  const result = json(`(() => {
    state.overnightView = 'overview'; render();
    const list = document.querySelector('[aria-label="隔日沖分群"]');
    const first = list.querySelector('[data-overnight-view="overview"]');
    const second = list.querySelector('[data-overnight-view="strongContinuation"]');
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return { focused: document.activeElement === second, view: state.overnightView };
  })()`);
  assert.equal(result.focused, true);
  assert.equal(result.view, "strongContinuation");
});

test("partial detail and surveillance renders keep active tab ARIA state in sync", () => {
  const result = json(`(() => {
    state.detailTab = '即時';
    state.surveillanceTab = 'aboutToDispose';
    render();

    document.querySelector('[data-detail-tab="均線"]').click();
    const detailTabs = [...document.querySelectorAll('.detail-tabs > button')].map((tab) => ({
      key: tab.dataset.detailTab,
      selected: tab.getAttribute('aria-selected'),
      tabIndex: tab.tabIndex,
    }));

    state.screen = 'surveillance';
    render();
    document.querySelector('[data-surv-tab="attention"]').click();
    const surveillanceTabs = [...document.querySelectorAll('#survTabs > button')].map((tab) => ({
      key: tab.dataset.survTab,
      active: tab.classList.contains('is-active'),
      selected: tab.getAttribute('aria-selected'),
      tabIndex: tab.tabIndex,
    }));

    return {
      detailState: state.detailTab,
      detailTabs,
      surveillanceState: state.surveillanceTab,
      surveillanceTabs,
      surveillanceName: document.getElementById('survTabs').getAttribute('aria-label'),
    };
  })()`);

  assert.equal(result.detailState, "均線");
  assert.deepEqual(result.detailTabs.filter((tab) => tab.selected === "true"), [
    { key: "均線", selected: "true", tabIndex: 0 },
  ]);
  assert.equal(result.surveillanceState, "attention");
  assert.deepEqual(result.surveillanceTabs.filter((tab) => tab.active), [
    { key: "attention", active: true, selected: "true", tabIndex: 0 },
  ]);
  assert.equal(result.surveillanceName, "處置看板分類");
});

test("active main navigation exposes aria-current and global search has a name", () => {
  const result = json(`(() => {
    state.screen = 'technical'; updateActiveNav();
    const nav = [...document.querySelectorAll('.nav-action')];
    return {
      current: nav.filter((button) => button.getAttribute('aria-current') === 'page').map((button) => button.dataset.screen),
      staleCurrent: nav.some((button) => button.dataset.screen !== 'technical' && button.hasAttribute('aria-current')),
      searchLabel: document.getElementById('searchInput').getAttribute('aria-label'),
    };
  })()`);
  assert.deepEqual(result.current, ["technical", "technical"]);
  assert.equal(result.staleCurrent, false);
  assert.equal(result.searchLabel, "搜尋股票");
});

test("narrow bottom navigation keeps full accessible names beside its short visual labels", () => {
  const items = json(`[...document.querySelectorAll('.bottom-nav .nav-action')].map((button) => ({
    name: button.getAttribute('aria-label'),
    wide: button.querySelector('.nav-label-wide')?.textContent,
    narrow: button.querySelector('.nav-label-narrow')?.textContent,
    narrowDecorative: button.querySelector('.nav-label-narrow')?.getAttribute('aria-hidden'),
  }))`);
  assert.deepEqual(items.map((item) => item.name), [
    "隔日沖", "盤中選股", "策略雷達", "自選股", "技術分析", "處置看板", "更多",
  ]);
  assert.ok(items.every((item) => item.wide && item.narrow && item.narrowDecorative === "true"));
});

test("glossary terms and swing cards provide Enter and Space activation without hijacking nested controls", () => {
  const result = json(`(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    host.innerHTML = glossLink('量比', '量比5');
    const gloss = host.querySelector('[data-glossary-term]');
    const glossSemantics = {
      role: gloss.getAttribute('role'),
      tabIndex: gloss.tabIndex,
      hasPopup: gloss.getAttribute('aria-haspopup'),
      controls: gloss.getAttribute('aria-controls'),
    };
    const glossCalls = [];
    const originalOpenGlossaryAtTerm = openGlossaryAtTerm;
    openGlossaryAtTerm = (term, trigger) => glossCalls.push({ term, sameTrigger: trigger === gloss });
    gloss.focus();
    gloss.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    gloss.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    openGlossaryAtTerm = originalOpenGlossaryAtTerm;

    host.innerHTML = '<article class="swing-card" data-swing-code="2330" role="button" tabindex="0"><strong>台積電</strong><button type="button" data-child>內層按鈕</button></article>';
    const card = host.querySelector('.swing-card');
    const child = host.querySelector('[data-child]');
    let cardClicks = 0;
    card.click = () => { cardClicks += 1; };
    card.focus();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    host.remove();

    return { glossSemantics, glossCalls, cardClicks };
  })()`);

  assert.deepEqual(result.glossSemantics, {
    role: "button",
    tabIndex: 0,
    hasPopup: "dialog",
    controls: "glossaryModal",
  });
  assert.deepEqual(result.glossCalls, [
    { term: "量比5", sameTrigger: true },
    { term: "量比5", sameTrigger: true },
  ]);
  assert.equal(result.cardClicks, 2, "nested native controls must not activate the parent role=button card");
});

test("visual selection classes stay synchronized with ARIA pressed state", () => {
  const result = json(`(() => {
    const snapshot = (selector, dataKey) => [...document.querySelectorAll(selector)].map((button) => ({
      value: button.dataset[dataKey],
      active: button.classList.contains(selector.includes('surv-') ? 'is-on' : 'is-active'),
      pressed: button.getAttribute('aria-pressed'),
    }));

    state.survMarket = 'TPEx';
    state.survInterval = '20';
    renderSurvToolbar('inDisposition');

    state.technicalPeriod = 'week';
    updateTechnicalPeriodButtons();
    updateZoomPeriodButtons();

    drawState.tool = 'trend';
    drawState.color = DRAW_COLORS[1];
    renderDrawColors();
    updateDrawToolsUI();

    return {
      markets: snapshot('[data-surv-market]', 'survMarket'),
      intervals: snapshot('[data-surv-interval]', 'survInterval'),
      technical: snapshot('[data-analysis-period]', 'analysisPeriod'),
      zoom: snapshot('[data-zoom-period]', 'zoomPeriod'),
      tools: snapshot('[data-draw-tool]', 'drawTool'),
      colors: snapshot('[data-draw-color]', 'drawColor'),
    };
  })()`);

  for (const group of Object.values(result)) {
    assert.equal(group.filter((item) => item.active).length, 1);
    assert.equal(group.filter((item) => item.pressed === "true").length, 1);
    assert.ok(group.every((item) => item.pressed === String(item.active)));
  }
  assert.equal(result.markets.find((item) => item.active).value, "TPEx");
  assert.equal(result.intervals.find((item) => item.active).value, "20");
  assert.equal(result.technical.find((item) => item.active).value, "week");
  assert.equal(result.zoom.find((item) => item.active).value, "week");
  assert.equal(result.tools.find((item) => item.active).value, "trend");
  assert.equal(result.colors.find((item) => item.active).value, result.colors[1].value);
});

test("shared-note and company-summary textareas have accessible names", () => {
  const names = json(`(() => {
    authState.user = { id: 'u1', username: 'admin', displayName: '管理者', role: 'admin' };
    notesState.code = '2330';
    notesState.notes = [];
    renderStockNotes({ code: '2330' });

    state.technicalCode = '2330';
    companyState.code = '2330';
    companyState.data = { industry: '半導體業', summary: '' };
    companyState.editing = true;
    renderCompanyProfile();

    return {
      note: document.querySelector('[data-note-form] textarea')?.getAttribute('aria-label'),
      company: document.querySelector('[data-company-form] textarea')?.getAttribute('aria-label'),
    };
  })()`);
  assert.deepEqual(names, {
    note: "新增共享備註",
    company: "公司簡介內容",
  });
});
