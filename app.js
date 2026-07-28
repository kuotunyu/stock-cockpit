if (window.location.protocol === "file:") {
  window.location.replace("http://127.0.0.1:5174/");
}

const strategyCatalog = {
  strong: [
    {
      label: "量價轉強",
      aliases: ["權證偏多", "權證做多"],
      description: "價格走強且量能放大，先當作盤中轉強觀察，不等於買進訊號。",
      basis: "本機推估：漲幅、均量比、成交量與短線走勢。",
    },
    {
      label: "量能集中",
      aliases: ["資金買進", "主投買進股"],
      description: "量能和連量集中放大，代表市場注意度提高；目前不是正式法人或分點資料。",
      basis: "本機推估：成交量、連量、漲幅排序。",
    },
    {
      label: "沿線轉強",
      aliases: ["資金沿線", "主投買沿上"],
      description: "股價沿短線均線往上，偏趨勢延伸觀察。",
      basis: "本機推估：短線走勢、量能、均線方向。",
    },
    {
      label: "強勢突破",
      aliases: ["飆風向上股"],
      description: "強勢突破型股票，重點是漲幅與短線動能。",
      basis: "本機推估：漲幅、即時走勢與量能。",
    },
    {
      label: "上軌突破",
      aliases: ["布林突破", "布林多啵叭"],
      description: "布林通道是真實技術指標；這裡指股價接近或突破上軌的偏多觀察。",
      basis: "目前只用本機樣本推估，尚未全市場正式計算布林上軌。",
    },
    {
      label: "急漲高波動",
      aliases: ["空方回補", "嗄爆空單股"],
      description: "上漲快速、可能讓空方回補的股票，屬高波動觀察。",
      basis: "本機推估：急漲、量能與連量。",
    },
    {
      label: "多頭回檔",
      aliases: ["多頭回檔買"],
      description: "多頭趨勢中短線回檔後重新轉強。",
      basis: "本機推估：回檔幅度、短線反彈與均線位置。",
    },
    {
      label: "下緣反彈",
      aliases: ["下軌低接買"],
      description: "接近布林下緣或短線低檔後反彈，風險比突破型高。",
      basis: "本機推估：低檔反彈、均線與量能。",
    },
  ],
  weak: [
    {
      label: "轉弱觀察",
      aliases: ["權證偏空", "權證做空"],
      description: "價格或短線結構轉弱，適合先放進風險觀察。",
      basis: "本機推估：弱勢價格與題材標籤。",
    },
    {
      label: "量增轉弱",
      aliases: ["主投賣出股"],
      description: "量能放大但價格偏弱，適合觀察賣壓或反彈無力。",
      basis: "本機推估：跌幅、量能與連量。",
    },
    {
      label: "弱勢沿線",
      aliases: ["弱勢沿下軌"],
      description: "價格沿弱勢趨勢下滑，偏風險觀察。",
      basis: "本機推估：短線走勢與均線方向。",
    },
    {
      label: "月線轉弱",
      aliases: ["月線下彎空"],
      description: "中期均線轉弱，偏空方趨勢觀察。",
      basis: "本機推估：均線方向與跌幅。",
    },
    {
      label: "下軌跌破",
      aliases: ["布林空啵叭"],
      description: "布林通道是真實技術指標；這裡指股價接近或跌破下軌的偏空觀察。",
      basis: "目前只用本機樣本推估，尚未全市場正式計算布林下軌。",
    },
    {
      label: "高檔轉弱",
      aliases: ["高檔轉弱"],
      description: "高檔區轉弱，適合風險控管觀察。",
      basis: "本機推估：高檔跌幅、量能與走勢。",
    },
  ],
  intraday: [
    {
      label: "爆量急動",
      aliases: ["盤中爆量", "即時爆量"],
      description: "盤中量能明顯放大且價格有動，適合先看是否追價過熱或資金集中。",
      basis: "目前觀察池：已載入股票的即時漲跌、均量比、成交量與短線走勢；不是全市場掃描。",
    },
    {
      label: "急漲觀察",
      aliases: ["盤中急漲"],
      description: "盤中漲幅較大或短線走勢轉強，偏機會觀察，但仍需看成交量與風險。",
      basis: "目前觀察池：官方即時報價 + 本機短線走勢推估。",
    },
    {
      label: "急跌觀察",
      aliases: ["盤中急跌"],
      description: "盤中跌幅較大或短線走勢轉弱，偏風險觀察。",
      basis: "目前觀察池：官方即時報價 + 本機短線走勢推估。",
    },
  ],
  turnover: [
    {
      label: "量能熱區",
      aliases: ["資金關注焦點"],
      description: "量能和週轉率偏高的資金熱區。",
      basis: "本機推估：成交量、週轉率、均量比。",
    },
    {
      label: "換手高危",
      aliases: ["大量換手高危"],
      description: "大量換手代表熱度高，但也代表追高風險高。",
      basis: "本機推估：爆量、振幅、週轉率。",
    },
    {
      label: "短線熱區",
      aliases: ["隔日沖熱區"],
      description: "疑似短線資金聚集區，需搭配隔日沖公式和風險清單看。",
      basis: "本機推估：量能、漲幅、連量。",
    },
    {
      label: "爆量警戒",
      aliases: ["爆量警戒"],
      description: "成交量異常放大，先看風險再看機會。",
      basis: "本機推估：量比、成交量、振幅。",
    },
  ],
};

const strategies = Object.fromEntries(
  Object.entries(strategyCatalog).map(([key, items]) => [key, items.map((item) => item.label)])
);

// 股票池：啟動時由官方報價（自選股、預設清單、隔日沖訊號）動態建立，不再使用寫死的展示資料。
const stocks = [];

const state = {
  screen: "overnight",
  universe: "overnight",
  overnightView: "overview",
  surveillanceTab: "aboutToDispose",
  focus: "capital",
  strategy: "量價轉強",
  sort: "flow",
  sortDir: "desc",
  selectedCode: "2330",
  watchList: "1",
  detailTab: "即時",
  indicator: "量價摘要",
  direction: "all",
  minTurnover: 0,
  // 是否在選股清單顯示注意/處置/全額交割股（帶風險標籤）。預設顯示，可切換。
  showSurveillance: true,
  // 處置看板「只看自選股」開關（預設關）。
  survMineOnly: false,
  // 處置看板排序/篩選/搜尋（Phase 2）。
  survSort: "default",
  survMarket: "all",   // all | TWSE | TPEx
  survInterval: "all", // all | 5 | 20（僅處置相關分頁）
  survQuery: "",
  watchOnly: false,
  addMode: false,
  watchEditMode: false,
  watchFilter: "all",
  watchSelection: new Set(),
  morePanel: "source",
  technicalCode: "2330",
  technicalPeriod: "day",
};

const SELECTED_CODE_STORAGE_KEY = "stock1-selected-code-v1";

// 「顯示注意/處置股」開關：跨 session 記住使用者的選擇（預設顯示）。
const SHOW_SURVEILLANCE_KEY = "stock1.showSurveillance.v1";
try {
  const saved = window.localStorage.getItem(SHOW_SURVEILLANCE_KEY);
  if (saved === "0") state.showSurveillance = false;
} catch {}
function setShowSurveillance(show) {
  state.showSurveillance = !!show;
  try { window.localStorage.setItem(SHOW_SURVEILLANCE_KEY, show ? "1" : "0"); } catch {}
  render();
}

// 處置看板「只看自選股」開關與排序偏好：跨 session 記住。
const SURV_MINE_ONLY_KEY = "stock1.survMineOnly.v1";
const SURV_SORT_KEY = "stock1.survSort.v1";
try {
  if (window.localStorage.getItem(SURV_MINE_ONLY_KEY) === "1") state.survMineOnly = true;
  const sort = window.localStorage.getItem(SURV_SORT_KEY);
  if (sort) state.survSort = sort;
} catch {}
function setSurvMineOnly(on) {
  state.survMineOnly = !!on;
  try { window.localStorage.setItem(SURV_MINE_ONLY_KEY, on ? "1" : "0"); } catch {}
  renderSurveillanceScreen();
}

function restoreSelectedCode() {
  try {
    const payload = JSON.parse(window.localStorage.getItem(SELECTED_CODE_STORAGE_KEY) || "");
    const code = String(payload?.code || "").trim();
    if (!isValidSecurityCode(code)) return "";
    // 「記住上次看的股票」只在同一天內有效：盤中重新整理不會跳掉，
    // 隔天打開回到台積電/0050 的固定起點，不會停在很久以前點過的股票。
    return String(payload?.date || "") === getTaiwanClockParts().isoDate ? code : "";
  } catch {
    return "";
  }
}

// 當天看過的股票優先；全新一天的起點在 restoreWatchLists() 之後決定。
const storedSelectedCode = restoreSelectedCode();
if (storedSelectedCode) {
  state.selectedCode = storedSelectedCode;
  state.technicalCode = storedSelectedCode;
}

const initialParams = new URLSearchParams(window.location.search);
const initialScreen = initialParams.get("screen");
if (["overnight", "screener", "strategy", "watchlist", "technical", "surveillance", "more"].includes(initialScreen)) {
  state.screen = initialScreen;
}
const initialTechnicalCode = String(initialParams.get("code") || "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
if (initialTechnicalCode) state.technicalCode = initialTechnicalCode;
const initialTechnicalPeriod = initialParams.get("period");
if (["day", "week", "month"].includes(initialTechnicalPeriod)) state.technicalPeriod = initialTechnicalPeriod;

// 全新使用者的起手清單：只放兩檔指標性標的當示範，其餘清單留白讓使用者自己建。
// （已使用過的人以自己存過的清單為準，不受這裡影響。）
const watchLists = {
  1: new Set(["2330", "0050"]),
  2: new Set(),
  3: new Set(),
};
const MAX_WATCHLIST_CODES_PER_LIST = 100;
const MAX_PRICE_ALERTS = 50;

const WATCH_LIST_STORAGE_KEY = "stock1-watch-lists-v1";
const DATA_SOURCE_STORAGE_KEY = "stock1-data-source-v1";

restoreWatchLists();

// 每天第一次打開的起點：台積電/0050 之間隨機（個股視角 vs 大盤視角）。
// 不用自選清單第一檔，避免每次打開都固定看到同一檔。
if (!storedSelectedCode) {
  const freshStart = Math.random() < 0.5 ? "2330" : "0050";
  state.selectedCode = freshStart;
  // 網址帶了 ?code= 時以網址為準，不要蓋掉。
  if (!initialTechnicalCode) state.technicalCode = freshStart;
}

const sourceState = {
  selected: restoreDataSource(),
  sources: {},
  loading: false,
  error: "",
};

const authState = {
  checked: false,
  user: null,
  error: "",
  warnings: {},
};
let authScopeGeneration = 0;

const PERSONAL_BACKUP_FORMAT = "stock1-personal-backup";
const PERSONAL_BACKUP_FORMAT_VERSION = 1;
const PERSONAL_BACKUP_MAX_FILE_BYTES = 16 * 1024 * 1024;
const PERSONAL_RESTORE_OPTIONS = Object.freeze({
  watchLists: "replace",
  alerts: "replace",
  trades: "replace",
  stockNotes: "merge",
  companyProfiles: "skip",
});
const personalBackupState = {
  requestSeq: 0,
  previewToken: "",
  expiresAt: "",
  preview: null,
  fileName: "",
  sourceName: "",
  sourceUsername: "",
  loading: false,
  restoring: false,
  status: "尚未選擇備份檔。",
  statusTone: "idle",
};

const brokerSettingsState = {
  loaded: false,
  loading: false,
  saving: false,
  testing: false,
  status: null,
  error: "",
  testMessage: "",
};

const adminUsersState = {
  loaded: false,
  loading: false,
  creating: false,
  users: [],
  error: "",
};

let watchListSyncTimer = 0;

const dataState = {
  mode: sourceState.selected,
  source: "",
  lastUpdated: "",
  quoteCount: 0,
  realtimeCount: 0,
  fallbackCount: 0,
  // 後端 /api/quotes 會回「上市與上櫃整批收盤資料日尚未對齊」「沿用 last-good」等 warnings，
  // 隔日沖與策略雷達都有渲染，唯獨主報價畫面以前連欄位都沒有 → 使用者不知道自己在看舊價。
  warnings: [],
  degraded: false,
  error: "",
  loadedOnce: false,
};

const institutionalState = {
  loaded: false,
  loading: false,
  records: {},
  source: "",
  asOf: "",
  lastUpdated: "",
  error: "",
  warnings: [],
};

const marketState = {
  selected: "tx",
  markets: {},
  source: "",
  lastUpdated: "",
  error: "",
  warnings: [],
};

const marketSessionState = {
  stock: null,
  loadingPromise: null,
  retryAt: 0,
  warnings: [],
};

const marginState = {
  loaded: false,
  loading: false,
  records: {},
  source: "",
  asOf: "",
  error: "",
  warnings: [],
};

const overnightState = {
  loaded: false,
  loading: false,
  error: "",
  asOf: "",
  source: "",
  groups: null,
  surveillanceCount: 0,
  warnings: [],
};

// 處置看板（即將處置／處置中／即將出關／鉅額交易／注意股）
const surveillanceBoardState = {
  loaded: false,
  loading: false,
  error: "",
  asOf: "",
  data: null,
  loadedDate: "",
};

const strategyState = {
  loaded: false,
  loading: false,
  error: "",
  asOf: "",
  source: "",
  scenario: "midBandDefense",
  picks: [],
  scenarios: [],
  matchedCount: 0,
  candidateCount: 0,
  generatedAt: "",
  riskPolicy: "",
  warnings: [],
};

const technicalState = {
  loading: false,
  error: "",
  data: null,
  requestId: 0,
};

const verifyState = {
  loaded: false,
  loading: false,
  data: null,
  error: "",
};

const backtestState = {
  loaded: false,
  loading: false,
  data: null,
  error: "",
};

const verifyHistoryState = {
  loaded: false,
  loading: false,
  data: null,
  error: "",
};

const notesState = {
  code: "",
  loading: false,
  notes: [],
  error: "",
};

const companyState = {
  code: "",
  loading: false,
  data: null,
  error: "",
  editing: false,
};

// 基本面（月營收/EPS/估值/除權息）：per-code 快取，detail panel「基本面」籤與技術頁區塊共用。
const fundamentalsState = {
  byCode: new Map(), // code → { loading, data, error, at }
};

const searchState = {
  token: 0,
  query: "",
  loading: false,
  remote: [],
  error: "",
  timer: 0,
};

function getAllStrategyMeta() {
  return Object.values(strategyCatalog).flat();
}

function getStrategyMeta(label) {
  return getAllStrategyMeta().find((item) => item.label === label || item.aliases.includes(label));
}

function formatStrategyLabel(label) {
  return getStrategyMeta(label)?.label || label;
}

function formatExchangeLabel(exchange) {
  if (exchange === "TPEx") return "上櫃";
  if (exchange === "TWSE") return "上市";
  return exchange || "";
}

function stockIntradayScore(stock) {
  const change = Number(stock.change) || 0;
  const avgVol = Number(stock.avgVol) || 0;
  const total = Number(stock.total) || 0;
  const flow = Number(stock.flow) || 0;
  const trend = recentTrendPercent(stock.spark || []);
  const volumeHeat = Math.log10(Math.max(total + flow, 1)) * 9;
  return Math.abs(change) * 12 + avgVol * 18 + Math.abs(trend) * 4 + volumeHeat;
}

function stockMatchesIntradayStrategy(stock, label) {
  const change = Number(stock.change) || 0;
  const avgVol = Number(stock.avgVol) || 0;
  const total = Number(stock.total) || 0;
  const flow = Number(stock.flow) || 0;
  const trend = recentTrendPercent(stock.spark || []);
  const hasVolume = avgVol >= 1.8 || total >= 2500 || flow >= 1200;
  if (label === "急漲觀察") return change >= 2.5 || (change >= 1 && trend > 1.2);
  if (label === "急跌觀察") return change <= -2.5 || (change <= -1 && trend < -1.2);
  return hasVolume && (Math.abs(change) >= 0.8 || Math.abs(trend) >= 1.2);
}

function stockStrategySnapshot(stock) {
  const spark = Array.isArray(stock.spark) ? stock.spark.map(Number).filter(Number.isFinite) : [];
  const recent = spark.slice(-10);
  const last = spark.at(-1) || Number(stock.price) || 0;
  const mean = average(recent);
  const deviation = standardDeviation(recent) || Math.max(Math.abs(mean) * 0.01, 1);
  const ma3 = average(spark.slice(-3));
  const ma8 = average(spark.slice(-8));
  const maBias = ma8 ? ((ma3 - ma8) / ma8) * 100 : 0;
  return {
    change: Number(stock.change) || 0,
    avgVol: Number(stock.avgVol) || 0,
    total: Number(stock.total) || 0,
    flow: Number(stock.flow) || 0,
    turnover: Number(stock.turnover) || 0,
    trend: recentTrendPercent(spark),
    maBias,
    bandPosition: deviation ? (last - mean) / deviation : 0,
  };
}

function stockHasLegacyStrategyTag(stock, meta, label) {
  const stockStrategies = Array.isArray(stock.strategies) ? stock.strategies : [];
  if (!meta) return stockStrategies.includes(label);
  return stockStrategies.some((strategy) => strategy === meta.label || meta.aliases.includes(strategy));
}

function stockMatchesStrongStrategy(stock, label) {
  const meta = getStrategyMeta(label);
  if (!isQuoteBackedStock(stock)) return stock.groups?.includes("strong") && stockHasLegacyStrategyTag(stock, meta, label);
  const signal = stockStrategySnapshot(stock);
  const isUp = signal.change > 0;
  const hasVolume = signal.avgVol >= 1.2 || signal.total >= 2000 || signal.flow >= 1000;
  if (!isUp) return false;
  if (label === "量價轉強") return hasVolume && (signal.trend >= -0.5 || signal.avgVol >= 1.5);
  if (label === "量能集中") return signal.avgVol >= 1.5 || signal.total >= 3000 || signal.flow >= 1200;
  if (label === "沿線轉強") return signal.trend > 0 || signal.maBias > 0;
  if (label === "強勢突破") return signal.change >= 2 || signal.trend >= 2;
  if (label === "上軌突破") return signal.bandPosition >= 0.8 || (signal.trend > 1 && signal.maBias >= 0);
  if (label === "急漲高波動") return signal.change >= 3 && hasVolume;
  if (label === "多頭回檔") return hasVolume && signal.maBias >= -1 && signal.trend > -1;
  if (label === "下緣反彈") return hasVolume && (signal.bandPosition <= -0.4 || signal.trend > 1);
  return hasVolume;
}

function stockMatchesWeakStrategy(stock, label) {
  const meta = getStrategyMeta(label);
  if (!isQuoteBackedStock(stock)) return stock.groups?.includes("weak") && stockHasLegacyStrategyTag(stock, meta, label);
  const signal = stockStrategySnapshot(stock);
  const isDown = signal.change < 0;
  const hasVolume = signal.avgVol >= 1.2 || signal.total >= 2000 || signal.flow >= 1000;
  if (!isDown) return false;
  if (label === "轉弱觀察") return signal.trend < 0 || hasVolume;
  if (label === "量增轉弱") return hasVolume;
  if (label === "弱勢沿線") return signal.trend < 0 || signal.maBias < 0;
  if (label === "月線轉弱") return signal.maBias < 0 || signal.trend < -1;
  if (label === "下軌跌破") return signal.bandPosition <= -0.8 || signal.trend < -1;
  if (label === "高檔轉弱") return signal.change <= -2 || hasVolume;
  return true;
}

function stockMatchesTurnoverStrategy(stock, label) {
  const meta = getStrategyMeta(label);
  if (!isQuoteBackedStock(stock)) return stock.groups?.includes("turnover") && stockHasLegacyStrategyTag(stock, meta, label);
  const signal = stockStrategySnapshot(stock);
  const hasVolume = signal.avgVol >= 1.5 || signal.total >= 2500 || signal.flow >= 1200 || signal.turnover >= 3;
  if (label === "量能熱區") return hasVolume;
  if (label === "換手高危") return signal.avgVol >= 2 || signal.total >= 4000 || signal.turnover >= 5;
  if (label === "短線熱區") return hasVolume && Math.abs(signal.change) >= 1;
  if (label === "爆量警戒") return signal.avgVol >= 2.5 || signal.total >= 5000 || signal.turnover >= 5;
  return hasVolume;
}

function stockMatchesStrategy(stock, label) {
  const meta = getStrategyMeta(label);
  const normalized = meta?.label || label;
  if (strategies.intraday.includes(normalized)) return stockMatchesIntradayStrategy(stock, normalized);
  if (strategies.strong.includes(normalized)) return stockMatchesStrongStrategy(stock, normalized);
  if (strategies.weak.includes(normalized)) return stockMatchesWeakStrategy(stock, normalized);
  if (strategies.turnover.includes(normalized)) return stockMatchesTurnoverStrategy(stock, normalized);
  return stockHasLegacyStrategyTag(stock, meta, label);
}

function countStrategyMatches(label, universe = state.universe) {
  const normalized = getStrategyMeta(label)?.label || label;
  const isKnownStrategy = Object.values(strategies).some((list) => list.includes(normalized));
  if (isKnownStrategy) {
    return stocks.filter((stock) => stockMatchesStrategy(stock, label)).length;
  }
  return stocks.filter((stock) => stock.groups.includes(universe) && stockMatchesStrategy(stock, label)).length;
}

const indicatorLabels = ["量價摘要", "法人籌碼", "技術均線", "風險提醒"];

const indicatorButtonMeta = {
  量價摘要: { badge: "估算", tone: "estimate" },
  法人籌碼: { badge: "待官方", tone: "pending" },
  技術均線: { badge: "估算", tone: "estimate" },
  風險提醒: { badge: "風險", tone: "estimate" },
};

function getIndicatorButtonMeta(label, stock) {
  if (label === "法人籌碼") {
    if (stock?.institutional) return { badge: "官方", tone: "local" };
    if (institutionalState.loading) return { badge: "載入", tone: "estimate" };
    if (institutionalState.error) return { badge: "失敗", tone: "pending" };
    if (institutionalState.loaded) return { badge: "無資料", tone: "pending" };
  }
  if (label === "風險提醒") {
    if (stock?.margin) return { badge: "官方", tone: "local" };
    if (marginState.loading) return { badge: "載入", tone: "estimate" };
    if (marginState.error) return { badge: "失敗", tone: "pending" };
    if (marginState.loaded) return { badge: "無資料", tone: "pending" };
  }
  return indicatorButtonMeta[label] || { badge: "", tone: "neutral" };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatIndicatorPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return `${number.toFixed(1).replace(/\.0$/, "")}%`;
}

function getDailyClosesForStock(stock) {
  const candles = detailHistoryCache.get(stock.code)?.candles;
  if (!candles?.length) return null;
  const closes = candles.map((row) => Number(row.close)).filter(Number.isFinite);
  if (!closes.length) return null;
  const price = Number(stock.price);
  // 盤中時最後一根官方日K還是昨天：把最新價接上去，均線才是「盤中即時均線」口徑。
  if (Number.isFinite(price) && Math.abs(price - closes.at(-1)) > 0.0001) {
    closes.push(price);
  }
  return closes;
}

function buildIndicatorDetail(stock) {
  const spark = stock.spark.length ? stock.spark : [stock.price];
  const avgVol = Number(stock.avgVol) || 0;
  const turnover = Number(stock.turnover) || 0;
  const flow = Number(stock.flow) || 0;
  const total = Number(stock.total) || 0;
  const unit = Number(stock.unit) || 0;
  const unitShare = total > 0 ? (unit / total) * 100 : null;
  const dailyCloses = getDailyClosesForStock(stock);
  const usingDaily = Boolean(dailyCloses && dailyCloses.length >= 20);
  const maSeries = usingDaily ? dailyCloses : spark;
  const ma5 = average(maSeries.slice(-5));
  const ma20 = average(maSeries.slice(-20));
  const ma5Label = usingDaily ? "MA5（5日）" : `${Math.min(5, maSeries.length)}筆盤中均`;
  const ma20Label = usingDaily ? "MA20（20日）" : `${Math.min(20, maSeries.length)}筆盤中均`;
  const lookback = maSeries.slice(-Math.min(20, maSeries.length));
  const basis = lookback.reduce((sum, value) => sum + value, 0) / lookback.length;
  const variance = lookback.reduce((sum, value) => sum + (value - basis) ** 2, 0) / lookback.length;
  const deviation = Math.sqrt(variance);
  const upperBand = basis + deviation * 2;
  const lowerBand = basis - deviation * 2;
  const bandPosition = upperBand === lowerBand ? 50 : ((stock.price - lowerBand) / (upperBand - lowerBand)) * 100;
  const volumeState = avgVol >= 3 ? "爆量" : avgVol >= 1.5 ? "放量" : "一般";
  const leverageRisk = turnover >= 15 || avgVol >= 3 ? "偏高" : turnover >= 5 ? "中等" : "低";
  const institutional = stock.institutional;
  const institutionalUnavailableStatus = institutionalState.loading
    ? "載入中"
    : institutionalState.error
      ? "更新失敗"
      : institutionalState.loaded
        ? "官方無資料"
        : "尚未載入";
  const institutionalUnavailableNote = institutionalState.loading
    ? "法人資料正在更新，完成後會自動改成官方買賣超。"
    : institutionalState.error
      ? `法人資料更新失敗：${institutionalState.error}`
      : institutionalState.loaded
        ? "官方三大法人資料中查不到這檔，可能是該市場資料尚未揭露或代號不在該日明細。"
        : "法人資料尚未載入完成。";
  const institutionalSource = institutional
    ? `${institutional.source} / ${institutional.asOf}`
    : institutionalState.source || "TWSE/TPEx";
  const institutionalDetail = institutional
    ? {
        title: "法人籌碼",
        status: "官方資料",
        statusTone: "local",
        summary: "把外資、投信與自營商買賣超放在同一頁，方便直接看法人方向。",
        metrics: [
          { label: "外資", value: formatShareLots(institutional.foreignNet), tone: toneFromNet(institutional.foreignNet) },
          { label: "投信", value: formatShareLots(institutional.trustNet), tone: toneFromNet(institutional.trustNet) },
          { label: "自營商", value: formatShareLots(institutional.dealerNet), tone: toneFromNet(institutional.dealerNet) },
          { label: "法人合計", value: formatShareLots(institutional.totalNet), tone: toneFromNet(institutional.totalNet) },
        ],
        note: `來源：${institutionalSource}。自營商合計包含自行買賣與避險；外資採官方外陸資買賣超口徑（不含外資自營商）。${formatForeignDealerReconcile(institutional)}`,
      }
    : {
        title: "法人籌碼",
        status: institutionalUnavailableStatus,
        statusTone: "pending",
        summary: "這裡只放官方三大法人資料；官方尚無明細時，不用 N/A 數字誤導判斷。",
        metrics: [
          { label: "外資", value: "未揭露", tone: "muted" },
          { label: "投信", value: "未揭露", tone: "muted" },
          { label: "自營商", value: "未揭露", tone: "muted" },
          { label: "來源狀態", value: institutionalUnavailableStatus, tone: "warning" },
        ],
        note: `${institutionalUnavailableNote} 沒有官方明細時，本頁不顯示推估法人買賣超。`,
      };

  return {
    量價摘要: {
      title: "量價摘要（非分點）",
      status: "估算可用",
      statusTone: "estimate",
      summary: "用單量、總量、連量與均量比觀察量能是否集中放大；目前不是券商分點，也不是官方主力買賣超。",
      metrics: [
        { label: "單量", value: formatNumber(unit), tone: "neutral" },
        { label: "總量", value: formatNumber(total), tone: "neutral" },
        { label: "單量占比", value: unitShare === null ? "無法計算" : formatIndicatorPercent(unitShare), tone: unitShare >= 1 ? "positive" : "muted" },
        { label: "均量比", value: formatNumber(avgVol), tone: avgVol >= 3 ? "warning" : avgVol >= 1.5 ? "positive" : "muted" },
      ],
      note: `目前量能狀態：${volumeState}。這一格只適合看量能有沒有放大，不能解讀成特定主力買進。`,
    },
    法人籌碼: institutionalDetail,
    風險提醒: stock.margin
      ? {
          title: "融資融券（官方餘額）",
          status: "官方資料",
          statusTone: "local",
          summary: "用官方融資券餘額看籌碼風險：融資大增代表散戶槓桿堆高，券資比高代表軋空與波動風險。",
          metrics: [
            {
              label: "融資餘額",
              value: `${formatNumber(stock.margin.marginBalance)} 張`,
              tone: Number(stock.margin.marginChange) > 0 ? "warning" : "neutral",
            },
            {
              label: "融資增減",
              value: Number.isFinite(Number(stock.margin.marginChange)) ? `${stock.margin.marginChange > 0 ? "+" : ""}${formatNumber(stock.margin.marginChange)} 張` : "--",
              tone: toneFromNet(stock.margin.marginChange),
            },
            {
              label: "融券餘額",
              value: `${formatNumber(stock.margin.shortBalance)} 張`,
              tone: "neutral",
            },
            {
              label: "券資比",
              value: formatIndicatorPercent(stock.margin.shortMarginRatio),
              tone: Number(stock.margin.shortMarginRatio) >= 30 ? "warning" : Number(stock.margin.shortMarginRatio) >= 10 ? "positive" : "muted",
            },
          ],
          note: `來源：${stock.margin.source} / ${stock.margin.asOf}。融資使用率 ${formatIndicatorPercent(stock.margin.marginUsagePct)}；週轉率 ${formatIndicatorPercent(turnover)}。`,
        }
      : {
          title: "風險提醒（融資券載入中）",
          status: marginState.loading ? "載入中" : marginState.error ? "更新失敗" : marginState.loaded ? "官方無資料" : "尚未載入",
          statusTone: "estimate",
          summary: "官方融資券餘額載入後會顯示在這裡；查不到時通常是該股無信用交易或當日尚未公布。",
          metrics: [
            { label: "融資餘額", value: marginState.loading ? "載入中" : "未揭露", tone: "muted" },
            { label: "融券餘額", value: marginState.loading ? "載入中" : "未揭露", tone: "muted" },
            { label: "週轉率", value: formatIndicatorPercent(turnover), tone: turnover >= 15 ? "warning" : turnover >= 5 ? "positive" : "muted" },
            { label: "槓桿風險", value: leverageRisk, tone: leverageRisk === "偏高" ? "warning" : leverageRisk === "中等" ? "positive" : "muted" },
          ],
          note: marginState.error ? `融資券更新失敗：${marginState.error}` : "沒有官方餘額時，只用週轉率與均量比粗略提醒，不代表實際信用變化。",
        },
    技術均線: {
      title: usingDaily ? "技術均線（官方日K）" : "技術均線估算",
      status: usingDaily ? "官方日K" : "盤中樣本",
      statusTone: usingDaily ? "local" : "estimate",
      summary: usingDaily
        ? "用官方日K收盤價（含最新成交價）計算均線與布林通道，與一般看盤軟體口徑相同。"
        : "官方日K還沒載入，先用盤中觀察到的幾筆價格粗估，這不是日均線，僅供短線參考。",
      metrics: [
        { label: ma5Label, value: formatNumber(ma5), tone: stock.price >= ma5 ? "positive" : "negative" },
        { label: ma20Label, value: formatNumber(ma20), tone: stock.price >= ma20 ? "positive" : "negative" },
        { label: usingDaily ? "布林上軌" : "上軌粗估", value: formatNumber(upperBand), tone: "neutral" },
        { label: "通道位置", value: formatIndicatorPercent(Math.max(0, Math.min(100, bandPosition))), tone: bandPosition >= 90 ? "warning" : bandPosition >= 50 ? "positive" : "muted" },
      ],
      note: usingDaily
        ? `以官方日K ${dailyCloses.length} 根收盤價計算（20日、2 倍標準差布林）。`
        : `目前只有 ${lookback.length} 筆盤中價格可用；完整均線與布林需要官方日K。`,
    },
  };
}

const el = {
  title: document.getElementById("screenTitle"),
  strategyStrip: document.getElementById("strategyStrip"),
  strategyInfo: document.getElementById("strategyInfo"),
  overnightGroups: document.getElementById("overnightGroups"),
  strategyBoard: document.getElementById("strategyBoard"),
  strategyMeta: document.getElementById("strategyMeta"),
  survBoard: document.getElementById("survBoard"),
  survTabs: document.getElementById("survTabs"),
  survAsOf: document.getElementById("survAsOf"),
  survIntro: document.getElementById("survIntro"),
  survMineToggle: document.getElementById("survMineToggle"),
  survSearch: document.getElementById("survSearch"),
  survSort: document.getElementById("survSort"),
  survMarketChips: document.getElementById("survMarketChips"),
  survIntervalChips: document.getElementById("survIntervalChips"),
  survHelp: document.getElementById("survHelp"),
  survHelpOpen: document.getElementById("survHelpOpen"),
  survHelpClose: document.getElementById("survHelpClose"),
  survLegend: document.getElementById("survLegend"),
  technicalSurveillance: document.getElementById("technicalSurveillance"),
  screenerRows: document.getElementById("screenerRows"),
  overnightRows: document.getElementById("overnightRows"),
  watchRows: document.getElementById("watchRows"),
  watchEdit: document.getElementById("watchEdit"),
  watchTableHead: document.getElementById("watchTableHead"),
  watchBrief: document.getElementById("watchBrief"),
  watchManageBar: document.getElementById("watchManageBar"),
  watchManageSummary: document.getElementById("watchManageSummary"),
  watchRemoveSelected: document.getElementById("watchRemoveSelected"),
  watchSelectVisible: document.getElementById("watchSelectVisible"),
  watchClearSelection: document.getElementById("watchClearSelection"),
  detailPanel: document.getElementById("detailPanel"),
  searchModal: document.getElementById("searchModal"),
  searchInput: document.getElementById("searchInput"),
  searchResults: document.getElementById("searchResults"),
  filterDrawer: document.getElementById("filterDrawer"),
  directionFilter: document.getElementById("directionFilter"),
  turnoverFilter: document.getElementById("turnoverFilter"),
  turnoverValue: document.getElementById("turnoverValue"),
  watchOnlyFilter: document.getElementById("watchOnlyFilter"),
  loginGate: document.getElementById("loginGate"),
  loginForm: document.getElementById("loginForm"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  loginMessage: document.getElementById("loginMessage"),
  loginSubmit: document.getElementById("loginSubmit"),
  technicalForm: document.getElementById("technicalForm"),
  technicalCode: document.getElementById("technicalCode"),
  technicalStatus: document.getElementById("technicalStatus"),
  companyProfile: document.getElementById("companyProfile"),
  fundamentalsPanel: document.getElementById("fundamentalsPanel"),
  priceAlertBox: document.getElementById("priceAlertBox"),
  holdingsPanel: document.getElementById("holdingsPanel"),
  swingVerify: document.getElementById("swingVerify"),
  technicalSummary: document.getElementById("technicalSummary"),
  technicalTitle: document.getElementById("technicalTitle"),
  technicalSubtitle: document.getElementById("technicalSubtitle"),
  technicalBadge: document.getElementById("technicalBadge"),
  technicalChartMarkers: document.getElementById("technicalChartMarkers"),
  technicalChart: document.getElementById("technicalChart"),
  technicalMacdChart: document.getElementById("technicalMacdChart"),
  technicalDetailGrid: document.getElementById("technicalDetailGrid"),
  technicalZoomOpen: document.getElementById("technicalZoomOpen"),
  technicalHelpOpen: document.getElementById("technicalHelpOpen"),
  priceChart: document.getElementById("priceChart"),
  detailZoomOpen: document.getElementById("detailZoomOpen"),
  technicalZoomModal: document.getElementById("technicalZoomModal"),
  zoomChartTitle: document.getElementById("zoomChartTitle"),
  zoomChartClose: document.getElementById("zoomChartClose"),
  zoomChartStage: document.getElementById("zoomChartStage"),
  zoomChartCanvas: document.getElementById("zoomChartCanvas"),
  zoomCrosshairCanvas: document.getElementById("zoomCrosshairCanvas"),
  zoomChartReadout: document.getElementById("zoomChartReadout"),
  zoomChartPeriods: document.getElementById("zoomChartPeriods"),
  zoomChartStatus: document.getElementById("zoomChartStatus"),
  zoomChartTools: document.getElementById("zoomChartTools"),
  zoomChartColors: document.getElementById("zoomChartColors"),
  zoomChartHelp: document.getElementById("zoomChartHelp"),
  zoomChartHelpOpen: document.getElementById("zoomChartHelpOpen"),
  zoomChartHelpClose: document.getElementById("zoomChartHelpClose"),
  zoomChartHelpGot: document.getElementById("zoomChartHelpGot"),
};

function formatNumber(value, maxFractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const digits = Math.max(0, Math.min(8, Math.round(Number(maxFractionDigits) || 0)));
  if (Number.isInteger(number)) return number.toString();
  // 只在有小數點時去尾零：digits=0 時 toFixed 會回整數字串（1049.6 → "1050"），
  // 直接套 /\.?0+$/ 會把它砍成 "105"。與 formatTechnicalValue 用同一道防線。
  const text = number.toFixed(digits);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

// Number(null) 會變成 0；行情合併與顯示不能因此捏造「0 元／0 張」。
function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positivePriceOrNull(value) {
  const number = finiteNumberOrNull(value);
  return number !== null && number > 0 ? number : null;
}

function formatOptionalNumber(value, maxFractionDigits = 2) {
  const number = finiteNumberOrNull(value);
  return number === null ? "--" : formatNumber(number, maxFractionDigits);
}

function formatQuotePrice(value) {
  const price = positivePriceOrNull(value);
  return price === null ? "--" : formatNumber(price);
}

function formatShareLots(value) {
  const shares = Number(value);
  if (!Number.isFinite(shares)) return "N/A";
  const lots = shares / 1000;
  const absLots = Math.abs(lots);
  const digits = absLots >= 100 || Number.isInteger(lots) ? 0 : 1;
  const formatted = lots.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return `${shares > 0 ? "+" : ""}${formatted} 張`;
}

// 畫面統一的漲跌方向：百分比顯示到小數 2 位，|值| < 0.005 會四捨五入成 0.00，
// 必須視為平盤，不能一邊顯示 0.00% 一邊仍染成紅／綠。
function signedDirection(value) {
  const number = finiteNumberOrNull(value);
  if (number === null) return 0;
  if (!Number.isFinite(number) || Math.abs(number) < 0.005) return 0;
  return number > 0 ? 1 : -1;
}

function toneFromNet(value) {
  const direction = signedDirection(value);
  return direction > 0 ? "positive" : direction < 0 ? "negative" : "muted";
}

// 明細面板欄位的語意色。舊寫法的 tone 不是語意而是「調色盤第幾格」——四個分頁一律
// neutral→high→low→volume→total 固定輪轉，於是投信買賣超永遠紅、自營永遠綠、
// 營收 YoY 的 ▼ 是紅色的（符號說跌、顏色說漲，直接互相打臉）。
//
// 分辨規則：
//   有正負的「變化量／流量」（買賣超、YoY、價與均線的差）→ 走台股紅漲綠跌。
//   沒有正負的「水準值」（開高低、均價、量、本益比、殖利率）→ 不上色，語意由 label 承擔。
//   無值／未揭露 → is-na 灰，不進紅綠。
// 平盤門檻沿用既有的 signedDirection（|值| < 0.005），不新增任何門檻。
function metricToneFromNet(value) {
  if (finiteNumberOrNull(value) === null) return "na";
  const direction = signedDirection(value);
  return direction > 0 ? "up" : direction < 0 ? "down" : "flat";
}

function signalFromChange(value) {
  const direction = signedDirection(value);
  return direction > 0 ? "red" : direction < 0 ? "green" : "white";
}

function formatSignedPercent(value) {
  const percent = finiteNumberOrNull(value);
  if (percent === null) return "--";
  const direction = signedDirection(percent);
  if (!direction) return "0.00%";
  return `${direction > 0 ? "▲" : "▼"}${Math.abs(percent).toFixed(2)}%`;
}

function formatSignedPrice(value) {
  const price = finiteNumberOrNull(value);
  if (price === null) return "--";
  const direction = signedDirection(price);
  return `${direction > 0 ? "+" : ""}${direction ? formatNumber(price) : "0"}`;
}

function formatLocalTime(isoText) {
  if (!isoText) return "";
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return isoText;
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function extractIsoDate(value) {
  const text = String(value || "");
  const match = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function getCurrentTradeDate() {
  const counts = new Map();
  stocks.forEach((stock) => {
    const date = extractIsoDate(stock.asOf);
    if (!date) return;
    counts.set(date, (counts.get(date) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] || "";
}

function getTaiwanIsoDate(date = new Date()) {
  return getTaiwanClockParts(date).isoDate;
}

function compactDateLabel(dateText) {
  const iso = extractIsoDate(dateText) || String(dateText || "");
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}/${match[3]}` : iso || "--";
}

function getOvernightDateLabels() {
  const signalDate = extractIsoDate(overnightState.asOf) || overnightState.asOf || "--";
  const todayIso = getTaiwanIsoDate();
  // 絕不把「現在的日曆日」猜成觀察日。週末、連假或隔幾天才重開 App 時都會猜錯；
  // 只有後端 exact-next-trading-day 驗證和本清單同一訊號日，才採用其 observationDate。
  const verifiedSignalDate = extractIsoDate(verifyState.data?.signalDate);
  const verifiedObservationDate = extractIsoDate(verifyState.data?.observationDate);
  const observationDate = verifiedSignalDate === extractIsoDate(signalDate) ? verifiedObservationDate : "";
  const observationLabel = observationDate
    ? `${compactDateLabel(observationDate)} ${observationDate < todayIso ? "實際下一交易日" : "下一交易日"}`
    : "下一交易日（待官方確認）";
  return {
    signalDate,
    observationDate,
    signalLabel: `${compactDateLabel(signalDate)} 收盤後`,
    observationLabel,
  };
}

function formatOptionalPercent(value, fallback = "資料不足") {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return fallback;
  return `${percent.toFixed(2)}%`;
}

function splitMetricText(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.+?)\s+([-+−]?\d+(?:\.\d+)?%?)$/);
  if (!match) return { label: text, value: "" };
  return {
    label: match[1].trim(),
    value: match[2].replace("−", "-"),
  };
}

function compactMetricLabel(label) {
  if (label === "收盤位置") return "位置";
  if (label === "隔日收") return "隔收";
  return label;
}

function getScoreMeta(score, groupKey) {
  const value = Number(score);
  const numeric = Number.isFinite(value) ? value : 0;
  const isDanger = groupKey === "volumeDanger";
  const caption = isDanger ? "熱度" : groupKey === "pullbackReversal" ? "轉強" : "強度";
  const label = isDanger
    ? numeric >= 100 ? "極熱" : numeric >= 90 ? "高危" : numeric >= 75 ? "偏熱" : numeric >= 60 ? "觀察" : "低"
    : numeric >= 100 ? "極強" : numeric >= 90 ? "很強" : numeric >= 75 ? "強" : numeric >= 60 ? "中" : "弱";
  const tierClass = numeric >= 100
    ? "is-extreme"
    : numeric >= 90
      ? "is-high"
      : numeric >= 75
        ? "is-solid"
        : numeric >= 60
          ? "is-watch"
          : "is-low";
  const title = isDanger
    ? `${caption} ${score}：越高代表爆量過熱程度越高，不是買進分數`
    : `${caption} ${score}：越高代表越符合本組公式，不代表勝率`;
  return {
    caption,
    label,
    className: `${tierClass}${isDanger ? " is-danger-score" : ""}`,
    progress: Math.max(0, Math.min(100, Math.round(numeric))),
    title,
  };
}

function renderScoreBadge(pick, groupKey) {
  const score = Number.isFinite(Number(pick.score)) ? Number(pick.score) : 0;
  const meta = getScoreMeta(score, groupKey);
  return `
    <span class="pick-rank score-badge ${meta.className}" style="--score:${meta.progress}%" title="${escapeHtml(meta.title)}">
      <small>${glossMaybe(meta.caption)}</small>
      <strong>${escapeHtml(score)}</strong>
      <em>${escapeHtml(meta.label)}</em>
      <i aria-hidden="true"><b></b></i>
    </span>
  `;
}

function renderReasonChips(reasons = []) {
  const chips = reasons.map((reason) => {
    const metric = splitMetricText(reason);
    if (metric.value) {
      const label = compactMetricLabel(metric.label);
      return `
        <span class="pick-chip is-metric">
          <small>${glossMaybe(label)}</small>
          <strong>${escapeHtml(metric.value)}</strong>
        </span>
      `;
    }
    return `<span class="pick-chip is-note">${glossMaybe(metric.label)}</span>`;
  });
  return `<span class="pick-chip-list">${chips.join("") || '<span class="pick-chip is-muted">目前未標記</span>'}</span>`;
}

function renderRiskChips(tags = []) {
  const chips = tags.map((tag) => {
    const text = String(tag || "")
      .replace(/週轉率?\s*N\/A/g, "週轉未接")
      .replace(/N\/A/g, "資料不足");
    return `<span class="pick-chip is-risk">${glossMaybe(text)}</span>`;
  });
  return `<span class="pick-chip-list pick-risk-list">${chips.join("") || '<span class="pick-chip is-muted">目前未標記</span>'}</span>`;
}

function renderBacktestChips(backtest) {
  const sample = backtest?.sampleSize || 0;
  if (!sample) {
    return `
      <span class="pick-chip-list pick-backtest-list">
        <span class="pick-chip is-backtest is-incomplete"><small>${glossMaybe("回測")}</small><strong>樣本不足</strong></span>
      </span>
    `;
  }
  // 個股回測的樣本是「這檔在回測窗內觸發訊號的次數」，常常只有一兩次。
  // 1 次觸發算出的「+2 達成率 100%」沒有統計意義，卻跟累積多次的數字長得一樣。
  // 這裡的門檻用 5（比場景勝率的 20 寬鬆）——它是個股層級的參考提示，不是策略結論；
  // 次數本身照樣顯示，讓使用者自己看得到樣本有多小。
  const RATE_MIN_SAMPLES = 5;
  const hitRate = sample < RATE_MIN_SAMPLES
    ? "樣本不足"
    : backtest?.hitPlus2Rate === null || backtest?.hitPlus2Rate === undefined
      ? "資料不足"
      : formatOptionalPercent(backtest.hitPlus2Rate * 100);
  const avgClose = backtest?.avgCloseReturn === null || backtest?.avgCloseReturn === undefined
    ? "資料不足"
    : formatOptionalPercent(backtest.avgCloseReturn);
  return `
    <span class="pick-chip-list pick-backtest-list">
      <span class="pick-chip is-backtest is-summary"><small>${glossMaybe("回測")}</small><strong>${sample}次 / +2 ${hitRate} / 收 ${avgClose}</strong></span>
    </span>
  `;
}

function getOvernightGroupMeta(groupKey) {
  const meta = {
    strongContinuation: {
      title: "強勢續攻",
      shortTitle: "續攻",
      badge: "強度",
      hint: "收盤強、量能放大、站上均線",
      scoreMeaning: "分數代表續攻條件完整度，不是下一交易日一定上漲的機率。",
    },
    volumeDanger: {
      title: "爆量高危",
      shortTitle: "高危",
      badge: "熱度",
      hint: "量能過熱或收盤轉弱，偏風險觀察",
      scoreMeaning: "分數代表過熱與波動程度，越高越需要控管追高風險。",
    },
    pullbackReversal: {
      title: "回檔轉強",
      shortTitle: "轉強",
      badge: "轉強",
      hint: "回檔後重新站上短均，隔日觀察",
      scoreMeaning: "分數代表回到短線強勢的條件數，不是勝率保證。",
    },
  };
  return meta[groupKey] || meta.strongContinuation;
}

function renderReadableScoreExplainer(groupKey) {
  const meta = getOvernightGroupMeta(groupKey);
  const parts = {
    strongContinuation: ["漲幅 3%-9.5%", "量比5 >= 1.5", "收盤位置 >= 70%", "站上 MA5", "站上 MA20"],
    volumeDanger: ["漲幅或振幅偏大", "量比5 >= 3", "爆量過熱", "收盤轉弱", "高波動加權"],
    pullbackReversal: ["紅K", "收盤位置 >= 65%", "站回 MA5", "守住 MA20", "量能回溫"],
  }[groupKey] || [];
  const tone = groupKey === "volumeDanger" ? "danger" : groupKey === "pullbackReversal" ? "reversal" : "momentum";
  return `
    <section class="score-explainer is-${tone}" aria-label="${escapeHtml(meta.title)}分數說明">
      <div class="score-explainer-copy">
        <span>${escapeHtml(meta.badge)}</span>
        <strong>${escapeHtml(meta.title)}的分數怎麼看</strong>
        <p>${escapeHtml(meta.scoreMeaning)}</p>
      </div>
      <div class="score-explainer-parts">
        ${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}
      </div>
      <small>分數用來排序與提醒觀察重點；真正判斷仍要看成交量、收盤位置、風險標籤與隔日回測。</small>
    </section>
  `;
}

function getOvernightTopPick(groupKey) {
  const picks = overnightState.groups?.[groupKey] || [];
  return picks[0] || null;
}

function getDataTrustTone() {
  if (dataState.error || marketState.error || sourceState.error) return "warn";
  if (getSelectedSource() === "broker") return isBrokerSourceReady() ? "good" : "warn";
  // 後端已明說資料降級（例如兩市場收盤日未對齊、沿用 last-good）時不能還顯示「資料正常」。
  if (dataState.degraded || dataState.warnings.length) return "mixed";
  if (dataState.fallbackCount > 0) return "mixed";
  return "good";
}

// D-20：驗證與回測的百分比預設是「未扣費稅的毛報酬」。台股一買一賣約 0.471%，
// 而隔日沖的平均報酬本來就在 ±0.5% 這個量級——毛值 +0.35% 扣完成本其實是 −0.12%，
// 正負號會翻轉。這裡不動使用者熟悉的毛值，改成在旁邊並陳伺服器算好的淨值。
function formatGrossWithNet(grossPct, netPct) {
  const gross = formatSignedPercent(grossPct);
  // 這裡不能用 Number.isFinite(Number(netPct))：Number(null)===0 是有限值，
  // 缺值會被渲染成「淨 +0.00%」——正是全站一直在防的造假零。走既有的 finiteNumberOrNull。
  const net = finiteNumberOrNull(netPct);
  if (net === null) return gross;
  return `${gross}<em class="verify-net" title="已扣一買一賣的手續費與證交稅估算（約 0.471%）">淨 ${formatSignedPercent(net)}</em>`;
}

// D-32：官方 T86 的「三大法人合計」含外資自營商，而畫面上的外資欄是「外陸資」（不含它），
// 所以外資＋投信＋自營商永遠比合計少一個外資自營商——實測 5000+1000+500=6500 vs 官方合計 6600。
// 數字一律維持官方定義不動（改成合併口徑需要對市場慣用定義下斷言，不做），改成把差額講明白。
function formatForeignDealerReconcile(institutional) {
  const dealerNet = finiteNumberOrNull(institutional?.foreignDealerNet);
  if (dealerNet === null) return "";
  return `法人合計另含外資自營商 ${formatShareLots(dealerNet)}，因此不等於上方三格相加。`;
}

function renderDataTrustCompact() {
  const tone = getDataTrustTone();
  const toneText = {
    good: "資料正常",
    mixed: "部分備援",
    warn: "需要確認",
  }[tone];
  const sourceLabel = getSelectedSourceLabel();
  const updated = dataState.lastUpdated || marketState.lastUpdated || "尚未更新";
  const realtime = dataState.realtimeCount || 0;
  const fallback = dataState.fallbackCount || 0;
  const detail = getSelectedSource() === "official"
    ? `即時 ${realtime} 檔 / 收盤備援 ${fallback} 檔`
    : isBrokerSourceReady()
      ? "券商行情已設定"
      : "券商未設定，會回官方資料";
  // 後端明講的降級原因（兩市場收盤日未對齊、沿用 last-good…）以前只留在 payload 裡沒人顯示。
  // 這是使用者判斷「現在看到的數字能不能信」的關鍵，最多列兩條避免洗版，其餘用 title 補。
  const warnings = dataState.warnings || [];
  const warningText = warnings.slice(0, 2).join("；");
  const warningHtml = warnings.length
    ? `<small class="data-trust-warning" title="${escapeHtml(warnings.join("\n"))}">${escapeHtml(warningText)}${warnings.length > 2 ? `（另有 ${warnings.length - 2} 則）` : ""}</small>`
    : "";
  return `
    <aside class="data-trust-card is-${tone}">
      <span>資料可信度</span>
      <strong>${escapeHtml(toneText)}</strong>
      <p>${escapeHtml(sourceLabel)} / 更新 ${escapeHtml(updated)}</p>
      <small>${escapeHtml(detail)}</small>
      ${warningHtml}
    </aside>
  `;
}

function renderFocusPickCard(groupKey, pick) {
  const meta = getOvernightGroupMeta(groupKey);
  if (!pick) {
    return `
      <article class="today-focus-card is-empty">
        <span>${escapeHtml(meta.title)}</span>
        <strong>目前沒有符合</strong>
        <p>${escapeHtml(meta.hint)}</p>
      </article>
    `;
  }
  const reason = (pick.reasons || []).slice(0, 2).join("、") || meta.hint;
  return `
    <button class="today-focus-card" data-overnight-code="${pick.code}" type="button">
      <span>${escapeHtml(meta.title)}</span>
      <strong><span class="focus-pick-name">${escapeHtml(pick.name)}</span><em>${formatSignedPercent(pick.changePct)}</em></strong>
      <p>${escapeHtml(reason)}</p>
      <small>${escapeHtml(pick.code)} / 分數 ${escapeHtml(String(pick.score ?? "--"))}</small>
    </button>
  `;
}

function renderTodayFocusPanel() {
  if (!overnightState.loaded || !overnightState.groups) return "";
  const watchStats = getWatchStats();
  const strongestWatch = watchStats.strongest;
  const watchTone = strongestWatch ? toneFromNet(strongestWatch.change) : "muted";
  const signalLabel = compactDateLabel(overnightState.asOf);
  return `
    <section class="today-focus-panel" aria-label="${escapeHtml(signalLabel)} 訊號重點">
      <header>
        <div>
          <span>${escapeHtml(signalLabel)} 訊號重點</span>
          <strong>先看清單，再看風險</strong>
        </div>
        <p>三組清單、自選股狀態與資料可信度，先集中看這裡。</p>
      </header>
      <div class="today-focus-grid">
        ${renderFocusPickCard("strongContinuation", getOvernightTopPick("strongContinuation"))}
        ${renderFocusPickCard("volumeDanger", getOvernightTopPick("volumeDanger"))}
        ${renderFocusPickCard("pullbackReversal", getOvernightTopPick("pullbackReversal"))}
        <article class="today-focus-card is-watch">
          <span>自選股</span>
          <strong>${watchStats.upCount} 漲 / ${watchStats.downCount} 跌</strong>
          <p>平均 ${formatSignedPercent(watchStats.avgChange)}，強波動 ${watchStats.activeCount} 檔。</p>
          <small class="${watchTone}">${strongestWatch ? `最新交易日最強：${escapeHtml(strongestWatch.name)} ${escapeHtml(strongestWatch.changeText)}` : "尚無自選股"}</small>
        </article>
        ${renderDataTrustCompact()}
      </div>
    </section>
  `;
}

function apiCandidates(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const fallbackOrigin = "http://127.0.0.1:5174";
  const urls = [normalized];
  // http(s) 預覽必須只打同源 API；否則 5180 測試失敗時會偷偷碰使用者保留的 5174 正式資料。
  // 只有直接以 file:// 開啟（沒有同源後端）時才保留正式 localhost fallback。
  const canUseLocalFallback = window.location.protocol === "file:";
  if (canUseLocalFallback && window.location.origin !== fallbackOrigin) {
    urls.push(`${fallbackOrigin}${normalized}`);
  }
  return urls;
}

let pendingFetchCount = 0;
let loadingBarTimer = 0;

function refreshGlobalLoadingBar(active) {
  const bar = document.getElementById("globalLoadingBar");
  if (bar) bar.hidden = !active;
}

function beginFetch() {
  pendingFetchCount += 1;
  // 只有載入超過 ~400ms 才顯示進度條，避免每 10 秒的即時報價輪詢一直閃。
  if (pendingFetchCount === 1 && !loadingBarTimer) {
    loadingBarTimer = window.setTimeout(() => {
      loadingBarTimer = 0;
      if (pendingFetchCount > 0) refreshGlobalLoadingBar(true);
    }, 400);
  }
}

function endFetch() {
  pendingFetchCount = Math.max(0, pendingFetchCount - 1);
  if (pendingFetchCount === 0) {
    if (loadingBarTimer) {
      window.clearTimeout(loadingBarTimer);
      loadingBarTimer = 0;
    }
    refreshGlobalLoadingBar(false);
  }
}

async function fetchApi(path, options = {}) {
  beginFetch();
  try {
  const failures = [];
  for (const url of apiCandidates(path)) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "include",
        ...options,
        headers: {
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        let code = "";
        try {
          const payload = await response.json();
          message = payload.error || payload.message || message;
          code = payload.code || "";
        } catch {
          // Keep the HTTP status when the server does not return JSON.
        }
        const serverError = new Error(message);
        serverError.fromServer = true;
        serverError.status = response.status;
        serverError.code = code;
        throw serverError;
      }
      return response.json();
    } catch (error) {
      if (error.fromServer) throw error;
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`後端連線失敗，請確認 npm start 並開啟 http://127.0.0.1:5174/。${failures.join("；")}`);
  } finally {
    endFetch();
  }
}

// ===== 對話層焦點管理 =====
// 所有 modal / drawer 共用一個 stack：背景 inert、Tab 圈限、Esc 只處理最上層、關閉回到 opener。
// 不使用原生 <dialog>，是為了保留既有全螢幕 K 線與巢狀操作說明的版面；行為仍對齊 modal 規範。
const dialogStack = [];
const dialogIsolationState = new Map();

function getDialogSurface(root) {
  if (!root) return null;
  return root.matches?.('[role="dialog"]') ? root : root.querySelector?.('[role="dialog"]');
}

function getDialogFocusables(root) {
  if (!root) return [];
  const selector = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  return [...root.querySelectorAll(selector)].filter((node) => {
    if (node.disabled || node.getAttribute("aria-disabled") === "true") return false;
    if (node.closest("[hidden], [inert], [aria-hidden=\"true\"]")) return false;
    return node.tabIndex >= 0;
  });
}

function rememberAndInert(node) {
  if (!(node instanceof HTMLElement) || dialogIsolationState.has(node)) return;
  dialogIsolationState.set(node, {
    hadInert: node.hasAttribute("inert"),
    ariaHidden: node.getAttribute("aria-hidden"),
  });
  node.setAttribute("inert", "");
  node.setAttribute("aria-hidden", "true");
}

function clearDialogIsolation() {
  for (const [node, original] of dialogIsolationState) {
    if (!node.isConnected) continue;
    if (original.hadInert) node.setAttribute("inert", "");
    else node.removeAttribute("inert");
    if (original.ariaHidden == null) node.removeAttribute("aria-hidden");
    else node.setAttribute("aria-hidden", original.ariaHidden);
  }
  dialogIsolationState.clear();
}

function syncDialogEnvironment() {
  clearDialogIsolation();
  const top = dialogStack.at(-1)?.root || null;
  document.body.classList.toggle("has-modal", Boolean(top));
  dialogStack.forEach((entry) => {
    const surface = getDialogSurface(entry.root);
    if (surface) surface.setAttribute("aria-modal", entry.root === top ? "true" : "false");
  });
  if (!top) return;

  // 沿 top dialog 到 body 的祖先路徑逐層 inert 其餘兄弟。
  // 這也能處理 #survHelp 位在 .app-shell 內，而不會把 modal 自己一起 inert。
  let branch = top;
  while (branch?.parentElement) {
    const parent = branch.parentElement;
    for (const sibling of parent.children) {
      if (sibling === branch) continue;
      if (sibling.matches?.("#globalLoadingBar, #toastStack")) continue;
      rememberAndInert(sibling);
    }
    if (parent === document.body) break;
    branch = parent;
  }
}

function focusDialogEntry(entry) {
  if (!entry?.root || entry.root.hidden) return;
  const surface = getDialogSurface(entry.root) || entry.root;
  if (!surface.hasAttribute("tabindex")) surface.setAttribute("tabindex", "-1");
  let target = null;
  if (typeof entry.initialFocus === "string") target = entry.root.querySelector(entry.initialFocus);
  else if (entry.initialFocus instanceof HTMLElement) target = entry.initialFocus;
  target ||= getDialogFocusables(entry.root)[0] || surface;
  target.focus?.({ preventScroll: true });
}

function openDialogLayer(root, {
  trigger = document.activeElement,
  initialFocus = null,
  focus = true,
  openerResolver = null,
} = {}) {
  if (!root) return false;
  const existingIndex = dialogStack.findIndex((entry) => entry.root === root);
  const existingEntry = existingIndex >= 0 ? dialogStack.splice(existingIndex, 1)[0] : null;
  // 同一個 401 / action 重複要求已開啟的 dialog 時，保留第一次的外部 opener；
  // 否則 opener 會被改成 dialog 內的欄位，關閉後無法回到原本工作位置。
  const opener = existingEntry?.opener
    || (trigger instanceof HTMLElement && trigger !== document.body ? trigger : null);
  const entry = {
    root,
    opener,
    initialFocus,
    openerResolver: existingEntry?.openerResolver
      || (typeof openerResolver === "function" ? openerResolver : null),
  };
  root.hidden = false;
  dialogStack.push(entry);
  syncDialogEnvironment();
  if (focus) requestAnimationFrame(() => focusDialogEntry(entry));
  return true;
}

function closeDialogLayer(root, { restoreFocus = true, hide = true } = {}) {
  if (!root) return false;
  const index = dialogStack.findIndex((entry) => entry.root === root);
  const entry = index >= 0 ? dialogStack[index] : null;
  const closing = index >= 0 ? dialogStack.splice(index) : [];
  (closing.length ? closing : [{ root }]).forEach((item) => {
    // 行動版個股明細保留在 DOM 內做抽屜位移，但關閉後會由自己的生命週期設成 inert；
    // 其餘真正的 modal 仍使用 hidden。若一併關掉巢狀層，只有指定 root 可保留顯示狀態。
    item.root.hidden = item.root === root ? hide : true;
    const surface = getDialogSurface(item.root);
    if (surface) surface.setAttribute("aria-modal", "true");
  });
  syncDialogEnvironment();
  if (restoreFocus) {
    const remainingEntry = dialogStack.at(-1);
    requestAnimationFrame(() => {
      let focusTarget = entry?.opener || null;
      const targetUnavailable = !focusTarget?.isConnected || focusTarget.closest("[inert], [hidden]");
      if (targetUnavailable && entry?.openerResolver) {
        try {
          focusTarget = entry.openerResolver();
        } catch {
          focusTarget = null;
        }
      }
      if (focusTarget?.isConnected && !focusTarget.closest("[inert], [hidden]")) {
        focusTarget.focus?.({ preventScroll: true });
      } else if (remainingEntry) {
        // opener 已被重繪移除或位在剛關閉的 dialog 時，至少把焦點留在下一層 dialog。
        focusDialogEntry(remainingEntry);
      }
    });
  }
  return true;
}

function topDialogLayer() {
  return dialogStack.at(-1)?.root || null;
}

function trapDialogTab(event) {
  const top = topDialogLayer();
  if (!top || event.key !== "Tab") return false;
  const focusables = getDialogFocusables(top);
  const surface = getDialogSurface(top) || top;
  if (!focusables.length) {
    event.preventDefault();
    surface.focus?.({ preventScroll: true });
    return true;
  }
  const first = focusables[0];
  const last = focusables.at(-1);
  const active = document.activeElement;
  if (!top.contains(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus?.({ preventScroll: true });
    return true;
  }
  return false;
}

document.addEventListener("focusin", (event) => {
  const entry = dialogStack.at(-1);
  if (entry && !entry.root.contains(event.target)) focusDialogEntry(entry);
});

function setLoginGateVisible(visible, message = "") {
  if (el.loginMessage) el.loginMessage.textContent = message;
  if (!el.loginGate) return;
  if (visible) openDialogLayer(el.loginGate, { initialFocus: "#loginUsername" });
  else closeDialogLayer(el.loginGate);
}

function captureAuthScope() {
  return {
    generation: authScopeGeneration,
    userId: String(authState.user?.id || ""),
  };
}

function isCurrentAuthScope(scope) {
  return Boolean(scope?.userId)
    && scope.generation === authScopeGeneration
    && scope.userId === String(authState.user?.id || "");
}

function authScopeChangedError() {
  const error = new Error("帳號已切換，舊帳號的操作已取消");
  error.code = "AUTH_SCOPE_CHANGED";
  return error;
}

function getPersonalBackupElements() {
  return {
    modal: document.getElementById("personalBackupModal"),
    file: document.getElementById("personalBackupFile"),
    status: document.getElementById("personalBackupStatus"),
    preview: document.getElementById("personalBackupPreview"),
    confirm: document.getElementById("personalBackupConfirm"),
    password: document.getElementById("personalBackupPassword"),
    apply: document.querySelector('[data-action="restore-personal-backup"]'),
  };
}

function personalBackupCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? String(Math.trunc(count)) : "--";
}

function personalBackupDisplayText(value, maxLength = 160) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function personalBackupSourceLabel() {
  return personalBackupState.sourceName
    || personalBackupState.sourceUsername
    || "備份檔未標示來源帳號";
}

function renderPersonalBackupPreview() {
  const { preview } = getPersonalBackupElements();
  if (!preview) return;
  const fileName = personalBackupState.fileName;
  const sourceLabel = personalBackupSourceLabel();
  const targetLabel = authState.user?.displayName || authState.user?.username || "未登入";

  if (personalBackupState.loading) {
    preview.innerHTML = `
      <div class="personal-backup-source">
        <span>檔案</span><strong>${escapeHtml(fileName || "讀取中")}</strong>
        <span>來源帳號</span><strong>${escapeHtml(sourceLabel)}</strong>
        <span>復原至</span><strong>${escapeHtml(targetLabel)}</strong>
      </div>
      <p class="personal-backup-working"><span class="mini-spinner" aria-hidden="true"></span>伺服器正在驗證與正規化資料，尚未寫入。</p>
    `;
    return;
  }

  const response = personalBackupState.preview;
  if (!response || !personalBackupState.previewToken) {
    preview.innerHTML = `<p>選檔後會先顯示自選股、到價提醒、交易與共享備註的變更摘要。</p>`;
    return;
  }

  const sections = response.plan?.sections || response.sections || {};
  const watch = sections.watchLists || {};
  const alerts = sections.alerts || {};
  const trades = sections.trades || {};
  const notes = sections.stockNotes || {};
  const warnings = Array.isArray(response.plan?.warnings)
    ? response.plan.warnings
    : Array.isArray(response.warnings) ? response.warnings : [];
  const warningRows = warnings
    .map((item) => escapeHtml(typeof item === "string" ? item : item?.message || item?.code || "資料需要留意"))
    .filter(Boolean);

  preview.innerHTML = `
    <header>
      <span>伺服器安全預覽</span>
      <strong>尚未寫入、尚未變更任何資料</strong>
    </header>
    <div class="personal-backup-source">
      <span>檔案</span><strong>${escapeHtml(fileName || "--")}</strong>
      <span>來源帳號</span><strong>${escapeHtml(sourceLabel)}</strong>
      <span>復原至</span><strong>${escapeHtml(targetLabel)}</strong>
    </div>
    <div class="personal-backup-summary">
      <article>
        <span>自選股</span>
        <strong>${personalBackupCount(watch.beforeCount)} → ${personalBackupCount(watch.afterCount)}</strong>
        <small>取代目前三份清單</small>
      </article>
      <article>
        <span>到價提醒</span>
        <strong>${personalBackupCount(alerts.beforeCount)} → ${personalBackupCount(alerts.afterCount)}</strong>
        <small>取代目前提醒</small>
      </article>
      <article>
        <span>交易帳本</span>
        <strong>${personalBackupCount(trades.beforeCount)} → ${personalBackupCount(trades.afterCount)}</strong>
        <small>隔離 ${personalBackupCount(trades.quarantinedCount || 0)} 筆</small>
      </article>
      <article>
        <span>共享備註</span>
        <strong>新增 ${personalBackupCount(notes.addCount || 0)}</strong>
        <small>略過重複 ${personalBackupCount(notes.duplicateCount || 0)} 則</small>
      </article>
    </div>
    ${warningRows.length ? `<ul class="personal-backup-warnings">${warningRows.map((warning) => `<li>${warning}</li>`).join("")}</ul>` : ""}
  `;
}

function syncPersonalBackupControls() {
  const { file, status, confirm, password, apply } = getPersonalBackupElements();
  const hasPreview = Boolean(personalBackupState.previewToken);
  const busy = personalBackupState.loading || personalBackupState.restoring;
  if (status) {
    status.textContent = personalBackupState.status;
    status.dataset.tone = personalBackupState.statusTone;
    status.setAttribute("role", personalBackupState.statusTone === "error" ? "alert" : "status");
  }
  if (file) file.disabled = busy;
  if (confirm) confirm.disabled = busy || !hasPreview;
  if (password) password.disabled = busy || !hasPreview;
  if (apply) {
    apply.disabled = busy || !hasPreview || !confirm?.checked || !String(password?.value || "").trim();
    apply.setAttribute("aria-busy", personalBackupState.restoring ? "true" : "false");
    apply.textContent = personalBackupState.restoring ? "復原中…" : "確認復原";
  }
  renderPersonalBackupPreview();
}

function resetPersonalBackupRestoreState({ closeModal = false } = {}) {
  personalBackupState.requestSeq += 1;
  personalBackupState.previewToken = "";
  personalBackupState.expiresAt = "";
  personalBackupState.preview = null;
  personalBackupState.fileName = "";
  personalBackupState.sourceName = "";
  personalBackupState.sourceUsername = "";
  personalBackupState.loading = false;
  personalBackupState.restoring = false;
  personalBackupState.status = "尚未選擇備份檔。";
  personalBackupState.statusTone = "idle";

  const { modal, file, confirm, password } = getPersonalBackupElements();
  if (file) {
    try { file.value = ""; } catch {}
  }
  if (confirm) confirm.checked = false;
  if (password) password.value = "";
  syncPersonalBackupControls();
  if (closeModal && modal && (!modal.hidden || topDialogLayer() === modal)) {
    closeDialogLayer(modal, { restoreFocus: false });
  }
}

function openPersonalBackupRestore(trigger = document.activeElement) {
  if (!authState.user) {
    setLoginGateVisible(true, "登入後才能復原個人資料");
    return false;
  }
  resetPersonalBackupRestoreState();
  const { modal } = getPersonalBackupElements();
  if (!modal) return false;
  openDialogLayer(modal, { trigger, initialFocus: "#personalBackupFile" });
  refreshLucideIcons();
  return true;
}

function closePersonalBackupRestore() {
  if (personalBackupState.restoring) {
    showToast("復原資料正在寫入，完成前請不要關閉視窗");
    return false;
  }
  const { modal } = getPersonalBackupElements();
  resetPersonalBackupRestoreState();
  if (modal) closeDialogLayer(modal);
  return true;
}

function readPersonalBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("備份檔讀取失敗")), { once: true });
    reader.readAsText(file, "utf-8");
  });
}

function setPersonalBackupError(message) {
  personalBackupState.loading = false;
  personalBackupState.restoring = false;
  personalBackupState.previewToken = "";
  personalBackupState.expiresAt = "";
  personalBackupState.preview = null;
  personalBackupState.status = String(message || "備份檔無法使用");
  personalBackupState.statusTone = "error";
  const { confirm, password } = getPersonalBackupElements();
  if (confirm) confirm.checked = false;
  if (password) password.value = "";
  syncPersonalBackupControls();
}

async function previewPersonalBackupFile(input) {
  if (!authState.user) {
    setLoginGateVisible(true, "登入後才能復原個人資料");
    return;
  }
  const requestId = ++personalBackupState.requestSeq;
  const scope = captureAuthScope();
  const file = input?.files?.[0] || null;
  personalBackupState.previewToken = "";
  personalBackupState.expiresAt = "";
  personalBackupState.preview = null;
  personalBackupState.fileName = personalBackupDisplayText(file?.name);
  personalBackupState.sourceName = "";
  personalBackupState.sourceUsername = "";
  personalBackupState.loading = false;
  personalBackupState.restoring = false;
  const controls = getPersonalBackupElements();
  if (controls.confirm) controls.confirm.checked = false;
  if (controls.password) controls.password.value = "";

  if (!file || file.size === 0) {
    setPersonalBackupError("備份檔是空白的，請重新選擇有內容的 JSON 檔。");
    return;
  }
  if (file.size > PERSONAL_BACKUP_MAX_FILE_BYTES) {
    setPersonalBackupError("備份檔過大；個人備份檔上限為 16 MB。");
    return;
  }

  let bundle;
  try {
    const text = await readPersonalBackupFile(file);
    if (requestId !== personalBackupState.requestSeq || !isCurrentAuthScope(scope)) return;
    if (!text.trim()) {
      setPersonalBackupError("備份檔沒有內容，請重新選擇。");
      return;
    }
    bundle = JSON.parse(text);
  } catch (error) {
    if (requestId !== personalBackupState.requestSeq || !isCurrentAuthScope(scope)) return;
    setPersonalBackupError(`JSON 格式無法讀取：${error.message || "檔案格式錯誤"}`);
    return;
  }

  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) || bundle.format !== PERSONAL_BACKUP_FORMAT) {
    setPersonalBackupError("這不是 Stock1 個人備份格式，請選擇由本 App 下載的 JSON 檔。");
    return;
  }
  if (!Number.isInteger(bundle.formatVersion) || bundle.formatVersion !== PERSONAL_BACKUP_FORMAT_VERSION) {
    const message = Number(bundle.formatVersion) > PERSONAL_BACKUP_FORMAT_VERSION
      ? `這份備份是較新版格式（版本 ${bundle.formatVersion}），請先更新 Stock1 再復原。`
      : "這份備份版本不受支援，請重新下載最新版備份。";
    setPersonalBackupError(message);
    return;
  }

  personalBackupState.sourceName = personalBackupDisplayText(bundle.sourceAccount?.displayName);
  personalBackupState.sourceUsername = personalBackupDisplayText(bundle.sourceAccount?.username);
  personalBackupState.loading = true;
  personalBackupState.status = "正在做伺服器安全預覽，尚未寫入任何資料…";
  personalBackupState.statusTone = "working";
  syncPersonalBackupControls();

  try {
    const response = await fetchApi("/api/personal-data/restore/preview", {
      method: "POST",
      body: JSON.stringify({ bundle, options: PERSONAL_RESTORE_OPTIONS }),
    });
    if (requestId !== personalBackupState.requestSeq || !isCurrentAuthScope(scope)) return;
    if (!response?.previewToken) throw new Error("伺服器未建立復原預覽，請稍後再試");
    personalBackupState.previewToken = String(response.previewToken);
    personalBackupState.expiresAt = String(response.expiresAt || "");
    personalBackupState.preview = response;
    personalBackupState.loading = false;
    personalBackupState.status = "預覽完成；目前尚未變更任何資料。";
    personalBackupState.statusTone = "ready";
    syncPersonalBackupControls();
  } catch (error) {
    if (requestId !== personalBackupState.requestSeq || !isCurrentAuthScope(scope)) return;
    personalBackupState.loading = false;
    if (handleAuthRequired(error)) return;
    setPersonalBackupError(`無法預覽備份：${error.message}`);
  }
}

function safePersonalBackupFilePart(value) {
  const clean = String(value || "")
    .normalize("NFKC")
    .replace(/[^0-9A-Za-z_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || "user";
}

function personalBackupDownloadName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const username = safePersonalBackupFilePart(authState.user?.username || authState.user?.displayName);
  return `stock1-${username}-${day}-${clock}.json`;
}

async function downloadPersonalBackup(button = null) {
  if (!authState.user) {
    setLoginGateVisible(true, "登入後才能下載個人資料備份");
    return;
  }
  const scope = captureAuthScope();
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  let objectUrl = "";
  let anchor = null;
  try {
    const response = await fetchApi("/api/personal-data/export");
    if (!isCurrentAuthScope(scope)) return;
    const bundle = response?.bundle;
    if (!bundle || typeof bundle !== "object") throw new Error("伺服器沒有回傳可下載的備份內容");
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json;charset=utf-8" });
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = personalBackupDownloadName();
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    showToast("個人資料備份已下載；請把檔案放在只有自己能存取的位置");
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) showToast(`備份下載失敗：${error.message}`);
  } finally {
    anchor?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (button?.isConnected) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

async function restorePersonalBackup() {
  const { confirm, password } = getPersonalBackupElements();
  const currentPassword = String(password?.value || "");
  if (!authState.user || !personalBackupState.previewToken || !confirm?.checked || !currentPassword.trim()) {
    syncPersonalBackupControls();
    return;
  }
  const scope = captureAuthScope();
  const requestId = personalBackupState.requestSeq;
  const previewToken = personalBackupState.previewToken;
  personalBackupState.restoring = true;
  personalBackupState.status = "正在建立復原點並套用資料，請不要關閉頁面…";
  personalBackupState.statusTone = "working";
  syncPersonalBackupControls();

  try {
    const response = await fetchApi("/api/personal-data/restore", {
      method: "POST",
      body: JSON.stringify({ previewToken, currentPassword, confirmation: "RESTORE" }),
    });
    if (password) password.value = "";
    if (requestId !== personalBackupState.requestSeq || !isCurrentAuthScope(scope)) return;
    if (response?.ok === false) throw new Error(response.error || "個人資料復原失敗");

    personalBackupState.status = "復原已寫入，正在重新載入伺服器正規資料…";
    syncPersonalBackupControls();
    notesFeedState.loaded = false;
    await Promise.allSettled([
      loadWatchListsFromServer(),
      loadAlertsFromServer(),
      loadTradesFromServer(),
      loadNotesFeed(),
    ]);
    if (requestId !== personalBackupState.requestSeq || !isCurrentAuthScope(scope)) return;
    const warningCount = Array.isArray(response?.warnings) ? response.warnings.length : 0;
    resetPersonalBackupRestoreState();
    const { modal } = getPersonalBackupElements();
    if (modal) closeDialogLayer(modal);
    showToast(warningCount ? `個人資料已復原完成；另有 ${warningCount} 則提醒` : "個人資料已復原完成");
  } catch (error) {
    if (password) password.value = "";
    if (requestId !== personalBackupState.requestSeq || !isCurrentAuthScope(scope)) return;
    personalBackupState.restoring = false;
    if (handleAuthRequired(error)) return;
    if (error?.status === 409) {
      personalBackupState.previewToken = "";
      personalBackupState.preview = null;
      if (confirm) confirm.checked = false;
      setPersonalBackupError("復原預覽已過期或資料已變更，請重新選檔再預覽一次。");
      return;
    }
    personalBackupState.status = `復原失敗：${error.message}`;
    personalBackupState.statusTone = "error";
    syncPersonalBackupControls();
  } finally {
    if (password) password.value = "";
    if (requestId === personalBackupState.requestSeq && isCurrentAuthScope(scope)) {
      personalBackupState.restoring = false;
      syncPersonalBackupControls();
    }
  }
}

function clearUserScopedState({ renderNow = true } = {}) {
  authScopeGeneration += 1;
  resetPersonalBackupRestoreState({ closeModal: true });
  authState.user = null;

  window.clearTimeout(watchListSyncTimer);
  watchListSyncTimer = 0;
  watchLists[1] = new Set();
  watchLists[2] = new Set();
  watchLists[3] = new Set();
  watchListsRev = 0;
  watchListMutationVersion = 0;
  watchListSyncInFlight = false;
  watchListSyncPending = false;
  watchListSyncRunId += 1;
  watchListLoadSeq += 1;
  state.watchSelection.clear();

  window.clearTimeout(alertSyncTimer);
  alertSyncTimer = 0;
  priceAlertsState.alerts = [];
  priceAlertsState.loaded = false;
  priceAlertsState.rev = 0;
  alertMutationVersion = 0;
  alertSyncInFlight = false;
  alertSyncPending = false;
  alertSyncRunId += 1;
  alertLoadSeq += 1;

  tradesState.settings = { feeDiscount: 0.6, minFee: 20 };
  tradesState.schemaVersion = 2;
  tradesState.records = [];
  tradesState.quarantinedRecords = [];
  tradesState.portfolio = null;
  tradesState.missingCorporateActions = [];
  tradesState.loaded = false;
  tradesState.rev = 0;
  tradesState.mutating = false;
  tradesHistoryLimit = 40;
  tradesEditingId = "";
  tradesMutationVersion = 0;
  tradesLoadSeq += 1;

  Object.assign(brokerSettingsState, {
    loaded: false, loading: false, saving: false, testing: false,
    status: null, error: "", testMessage: "",
  });
  Object.assign(adminUsersState, {
    loaded: false, loading: false, creating: false, users: [], error: "",
  });
  sourceState.sources = {};
  sourceState.loading = false;
  sourceState.error = "";
  sourceStatusRequestSeq += 1;
  try {
    window.localStorage.removeItem(WATCH_LIST_STORAGE_KEY);
  } catch {
    // 儲存空間不可用不影響記憶體與畫面清除。
  }
  // render() 只更新目前分頁；私人資料也可能留在已渲染但隱藏的頁面，必須同步清空。
  [el.watchRows, el.priceAlertBox, el.holdingsPanel, document.getElementById("moreDetail")].forEach((node) => {
    if (node) node.replaceChildren();
  });
  if (renderNow) render();
}

function activateAuthenticatedUser(user) {
  const nextUser = user || null;
  if (String(authState.user?.id || "") !== String(nextUser?.id || "")) {
    clearUserScopedState({ renderNow: false });
  }
  authState.user = nextUser;
}

function handleAuthRequired(error) {
  if (error?.status === 401 || error?.code === "AUTH_REQUIRED") {
    clearUserScopedState();
    authState.error = error.message || "需要先登入";
    setLoginGateVisible(true, authState.error);
    return true;
  }
  return false;
}

async function loadCurrentUser({ showLogin = false } = {}) {
  try {
    const payload = await fetchApi("/api/auth/me");
    authState.checked = true;
    activateAuthenticatedUser(payload.user);
    authState.error = "";
    authState.warnings = payload.warnings || {};
    setLoginGateVisible(false);
    return Boolean(authState.user);
  } catch (error) {
    authState.checked = true;
    clearUserScopedState({ renderNow: false });
    authState.error = error.message;
    setLoginGateVisible(showLogin, showLogin ? (error.status === 401 ? "請先登入" : error.message) : "");
    return false;
  }
}

async function loginWithCredentials(username, password) {
  if (el.loginSubmit) el.loginSubmit.disabled = true;
  if (el.loginMessage) el.loginMessage.textContent = "登入中...";
  try {
    const payload = await fetchApi("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    activateAuthenticatedUser(payload.user);
    authState.error = "";
    authState.warnings = payload.warnings || {};
    setLoginGateVisible(false);
    await loadWatchListsFromServer();
    await loadAlertsFromServer();
    await loadTradesFromServer();
    await loadBrokerSettings();
    await loadSourceStatus();
    if (state.morePanel === "system" && authState.user?.role === "admin") {
      await loadAdminUsers();
    }
    if (getSelectedSource() === "broker" && !isBrokerSourceReady()) {
      switchToOfficialFallback(sourceState.sources?.broker?.message || "券商 API 未設定");
    }
    await Promise.all([loadMarketSummary(), loadMarketData(), loadOvernightSignals()]);
    if (state.screen === "technical" && !technicalState.loading) loadTechnicalAnalysis();
    showToast(`已登入：${authState.user?.displayName || authState.user?.username || ""}`);
  } catch (error) {
    authState.error = error.message;
    setLoginGateVisible(true, error.message);
  } finally {
    if (el.loginSubmit) el.loginSubmit.disabled = false;
  }
}

async function logout() {
  clearUserScopedState({ renderNow: false });
  await fetchApi("/api/auth/logout", { method: "POST" }).catch(() => null);
  authState.error = "";
  authState.warnings = {};
  sourceState.selected = "official";
  saveDataSource();
  setLoginGateVisible(false, "");
  render();
  showToast("已登出，回到未登入看盤模式");
  loadSourceStatus();
  loadMarketSummary();
  loadMarketData();
}

function watchListsPayload() {
  return Object.fromEntries(
    Object.entries(watchLists).map(([key, list]) => [key, [...list]])
  );
}

function applyWatchListsPayload(lists) {
  if (!lists || typeof lists !== "object") return;
  Object.entries(lists).forEach(([key, codes]) => {
    if (watchLists[key] && Array.isArray(codes)) {
      watchLists[key] = new Set(codes.map(normalizeStockCodeInput).filter(Boolean));
    }
  });
}

let watchListsRev = 0; // 蓋寫防護：伺服器端的資料版本號，PUT 帶舊版會被 409 擋下
let watchListMutationVersion = 0;
let watchListSyncInFlight = false;
let watchListSyncPending = false;
let watchListSyncRunId = 0;
let watchListLoadSeq = 0;

async function loadWatchListsFromServer() {
  if (!authState.user) return;
  const scope = captureAuthScope();
  const requestSeq = ++watchListLoadSeq;
  const mutationVersion = watchListMutationVersion;
  try {
    const payload = await fetchApi("/api/watchlists");
    if (
      !isCurrentAuthScope(scope)
      || requestSeq !== watchListLoadSeq
      || mutationVersion !== watchListMutationVersion
      || Number(payload.rev || 0) < watchListsRev
    ) return;
    watchListsRev = Number(payload.rev) || 0;
    applyWatchListsPayload(payload.lists);
    saveWatchLists({ sync: false });
    render();
  } catch (error) {
    if (!isCurrentAuthScope(scope) || requestSeq !== watchListLoadSeq) return;
    if (!handleAuthRequired(error)) showToast(`自選股同步失敗：${error.message}`);
  }
}

function scheduleWatchListSync() {
  if (!authState.user) return;
  window.clearTimeout(watchListSyncTimer);
  watchListSyncTimer = window.setTimeout(syncWatchListsToServer, 350);
}

async function syncWatchListsToServer() {
  if (!authState.user) return;
  if (watchListSyncInFlight) {
    watchListSyncPending = true;
    return;
  }
  watchListSyncInFlight = true;
  watchListSyncPending = false;
  const scope = captureAuthScope();
  const runId = ++watchListSyncRunId;
  const mutationVersion = watchListMutationVersion;
  const lists = watchListsPayload();
  try {
    const payload = await fetchApi("/api/watchlists", {
      method: "PUT",
      body: JSON.stringify({ lists, rev: watchListsRev }),
    });
    if (!isCurrentAuthScope(scope)) return;
    if (Number.isFinite(Number(payload?.rev))) watchListsRev = Number(payload.rev);
    if (mutationVersion === watchListMutationVersion) {
      applyWatchListsPayload(payload?.lists);
      saveWatchLists({ sync: false });
      render();
    } else {
      watchListSyncPending = true;
    }
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (error?.status === 409) {
      // 別的分頁改過 → 以伺服器版為準（避免把別人剛存的清單蓋掉）
      await loadWatchListsFromServer();
      showToast("自選股已在其他視窗更新，已同步最新版——剛剛的變更請再操作一次");
      return;
    }
    if (error?.status === 422) {
      await loadWatchListsFromServer();
      showToast(error.message || "自選股內容超過上限，已還原伺服器版本");
      return;
    }
    if (!handleAuthRequired(error)) showToast(`自選股儲存失敗：${error.message}`);
  } finally {
    if (runId !== watchListSyncRunId) return;
    watchListSyncInFlight = false;
    if (watchListSyncPending && authState.user) {
      watchListSyncPending = false;
      window.clearTimeout(watchListSyncTimer);
      watchListSyncTimer = window.setTimeout(syncWatchListsToServer, 0);
    }
  }
}

// ===== 到價提醒（頁面開著時）=====
// 設定存伺服器（每人一份、整包同步，比照自選股）；觸價判斷在前端 10 秒報價輪詢做。
// 沒有背景推播：頁面關了就收不到，這是刻意的第一版範圍。
const priceAlertsState = {
  alerts: [],
  loaded: false,
  rev: 0, // 蓋寫防護版本號
};
let alertSyncTimer = 0;
let alertMutationVersion = 0;
let alertSyncInFlight = false;
let alertSyncPending = false;
let alertSyncRunId = 0;
let alertLoadSeq = 0;

async function loadAlertsFromServer() {
  if (!authState.user) return;
  const scope = captureAuthScope();
  const requestSeq = ++alertLoadSeq;
  const mutationVersion = alertMutationVersion;
  try {
    const payload = await fetchApi("/api/alerts");
    if (
      !isCurrentAuthScope(scope)
      || requestSeq !== alertLoadSeq
      || mutationVersion !== alertMutationVersion
      || Number(payload.rev || 0) < priceAlertsState.rev
    ) return;
    priceAlertsState.alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    priceAlertsState.rev = Number(payload.rev) || 0;
    priceAlertsState.loaded = true;
    render();
  } catch (error) {
    if (!isCurrentAuthScope(scope) || requestSeq !== alertLoadSeq) return;
    if (!handleAuthRequired(error)) showToast(`到價提醒同步失敗：${error.message}`);
  }
}

function scheduleAlertSync() {
  if (!authState.user) return;
  alertMutationVersion += 1;
  window.clearTimeout(alertSyncTimer);
  alertSyncTimer = window.setTimeout(syncAlertsToServer, 350);
}

async function syncAlertsToServer() {
  if (!authState.user) return;
  if (alertSyncInFlight) {
    alertSyncPending = true;
    return;
  }
  alertSyncInFlight = true;
  alertSyncPending = false;
  const scope = captureAuthScope();
  const runId = ++alertSyncRunId;
  const mutationVersion = alertMutationVersion;
  const alerts = priceAlertsState.alerts.map((alert) => ({ ...alert }));
  try {
    const payload = await fetchApi("/api/alerts", {
      method: "PUT",
      body: JSON.stringify({ alerts, rev: priceAlertsState.rev }),
    });
    if (!isCurrentAuthScope(scope)) return;
    if (Number.isFinite(Number(payload?.rev))) priceAlertsState.rev = Number(payload.rev);
    if (mutationVersion === alertMutationVersion) {
      if (Array.isArray(payload?.alerts)) priceAlertsState.alerts = payload.alerts;
      render();
    } else {
      alertSyncPending = true;
    }
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (error?.status === 409) {
      await loadAlertsFromServer();
      showToast("到價提醒已在其他視窗更新，已同步最新版——剛剛的變更請再操作一次");
      return;
    }
    if (error?.status === 422) {
      await loadAlertsFromServer();
      showToast(error.message || "到價提醒超過上限，已還原伺服器版本");
      return;
    }
    if (!handleAuthRequired(error)) showToast(`到價提醒儲存失敗：${error.message}`);
  } finally {
    if (runId !== alertSyncRunId) return;
    alertSyncInFlight = false;
    if (alertSyncPending && authState.user) {
      alertSyncPending = false;
      window.clearTimeout(alertSyncTimer);
      alertSyncTimer = window.setTimeout(syncAlertsToServer, 0);
    }
  }
}

function alertsForCode(code) {
  const clean = String(code || "").trim();
  if (!clean) return [];
  return priceAlertsState.alerts.filter((alert) => alert.code === clean);
}

function addPriceAlert(code, op, price) {
  const clean = String(code || "").trim();
  const value = Number(price);
  if (!clean || !Number.isFinite(value) || value <= 0) {
    showToast("請輸入有效的目標價");
    return false;
  }
  if (!authState.user) {
    showToast("到價提醒需要登入（更多 → 帳號管理）");
    return false;
  }
  if (priceAlertsState.alerts.length >= MAX_PRICE_ALERTS) {
    showToast(`到價提醒最多 ${MAX_PRICE_ALERTS} 筆，請先刪除舊提醒`);
    return false;
  }
  priceAlertsState.alerts.push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    code: clean,
    op: op === "<=" ? "<=" : ">=",
    price: Math.round(value * 100) / 100,
    note: "",
    active: true,
    createdAt: new Date().toISOString(),
    triggeredAt: "",
  });
  scheduleAlertSync();
  showToast(`已設定 ${clean} 到價提醒`);
  return true;
}

function removePriceAlert(id) {
  const before = priceAlertsState.alerts.length;
  priceAlertsState.alerts = priceAlertsState.alerts.filter((alert) => alert.id !== id);
  if (priceAlertsState.alerts.length !== before) scheduleAlertSync();
}

// 觸價音效：短促兩聲上行（AudioContext 在使用者互動前可能被瀏覽器擋，失敗就只出 toast）。
function playAlertBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (at, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.25);
    };
    beep(0, 880);
    beep(0.28, 1174);
    window.setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    // 音效失敗不影響 toast 提醒
  }
}

// 每次報價更新後跑：現價越過目標 → toast＋音效，標記已觸發（一次性，不重複吵）。
// priceStale（無即時成交、顯示昨收）的檔位跳過，避免用昨收誤觸發。
function checkPriceAlerts(eligibleCodes = null, { renderNow = true } = {}) {
  if (!priceAlertsState.alerts.length) return 0;
  const eligible = eligibleCodes
    ? new Set([...eligibleCodes].map((code) => normalizeStockCodeInput(code)).filter(Boolean))
    : null;
  const byCode = new Map(stocks.map((stock) => [stock.code, stock]));
  let fired = 0;
  for (const alert of priceAlertsState.alerts) {
    if (!alert.active || alert.triggeredAt) continue;
    // 行情 loader 會傳入「本輪確實取得即時價」的代號；API 漏回某檔時不可沿用全域舊價誤觸。
    if (eligible && !eligible.has(normalizeStockCodeInput(alert.code))) continue;
    const stock = byCode.get(alert.code);
    // 成交價要走 positivePriceOrNull：Number(null)===0 會讓「無報價」的檔位通過門檻，
    // 於是任何跌破提醒都會用「現價 0」立刻誤觸發並自我標記已觸發，真正到價時反而不再提醒。
    const price = positivePriceOrNull(stock?.price);
    if (!stock || price === null || stock.priceStale) continue;
    const hit = alert.op === "<=" ? price <= alert.price : price >= alert.price;
    if (!hit) continue;
    alert.triggeredAt = new Date().toISOString();
    alert.active = false;
    fired += 1;
    // 除息日的下跌含除息缺口，加註提醒使用者別把息盤當崩盤（只加註、不抑制提醒）。
    const exDivNote = stock.dividend?.isToday ? `（今日除息 ${formatNumber(stock.dividend.cash)} 元，跌幅含除息缺口）` : "";
    showToast(`🔔 ${stock.name || alert.code} ${alert.code} 到價：現價 ${formatNumber(price)}（${alert.op === "<=" ? "跌破" : "站上"} ${formatNumber(alert.price)}）${exDivNote}`, 8000);
  }
  if (fired) {
    playAlertBeep();
    scheduleAlertSync();
    if (renderNow) render();
  }
  return fired;
}

// ===== 持股損益（完整交易紀錄）=====
// 紀錄與設定存伺服器（每人一份）；損益引擎在後端（加權平均法），前端只把
// 持股跟即時報價配對算未實現損益。任何寫入都走 PUT 整包同步，伺服器擋「賣超」。
const tradesState = {
  schemaVersion: 2,
  settings: { feeDiscount: 0.6, minFee: 20 },
  records: [],
  quarantinedRecords: [],
  portfolio: null,
  loaded: false,
  rev: 0, // 蓋寫防護版本號
  mutating: false, // 同一時間只允許一個帳本寫入，避免連點被 rev 重放成兩筆
};
let tradesMutationVersion = 0;
let tradesLoadSeq = 0;
let tradesHistoryLimit = 40;
let tradesEditingId = "";
let tradeInstrumentProfileSeq = 0;
const tradeInstrumentProfileRequests = new WeakMap();

function compactTradeDate(value) {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(compact) ? compact : "";
}

function tradeDateInputValue(value) {
  const compact = compactTradeDate(value);
  return compact ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : "";
}

function tradeDateOf(record) {
  return compactTradeDate(record?.tradeDate || record?.date);
}

function tradeFeeAmountOf(record) {
  const value = record?.feeAmountTwd ?? record?.fee;
  return value === null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
}

function tradeTaxAmountOf(record) {
  const value = record?.taxAmountTwd ?? record?.tax;
  return value === null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
}

function tradeInstrumentOf(record) {
  if (record?.instrumentType) return record.instrumentType;
  return record?.kind === "etf" ? "unknownEtf" : "stock";
}

function tradeInstrumentLabel(record) {
  const labels = {
    stock: "股票",
    equityEtf: "股票 ETF",
    unknownEtf: "舊 ETF",
    bondIndexEtf: "債券指數 ETF",
    leveragedInverseEtf: "槓桿／反向 ETF",
    activeEtf: "主動式 ETF",
    otherEtf: "期貨／多資產 ETF",
    etn: "ETN",
    other: "其他",
  };
  return labels[tradeInstrumentOf(record)] || "待確認";
}

function setTradeInstrumentProfileStatus(form, message, tone = "idle") {
  const status = form?.querySelector("[data-trade-product-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

async function refreshTradeInstrumentProfile(form, { autoSelect = true } = {}) {
  if (!form) return;
  const code = normalizeStockCodeInput(form.elements.code?.value);
  if (!isValidSecurityCode(code)) {
    setTradeInstrumentProfileStatus(form, "輸入 4～6 碼證券代號後，會向官方商品主檔核對類型。", "idle");
    return;
  }
  const editingId = String(form.dataset.editingId || "");
  const editingRecord = editingId ? tradesState.records.find((record) => record.id === editingId) : null;
  if (editingRecord && normalizeStockCodeInput(editingRecord.code) === code) {
    const verified = editingRecord.instrumentSource === "official";
    setTradeInstrumentProfileStatus(
      form,
      verified
        ? `已保存的官方分類：${tradeInstrumentLabel(editingRecord)}；未更換代號時不重新改寫歷史分類。`
        : `這筆歷史分類仍待覆核；未更換代號時不會在背景重新分類。`,
      verified ? "official" : "review",
    );
    return;
  }

  const requestId = ++tradeInstrumentProfileSeq;
  const selectedAtStart = form.elements.instrumentType?.value || "stock";
  const userEditVersion = String(form.dataset.productUserEditVersion || "0");
  tradeInstrumentProfileRequests.set(form, requestId);
  setTradeInstrumentProfileStatus(form, `正在核對 ${code} 的官方商品分類…`, "loading");
  try {
    const payload = await fetchApi(`/api/instrument-profile?code=${encodeURIComponent(code)}`);
    if (tradeInstrumentProfileRequests.get(form) !== requestId) return;
    if (normalizeStockCodeInput(form.elements.code?.value) !== code) return;
    const profile = payload?.status === "official" ? payload.profile : null;
    if (!profile) {
      const select = form.elements.instrumentType;
      const userHasChanged = String(form.dataset.productUserEditVersion || "0") !== userEditVersion
        || (select?.value || "stock") !== selectedAtStart;
      if (autoSelect && select && !userHasChanged && [...select.options].some((option) => option.value === "other")) {
        select.value = "other";
        syncTradeFormControls(form);
      }
      setTradeInstrumentProfileStatus(
        form,
        payload?.dataQuality?.degraded
          ? "官方主檔目前不完整，暫不自動判定；儲存後會標記待覆核。"
          : "官方主檔尚未確認這個代號；仍可儲存，但會標記待覆核。",
        "review",
      );
      return;
    }
    const select = form.elements.instrumentType;
    const userHasChanged = String(form.dataset.productUserEditVersion || "0") !== userEditVersion
      || (select?.value || "stock") !== selectedAtStart;
    if (autoSelect && select && !userHasChanged && [...select.options].some((option) => option.value === profile.instrumentType)) {
      select.value = profile.instrumentType;
      syncTradeFormControls(form);
    }
    const marketBase = profile.market === "TPEx" ? "上櫃" : profile.market === "TWSE" ? "上市" : "市場待確認";
    const market = profile.membershipStatus === "notCurrent"
      ? `${marketBase}歷史主檔`
      : profile.membershipStatus === "unknown" ? `${marketBase}分類（現行狀態未確認）` : marketBase;
    const asOf = tradeDateInputValue(profile.instrumentAsOf).replaceAll("-", "/");
    setTradeInstrumentProfileStatus(
      form,
      `官方主檔：${tradeInstrumentLabel(profile)} · ${market}${asOf ? ` · 資料日 ${asOf}` : ""}；儲存時由後端再次核定。`,
      "official",
    );
  } catch {
    if (tradeInstrumentProfileRequests.get(form) !== requestId) return;
    setTradeInstrumentProfileStatus(form, "官方分類服務暫時無法連線；仍可儲存，後端會保守估算並標記待覆核。", "review");
  }
}

function tradeCostSourceLabel(source) {
  if (source === "broker") return "實";
  if (source === "manual") return "手填";
  if (source === "estimated") return "估";
  return "舊";
}

function tradeDayTradeOf(record) {
  if (record?.dayTrade && typeof record.dayTrade === "object") return record.dayTrade;
  return record?.kind === "dayTrade"
    ? { status: "legacyDeclared", matchedShares: 0, pairId: "" }
    : { status: "none", matchedShares: 0, pairId: "" };
}

function tradeExecutedTimeOf(record) {
  const match = /T(\d{2}:\d{2}(?::\d{2})?)/.exec(String(record?.executedAt || ""));
  return match ? match[1] : "";
}

function tradeActualAmountForEdit(record, amountKey, sourceKey) {
  if (!["broker", "manual"].includes(record?.[sourceKey])) return "";
  const amount = amountKey === "feeAmountTwd" ? tradeFeeAmountOf(record) : tradeTaxAmountOf(record);
  const value = Number(amount);
  return Number.isFinite(value) && value >= 0 ? String(value) : "";
}

function selectedTradeOption(actual, expected) {
  return actual === expected ? " selected" : "";
}

function syncTradeFormControls(form, { focusDividend = false } = {}) {
  if (!form) return;
  const side = form.elements.side?.value || "buy";
  const instrumentType = form.elements.instrumentType?.value || "stock";
  const isDividend = side === "dividend";
  const isSell = side === "sell";
  const dividendField = form.querySelector("[data-trade-dividend-only]");
  const dividendInput = form.elements.receivedAmount;
  const productSelect = form.elements.instrumentType;
  const actuals = form.querySelector("[data-trade-actuals]");
  const dayTradeSelect = form.elements.dayTradeStatus;
  const matchedInput = form.elements.matchedShares;
  const feeInput = form.elements.feeAmountTwd;
  const taxInput = form.elements.taxAmountTwd;
  const sessionSelect = form.elements.session;
  const executedInput = form.elements.executedTime;

  if (dividendField) dividendField.hidden = !isDividend;
  if (dividendInput) {
    dividendInput.required = isDividend;
    dividendInput.disabled = !isDividend;
    if (!isDividend) dividendInput.value = "";
  }
  if (productSelect) productSelect.disabled = isDividend;
  if (actuals) {
    actuals.hidden = isDividend;
    if (isDividend) actuals.open = false;
  }
  if (feeInput) {
    feeInput.disabled = isDividend;
    if (isDividend) feeInput.value = "";
  }
  if (taxInput) {
    taxInput.disabled = !isSell;
    if (!isSell) taxInput.value = "";
  }
  if (sessionSelect) sessionSelect.disabled = isDividend;
  if (executedInput) executedInput.disabled = isDividend;

  const canConfirmDayTrade = isSell && instrumentType === "stock";
  if (dayTradeSelect) {
    dayTradeSelect.disabled = !canConfirmDayTrade;
    if (!canConfirmDayTrade) dayTradeSelect.value = "none";
  }
  const hasConfirmedDayTrade = canConfirmDayTrade && ["brokerConfirmed", "userConfirmed"].includes(dayTradeSelect?.value);
  if (matchedInput) {
    matchedInput.disabled = !hasConfirmedDayTrade;
    matchedInput.required = hasConfirmedDayTrade;
    if (!hasConfirmedDayTrade) matchedInput.value = "";
  }
  if (isDividend && focusDividend) dividendInput?.focus();
}

function isValidTradeDateInput(value, todayIso = getTaiwanClockParts().isoDate) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(todayIso) && text <= todayIso;
}

// 現金股利權利以「除息日前一交易日收盤持有」為準：除息日賣出仍有權利，
// 除息日才買進則沒有。因此只重放 date < exDate 的買賣，不能使用現在庫存。
function dividendEntitlementShares(records, code, exDate) {
  const cleanCode = String(code || "").trim().toUpperCase();
  const cutoff = compactTradeDate(exDate);
  if (!cleanCode || !cutoff) return 0;
  let shares = 0;
  for (const record of Array.isArray(records) ? records : []) {
    if (String(record?.code || "").toUpperCase() !== cleanCode) continue;
    const recordDate = tradeDateOf(record);
    if (!recordDate || recordDate >= cutoff) continue;
    if (record.side === "buy") shares += Number(record.shares) || 0;
    if (record.side === "sell") shares -= Number(record.shares) || 0;
  }
  return Math.max(0, Math.round(shares));
}

function dividendEventMeta(stock) {
  const div = stock?.dividend;
  const exDate = compactTradeDate(div?.exDate);
  const exchange = stock?.exchange === "TPEx" ? "TPEx" : "TWSE";
  if (!stock?.code || !exDate) return null;
  return {
    eventId: `cash-dividend:${exchange}:${stock.code}:${exDate}`,
    recordId: `div:${exchange}:${stock.code}:${exDate}`,
    exDate,
    exchange,
  };
}

function hasDividendEventRecord(records, stock) {
  const event = dividendEventMeta(stock);
  if (!event) return false;
  return (Array.isArray(records) ? records : []).some((record) => (
    record?.side === "dividend"
    && String(record.code) === String(stock.code)
    && (
      record.eventId === event.eventId
      || record.id === event.recordId
      || compactTradeDate(record.exDate || tradeDateOf(record)) === event.exDate
    )
  ));
}

function beginTradeMutation() {
  if (tradesState.mutating) {
    showToast("上一筆帳本操作仍在儲存，請稍候");
    return false;
  }
  tradesState.mutating = true;
  tradesMutationVersion += 1;
  return true;
}

function finishTradeMutation() {
  tradesState.mutating = false;
  render();
}

function applyTradesPayload(payload) {
  if (Number.isInteger(Number(payload.schemaVersion))) tradesState.schemaVersion = Number(payload.schemaVersion);
  if (payload.settings) tradesState.settings = payload.settings;
  tradesState.records = Array.isArray(payload.records) ? payload.records : [];
  tradesState.quarantinedRecords = Array.isArray(payload.quarantinedRecords) ? payload.quarantinedRecords : [];
  tradesState.portfolio = payload.portfolio || null;
  // 官方歸檔有、帳本沒登錄的除權／現增（伺服器比對後回傳）。漏記不只是顯示假虧損，
  // 之後想賣掉含配股的股數還會被賣超檢查擋下，所以要主動提示補登。
  tradesState.missingCorporateActions = Array.isArray(payload.missingCorporateActions)
    ? payload.missingCorporateActions
    : [];
  if (Number.isFinite(Number(payload.rev))) tradesState.rev = Number(payload.rev);
  tradesState.loaded = true;
}

async function loadTradesFromServer() {
  if (!authState.user) return;
  const scope = captureAuthScope();
  const requestSeq = ++tradesLoadSeq;
  const mutationVersion = tradesMutationVersion;
  try {
    const payload = await fetchApi("/api/trades");
    if (
      !isCurrentAuthScope(scope)
      || requestSeq !== tradesLoadSeq
      || mutationVersion !== tradesMutationVersion
      || Number(payload.rev || 0) < tradesState.rev
    ) return;
    applyTradesPayload(payload);
    render();
  } catch (error) {
    if (!isCurrentAuthScope(scope) || requestSeq !== tradesLoadSeq) return;
    if (!handleAuthRequired(error)) showToast(`持股資料同步失敗：${error.message}`);
  }
}

async function putTrades(next) {
  const scope = captureAuthScope();
  const payload = await fetchApi("/api/trades", {
    method: "PUT",
    body: JSON.stringify({ schemaVersion: tradesState.schemaVersion || 2, ...next, rev: tradesState.rev }),
  });
  if (!isCurrentAuthScope(scope)) throw authScopeChangedError();
  if (payload?.ok === false) throw new Error(payload.error || "儲存失敗");
  applyTradesPayload(payload);
}

// 蓋寫防護的重放：409（別的分頁改過）→ 先同步最新版，再把「這一次的操作」重放一次。
// 交易紀錄的操作都是「新增一筆／刪一筆／改設定」，天然可以在新狀態上重放。
async function putTradesWithRetry(buildNext) {
  const scope = captureAuthScope();
  try {
    await putTrades(buildNext());
  } catch (error) {
    if (error?.status !== 409) throw error;
    if (!isCurrentAuthScope(scope)) throw authScopeChangedError();
    const latest = await fetchApi("/api/trades");
    if (!isCurrentAuthScope(scope)) throw authScopeChangedError();
    applyTradesPayload(latest);
    if (!isCurrentAuthScope(scope)) throw authScopeChangedError();
    await putTrades(buildNext()); // 仍失敗就往外拋，交給呼叫端 toast
    if (!isCurrentAuthScope(scope)) throw authScopeChangedError();
    showToast("其他視窗剛更新過帳本，已自動同步並套用你這筆操作");
  }
}

async function addTradeRecord(fields) {
  if (!authState.user) {
    showToast("記帳需要登入（更多 → 帳號管理）");
    return false;
  }
  if (!beginTradeMutation()) return false;
  const record = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    ...fields,
  };
  try {
    await putTradesWithRetry(() => ({ settings: tradesState.settings, records: [...tradesState.records, record] }));
    showToast(`已記一筆：${fields.side === "sell" ? "賣出" : fields.side === "dividend" ? "股利" : "買進"} ${fields.code}`);
    return true;
  } catch (error) {
    if (!handleAuthRequired(error)) showToast(error.message); // 賣超等驗證訊息直接給使用者看
    return false;
  } finally {
    finishTradeMutation();
  }
}

async function removeTradeRecord(id) {
  const recordId = String(id || "");
  if (!recordId || !tradesState.records.some((record) => record.id === recordId)) {
    showToast("找不到要刪除的交易紀錄，請重新整理後再試");
    return false;
  }
  if (!beginTradeMutation()) return false;
  try {
    await putTradesWithRetry(() => {
      if (!tradesState.records.some((record) => record.id === recordId)) {
        throw new Error("這筆交易已在其他視窗刪除，未重複送出刪除");
      }
      return { settings: tradesState.settings, records: tradesState.records.filter((record) => record.id !== recordId) };
    });
    if (tradesEditingId === recordId) tradesEditingId = "";
    showToast("已刪除該筆交易");
    return true;
  } catch (error) {
    // 刪掉舊買單會讓後面的賣單變賣超 → 伺服器擋下，這裡把原因講清楚。
    if (!handleAuthRequired(error)) showToast(`刪不掉：${error.message}`);
    return false;
  } finally {
    finishTradeMutation();
  }
}

async function updateTradeRecord(id, patch, {
  missingMessage = "找不到要更新的股利紀錄，請重新整理後再試",
  vanishedMessage = "這筆股利已在其他視窗刪除，未進行入帳更新",
  successMessage = "股利已確認入帳",
  errorPrefix = "股利入帳失敗",
} = {}) {
  const recordId = String(id || "");
  if (!recordId || !tradesState.records.some((record) => record.id === recordId)) {
    showToast(missingMessage);
    return false;
  }
  if (!beginTradeMutation()) return false;
  try {
    await putTradesWithRetry(() => {
      const current = tradesState.records.find((record) => record.id === recordId);
      if (!current) throw new Error(vanishedMessage);
      const nextPatch = typeof patch === "function" ? patch(current) : patch;
      return {
        settings: tradesState.settings,
        records: tradesState.records.map((record) => (
          record.id === recordId ? { ...record, ...nextPatch, id: record.id, eventId: record.eventId } : record
        )),
      };
    });
    renderHoldingsPanel();
    showToast(successMessage);
    return true;
  } catch (error) {
    if (!handleAuthRequired(error)) showToast(`${errorPrefix}：${error.message}`);
    return false;
  } finally {
    finishTradeMutation();
  }
}

function buildTradeEditPatch(current, fields, { feeProvided, taxProvided }) {
  const currentFeeSource = String(current?.feeSource || "");
  const currentTaxSource = String(current?.taxSource || "");
  const sameSecurity = String(current?.code || "") === fields.code;
  const sameInstrument = tradeInstrumentOf(current) === fields.instrumentType;
  const currentDayTrade = tradeDayTradeOf(current);
  const sameTradeDate = tradeDateOf(current) === compactTradeDate(fields.tradeDate || fields.date);
  const economicChanged = !sameSecurity
    || !sameInstrument
    || current?.side !== fields.side
    || Number(current?.price) !== Number(fields.price)
    || Number(current?.shares) !== Number(fields.shares)
    || !sameTradeDate;
  const keepPairId = sameSecurity
    && sameTradeDate
    && fields.side === "sell"
    && current?.session === fields.session
    && currentDayTrade.status === fields.dayTrade.status
    && Number(currentDayTrade.matchedShares || 0) === Number(fields.dayTrade.matchedShares || 0);
  const patch = {
    ...fields,
    market: sameSecurity && fields.market === "unknown" ? (current?.market || "unknown") : fields.market,
    instrumentSource: sameSecurity && sameInstrument ? (current?.instrumentSource || "user") : "user",
    brokerAccountId: current?.brokerAccountId || fields.brokerAccountId || "default",
    dayTrade: {
      ...fields.dayTrade,
      pairId: keepPairId ? String(currentDayTrade.pairId || "") : "",
    },
    reviewStatus: undefined,
    reviewReasons: undefined,
  };

  if (feeProvided) {
    patch.fee = fields.feeAmountTwd;
    patch.feeAmountTwd = fields.feeAmountTwd;
    patch.feeSource = ["broker", "manual"].includes(currentFeeSource) ? currentFeeSource : "broker";
    patch.feeRuleId = undefined;
  } else if (currentFeeSource && (currentFeeSource !== "legacy" || economicChanged)) {
    patch.fee = undefined;
    patch.feeAmountTwd = undefined;
    patch.feeSource = undefined;
    patch.feeRuleId = undefined;
  }

  if (fields.side !== "sell") {
    patch.tax = undefined;
    patch.taxAmountTwd = undefined;
    patch.taxSource = undefined;
    patch.taxRuleId = undefined;
  } else if (taxProvided) {
    patch.tax = fields.taxAmountTwd;
    patch.taxAmountTwd = fields.taxAmountTwd;
    patch.taxSource = ["broker", "manual"].includes(currentTaxSource) ? currentTaxSource : "broker";
    patch.taxRuleId = undefined;
  } else if (currentTaxSource && (currentTaxSource !== "legacy" || economicChanged)) {
    patch.tax = undefined;
    patch.taxAmountTwd = undefined;
    patch.taxSource = undefined;
    patch.taxRuleId = undefined;
  }

  return patch;
}

async function saveEditedTradeRecord(id, fields, actuals) {
  const recordId = String(id || "");
  const saved = await updateTradeRecord(
    recordId,
    (current) => buildTradeEditPatch(current, fields, actuals),
    {
      missingMessage: "找不到要修正的交易紀錄，請重新整理後再試",
      vanishedMessage: "這筆交易已在其他視窗刪除，未進行修正",
      successMessage: "交易紀錄已修正",
      errorPrefix: "交易紀錄修正失敗",
    },
  );
  if (saved && tradesEditingId === recordId) {
    tradesEditingId = "";
    renderHoldingsPanel();
  }
  return saved;
}

function beginTradeEdit(id) {
  const recordId = String(id || "");
  const record = tradesState.records.find((item) => item.id === recordId);
  if (!record || record.side === "dividend") {
    showToast("找不到可修正的交易紀錄");
    return;
  }
  document.activeElement?.blur?.();
  tradesEditingId = recordId;
  renderHoldingsPanel();
  const form = el.holdingsPanel?.querySelector("[data-trade-form]");
  form?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  form?.elements.code?.focus?.();
}

function cancelTradeEdit() {
  if (!tradesEditingId) return;
  document.activeElement?.blur?.();
  tradesEditingId = "";
  renderHoldingsPanel();
}

async function saveTradeSettings(feeDiscount) {
  const value = Number(feeDiscount);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    showToast("折數要在 0.1～1 之間（例：0.6 = 6 折）");
    return;
  }
  if (!beginTradeMutation()) return false;
  try {
    await putTradesWithRetry(() => ({ settings: { ...tradesState.settings, feeDiscount: value }, records: tradesState.records }));
    showToast(`手續費折數已改為 ${value}（只影響之後新增的紀錄）`);
    return true;
  } catch (error) {
    if (!handleAuthRequired(error)) showToast(error.message);
    return false;
  } finally {
    finishTradeMutation();
  }
}

// 錢的顯示：整數＋千分位＋正負號；漲跌配色交給 class。
function formatMoney(value, { signed = false } = {}) {
  if (!Number.isFinite(value)) return "--";
  const rounded = Math.round(value);
  const text = Math.abs(rounded).toLocaleString("zh-TW");
  if (!signed) return rounded < 0 ? `-${text}` : text;
  return rounded >= 0 ? `+${text}` : `-${text}`;
}

// 自選股頁第 4 籤「庫存損益」：總覽＋持股（配即時價算未實現）＋記一筆＋交易紀錄。
// D-22 補登：官方歸檔有、帳本沒登錄的除權／現增。快速鈕只在除權當天出現，
// 錯過就沒有入口了——而漏記會讓之後賣出含配股的股數被賣超檢查擋下，所以要能事後補。
// 比率一律用官方值，使用者不必自己查（手填最容易把「每仟股配股數」當成比率）。
function renderMissingCorporateActions() {
  const missing = tradesState.missingCorporateActions || [];
  if (!missing.length) return "";
  const rows = missing.map((item) => {
    const parts = [];
    if (item.bonusShares > 0) parts.push(`配股 +${Number(item.bonusShares).toLocaleString("zh-TW")} 股`);
    if (item.subscribedShares > 0) {
      parts.push(`現增 +${Number(item.subscribedShares).toLocaleString("zh-TW")} 股＠${formatNumber(item.subscriptionPrice)} 元`);
    }
    const exDate = String(item.exDate || "");
    return `
      <li>
        <span><strong>${escapeHtml(item.code)}</strong> ${escapeHtml(`${exDate.slice(4, 6)}/${exDate.slice(6, 8)}`)} · ${escapeHtml(parts.join("、"))}</span>
        <button class="hold-div-quick is-corporate" type="button" data-corporate-action-quick
          data-code="${escapeHtml(item.code)}" data-ex-date="${escapeHtml(exDate)}"
          data-stock-ratio="${Number(item.stockRatio) || 0}"
          data-subscription-ratio="${Number(item.subscriptionRatio) || 0}"
          data-subscription-price="${Number(item.subscriptionPrice) || 0}"
          ${tradesState.mutating ? "disabled aria-busy=\"true\"" : ""}>補登</button>
      </li>`;
  }).join("");
  return `
    <div class="hold-missing-ca">
      <strong>有 ${missing.length} 筆官方除權／現增尚未登錄</strong>
      <small>漏記會讓持股股數停在配股前——除了未實現損益失真，之後賣出含配股的股數還會被當成賣超擋下。比率取自官方公告。</small>
      <ul>${rows}</ul>
    </div>`;
}

function renderHoldingsPanel() {
  const panel = el.holdingsPanel;
  if (!panel) return;
  const screenEl = document.querySelector('[data-screen-panel="watchlist"]');
  const active = state.watchList === "hold";
  if (screenEl) screenEl.classList.toggle("is-holdings", active);
  panel.hidden = !active;
  if (!active) return;
  if (panel.contains(document.activeElement)) return; // 表單輸入中不重繪
  if (!authState.user) {
    panel.innerHTML = `<div class="hold-empty"><strong>庫存損益需要登入</strong><small>每個帳號的交易紀錄各自獨立，只有自己看得到。到「更多 → 帳號管理」登入。</small></div>`;
    return;
  }
  const settings = tradesState.settings;
  const pf = tradesState.portfolio;
  const holdings = pf?.holdings || [];
  const byCode = new Map(stocks.map((stock) => [stock.code, stock]));
  const holdingCodes = new Set(holdings.map((holding) => holding.code));
  const quickDividendCandidates = stocks
    .map((stock) => {
      const div = stock?.dividend;
      const event = dividendEventMeta(stock);
      if (!div?.isToday || !event || !Number.isFinite(div.cash) || div.cash <= 0) return null;
      const entitledShares = dividendEntitlementShares(tradesState.records, stock.code, event.exDate);
      if (entitledShares <= 0 || hasDividendEventRecord(tradesState.records, stock)) return null;
      return { stock, div, event, entitledShares };
    })
    .filter(Boolean);
  const quickDividendByCode = new Map(quickDividendCandidates.map((item) => [item.stock.code, item]));

  // D-22：除權（無償配股）當日的快速登錄。帳本原本只認買賣與現金股利，配股後股數永遠停在
  // 配股前——除了顯示假虧損，更嚴重的是之後想賣掉「含配股」的全部股數會被賣超檢查擋下。
  // 沿用現金股利快速鈕的同一套模式：只在官方除權基準日當天、且尚未登錄過時出現。
  const hasCorporateActionRecord = (code, exDate) => tradesState.records.some((record) => record.side === "corporateAction"
    && record.code === code
    && String(record.tradeDate || record.date || "") === String(exDate || "").replaceAll("-", ""));
  const quickCorporateActionByCode = new Map(stocks
    .map((stock) => {
      const div = stock?.dividend;
      const stockRatio = finiteNumberOrNull(div?.stockRatio);
      if (!div?.isToday || stockRatio === null || stockRatio <= 0) return null;
      const exDate = String(div.exDate || "").replaceAll("-", "");
      if (!exDate || !holdingCodes.has(stock.code)) return null;
      if (hasCorporateActionRecord(stock.code, exDate)) return null;
      const holding = holdings.find((item) => item.code === stock.code);
      const bonusShares = Math.floor(Number(holding?.shares || 0) * stockRatio);
      if (bonusShares <= 0) return null;
      return { stock, exDate, stockRatio, bonusShares };
    })
    .filter(Boolean)
    .map((item) => [item.stock.code, item]));

  const quickCorporateActionButton = (item) => `
    <button class="hold-div-quick is-corporate" type="button" data-corporate-action-quick
      data-code="${item.stock.code}" data-ex-date="${item.exDate}" data-stock-ratio="${item.stockRatio}"
      title="依除權基準日當下持股計算；無償配股不增加成本，均價會自動稀釋"
      ${tradesState.mutating ? "disabled aria-busy=\"true\"" : ""}>記除權配股 · +${item.bonusShares.toLocaleString("zh-TW")} 股</button>`;

  const quickDividendButton = (item) => `
    <button class="hold-div-quick" type="button" data-dividend-quick
      data-code="${item.stock.code}" data-cash="${item.div.cash}"
      data-shares="${item.entitledShares}" data-event-id="${item.event.eventId}"
      data-record-id="${item.event.recordId}" data-ex-date="${item.event.exDate}"
      data-exchange="${item.event.exchange}" title="依除息日前交易紀錄計算：${item.entitledShares.toLocaleString("zh-TW")} 股"
      ${tradesState.mutating ? "disabled aria-busy=\"true\"" : ""}>記應收股利 · ${item.entitledShares.toLocaleString("zh-TW")} 股</button>`;

  let totalValue = 0;
  let totalUnrealized = 0;
  let pricedCost = 0; // 報酬率的分母只能算「有報價、已計入市值與未實現」的那部分成本
  let unpriced = 0;
  const holdRows = holdings
    .map((h) => {
      const stock = byCode.get(h.code);
      // 同上：Number(null)===0 會讓未報價的持股算出市值 0、未實現＝全額虧損，還會混進總計。
      const price = positivePriceOrNull(stock?.price);
      const hasPrice = price !== null;
      const value = hasPrice ? price * h.shares : null;
      const unrealized = hasPrice ? value - h.cost : null;
      if (hasPrice) {
        totalValue += value;
        totalUnrealized += unrealized;
        pricedCost += h.cost;
      } else {
        unpriced += 1;
      }
      const pct = hasPrice && h.cost > 0 ? (unrealized / h.cost) * 100 : null;
      const tone = unrealized == null ? "" : unrealized >= 0 ? "is-up" : "is-down";
      // 除息提示：5 天內即將除息顯示 chip；除息日當天先認列應收，實際匯入後再確認入帳。
      const div = stock?.dividend;
      const divChip = div && Number.isFinite(div.daysUntil) && div.daysUntil >= 0 && div.daysUntil <= 5
        ? `<span class="hold-exdiv ${div.isToday ? "is-today" : ""}">${div.isToday ? "今日" : `${div.exDate.slice(5).replace("-", "/")} `}${escapeHtml(div.kind || "除息")}${Number.isFinite(div.cash) && div.cash > 0 ? ` 每股 ${formatNumber(div.cash, 6)} 元` : ""}${hasDividendEventRecord(tradesState.records, stock) ? " · 已記" : ""}</span>`
        : "";
      const divQuick = quickDividendByCode.has(h.code) ? quickDividendButton(quickDividendByCode.get(h.code)) : "";
      const caQuick = quickCorporateActionByCode.has(h.code)
        ? quickCorporateActionButton(quickCorporateActionByCode.get(h.code))
        : "";
      return `
        <div class="hold-row">
          <span class="hold-name"><strong>${escapeHtml(stock?.name || h.code)}</strong><span>${h.code}</span>${divChip}</span>
          <span class="hold-cell"><em>股數</em><b>${h.shares.toLocaleString("zh-TW")}</b></span>
          <span class="hold-cell"><em>均價</em><b>${formatNumber(h.avgCost)}</b></span>
          <span class="hold-cell"><em>現價</em><b>${hasPrice ? formatNumber(price) : "--"}</b></span>
          <span class="hold-cell"><em>市值</em><b>${value != null ? formatMoney(value) : "--"}</b></span>
          ${h.dividendsReceivableGross > 0 ? `<span class="hold-cell"><em>待入帳股利</em><b>${formatMoney(h.dividendsReceivableGross)}</b></span>` : ""}
          ${h.dividends > 0 ? `<span class="hold-cell"><em>已入帳股利</em><b>${formatMoney(h.dividends)}</b></span>` : ""}
          <span class="hold-cell hold-pnl ${tone}"><em>未實現</em><b>${unrealized != null ? `${formatMoney(unrealized, { signed: true })}${pct != null ? `（${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%）` : ""}` : "--"}</b></span>
          ${divQuick}
          ${caQuick}
        </div>`;
    })
    .join("");

  const totalCost = pf?.totals?.cost || 0;
  // 分母必須與分子同口徑：totalUnrealized 只累加有報價的持股，若拿含未報價部位的 totalCost 當分母，
  // 報酬率會被灌水稀釋（例：+10,000 / 有報價成本 100,000 = +10%，用全部成本 200,000 算變 +5%）。
  const totalPct = pricedCost > 0 ? (totalUnrealized / pricedCost) * 100 : null;
  const upTone = totalUnrealized >= 0 ? "is-up" : "is-down";
  const realizedPnl = pf?.totals?.realizedPnl || 0;
  const dividendRecognizedGross = Number(pf?.totals?.dividendRecognizedGross ?? pf?.totals?.dividendIncome) || 0;
  const dividendReceivableGross = Number(pf?.totals?.dividendReceivableGross) || 0;
  const dividendReceivedNet = Number(pf?.totals?.dividendReceivedNet ?? pf?.totals?.dividendIncome) || 0;
  const hasDividendRecords = tradesState.records.some((record) => record.side === "dividend");
  const todayIso = getTaiwanClockParts().isoDate;
  let editingRecord = tradesEditingId
    ? tradesState.records.find((record) => record.id === tradesEditingId && record.side !== "dividend")
    : null;
  if (tradesEditingId && !editingRecord) {
    tradesEditingId = "";
    editingRecord = null;
  }
  const editingDayTrade = tradeDayTradeOf(editingRecord);
  const formSide = editingRecord?.side || "buy";
  const formInstrument = editingRecord ? tradeInstrumentOf(editingRecord) : "stock";
  const formSession = editingRecord?.session || "regular";
  const formFeeActual = editingRecord
    ? tradeActualAmountForEdit(editingRecord, "feeAmountTwd", "feeSource")
    : "";
  const formTaxActual = editingRecord
    ? tradeActualAmountForEdit(editingRecord, "taxAmountTwd", "taxSource")
    : "";
  const formHasAdvancedValues = Boolean(
    editingRecord
    && (editingDayTrade.status !== "none" || editingRecord.executedAt || formSession !== "regular" || formFeeActual !== "" || formTaxActual !== ""),
  );

  const realizedById = new Map((pf?.realized || []).map((r) => [r.id, r]));
  const recordRows = [...tradesState.records]
    .reverse()
    .slice(0, tradesHistoryLimit)
    .map((t) => {
      // 公司行動（除權／現增）是「事件」不是「成交」：沒有價金、股數與費稅，
      // 底下整套買賣／股利的欄位讀取全都不適用（實測會在 shares.toLocaleString 直接丟例外）。
      // 用獨立的精簡列呈現，說明它對持股做了什麼，讓帳本的變化可稽核。
      if (t.side === "corporateAction") {
        const caDate = tradeDateOf(t) || "";
        const stockRatio = finiteNumberOrNull(t.stockRatio) || 0;
        const subscriptionRatio = finiteNumberOrNull(t.subscriptionRatio) || 0;
        const subscriptionPrice = finiteNumberOrNull(t.subscriptionPrice) || 0;
        const parts = [];
        if (stockRatio > 0) parts.push(`無償配股 ${(stockRatio * 100).toFixed(2).replace(/\.?0+$/, "")}%`);
        if (subscriptionRatio > 0) {
          parts.push(`現增 ${(subscriptionRatio * 100).toFixed(2).replace(/\.?0+$/, "")}%＠${formatNumber(subscriptionPrice)} 元`);
        }
        return `
          <div class="trade-row is-corporate-action">
            <span class="trade-side is-corporate">權</span>
            <span class="trade-main">
              <strong>${escapeHtml(t.code)}</strong>
              <small>${escapeHtml(`${caDate.slice(4, 6)}/${caDate.slice(6, 8)}`)} · ${escapeHtml(parts.join("、") || "公司行動")}</small>
            </span>
            <span class="trade-note">依基準日持股調整股數；無償配股不增加成本</span>
          </div>`;
      }
      const r = realizedById.get(t.id);
      const isDiv = t.side === "dividend";
      const dividendStatus = isDiv && (t.status === "receivable" || t.status === "received")
        ? t.status
        : isDiv ? (t.source === "official-event" || t.eventId ? "receivable" : "received") : "";
      const sideLabel = isDiv ? "息" : t.side === "sell" ? "賣" : "買";
      const sideClass = isDiv ? "is-div" : t.side === "sell" ? "is-sell" : "is-buy";
      const dividendGross = isDiv ? Number(t.price) * Number(t.shares) : null;
      const dividendReceived = isDiv && dividendStatus === "received"
        ? (Number.isFinite(Number(t.receivedAmount)) ? Number(t.receivedAmount) : dividendGross - (Number(t.fee) || 0))
        : null;
      const dayTrade = tradeDayTradeOf(t);
      const instrumentTag = isDiv ? "" : `<i class="trade-kind is-product">${escapeHtml(tradeInstrumentLabel(t))}</i>`;
      const dayTradeTag = !isDiv && dayTrade.status !== "none"
        ? `<i class="trade-kind is-daytrade">${dayTrade.status === "legacyDeclared" ? "舊當沖・待核" : `當沖 ${Number(dayTrade.matchedShares || 0).toLocaleString("zh-TW")} 股`}</i>`
        : "";
      const reviewTitle = Array.isArray(t.reviewReasons) ? t.reviewReasons.join("；") : "舊資料尚未覆核";
      const reviewTag = !isDiv && (t.reviewStatus === "needsReview" || (!t.reviewStatus && !t.feeSource))
        ? `<i class="trade-kind is-review" data-trade-review-status title="${escapeHtml(reviewTitle)}">待覆核</i>`
        : "";
      const receiptDate = tradeDateInputValue(t.receivedDate || todayIso);
      const recordTradeDate = tradeDateOf(t);
      const recognitionDate = tradeDateInputValue(recordTradeDate);
      const dividendStatusHtml = isDiv
        ? `<i class="trade-dividend-status is-${dividendStatus}" data-dividend-status="${dividendStatus}">${dividendStatus === "receivable" ? "待入帳" : "已入帳"}</i>`
        : "";
      const receiveFormMarkup = (mode) => `<form class="dividend-receive-form" data-dividend-receive-form data-record-id="${escapeHtml(String(t.id))}" data-receive-mode="${mode}">
            <label><span>入帳日</span><input name="receivedDate" type="date" value="${receiptDate}" min="${recognitionDate}" max="${todayIso}" aria-label="股利實際入帳日" required /></label>
            <label class="dividend-receive-amount"><span>實收金額</span><input name="receivedAmount" type="number" step="0.01" min="0" value="${mode === "correct" && Number.isFinite(dividendReceived) ? dividendReceived : ""}" inputmode="decimal" placeholder="實收金額${Number.isFinite(dividendGross) ? `（公告毛額 ${formatMoney(dividendGross)}）` : ""}" aria-label="股利實收金額" required /></label>
            <button type="submit" data-dividend-receive ${tradesState.mutating ? "disabled aria-busy=\"true\"" : ""}>${mode === "correct" ? "儲存修正" : "確認入帳"}</button>
          </form>`;
      const receiveForm = isDiv && dividendStatus === "receivable" ? receiveFormMarkup("receive") : "";
      const correctionForm = isDiv && dividendStatus === "received"
        ? `<details class="dividend-correction"><summary data-dividend-edit-receipt aria-label="修正股利入帳資料">修正入帳資料</summary>${receiveFormMarkup("correct")}</details>`
        : "";
      const feeAmount = tradeFeeAmountOf(t);
      const taxAmount = tradeTaxAmountOf(t);
      const feeSource = tradeCostSourceLabel(t.feeSource);
      const taxSource = tradeCostSourceLabel(t.taxSource);
      const dividendMeta = isDiv && dividendStatus === "received"
        ? `入帳 ${receiptDate.slice(5).replace("-", "/")}`
        : isDiv ? "認列毛額" : `手續費 ${feeAmount ?? "—"}<i class="trade-cost-source" data-trade-cost-source>${feeSource}</i>・證交稅 ${taxAmount ?? "—"}<i class="trade-cost-source" data-trade-cost-source title="${escapeHtml(String(t.taxRuleId || ""))}">${taxSource}</i>`;
      const dividendAmountText = dividendStatus === "received" && Number.isFinite(dividendReceived)
        ? `實收金額 ${dividendReceived.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : formatMoney(dividendGross);
      return `
        <div class="trade-row">
          <span class="trade-date">${isDiv ? "認列 " : ""}${recordTradeDate.slice(4, 6)}/${recordTradeDate.slice(6, 8)}</span>
          <span class="trade-main"><b class="${sideClass}">${sideLabel}</b> ${escapeHtml(byCode.get(t.code)?.name || t.code)} ${t.code}${instrumentTag}${dayTradeTag}${reviewTag}${dividendStatusHtml}</span>
          <span class="trade-qty">${isDiv ? `每股 ${formatNumber(t.price, 6)}` : formatNumber(t.price)} × ${t.shares.toLocaleString("zh-TW")} 股</span>
          <span class="trade-fee">${dividendMeta}</span>
          <span class="trade-pnl ${isDiv ? "is-up" : r ? (r.pnl >= 0 ? "is-up" : "is-down") : ""}">${isDiv ? dividendAmountText : r ? formatMoney(r.pnl, { signed: true }) : ""}</span>
          ${isDiv ? "" : `<button class="trade-edit" data-trade-edit="${escapeHtml(t.id)}" type="button" aria-label="修正這筆交易"${tradesEditingId === t.id ? " aria-current=\"true\"" : ""}>${tradesEditingId === t.id ? "修正中" : "修正"}</button>`}
          <button class="alert-del" data-trade-remove="${escapeHtml(t.id)}" type="button" aria-label="刪除這筆交易">刪除</button>
          ${receiveForm}
          ${correctionForm}
        </div>`;
    })
    .join("");

  const closedPositionDividendActions = quickDividendCandidates.filter((item) => !holdingCodes.has(item.stock.code));
  const closedPositionDividendHtml = closedPositionDividendActions.length
    ? `<div class="hold-dividend-actions" role="status">
        <span><strong>今日除息權利</strong><small>即使今天已賣出，仍按除息日前持股計算</small></span>
        ${closedPositionDividendActions.map(quickDividendButton).join("")}
      </div>`
    : "";
  panel.innerHTML = `
    <div class="hold-summary">
      <div><span>總市值</span><strong>${formatMoney(totalValue)}</strong></div>
      <div><span>總成本</span><strong>${formatMoney(totalCost)}</strong></div>
      <div><span>未實現損益</span><strong class="${upTone}">${formatMoney(totalUnrealized, { signed: true })}${totalPct != null ? `（${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(1)}%）` : ""}</strong></div>
      <div><span>已實現累計</span><strong class="${realizedPnl >= 0 ? "is-up" : "is-down"}">${formatMoney(realizedPnl, { signed: true })}</strong></div>
    </div>
    ${(hasDividendRecords || dividendRecognizedGross || dividendReceivableGross || dividendReceivedNet) ? `
      <div class="hold-dividend-summary" aria-label="股利入帳摘要">
        <div data-dividend-summary="recognized"><span>已認列毛額</span><strong>${formatMoney(dividendRecognizedGross)}</strong></div>
        <div data-dividend-summary="receivable"><span>待入帳</span><strong>${formatMoney(dividendReceivableGross)}</strong></div>
        <div data-dividend-summary="received"><span>已入帳淨額</span><strong>${formatMoney(dividendReceivedNet)}</strong></div>
      </div>` : ""}
    ${renderMissingCorporateActions()}
    ${unpriced ? `<p class="hold-hint">${unpriced} 檔暫無報價，未計入市值與未實現損益，報酬率分母也只算已報價部位（開盤後會自動補上）；「總成本」仍為全部持股。</p>` : ""}
    ${closedPositionDividendHtml}
    ${tradesState.quarantinedRecords.length ? `<div class="trade-review-banner" role="status"><strong>${tradesState.quarantinedRecords.length} 筆舊資料待整理</strong><span>原始內容已安全保留，未納入持股與損益；不會在升級時被靜默刪除。</span></div>` : ""}
    <div class="hold-list">
      ${holdRows || `<div class="hold-empty"><strong>目前沒有庫存</strong><small>用下面的表單記下第一筆買進，之後這裡會自動算持股與損益。</small></div>`}
    </div>
    <form class="trade-form${editingRecord ? " is-editing" : ""}" data-trade-form${editingRecord ? ` data-editing-id="${escapeHtml(editingRecord.id)}"` : ""}>
      ${editingRecord ? `<div class="trade-edit-banner" role="status"><strong>正在修正 ${escapeHtml(byCode.get(editingRecord.code)?.name || editingRecord.code)} ${escapeHtml(editingRecord.code)}</strong><span>儲存後保留原紀錄編號與建立時間；清空實際費稅會改回估算。</span></div>` : ""}
      <div class="trade-form-main">
        <label><span>代號</span><input name="code" placeholder="2330／00725B" value="${escapeHtml(String(editingRecord?.code || state.selectedCode || ""))}" maxlength="6" autocapitalize="characters" aria-label="證券代號" required /></label>
        <label><span>類別</span><select name="side" aria-label="買賣別">
          <option value="buy"${selectedTradeOption(formSide, "buy")}>買進</option>
          <option value="sell"${selectedTradeOption(formSide, "sell")}>賣出</option>
          <option value="dividend"${editingRecord ? " disabled" : ""}>股利（已入帳）</option>
        </select></label>
        <label data-trade-product-field><span>商品</span><select name="instrumentType" aria-label="商品類型">
          <option value="stock"${selectedTradeOption(formInstrument, "stock")}>股票</option>
          <option value="equityEtf"${selectedTradeOption(formInstrument, "equityEtf")}>股票型 ETF</option>
          <option value="unknownEtf"${selectedTradeOption(formInstrument, "unknownEtf")}>舊 ETF（待確認）</option>
          <option value="bondIndexEtf"${selectedTradeOption(formInstrument, "bondIndexEtf")}>債券指數 ETF</option>
          <option value="leveragedInverseEtf"${selectedTradeOption(formInstrument, "leveragedInverseEtf")}>槓桿／反向 ETF</option>
          <option value="activeEtf"${selectedTradeOption(formInstrument, "activeEtf")}>主動式 ETF</option>
          <option value="otherEtf"${selectedTradeOption(formInstrument, "otherEtf")}>期貨／多資產 ETF</option>
          <option value="etn"${selectedTradeOption(formInstrument, "etn")}>ETN</option>
          <option value="other"${selectedTradeOption(formInstrument, "other")}>其他／待確認</option>
        </select></label>
        <label><span>成交價</span><input name="price" type="number" step="0.000001" min="0.000001" inputmode="decimal" value="${editingRecord ? escapeHtml(String(editingRecord.price)) : ""}" placeholder="每股價格" aria-label="成交價；選股利時填每股現金股利，最多六位小數" required /></label>
        <label><span>股數</span><input name="shares" type="number" step="1" min="1" inputmode="numeric" value="${editingRecord ? escapeHtml(String(editingRecord.shares)) : ""}" placeholder="1 張＝1000 股" aria-label="股數" required /></label>
        <label data-trade-dividend-only hidden><span>股利實收</span><input name="receivedAmount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="實收總額" aria-label="股利實收總額" /></label>
        <label><span>成交日</span><input name="date" type="date" value="${editingRecord ? tradeDateInputValue(tradeDateOf(editingRecord)) : todayIso}" max="${todayIso}" aria-label="成交日（不可晚於台北今天）" required /></label>
        <button type="submit" ${tradesState.mutating ? "disabled aria-busy=\"true\"" : ""}>${tradesState.mutating ? "儲存中…" : editingRecord ? "儲存修正" : "記一筆"}</button>
        ${editingRecord ? `<button class="trade-edit-cancel" type="button" data-trade-edit-cancel>取消修正</button>` : ""}
      </div>
      <p class="trade-product-status" data-trade-product-status data-tone="${editingRecord?.instrumentSource === "official" ? "official" : editingRecord ? "review" : "idle"}" role="status" aria-live="polite">${editingRecord
        ? editingRecord.instrumentSource === "official"
          ? `已保存的官方分類：${escapeHtml(tradeInstrumentLabel(editingRecord))}；未更換代號時不重新改寫歷史分類。`
          : "這筆歷史分類仍待覆核；未更換代號時不會在背景重新分類。"
        : "修改證券代號後會先顯示官方分類；儲存時後端仍會再次核定。"}</p>
      <details class="trade-actuals" data-trade-actuals${formHasAdvancedValues ? " open" : ""}>
        <summary>當沖與券商實際費稅（選填）</summary>
        <div class="trade-form-advanced">
          <label><span>當沖確認</span><select name="dayTradeStatus" data-trade-daytrade-status aria-label="當沖確認狀態" disabled>
            <option value="none"${selectedTradeOption(editingDayTrade.status || "none", "none")}>非當沖／不確定</option>
            <option value="brokerConfirmed"${selectedTradeOption(editingDayTrade.status, "brokerConfirmed")}>券商已確認</option>
            <option value="userConfirmed"${selectedTradeOption(editingDayTrade.status, "userConfirmed")}>自行確認（待券商核對）</option>
            ${editingDayTrade.status === "legacyDeclared" ? `<option value="legacyDeclared" selected>舊資料聲明（待核）</option>` : ""}
          </select></label>
          <label><span>當沖股數</span><input name="matchedShares" data-trade-matched-shares type="number" step="1" min="1" inputmode="numeric" value="${Number(editingDayTrade.matchedShares) > 0 ? Number(editingDayTrade.matchedShares) : ""}" placeholder="實際配對股數" aria-label="已確認的當沖配對股數" disabled /></label>
          <label><span>交易時段</span><select name="session" data-trade-session aria-label="交易時段">
            <option value="regular"${selectedTradeOption(formSession, "regular")}>一般交易</option>
            <option value="afterHoursFixed"${selectedTradeOption(formSession, "afterHoursFixed")}>盤後定價</option>
            <option value="oddLot"${selectedTradeOption(formSession, "oddLot")}>零股</option>
            <option value="block"${selectedTradeOption(formSession, "block")}>鉅額</option>
            <option value="unknown"${selectedTradeOption(formSession, "unknown")}>不確定</option>
          </select></label>
          <label><span>成交時間</span><input name="executedTime" data-trade-executed-time type="time" step="1" value="${escapeHtml(tradeExecutedTimeOf(editingRecord))}" aria-label="成交時間（選填）" /></label>
          <label><span>實際手續費</span><input name="feeAmountTwd" data-trade-fee-input type="number" step="1" min="0" inputmode="numeric" value="${escapeHtml(formFeeActual)}" placeholder="留白＝估算" aria-label="券商實際手續費（選填）" /></label>
          <label><span>實際證交稅</span><input name="taxAmountTwd" data-trade-tax-input type="number" step="1" min="0" inputmode="numeric" value="${escapeHtml(formTaxActual)}" placeholder="留白＝估算" aria-label="券商實際證交稅（只適用賣出）" disabled /></label>
        </div>
        <p>只有券商對帳單可確認當沖資格與實際費稅；部分當沖請填真正配對的股數。</p>
      </details>
    </form>
    <p class="hold-hint">費稅留白時，依成交日、商品與目前的預設券商方案估算：0.1425% × <label class="hold-discount">折數 <input data-trade-discount type="number" step="0.05" min="0.1" max="1" value="${settings.feeDiscount}" aria-label="預設手續費折數" ${tradesState.mutating ? "disabled" : ""} /></label>、每筆最低 ${settings.minFee} 元。這只是估算方案，不是所有券商的法定費率；填入對帳單金額後以實際值為準。成本採加權平均法，未實現損益尚未預扣未來賣出成本。</p>
    <div class="trade-list">
      <div class="trade-list-head"><strong>交易紀錄</strong><small>${tradesState.records.length} 筆${tradesState.records.length > tradesHistoryLimit ? `（目前顯示最近 ${tradesHistoryLimit} 筆）` : ""}・賣出列的損益為該筆已實現</small>${tradesState.records.length > tradesHistoryLimit ? `<button type="button" data-trade-load-more>再顯示 ${Math.min(40, tradesState.records.length - tradesHistoryLimit)} 筆</button>` : ""}</div>
      ${recordRows || `<p class="hold-hint">還沒有任何紀錄。</p>`}
    </div>
  `;
  syncTradeFormControls(panel.querySelector("[data-trade-form]"));
}

function getSelectedStock() {
  return stocks.find((stock) => stock.code === state.selectedCode) || stocks[0];
}

// 個股詳情在桌機是常駐 aside；1040px 以下則是 modal sheet（須與 styles.css 桌機三欄斷點一致）。
// 行動版關閉時不能只用 transform 移出畫面，否則裡面的按鈕仍會出現在 Tab 順序。
const detailDesktopMedia = window.matchMedia("(min-width: 1040px)");

function isDesktopDetailLayout() {
  return detailDesktopMedia.matches;
}

function detailIsDialogLayer() {
  return dialogStack.some((entry) => entry.root === el.detailPanel);
}

function resolveDetailPanelOpener(trigger) {
  if (!(trigger instanceof HTMLElement)) return el.searchOpen;
  if (trigger.isConnected) return trigger;
  // 開明細前會重繪目前清單，原本被點的卡片因此可能已離開 DOM。
  // 依它的穩定 data 契約找回新節點，Escape 才能回到使用者剛才的位置。
  if (trigger.matches(".search-result")) return el.searchOpen;
  const code = normalizeStockCodeInput(
    trigger.dataset.noteOpen
      || trigger.dataset.overnightCode
      || trigger.dataset.swingCode
      || trigger.dataset.code
  );
  if (!code) return el.searchOpen;
  let selector = "";
  if (trigger.matches("[data-note-open]")) selector = `[data-note-open="${code}"]`;
  else if (trigger.matches(".today-focus-card")) selector = `.today-focus-card[data-overnight-code="${code}"]`;
  else if (trigger.matches(".verify-chip")) selector = `.verify-chip[data-overnight-code="${code}"]`;
  else if (trigger.matches("[data-overnight-code]")) selector = `[data-overnight-code="${code}"]`;
  else if (trigger.matches(".inspect-open")) selector = `.inspect-open[data-swing-code="${code}"]`;
  else if (trigger.matches("[data-swing-code]")) selector = `[data-swing-code="${code}"]`;
  else if (trigger.matches(".surv-card")) selector = `.surv-card[data-code="${code}"]`;
  else if (trigger.matches(".watch-stock-row")) selector = `.watch-row-select[data-code="${code}"]`;
  else if (trigger.matches(".stock-row")) selector = `.stock-row[data-code="${code}"]`;
  const activeScreen = document.querySelector(`[data-screen-panel="${state.screen}"]`);
  const replacement = selector
    ? (activeScreen?.querySelector(selector) || document.querySelector(selector))
    : null;
  return replacement instanceof HTMLElement ? replacement : el.searchOpen;
}

function setClosedMobileDetailAccessibility() {
  el.detailPanel.setAttribute("role", "dialog");
  el.detailPanel.setAttribute("aria-modal", "true");
  el.detailPanel.setAttribute("aria-hidden", "true");
  el.detailPanel.setAttribute("inert", "");
}

function syncDetailPanelLayout() {
  if (isDesktopDetailLayout()) {
    if (detailIsDialogLayer()) {
      closeDialogLayer(el.detailPanel, { restoreFocus: false, hide: false });
    }
    el.detailPanel.removeAttribute("role");
    el.detailPanel.removeAttribute("aria-modal");
    el.detailPanel.removeAttribute("aria-hidden");
    el.detailPanel.removeAttribute("inert");
    return;
  }

  el.detailPanel.setAttribute("role", "dialog");
  el.detailPanel.setAttribute("aria-modal", "true");
  if (!el.detailPanel.classList.contains("is-open")) {
    setClosedMobileDetailAccessibility();
    return;
  }

  el.detailPanel.removeAttribute("aria-hidden");
  el.detailPanel.removeAttribute("inert");
  if (!detailIsDialogLayer()) {
    openDialogLayer(el.detailPanel, { initialFocus: "#detailClose" });
  }
}

// 個股詳情面板開關走瀏覽器歷史：手機返回鍵會先關面板，而不是直接離開網站。
function openDetailPanel(trigger = document.activeElement) {
  if (el.detailPanel.classList.contains("is-open")) return;
  el.detailPanel.classList.add("is-open");
  if (!isDesktopDetailLayout()) {
    el.detailPanel.removeAttribute("aria-hidden");
    el.detailPanel.removeAttribute("inert");
    openDialogLayer(el.detailPanel, {
      trigger: resolveDetailPanelOpener(trigger),
      initialFocus: "#detailClose",
      openerResolver: () => resolveDetailPanelOpener(trigger),
    });
  }
  try {
    history.pushState({ view: "detail" }, "");
  } catch {
    // 歷史 API 不可用時面板仍正常開關。
  }
}

function closeDetailPanel({ viaHistory = false } = {}) {
  if (!el.detailPanel.classList.contains("is-open")) return;
  if (!viaHistory && history.state?.view === "detail") {
    history.back();
    return;
  }
  el.detailPanel.classList.remove("is-open");
  if (!isDesktopDetailLayout()) {
    if (detailIsDialogLayer()) {
      closeDialogLayer(el.detailPanel, { hide: false });
    }
    setClosedMobileDetailAccessibility();
  }
}

if (detailDesktopMedia.addEventListener) detailDesktopMedia.addEventListener("change", syncDetailPanelLayout);
else detailDesktopMedia.addListener?.(syncDetailPanelLayout);
syncDetailPanelLayout();

function isInAnyWatchList(code) {
  return Object.values(watchLists).some((list) => list.has(code));
}

function restoreDataSource() {
  try {
    const stored = window.localStorage.getItem(DATA_SOURCE_STORAGE_KEY);
    return stored === "broker" ? "broker" : "official";
  } catch (error) {
    console.warn("Failed to restore data source", error);
    return "official";
  }
}

function saveDataSource() {
  try {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, sourceState.selected);
  } catch (error) {
    console.warn("Failed to save data source", error);
  }
}

function restoreWatchLists() {
  try {
    const raw = window.localStorage.getItem(WATCH_LIST_STORAGE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    Object.entries(payload).forEach(([key, codes]) => {
      if (watchLists[key] && Array.isArray(codes)) {
        watchLists[key] = new Set(codes.map(normalizeStockCodeInput).filter(Boolean));
      }
    });
  } catch (error) {
    console.warn("Failed to restore watch lists", error);
  }
}

function saveWatchLists({ sync = true } = {}) {
  try {
    window.localStorage.setItem(WATCH_LIST_STORAGE_KEY, JSON.stringify(watchListsPayload()));
  } catch (error) {
    console.warn("Failed to save watch lists", error);
  }
  if (sync) {
    watchListMutationVersion += 1;
    scheduleWatchListSync();
  }
}

function addCodeToWatchList(code, listKey = state.watchList) {
  const clean = normalizeStockCodeInput(code);
  const key = String(listKey || "1");
  const list = watchLists[key] || watchLists[1];
  if (!clean || !list) return false;
  if (list.has(clean)) {
    showToast(`${clean} 已在自選股清單 ${key}`);
    return false;
  }
  if (list.size >= MAX_WATCHLIST_CODES_PER_LIST) {
    showToast(`每份自選股最多 ${MAX_WATCHLIST_CODES_PER_LIST} 檔，請先移除一檔`);
    return false;
  }
  list.add(clean);
  saveWatchLists();
  return true;
}

function getActiveWatchStocks(listKey = state.watchList) {
  const activeList = watchLists[listKey] || watchLists[1];
  return stocks.filter((stock) => activeList.has(stock.code));
}

function getTrackedQuoteCodes() {
  const codes = new Set(stocks.map((stock) => normalizeStockCodeInput(stock.code)).filter(Boolean));
  Object.values(watchLists).forEach((list) => {
    list.forEach((code) => {
      const clean = normalizeStockCodeInput(code);
      if (clean) codes.add(clean);
    });
  });
  [state.selectedCode, state.technicalCode].forEach((code) => {
    const clean = normalizeStockCodeInput(code);
    if (clean) codes.add(clean);
  });
  // 有效的到價提醒也要抓報價：即使該檔已不在任何清單，仍要能觸發。
  priceAlertsState.alerts.forEach((alert) => {
    if (!alert.active) return;
    const clean = normalizeStockCodeInput(alert.code);
    if (clean) codes.add(clean);
  });
  // 庫存的持股也要抓報價：未實現損益要跟即時價配對。
  (tradesState.portfolio?.holdings || []).forEach((holding) => {
    const clean = normalizeStockCodeInput(holding.code);
    if (clean) codes.add(clean);
  });
  // 除息日賣光仍保有股利權利；當日有交易的代號也保留報價，才能顯示官方除息事件。
  const todayCompact = compactTradeDate(getTaiwanClockParts().isoDate);
  tradesState.records.forEach((record) => {
    if (tradeDateOf(record) !== todayCompact || !["buy", "sell"].includes(record.side)) return;
    const clean = normalizeStockCodeInput(record.code);
    if (clean) codes.add(clean);
  });
  return [...codes];
}

function stockMatchesWatchFilter(stock, filter = state.watchFilter) {
  if (filter === "up") return stock.change > 0;
  if (filter === "down") return stock.change < 0;
  if (filter === "active") {
    return Math.abs(stock.change) >= 5 || stock.avgVol >= 3 || stock.turnover >= 5;
  }
  return true;
}

function getWatchFilterLabel(filter = state.watchFilter) {
  const labels = {
    all: "全部",
    up: "上漲",
    down: "下跌",
    active: "強波動",
  };
  return labels[filter] || labels.all;
}

function getWatchStats() {
  const activeStocks = getActiveWatchStocks();
  const visibleStocks = activeStocks.filter((stock) => stockMatchesWatchFilter(stock));
  const upCount = activeStocks.filter((stock) => stock.change > 0).length;
  const downCount = activeStocks.filter((stock) => stock.change < 0).length;
  const activeCount = activeStocks.filter((stock) => stockMatchesWatchFilter(stock, "active")).length;
  const avgChange = activeStocks.length
    ? activeStocks.reduce((sum, stock) => sum + stock.change, 0) / activeStocks.length
    : 0;
  const strongest = activeStocks.reduce((best, stock) => {
    if (!best || stock.change > best.change) return stock;
    return best;
  }, null);
  return { activeStocks, visibleStocks, upCount, downCount, activeCount, avgChange, strongest };
}

function getSelectedSource() {
  return sourceState.selected === "broker" ? "broker" : "official";
}

function getSelectedSourceLabel() {
  return getSelectedSource() === "broker" ? "券商資料" : "官方資料";
}

function getSourceQuery() {
  return `source=${encodeURIComponent(getSelectedSource())}`;
}

function isBrokerSourceReady() {
  const broker = sourceState.sources?.broker;
  return Boolean(broker?.configured && broker.available !== false);
}

function switchToOfficialFallback(message = "券商 API 未設定", { notify = false, refresh = false } = {}) {
  sourceState.selected = "official";
  saveDataSource();
  dataState.mode = "official";
  dataState.error = "";
  marketState.error = "";
  render();
  if (notify) showToast(`${message}，已改用官方資料`);
  if (refresh) {
    loadMarketSummary();
    loadMarketData();
  }
}

function isTaiwanMarketSession(date = new Date()) {
  const clock = getTaiwanClockParts(date);
  const stockSession = marketSessionState.stock;
  const calendarApplies = stockSession?.date === clock.isoDate && typeof stockSession.tradingDay === "boolean";
  if (calendarApplies && !stockSession.tradingDay) return false;
  if (!calendarApplies && (clock.weekday === 0 || clock.weekday === 6)) return false;
  return clock.minutes >= 9 * 60 && clock.minutes <= 13 * 60 + 35;
}

async function ensureMarketSessionStatus({ force = false } = {}) {
  const today = getTaiwanClockParts().isoDate;
  const current = marketSessionState.stock;
  const sameDate = current?.date === today;
  const knownToday = sameDate && typeof current.tradingDay === "boolean";
  if (!force && knownToday) return current;
  if (!force && sameDate && marketSessionState.retryAt > Date.now()) return current;
  if (marketSessionState.loadingPromise) return marketSessionState.loadingPromise;
  marketSessionState.loadingPromise = fetchApi("/api/market-session")
    .then((payload) => {
      marketSessionState.stock = payload?.stock || null;
      marketSessionState.warnings = payload?.warnings || [];
      const known = typeof payload?.stock?.tradingDay === "boolean";
      marketSessionState.retryAt = Date.now() + (known ? 6 * 60 * 60e3 : 60e3);
      renderDataStatus();
      renderMarketPill();
      return marketSessionState.stock;
    })
    .catch(() => {
      marketSessionState.retryAt = Date.now() + 60e3;
      return marketSessionState.stock;
    })
    .finally(() => {
      marketSessionState.loadingPromise = null;
    });
  return marketSessionState.loadingPromise;
}

function isTaiwanFuturesNightSession(date = new Date()) {
  const clock = getTaiwanClockParts(date);
  // 期貨夜盤 15:00 到次日 05:00；凌晨時段屬於前一個交易日的夜盤。
  if (clock.minutes >= 15 * 60) return clock.weekday >= 1 && clock.weekday <= 5;
  if (clock.minutes <= 5 * 60) return clock.weekday >= 2 && clock.weekday <= 6;
  return false;
}

function clearWatchSelection() {
  state.watchSelection.clear();
}

function selectVisibleWatchStocks() {
  filterStocks("watchlist").forEach((stock) => state.watchSelection.add(stock.code));
}

function toggleWatchSelection(code) {
  if (state.watchSelection.has(code)) {
    state.watchSelection.delete(code);
  } else {
    state.watchSelection.add(code);
  }
}

function removeSelectedWatchStocks() {
  const list = watchLists[state.watchList] || watchLists[1];
  const selectedCodes = [...state.watchSelection].filter((code) => list.has(code));
  if (!selectedCodes.length) return 0;
  selectedCodes.forEach((code) => list.delete(code));
  saveWatchLists();
  clearWatchSelection();
  if (selectedCodes.includes(state.selectedCode)) {
    const nextStock = stocks.find((item) => list.has(item.code));
    if (nextStock) {
      state.selectedCode = nextStock.code;
    }
  }
  return selectedCodes.length;
}

function mergeOfficialQuote(stock, quote) {
  if (!stock || !quote) return;
  const latestPrice = positivePriceOrNull(quote.price);
  if (latestPrice !== null) {
    stock.price = latestPrice;
    const lastSpark = stock.spark[stock.spark.length - 1];
    if (lastSpark !== latestPrice) {
      stock.spark = [...stock.spark.slice(-13), latestPrice];
    }
  }
  if (quote.name) stock.name = quote.name;
  const changePct = finiteNumberOrNull(quote.changePct);
  if (changePct !== null) {
    stock.change = changePct;
    stock.changeText = formatSignedPercent(stock.change);
    stock.signal = signalFromChange(stock.change);
  }
  const unitLots = finiteNumberOrNull(quote.unitLots);
  if (unitLots !== null) {
    stock.unit = unitLots;
  }
  const volumeLots = finiteNumberOrNull(quote.volumeLots);
  if (volumeLots !== null) {
    stock.total = volumeLots;
  }
  const turnoverPct = finiteNumberOrNull(quote.turnoverPct);
  if (turnoverPct !== null) {
    stock.turnover = turnoverPct;
  }
  stock.official = true;
  stock.source = quote.source;
  stock.sourceKind = quote.sourceKind;
  stock.exchange = quote.exchange;
  stock.asOf = quote.asOf;
  stock.open = quote.open;
  stock.high = quote.high;
  stock.low = quote.low;
  stock.previousClose = quote.previousClose;
  stock.priceChange = quote.change;
  stock.priceStale = quote.priceStale === true; // 即時無成交價、價格退回收盤時為 true
  stock.dividend = quote.dividend || null; // 除息旗標 {exDate, kind, cash, isToday, daysUntil}（冷啟動首輪可能為 null）
}

function isQuoteBackedStock(stock) {
  return ["realtime", "daily-close", "broker-realtime"].includes(stock?.sourceKind);
}

async function syncOfficialQuotesForCodes(codes) {
  const cleanCodes = [...new Set((codes || []).map((code) => normalizeStockCodeInput(code)).filter(Boolean))];
  if (!cleanCodes.length) return [];
  const payload = await fetchApi(`/api/quotes?codes=${encodeURIComponent(cleanCodes.join(","))}&source=official`);
  const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
  quotes.forEach(upsertStockFromQuote);
  return quotes;
}

function findOvernightPick(code) {
  const clean = normalizeStockCodeInput(code);
  return Object.values(overnightState.groups || {})
    .flat()
    .find((pick) => pick.code === clean);
}

async function ensureStockForDetailCode(code) {
  const clean = normalizeStockCodeInput(code);
  if (!clean) return null;
  let stock = stocks.find((item) => item.code === clean);
  if (!isQuoteBackedStock(stock)) {
    try {
      await syncOfficialQuotesForCodes([clean]);
      stock = stocks.find((item) => item.code === clean);
    } catch {
      // Fall back to any already loaded local signal data below.
    }
  }
  if (!stock) {
    const pick = findOvernightPick(clean);
    if (pick) stock = upsertStockFromPick(pick);
  }
  // 盤後沒有自動刷新：新加入的股票補抓一次法人與融資券（伺服器端有快取，成本很低）。
  if (stock && !stock.institutional) loadInstitutionalData();
  if (stock && !stock.margin) loadMarginData();
  return stock || null;
}

function mergeInstitutionalRecord(record) {
  if (!record?.code) return;
  const stock = stocks.find((item) => item.code === record.code);
  if (stock) {
    stock.institutional = record;
  }
}

function upsertStockFromQuote(quote) {
  if (!quote?.code) return null;
  let stock = stocks.find((item) => item.code === quote.code);
  if (!stock) {
    const price = positivePriceOrNull(quote.price);
    const previousClose = positivePriceOrNull(quote.previousClose);
    const open = positivePriceOrNull(quote.open);
    const changePct = finiteNumberOrNull(quote.changePct);
    const unitLots = finiteNumberOrNull(quote.unitLots);
    const volumeLots = finiteNumberOrNull(quote.volumeLots);
    const turnoverPct = finiteNumberOrNull(quote.turnoverPct);
    // 只用時間順序確定的三個點（昨收→開盤→現價）當走勢圖起點；
    // 把最高/最低塞進序列會畫出沒發生過的價格路徑。
    const seedSpark = [previousClose, open, price].filter((value) => value !== null);
    stock = {
      code: quote.code,
      name: quote.name || quote.code,
      price,
      change: changePct,
      changeText: formatSignedPercent(changePct),
      unit: unitLots,
      total: volumeLots,
      signal: signalFromChange(changePct),
      stage: 0,
      slope: 0,
      streak: finiteNumberOrNull(quote.transactions) ?? unitLots ?? 0,
      flow: volumeLots ?? 0,
      turnover: turnoverPct,
      avgVol: 0,
      groups: ["watch"],
      strategies: ["官方查詢"],
      spark: seedSpark.length >= 2 ? seedSpark : price !== null ? [price, price] : [],
    };
    stocks.push(stock);
  }
  if (!stock.strategies.includes("官方查詢")) {
    stock.strategies = [...stock.strategies, "官方查詢"];
  }
  mergeOfficialQuote(stock, quote);
  return stock;
}

function renderSourceSwitch() {
  const wrapper = document.querySelector(".source-switch");
  const meta = document.getElementById("sourceMeta");
  const selected = getSelectedSource();
  document.querySelectorAll("[data-source-option]").forEach((button) => {
    const isActive = button.dataset.sourceOption === selected;
    const sourceInfo = sourceState.sources?.[button.dataset.sourceOption];
    const isUnavailableBroker = button.dataset.sourceOption === "broker" && sourceInfo?.configured === false;
    button.classList.toggle("is-active", isActive);
    button.classList.toggle("is-disabled", isUnavailableBroker);
    button.setAttribute("aria-pressed", String(isActive));
    button.title = sourceInfo?.message || sourceInfo?.description || button.textContent.trim();
  });
  if (!meta || !wrapper) return;
  wrapper.classList.toggle("is-error", Boolean(dataState.error || sourceState.error) && selected === "broker");
  if (selected === "broker") {
    const broker = sourceState.sources?.broker;
    meta.textContent = broker?.configured ? `券商 / 更新 ${dataState.lastUpdated || "尚未更新"}` : "券商 API 未設定";
    return;
  }
  if (dataState.lastUpdated) {
    const realtimeText = dataState.realtimeCount ? `即時 ${dataState.realtimeCount}` : "即時 0";
    const fallbackText = dataState.fallbackCount ? ` / 備援 ${dataState.fallbackCount}` : "";
    meta.textContent = `官方 / ${realtimeText}${fallbackText} / ${dataState.lastUpdated}`;
  } else {
    meta.textContent = "官方 / 等待更新";
  }
}

function renderDataStatus() {
  const refreshStatus = document.getElementById("refreshStatus");
  const sourceStateEl = document.getElementById("sourceState");
  if (refreshStatus) {
    if (getSelectedSource() === "official" && dataState.mode === "official") {
      const today = getTaiwanClockParts().isoDate;
      const closedToday = marketSessionState.stock?.date === today && marketSessionState.stock?.tradingDay === false;
      const closedLabel = closedToday
        ? `今日休市${marketSessionState.stock.holidayName ? `（${marketSessionState.stock.holidayName}）` : ""}`
        : "";
      const fallbackText = dataState.fallbackCount ? `（${dataState.fallbackCount} 檔為收盤價）` : "";
      refreshStatus.textContent = closedToday
        ? `${closedLabel} ・ 最近行情 ${dataState.lastUpdated || "載入中"}`
        : dataState.lastUpdated
          ? `官方行情 ・ 即時 ${dataState.realtimeCount || 0} 檔${fallbackText} ・ ${dataState.lastUpdated} 更新`
          : "官方行情 ・ 載入中…";
      refreshStatus.title = closedToday
        ? `${closedLabel}；個股不做 10 秒輪詢，畫面顯示最近交易日行情。期貨夜盤另依期交所行情判定。`
        : `來源：${dataState.source || "官方資料"}。盤中每 10 秒自動更新；策略與選股欄位為本機推估，價格以官方行情為準。`;
    } else if (getSelectedSource() === "broker") {
      refreshStatus.textContent = `券商行情 ・ ${dataState.error || (dataState.lastUpdated ? `${dataState.lastUpdated} 更新` : "等待更新")}`;
      refreshStatus.title = "個股報價來自富邦行情；指數與歷史資料仍使用官方來源。";
    } else if (dataState.error) {
      refreshStatus.textContent = `官方行情更新失敗 ・ ${dataState.error}`;
      refreshStatus.title = "請按「重新整理」再試；連續失敗時請確認網路。";
    } else {
      refreshStatus.textContent = "官方行情 ・ 等待更新";
      refreshStatus.title = "";
    }
  }
  if (sourceStateEl) {
    sourceStateEl.textContent = getSelectedSourceLabel();
  }
  renderSourceSwitch();
}

function formatMarketMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  if (!signedDirection(number)) return "0";
  const rounded = Math.abs(number) >= 100 ? number.toFixed(0) : number.toFixed(2).replace(/\.?0+$/, "");
  return `${number > 0 ? "+" : ""}${rounded}`;
}

function renderMarketPill() {
  const button = document.getElementById("marketPill");
  const label = document.getElementById("marketLabel");
  const value = button?.querySelector("strong");
  if (!button || !label || !value) return;

  const market = marketState.markets[marketState.selected];
  button.classList.remove("is-up", "is-down", "is-flat", "is-stale");
  if (!market) {
    label.textContent = marketState.selected === "tx" ? "台指" : "加權";
    value.textContent = "N/A";
    button.classList.add("is-stale");
    button.title = marketState.error || "官方市場資料尚未載入";
    return;
  }

  const isNonRealtimeMarket = market.realtime === false || market.sourceKind === "daily-futures";
  if (market.stale || isNonRealtimeMarket) {
    const staleLabel = market.key === "tx" ? "台指期" : market.label || "市場";
    const staleReason =
      market.staleReason ||
      `${market.freshnessLabel || market.source || "目前資料"}不是盤中即時行情`;
    const staleDateLabel = compactDateLabel(market.asOf);
    label.textContent = staleLabel;
    value.textContent = staleDateLabel && staleDateLabel !== "--" ? `${staleDateLabel}資料` : "非即時";
    button.classList.add("is-stale");
    button.title = `${staleLabel}目前不是即時行情：${staleReason}。點一下可切換加權/台指。`;
    button.setAttribute("aria-label", `${staleLabel}目前不是即時行情，畫面顯示的是${value.textContent}`);
    return;
  }

  const change = Number(market.change);
  const direction = signedDirection(change);
  const arrow = direction > 0 ? "▲" : direction < 0 ? "▼" : "▬";
  label.textContent = market.label || (market.key === "taiex" ? "加權" : "台指");
  value.textContent = `${arrow} ${formatMarketMove(change)}`;
  button.classList.add(direction > 0 ? "is-up" : direction < 0 ? "is-down" : "is-flat");
  const pct = Number.isFinite(Number(market.changePct)) ? `${Number(market.changePct).toFixed(2)}%` : "N/A";
  const baselineNote = market.session === "夜盤" ? "／夜盤漲跌以最近日盤結算價為基準（與加權的昨收基準不同）" : "";
  button.title = `${market.name || label.textContent} ${formatNumber(market.price || 0)} / ${formatMarketMove(change)} (${pct}) / ${market.source || ""} / ${market.asOf || ""}${baselineNote}`;
  button.setAttribute("aria-label", `${label.textContent} ${formatMarketMove(change)} ${pct}`);
}

let marketSummaryRequestSeq = 0;

async function loadMarketSummary({ notify = false, renderNow = true } = {}) {
  void ensureMarketSessionStatus();
  const requestId = ++marketSummaryRequestSeq;
  const source = getSelectedSource();
  try {
    const payload = await fetchApi(`/api/markets?${getSourceQuery()}`);
    if (requestId !== marketSummaryRequestSeq || source !== getSelectedSource()) return;
    if (!payload.ok || !payload.markets) throw new Error(payload.error || "市場資料更新失敗");
    marketState.markets = payload.markets || {};
    marketState.source = payload.source || "";
    marketState.lastUpdated = formatLocalTime(payload.generatedAt);
    marketState.error = "";
    marketState.warnings = payload.warnings || [];
    if (renderNow) render();
    if (notify) showToast("市場指數已更新");
    return true;
  } catch (error) {
    if (requestId !== marketSummaryRequestSeq || source !== getSelectedSource()) return false;
    if (handleAuthRequired(error)) return false;
    if (source === "broker") {
      switchToOfficialFallback(error.message || "券商行情失敗", { notify: true, refresh: true });
      return false;
    }
    marketState.markets = source === "broker" ? {} : marketState.markets;
    marketState.source = getSelectedSourceLabel();
    marketState.error = error.message;
    if (renderNow) render();
    if (notify) showToast("市場指數更新失敗");
    return true;
  }
}

let sourceStatusRequestSeq = 0;
async function loadSourceStatus() {
  const requestId = ++sourceStatusRequestSeq;
  const scope = authState.user ? captureAuthScope() : null;
  sourceState.loading = true;
  try {
    const payload = await fetchApi("/api/sources");
    if (requestId !== sourceStatusRequestSeq || (scope && !isCurrentAuthScope(scope))) return;
    sourceState.sources = payload.sources || {};
    sourceState.error = "";
  } catch (error) {
    if (requestId !== sourceStatusRequestSeq || (scope && !isCurrentAuthScope(scope))) return;
    if (handleAuthRequired(error)) return;
    sourceState.error = error.message;
  } finally {
    if (requestId !== sourceStatusRequestSeq || (scope && !isCurrentAuthScope(scope))) return;
    sourceState.loading = false;
    if (getSelectedSource() === "broker" && !isBrokerSourceReady()) {
      switchToOfficialFallback(sourceState.sources?.broker?.message || "券商 API 未設定");
      return;
    }
    renderSourceSwitch();
  }
}

async function loadBrokerSettings() {
  if (!authState.user) return;
  const scope = captureAuthScope();
  brokerSettingsState.loading = true;
  try {
    const payload = await fetchApi("/api/broker/settings");
    if (!isCurrentAuthScope(scope)) return;
    brokerSettingsState.status = payload;
    brokerSettingsState.loaded = true;
    brokerSettingsState.error = "";
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) brokerSettingsState.error = error.message;
  } finally {
    if (!isCurrentAuthScope(scope)) return;
    brokerSettingsState.loading = false;
    renderMorePanel();
  }
}

async function saveBrokerSettingsFromForm(form) {
  if (!authState.user) return;
  const scope = captureAuthScope();
  brokerSettingsState.saving = true;
  brokerSettingsState.error = "";
  brokerSettingsState.testMessage = "";
  renderMorePanel();
  const formData = new FormData(form);
  try {
    const payload = await fetchApi("/api/broker/settings", {
      method: "POST",
      body: JSON.stringify({
        provider: "fubon",
        personalId: formData.get("personalId"),
        password: formData.get("password"),
        certPath: formData.get("certPath"),
        certPassword: formData.get("certPassword"),
      }),
    });
    if (!isCurrentAuthScope(scope)) return;
    brokerSettingsState.status = payload;
    brokerSettingsState.loaded = true;
    await loadSourceStatus();
    if (!isCurrentAuthScope(scope)) return;
    showToast("富邦 API 設定已儲存");
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) brokerSettingsState.error = error.message;
  } finally {
    if (!isCurrentAuthScope(scope)) return;
    brokerSettingsState.saving = false;
    renderMorePanel();
  }
}

async function deleteBrokerSettings() {
  if (!authState.user) return;
  const scope = captureAuthScope();
  brokerSettingsState.saving = true;
  brokerSettingsState.error = "";
  brokerSettingsState.testMessage = "";
  renderMorePanel();
  try {
    const payload = await fetchApi("/api/broker/settings", { method: "DELETE" });
    if (!isCurrentAuthScope(scope)) return;
    brokerSettingsState.status = payload;
    sourceState.selected = "official";
    saveDataSource();
    await loadSourceStatus();
    if (!isCurrentAuthScope(scope)) return;
    showToast("已清除券商 API 設定，切回官方資料");
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) brokerSettingsState.error = error.message;
  } finally {
    if (!isCurrentAuthScope(scope)) return;
    brokerSettingsState.saving = false;
    renderMorePanel();
  }
}

async function testBrokerSettings() {
  if (!authState.user) return;
  const scope = captureAuthScope();
  brokerSettingsState.testing = true;
  brokerSettingsState.error = "";
  brokerSettingsState.testMessage = "測試中...";
  renderMorePanel();
  try {
    const payload = await fetchApi("/api/broker/test", {
      method: "POST",
      body: JSON.stringify({ code: state.selectedCode || "2330" }),
    });
    if (!isCurrentAuthScope(scope)) return;
    brokerSettingsState.testMessage = payload.ok
      ? `測試成功：${payload.quotes?.[0]?.name || state.selectedCode} ${formatNumber(Number(payload.quotes?.[0]?.price || 0))}`
      : payload.message || payload.error || "測試失敗";
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) {
      brokerSettingsState.testMessage = "";
      brokerSettingsState.error = error.message;
    }
  } finally {
    if (!isCurrentAuthScope(scope)) return;
    brokerSettingsState.testing = false;
    renderMorePanel();
  }
}

function renderBrokerSettingsPanel() {
  const status = brokerSettingsState.status || {};
  const isConfigured = Boolean(status.configured);
  const currentUser = authState.user;
  const statusText = brokerSettingsState.loading
    ? "讀取中"
    : isConfigured
      ? "已設定"
      : "未設定";
  const maskedUser = status.username || "尚未設定";
  const updatedAt = status.updatedAt ? formatLocalTime(status.updatedAt) : "尚未儲存";
  const certStatus = !status.certPathSet
    ? "未設定"
    : status.certPathExists
      ? "路徑存在 ✓"
      : "找不到檔案 ✗（請確認路徑）";
  return `
    <header>
      <span class="more-kicker">選用的進階資料來源</span>
      <h2>富邦 API 設定與申請教學</h2>
    </header>
    <p>不申請也完全能用：App 預設的官方資料已涵蓋所有功能。申請富邦行情 API 後，「個股報價」會改走富邦、延遲更低；只讀行情，<strong>不會下單、不碰庫存帳務</strong>。每個帳號各自設定自己的富邦資料。</p>
    <dl>
      <div><dt>目前帳號</dt><dd>${escapeHtml(currentUser?.displayName || currentUser?.username || "未登入")}</dd></div>
      <div><dt>券商狀態</dt><dd>${escapeHtml(statusText)}</dd></div>
      <div><dt>更新時間</dt><dd>${escapeHtml(updatedAt)}</dd></div>
      <div><dt>遮罩帳號</dt><dd>${escapeHtml(maskedUser)}</dd></div>
      <div><dt>資料來源</dt><dd>${escapeHtml(getSelectedSourceLabel())}</dd></div>
      <div><dt>憑證檔</dt><dd>${escapeHtml(certStatus)}</dd></div>
    </dl>

    <h3 class="broker-guide-title">一、去哪裡申請、怎麼申請</h3>
    <ol class="api-step-list">
      <li><strong>1. 要先有富邦證券帳戶</strong><span>還沒有的話先到富邦證券完成開戶（可線上開戶）。API 綁的是你的證券帳戶本人。</span></li>
      <li><strong>2. 到官網申請「新一代 API」服務</strong><span>登入富邦證券官網 → 交易 API 專區，線上簽署 API 服務申請。我們只看行情，<strong>不需要開通下單權限</strong>。</span></li>
      <li><strong>3. 申請電子憑證</strong><span>依官網指示用憑證工具申請「電子憑證」，過程會請你自訂一組<strong>憑證密碼</strong>，完成後會在電腦上產生一個<strong>憑證檔（.pfx）</strong>——記住存放位置和密碼，等下都要用。</span></li>
      <li><strong>4. 確認行情權限已生效</strong><span>申請完成後通常當天～隔個工作天生效。有問題直接看官方文件或打富邦客服。</span></li>
    </ol>
    <div class="api-provider-grid">
      <article>
        <strong>官方申請與文件入口</strong>
        <span>申請步驟、憑證工具下載、常見問題都在富邦官方的交易 API 專區。</span>
        <a href="https://www.fbs.com.tw/TradeAPI/docs/key/" target="_blank" rel="noreferrer">富邦 API 申請說明</a>
        <a href="https://www.fbs.com.tw/TradeAPI/docs/market-data/intro/" target="_blank" rel="noreferrer">富邦行情 API 文件</a>
      </article>
      <article>
        <strong>二、申請完成後你會有這四樣</strong>
        <span>1️⃣ 身分證字號（＝API 登入 ID）　2️⃣ 富邦的網路交易密碼　3️⃣ 憑證檔 .pfx（一個檔案）　4️⃣ 你自訂的憑證密碼。富邦不是發 API Key，就是用這四樣登入。</span>
      </article>
    </div>

    <h3 class="broker-guide-title">三、回到這個 App 怎麼串</h3>
    <ol class="api-step-list">
      <li><strong>1. 把憑證檔放到「跑網站的那台電腦」上</strong><span>API 連線是後端伺服器發出的，所以 .pfx 檔要放在跑這個網站的電腦裡（例如 <code>C:\\fubon\\我的憑證.pfx</code>），下面「憑證檔路徑」填的是那台電腦上的完整路徑，<strong>不是你手機裡的路徑</strong>。</span></li>
      <li><strong>2. 登入自己的帳號，填好下面四欄 → 儲存</strong><span>密碼與憑證密碼會在後端加密保存，不會回傳到任何人的瀏覽器。</span></li>
      <li><strong>3. 按「測試行情」</strong><span>成功會顯示一檔股票的即時報價；失敗會顯示原因（最常見：路徑打錯、憑證密碼錯、API 還沒生效）。</span></li>
      <li><strong>4. 把頂部的資料來源切到「券商資料」</strong><span>之後個股報價就走富邦。任何時候都能切回官方資料。</span></li>
    </ol>
    <form class="broker-settings-form" data-broker-settings-form autocomplete="off">
      <label>
        <span>身分證字號 / 富邦登入 ID</span>
        <input name="personalId" type="text" autocomplete="off" placeholder="${isConfigured ? "已儲存，重新輸入才會覆蓋" : "例如 A123456789"}" />
      </label>
      <label>
        <span>富邦登入密碼</span>
        <input name="password" type="password" autocomplete="new-password" placeholder="${isConfigured ? "已儲存，重新輸入才會覆蓋" : "輸入富邦登入密碼"}" />
      </label>
      <label>
        <span>憑證檔路徑</span>
        <input name="certPath" type="text" autocomplete="off" placeholder="例如 /secure-certs/fubon/user.pfx" />
      </label>
      <label>
        <span>憑證密碼</span>
        <input name="certPassword" type="password" autocomplete="new-password" placeholder="${isConfigured ? "已儲存，重新輸入才會覆蓋" : "輸入憑證密碼"}" />
      </label>
      <div class="broker-form-actions">
        <button class="more-primary" type="submit" ${brokerSettingsState.saving ? "disabled" : ""}>${brokerSettingsState.saving ? "儲存中..." : "儲存富邦設定"}</button>
        <button class="watch-secondary-action" data-action="test-broker" type="button" ${brokerSettingsState.testing || !isConfigured ? "disabled" : ""}>${brokerSettingsState.testing ? "測試中..." : "測試行情"}</button>
        <button class="watch-secondary-action" data-action="delete-broker" type="button" ${brokerSettingsState.saving || !isConfigured ? "disabled" : ""}>清除設定</button>
        <button class="watch-secondary-action" data-action="logout" type="button">登出</button>
      </div>
    </form>
    ${brokerSettingsState.error ? `<p class="api-warning">${escapeHtml(brokerSettingsState.error)}</p>` : ""}
    ${brokerSettingsState.testMessage ? `<p class="api-success">${escapeHtml(brokerSettingsState.testMessage)}</p>` : ""}

    <h3 class="broker-guide-title">四、串接成功後，會有什麼不一樣</h3>
    <dl>
      <div><dt>個股報價</dt><dd>改走富邦行情（更即時）</dd></div>
      <div><dt>市場指數</dt><dd>仍用官方（加權/台指期）</dd></div>
      <div><dt>K線/法人/融資券</dt><dd>仍用官方資料</dd></div>
      <div><dt>來源標示</dt><dd>頂部顯示「券商資料」</dd></div>
      <div><dt>富邦連線失敗時</dt><dd>自動切回官方並提示</dd></div>
      <div><dt>下單功能</dt><dd>沒有，永遠只讀行情</dd></div>
    </dl>
    <p class="api-warning">安全提醒：憑證檔代表你的證券身分，只放在自己人管理的電腦上，不要傳到聊天群或雲端硬碟；建議在富邦只開通「行情」權限。密碼與憑證密碼經 APP_SECRET 加密後存在後端，網頁不會回填顯示。</p>
  `;
}

async function loadAdminUsers() {
  if (authState.user?.role !== "admin") return;
  const scope = captureAuthScope();
  adminUsersState.loading = true;
  try {
    const payload = await fetchApi("/api/admin/users");
    if (!isCurrentAuthScope(scope)) return;
    adminUsersState.users = payload.users || [];
    adminUsersState.loaded = true;
    adminUsersState.error = "";
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) adminUsersState.error = error.message;
  } finally {
    if (!isCurrentAuthScope(scope)) return;
    adminUsersState.loading = false;
    renderMorePanel();
  }
}

async function createAdminUserFromForm(form) {
  if (authState.user?.role !== "admin") return;
  const scope = captureAuthScope();
  adminUsersState.creating = true;
  adminUsersState.error = "";
  renderMorePanel();
  const formData = new FormData(form);
  try {
    await fetchApi("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        displayName: formData.get("displayName"),
        password: formData.get("password"),
        role: formData.get("role"),
      }),
    });
    if (!isCurrentAuthScope(scope)) return;
    showToast("帳號已建立");
    await loadAdminUsers();
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) adminUsersState.error = error.message;
  } finally {
    if (!isCurrentAuthScope(scope)) return;
    adminUsersState.creating = false;
    renderMorePanel();
  }
}

async function changeOwnPasswordFromForm(form) {
  if (!authState.user) return;
  const scope = captureAuthScope();
  const formData = new FormData(form);
  try {
    await fetchApi("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: formData.get("currentPassword"),
        newPassword: formData.get("newPassword"),
      }),
    });
    if (!isCurrentAuthScope(scope)) return;
    form.reset();
    showToast("密碼已更新；你在其他裝置的登入已登出，需用新密碼重新登入");
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) showToast(`密碼更新失敗：${error.message}`);
  }
}

async function resetAdminUserPassword(userId, username) {
  if (authState.user?.role !== "admin") return;
  const next = window.prompt(`重設「${username}」的密碼（至少 8 個字）：`);
  if (next === null) return;
  const scope = captureAuthScope();
  try {
    await fetchApi("/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: userId, password: next }),
    });
    if (!isCurrentAuthScope(scope)) return;
    showToast(`已重設 ${username} 的密碼，該帳號所有裝置需重新登入`);
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) showToast(`重設失敗：${error.message}`);
  }
}

async function deleteAdminUser(userId, username) {
  if (authState.user?.role !== "admin") return;
  const sure = window.confirm(`確定刪除帳號「${username}」？\n他的自選股、到價提醒、交易紀錄會一併刪除，無法復原。`);
  if (!sure) return;
  const scope = captureAuthScope();
  try {
    const payload = await fetchApi(`/api/admin/users?id=${encodeURIComponent(userId)}`, { method: "DELETE" });
    if (!isCurrentAuthScope(scope)) return;
    adminUsersState.users = payload.users || [];
    showToast(`已刪除帳號 ${username}`);
    renderMorePanel();
  } catch (error) {
    if (!isCurrentAuthScope(scope)) return;
    if (!handleAuthRequired(error)) showToast(`刪除失敗：${error.message}`);
  }
}

const notesFeedState = {
  loaded: false,
  loading: false,
  notes: [],
  error: "",
};

async function loadNotesFeed() {
  if (notesFeedState.loading) return;
  notesFeedState.loading = true;
  try {
    const payload = await fetchApi("/api/notes/recent?limit=20");
    notesFeedState.notes = payload.notes || [];
    notesFeedState.error = "";
    notesFeedState.loaded = true;
  } catch (error) {
    if (!handleAuthRequired(error)) notesFeedState.error = error.message;
  } finally {
    notesFeedState.loading = false;
    renderMorePanel();
  }
}

function renderNotesFeedPanel() {
  const notes = notesFeedState.notes || [];
  const list = notes.length
    ? notes
        .map((note) => `
          <button class="note-feed-item" data-note-open="${escapeHtml(note.code)}" type="button">
            <div class="note-meta">
              <strong>${escapeHtml(note.userName || "")}</strong>
              <em>${escapeHtml(note.name || "")} ${escapeHtml(note.code)}</em>
              <span>${escapeHtml(formatLocalTime(note.createdAt))}</span>
            </div>
            <p>${escapeHtml(note.text)}</p>
          </button>
        `)
        .join("")
    : `<p class="notes-hint">${notesFeedState.loading ? "載入中..." : "目前還沒有任何備註。點開個股，在右側面板留下第一則吧。"}</p>`;
  return `
    <header>
      <span class="more-kicker">大家的看法</span>
      <h2>共享備註動態</h2>
    </header>
    <p>所有帳號在個股上留的備註都會列在這裡，點一則可直接打開那檔股票。${authState.user ? "" : "瀏覽不用登入；要留言才需要登入。"}</p>
    ${notesFeedState.error ? `<p class="api-warning">${escapeHtml(notesFeedState.error)}</p>` : ""}
    <div class="note-feed-list">${list}</div>
    <button class="watch-secondary-action" data-action="reload-notes-feed" type="button">重新整理</button>
  `;
}

function getOvernightSignalCount() {
  if (!overnightState.groups) return 0;
  return Object.values(overnightState.groups).reduce((total, group) => {
    return total + (Array.isArray(group) ? group.length : 0);
  }, 0);
}

function renderAccountManagementPanel() {
  const isAdmin = authState.user?.role === "admin";
  const users = adminUsersState.users || [];
  const currentName = authState.user?.displayName || authState.user?.username || "未登入";
  const secretStatus = authState.warnings?.defaultAppSecret ? "未設定" : "已設定";
  const passwordStatus = authState.warnings?.defaultAdminPassword ? "仍是預設密碼" : "已變更";

  return `
    <header>
      <span class="more-kicker">帳號管理</span>
      <h2>建立朋友帳號</h2>
    </header>
    <p>你和朋友不要共用 admin。每個帳號會分開保存自選股、資料來源、券商 API 設定；admin 只拿來管理帳號。</p>
    <dl>
      <div><dt>目前登入</dt><dd>${escapeHtml(currentName)}</dd></div>
      <div><dt>權限</dt><dd>${escapeHtml(authState.user?.role || "user")}</dd></div>
      <div><dt>APP_SECRET</dt><dd>${secretStatus}</dd></div>
      <div><dt>admin 密碼</dt><dd>${passwordStatus}</dd></div>
      <div><dt>資料保存</dt><dd>後端資料庫</dd></div>
      <div><dt>公開註冊</dt><dd>關閉</dd></div>
    </dl>
    ${authState.user ? `
      <form class="broker-settings-form self-password-form" data-password-form autocomplete="off">
        <label>
          <span>目前密碼</span>
          <input name="currentPassword" type="password" autocomplete="current-password" required />
        </label>
        <label>
          <span>新密碼</span>
          <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
        </label>
        <div class="broker-form-actions">
          <button class="more-primary" type="submit">修改我的密碼</button>
        </div>
      </form>
    ` : ""}
    ${isAdmin ? `
      <form class="broker-settings-form" data-admin-user-form autocomplete="off">
        <label>
          <span>朋友帳號</span>
          <input name="username" type="text" placeholder="friend01" required />
        </label>
        <label>
          <span>顯示名稱</span>
          <input name="displayName" type="text" placeholder="朋友名稱" />
        </label>
        <label>
          <span>初始密碼</span>
          <input name="password" type="password" autocomplete="new-password" minlength="8" required />
        </label>
        <label>
          <span>權限</span>
          <select name="role">
            <option value="user">一般使用者</option>
            <option value="admin">管理者</option>
          </select>
        </label>
        <div class="broker-form-actions">
          <button class="more-primary" type="submit" ${adminUsersState.creating ? "disabled" : ""}>${adminUsersState.creating ? "建立中..." : "建立帳號"}</button>
          <button class="watch-secondary-action" data-action="reload-users" type="button">重新整理</button>
          <button class="watch-secondary-action" data-action="logout" type="button">登出</button>
        </div>
      </form>
      <section class="user-list-panel">
        ${users.map((user) => {
          const isSelf = user.id === authState.user?.id;
          return `
          <div class="user-row">
            <div class="user-row-main">
              <strong>${escapeHtml(user.displayName || user.username)}${isSelf ? "（自己）" : ""}</strong>
              <span>${escapeHtml(user.username)} / ${escapeHtml(user.role)}</span>
            </div>
            <div class="user-row-actions">
              <button class="watch-secondary-action" data-admin-reset="${escapeHtml(user.id)}" data-admin-username="${escapeHtml(user.username)}" type="button">重設密碼</button>
              ${isSelf ? "" : `<button class="watch-secondary-action is-danger" data-admin-delete="${escapeHtml(user.id)}" data-admin-username="${escapeHtml(user.username)}" type="button">刪除</button>`}
            </div>
          </div>`;
        }).join("") || "<p>尚未載入帳號清單，請按重新整理。</p>"}
      </section>
    ` : `
      <p class="api-warning">你目前不是管理者。要建立朋友帳號，請用 admin 登入。</p>
      <button class="watch-secondary-action" data-action="logout" type="button">登出</button>
    `}
    ${adminUsersState.error ? `<p class="api-warning">${escapeHtml(adminUsersState.error)}</p>` : ""}
  `;
}

function renderPersonalBackupPanel() {
  const currentName = authState.user?.displayName || authState.user?.username || "未登入";
  if (!authState.user) {
    return `
      <header>
        <span class="more-kicker">個人資料可攜</span>
        <h2>個人資料備份</h2>
      </header>
      <p>登入後可下載只屬於目前帳號的自選股、到價提醒、交易帳本與自己留下的共享備註。</p>
      <p class="api-warning">尚未登入。請先到「帳號管理」登入，再進行備份或復原。</p>
    `;
  }
  return `
    <header>
      <span class="more-kicker">個人資料可攜</span>
      <h2>個人資料備份</h2>
    </header>
    <p>目前帳號：<strong>${escapeHtml(currentName)}</strong>。下載檔只包含這個帳號的個人資料；券商憑證、密碼、登入工作階段與其他使用者資料不會匯出。</p>
    <div class="personal-backup-panel-grid">
      <article>
        <i data-lucide="download"></i>
        <div>
          <strong>下載個人備份</strong>
          <span>把目前資料存成 UTF-8 JSON，可自行離線保管。</span>
        </div>
        <button class="more-primary" data-action="download-personal-backup" type="button">下載備份</button>
      </article>
      <article>
        <i data-lucide="rotate-ccw"></i>
        <div>
          <strong>從備份復原</strong>
          <span>先做 dry-run 預覽，確認摘要與目前密碼後才會寫入。</span>
        </div>
        <button class="watch-secondary-action" data-action="open-personal-restore" type="button" aria-haspopup="dialog" aria-controls="personalBackupModal">選檔並預覽</button>
      </article>
    </div>
    <p class="personal-backup-panel-note"><strong>復原規則：</strong>自選股、到價提醒與交易帳本會取代目前內容；你自己的共享備註只合併，不會刪除或擠掉別人的備註。公司簡介不會匯入。</p>
  `;
}

function renderMorePanel() {
  const screen = document.querySelector('[data-screen-panel="more"]');
  const panel = screen?.querySelector(".settings-panel");
  if (!screen || !panel) return;

  let summary = screen.querySelector(".more-status");
  if (!summary) {
    summary = document.createElement("section");
    summary.className = "more-status";
    screen.insertBefore(summary, panel);
  }

  let detail = screen.querySelector("#moreDetail");
  if (!detail) {
    detail = document.createElement("section");
    detail.id = "moreDetail";
    detail.className = "more-detail";
    detail.setAttribute("aria-live", "polite");
    screen.appendChild(detail);
  }

  const signalCount = getOvernightSignalCount();
  const currentSource = getSelectedSource();
  const brokerInfo = sourceState.sources?.broker;
  const officialInfo = sourceState.sources?.official;
  const sourceLabel = getSelectedSourceLabel();
  const sourceTone = currentSource === "official" && !dataState.error ? "is-good" : "is-warn";
  const sourceMeta = currentSource === "official"
    ? `${dataState.realtimeCount || 0} 檔即時 / ${dataState.fallbackCount || 0} 檔收盤備援`
    : brokerInfo?.message || dataState.error || "券商 API 未設定";
  const sourceDetail = currentSource === "official"
    ? dataState.source || officialInfo?.description || "TWSE MIS + official daily close fallback"
    : brokerInfo?.description || "券商 API 抽象介面已預留";
  const alertStatus = signalCount ? `${signalCount} 檔訊號` : "尚未產生";
  const activePanel = state.morePanel || "source";
  const items = [
    {
      key: "glossary",
      icon: "book-open",
      title: "名詞 / 觀念解釋",
      desc: "看不懂的詞都在這裡查",
      status: "說明",
    },
    {
      key: "source",
      icon: "database",
      title: "資料源狀態",
      desc: "官方與券商行情來源",
      status: sourceLabel,
    },
    {
      key: "brokerGuide",
      icon: "key-round",
      title: "富邦 API 教學與設定",
      desc: "怎麼申請、怎麼串接",
      status: brokerInfo?.configured ? "已設定" : "選用",
    },
    {
      key: "notesFeed",
      icon: "message-square",
      title: "共享備註動態",
      desc: "大家最新的個股留言",
      status: notesFeedState.loaded ? `${notesFeedState.notes.length} 則` : "可瀏覽",
    },
    {
      key: "backup",
      icon: "archive-restore",
      title: "個人資料備份",
      desc: "下載與安全復原個人資料",
      status: authState.user ? "可備份" : "需登入",
    },
    {
      key: "system",
      icon: "users",
      title: "帳號管理",
      desc: "建立朋友帳號與登出",
      status: authState.user?.role === "admin" ? "管理者" : "個人",
    },
    {
      key: "risk",
      icon: "shield-check",
      title: "風險規則",
      desc: "注意股、處置股顯示與標示",
      status: state.showSurveillance ? "顯示中" : "已隱藏",
    },
    {
      key: "alerts",
      icon: "bell",
      title: "訊號提醒",
      desc: "本機提示，不是手機推播",
      status: alertStatus,
    },
  ];

  summary.innerHTML = `
    <div>
      <span>資料來源</span>
      <strong class="${sourceTone}">${sourceLabel}</strong>
      <small>${escapeHtml(dataState.lastUpdated || "尚未更新")}</small>
    </div>
    <div>
      <span>隔日沖訊號</span>
      <strong>${signalCount || "N/A"}</strong>
      <small>${overnightState.asOf ? `${escapeHtml(overnightState.asOf)} 收盤後` : "等待官方資料"}</small>
    </div>
    <div>
      <span>注意/處置股</span>
      <strong>${overnightState.surveillanceCount || 0}</strong>
      <small>${state.showSurveillance ? "標示中（可隱藏）" : "目前隱藏"}</small>
    </div>
  `;

  panel.innerHTML = items
    .map(
      (item) => `
        <button class="${activePanel === item.key ? "is-active" : ""}" data-setting="${item.key}" type="button">
          <i data-lucide="${item.icon}"></i>
          <span>
            <strong>${item.title}</strong>
            <small>${item.desc}</small>
          </span>
          <em>${item.status}</em>
        </button>
      `
    )
    .join("");

  const details = {
    source: `
      <header>
        <span class="more-kicker">目前狀態</span>
        <h2>資料源狀態</h2>
      </header>
      <p>這裡只顯示行情來源，不代表買賣建議。若官方資料失敗，App 不應顯示可交易清單，只保留狀態與錯誤訊息。</p>
      <dl>
        <div><dt>目前來源</dt><dd>${escapeHtml(sourceLabel)}</dd></div>
        <div><dt>更新時間</dt><dd>${escapeHtml(dataState.lastUpdated || "尚未更新")}</dd></div>
        <div><dt>明細</dt><dd>${escapeHtml(sourceMeta)}</dd></div>
        <div><dt>官方</dt><dd>${escapeHtml(officialInfo?.description || "可用")}</dd></div>
        <div><dt>券商</dt><dd>${escapeHtml(brokerInfo?.message || "券商 API 未設定")}</dd></div>
      </dl>
      <p>${escapeHtml(sourceDetail)}</p>
      <button class="more-primary" data-action="refresh-data" type="button">重新抓目前來源</button>
    `,
    alerts: `
      <header>
        <span class="more-kicker">提醒中心</span>
        <h2>訊號提醒</h2>
      </header>
      <p><strong>到價提醒</strong>：在個股明細的價格下方設定「漲到／跌到某價」。頁面開著時每 10 秒對照現價，一觸價就跳畫面提示＋音效（觸發一次即停，不重複吵）。沒有背景監控與手機推播——頁面關了就收不到。</p>
      ${priceAlertsState.alerts.length
        ? `<div class="alert-manage">${priceAlertsState.alerts
            .map((alert) => {
              const stock = stocks.find((item) => item.code === alert.code);
              return `
                <div class="alert-row ${alert.triggeredAt ? "is-done" : ""}">
                  <span class="alert-cond"><b>${escapeHtml(stock?.name || alert.code)}</b> ${alert.code} ${alert.op === "<=" ? "跌到" : "漲到"} ${formatNumber(alert.price)}</span>
                  <span class="alert-state">${alert.triggeredAt ? `已觸發 ${escapeHtml(formatLocalTime(alert.triggeredAt))}` : "等待中"}</span>
                  <button class="alert-del" data-alert-remove="${escapeHtml(alert.id)}" type="button" aria-label="刪除這個提醒">刪除</button>
                </div>`;
            })
            .join("")}</div>`
        : `<p class="alert-manage-empty">${authState.user ? "目前沒有設定任何到價提醒。" : "登入後才能設定與同步到價提醒。"}</p>`}
      <dl>
        <div><dt>隔日沖訊號</dt><dd>${signalCount ? `${signalCount} 檔` : "尚未產生"}</dd></div>
        <div><dt>到價提醒</dt><dd>${priceAlertsState.alerts.filter((alert) => alert.active).length} 筆等待中</dd></div>
        <div><dt>推播</dt><dd>尚未接入（要等部署上線）</dd></div>
      </dl>
    `,
    risk: `
      <header>
        <span class="more-kicker">公式規則</span>
        <h2>風險規則</h2>
      </header>
      <p>注意股、處置股、全額交割股<strong>不再排除</strong>，改成在清單上<strong>標示</strong>（隔日沖、盤中選股、策略雷達都適用）。低流動性、高振幅、週轉資料未接一樣用標籤提示，不會自動下單。</p>
      <p class="risk-surv-warn">⚠ 處置股有實際交易限制：常需<strong>分盤集合競價</strong>（每 5 或 20 分才撮合）、<strong>預收全額款券</strong>、多半<strong>不能當沖</strong>——標示是提醒，不是買賣建議。</p>
      <label class="risk-surv-toggle">
        <span>
          <strong>顯示注意/處置股</strong>
          <small>關閉後，三個選股清單都會把它們藏起來</small>
        </span>
        <button class="surv-switch ${state.showSurveillance ? "is-on" : ""}" data-action="toggle-surveillance" type="button" role="switch" aria-checked="${state.showSurveillance}" aria-label="顯示注意/處置股">
          <i></i>
        </button>
      </label>
      <dl>
        <div><dt>目前清單中</dt><dd>${overnightState.surveillanceCount || 0} 檔注意/處置股</dd></div>
        <div><dt>低流動性</dt><dd>標籤提醒</dd></div>
        <div><dt>週轉率</dt><dd>依官方發行股數計算</dd></div>
      </dl>
    `,
  };

  detail.innerHTML = activePanel === "brokerGuide"
    ? renderBrokerSettingsPanel()
    : activePanel === "system"
      ? renderAccountManagementPanel()
      : activePanel === "backup"
        ? renderPersonalBackupPanel()
      : activePanel === "notesFeed"
        ? renderNotesFeedPanel()
        : details[activePanel] || details.source;
}

const SUPPLEMENTAL_MARKET_REFRESH_MS = 5 * 60 * 1000;
let supplementalMarketLastRequestedAt = 0;
let supplementalMarketTradeDate = "";
let marketDataRequestSeq = 0;

function refreshSupplementalMarketData({ force = false, liveUpdate = false } = {}) {
  if (document.hidden || getSelectedSource() !== "official") return false;
  const tradeDate = getCurrentTradeDate();
  const sameTradeDate = supplementalMarketTradeDate === tradeDate;
  if (!force && sameTradeDate && Date.now() - supplementalMarketLastRequestedAt < SUPPLEMENTAL_MARKET_REFRESH_MS) {
    return false;
  }
  supplementalMarketTradeDate = tradeDate;
  supplementalMarketLastRequestedAt = Date.now();
  if (liveUpdate) {
    // 自動行情輪詢的法人／融資券資料共用一次受保護提交，避免兩個 API 各重畫一次，
    // 也避免五分鐘補資料時清掉「更多」頁尚未送出的敏感表單。
    void Promise.allSettled([
      loadInstitutionalData({ renderNow: false }),
      loadMarginData({ renderNow: false }),
    ]).then((results) => {
      const applied = results.some((result) => result.status === "fulfilled" && result.value === true);
      if (applied && !document.hidden && getSelectedSource() === "official") renderLiveDataUpdate();
    });
  } else {
    void loadInstitutionalData();
    void loadMarginData();
  }
  return true;
}

function eligibleAlertQuoteCodes(quotes) {
  const today = getTaiwanClockParts().isoDate;
  return new Set((quotes || [])
    .filter((quote) => {
      const asOfDate = String(quote?.asOf || quote?.rawDate || "").slice(0, 10).replaceAll("/", "-");
      return ["realtime", "broker-realtime"].includes(quote?.sourceKind)
        && quote?.priceStale !== true
        && positivePriceOrNull(quote?.price) !== null
        && asOfDate === today;
    })
    .map((quote) => normalizeStockCodeInput(quote.code))
    .filter(Boolean));
}

async function loadMarketData({ notify = false, renderNow = true } = {}) {
  const requestId = ++marketDataRequestSeq;
  const trackedCodes = getTrackedQuoteCodes();
  const codes = trackedCodes.join(",");
  const codesKey = codes;
  const source = getSelectedSource();
  try {
    // 後端每次最多接受 100 檔，避免單一公開請求被放大成數百個上游連線；
    // 三份自選股各可 100 檔，因此前端要分批並保留完整追蹤集合，不能靜默截掉第 101 檔以後。
    const batches = [];
    for (let index = 0; index < trackedCodes.length; index += 100) batches.push(trackedCodes.slice(index, index + 100));
    const payloads = await Promise.all(batches.map((batch) =>
      fetchApi(`/api/quotes?codes=${encodeURIComponent(batch.join(","))}&${getSourceQuery()}`)
    ));
    if (requestId !== marketDataRequestSeq || source !== getSelectedSource() || codesKey !== getTrackedQuoteCodes().join(",")) return;
    const failed = payloads.find((payload) => !payload.ok || !Array.isArray(payload.quotes));
    if (failed) {
      throw new Error(failed.error || "API 回傳格式不正確");
    }
    const quotes = payloads.flatMap((payload) => payload.quotes);
    const byCode = new Map(stocks.map((stock) => [stock.code, stock]));
    quotes.forEach((quote) => {
      const existing = byCode.get(quote.code);
      if (existing) {
        mergeOfficialQuote(existing, quote);
      } else {
        upsertStockFromQuote(quote);
      }
    });
    dataState.mode = payloads[0]?.sourceKey || source;
    dataState.loadedOnce = true;
    dataState.source = [...new Set(payloads.map((payload) => payload.source).filter(Boolean))].join(" + ") || getSelectedSourceLabel();
    dataState.lastUpdated = formatLocalTime(payloads.map((payload) => payload.generatedAt).filter(Boolean).sort().at(-1));
    dataState.quoteCount = quotes.length;
    dataState.realtimeCount = payloads.reduce((sum, payload) => sum + (Number(payload.realtimeCount) || 0), 0);
    dataState.fallbackCount = payloads.reduce((sum, payload) => sum + (Number(payload.fallbackCount) || 0), 0);
    dataState.warnings = [...new Set(payloads.flatMap((payload) => payload.warnings || []).filter(Boolean))];
    dataState.degraded = payloads.some((payload) => payload.dataQuality?.degraded === true);
    const realtimeErrors = [...new Set(payloads.map((payload) => payload.realtimeError).filter(Boolean))];
    dataState.error = realtimeErrors.length ? `即時源部分失敗：${realtimeErrors.join("；")}` : "";
    // 到價狀態和本輪行情一起提交，避免同一批資料先畫一次、觸價後又立刻畫第二次。
    if (!document.hidden) checkPriceAlerts(eligibleAlertQuoteCodes(quotes), { renderNow: false });
    if (renderNow) render();
    if (notify) {
      showToast(`${getSelectedSourceLabel()}已更新：${dataState.quoteCount} 檔`);
    }
    if (source === "official" && renderNow) refreshSupplementalMarketData({ force: notify });
    return true;
  } catch (error) {
    if (requestId !== marketDataRequestSeq || source !== getSelectedSource() || codesKey !== getTrackedQuoteCodes().join(",")) return false;
    if (handleAuthRequired(error)) return false;
    if (source === "broker") {
      switchToOfficialFallback(error.message || "券商行情失敗", { notify: true, refresh: true });
      return false;
    }
    dataState.mode = source;
    dataState.loadedOnce = true;
    dataState.source = getSelectedSourceLabel();
    dataState.quoteCount = 0;
    dataState.realtimeCount = 0;
    dataState.fallbackCount = 0;
    dataState.warnings = [];
    dataState.degraded = false;
    dataState.error = error.message;
    if (renderNow) render();
    if (notify) showToast(`${getSelectedSourceLabel()}更新失敗`);
    return true;
  }
}

async function loadInstitutionalData({ notify = false, renderNow = true } = {}) {
  if (institutionalState.loading) return false;
  const codes = getTrackedQuoteCodes().join(",");
  const tradeDate = getCurrentTradeDate();
  const dateQuery = tradeDate ? `&date=${encodeURIComponent(tradeDate)}` : "";
  institutionalState.loading = true;
  try {
    const payload = await fetchApi(`/api/institutional?codes=${encodeURIComponent(codes)}${dateQuery}`);
    if (!payload.ok || !payload.records) {
      throw new Error(payload.error || "法人資料回傳格式不正確");
    }
    Object.values(payload.records).forEach(mergeInstitutionalRecord);
    institutionalState.loaded = true;
    institutionalState.loading = false;
    institutionalState.records = payload.records;
    institutionalState.source = payload.source || "TWSE/TPEx";
    institutionalState.asOf = payload.date || "";
    institutionalState.lastUpdated = formatLocalTime(payload.generatedAt);
    institutionalState.error = "";
    institutionalState.warnings = payload.warnings || [];
    if (renderNow) render();
    if (notify) showToast(`法人資料已更新：${payload.recordCount || 0} 檔`);
    return true;
  } catch (error) {
    institutionalState.loaded = false;
    institutionalState.loading = false;
    if (handleAuthRequired(error)) return false;
    institutionalState.error = error.message;
    if (renderNow) render();
    if (notify) showToast("法人資料更新失敗");
    return true;
  }
}

function mergeMarginRecord(record) {
  if (!record?.code) return;
  const stock = stocks.find((item) => item.code === record.code);
  if (stock) {
    stock.margin = record;
  }
}

async function loadMarginData({ notify = false, renderNow = true } = {}) {
  if (marginState.loading) return false;
  const codes = getTrackedQuoteCodes().join(",");
  marginState.loading = true;
  try {
    const payload = await fetchApi(`/api/margin?codes=${encodeURIComponent(codes)}`);
    if (!payload.ok || !payload.records) {
      throw new Error(payload.error || payload.warnings?.[0] || "融資券資料回傳格式不正確");
    }
    Object.values(payload.records).forEach(mergeMarginRecord);
    marginState.loaded = true;
    marginState.records = payload.records;
    marginState.source = payload.source || "TWSE/TPEx";
    marginState.asOf = payload.date || "";
    marginState.error = "";
    marginState.warnings = payload.warnings || [];
    if (renderNow) renderDetail();
    if (notify) showToast(`融資券已更新：${payload.recordCount || 0} 檔`);
    return true;
  } catch (error) {
    marginState.loaded = false;
    marginState.error = error.message;
    if (notify) showToast("融資券更新失敗");
    return true;
  } finally {
    marginState.loading = false;
  }
}

function upsertStockFromPick(pick) {
  let stock = stocks.find((item) => item.code === pick.code);
  if (isQuoteBackedStock(stock)) {
    if (!stock.groups.includes("overnight")) stock.groups = [...stock.groups, "overnight"];
    if (pick.groupName && !stock.strategies.includes(pick.groupName)) {
      stock.strategies = [...stock.strategies, pick.groupName];
    }
    stock.stage = pick.metrics?.volumeRatio5 || stock.stage;
    stock.slope = pick.metrics?.closePosition ? pick.metrics.closePosition * 10 : stock.slope;
    if (Number.isFinite(Number(pick.metrics?.turnover))) stock.turnover = Number(pick.metrics.turnover);
    stock.avgVol = pick.metrics?.volumeRatio5 || stock.avgVol;
    if (pick.surveillance) stock.surveillance = pick.surveillance;
    return stock;
  }
  if (!stock) {
    stock = {
      code: pick.code,
      name: pick.name,
      price: pick.price,
      change: pick.changePct || 0,
      changeText: formatSignedPercent(pick.changePct || 0),
      unit: 0,
      total: pick.volumeLots || 0,
      signal: signalFromChange(pick.changePct),
      stage: pick.metrics?.volumeRatio5 || 0,
      slope: pick.metrics?.closePosition ? pick.metrics.closePosition * 10 : 0,
      streak: pick.score || 0,
      flow: Math.round((pick.metrics?.volumeRatio20 || 0) * 100),
      turnover: Number(pick.metrics?.turnover) || 0,
      avgVol: pick.metrics?.volumeRatio5 || 0,
      groups: ["overnight"],
      strategies: [pick.groupName],
      // 用「隱含昨收→訊號日收盤」兩點起步，之後官方報價會把真實價格接上去；
      // 不再用均線值假造價格路徑。
      spark: [
        Number.isFinite(Number(pick.changePct)) ? pick.price / (1 + Number(pick.changePct) / 100) : null,
        pick.price,
      ].filter(Number.isFinite),
    };
    if (stock.spark.length < 2) stock.spark = [pick.price, pick.price];
    stocks.push(stock);
  }
  stock.name = pick.name;
  stock.price = pick.price;
  stock.change = pick.changePct || 0;
  stock.changeText = formatSignedPercent(pick.changePct || 0);
  stock.signal = signalFromChange(stock.change);
  stock.total = pick.volumeLots || stock.total;
  stock.stage = pick.metrics?.volumeRatio5 || stock.stage;
  stock.slope = pick.metrics?.closePosition ? pick.metrics.closePosition * 10 : stock.slope;
  if (Number.isFinite(Number(pick.metrics?.turnover))) stock.turnover = Number(pick.metrics.turnover);
  stock.avgVol = pick.metrics?.volumeRatio5 || stock.avgVol;
  stock.surveillance = pick.surveillance || null;
  stock.official = true;
  stock.source = pick.source;
  stock.sourceKind = "overnight-signal";
  stock.exchange = pick.exchange;
  stock.asOf = pick.asOf;
  stock.open = null;
  stock.high = null;
  stock.low = null;
  stock.previousClose = null;
  stock.priceChange = null;
  return stock;
}

function renderOvernightGroups() {
  if (!el.overnightGroups) return;
  const table = document.querySelector('[data-screen-panel="overnight"] .quote-table');
  if (overnightState.error) {
    el.overnightGroups.hidden = false;
    el.overnightGroups.classList.remove("is-single-group");
    if (table) table.hidden = true;
    el.overnightGroups.innerHTML = `
      <div class="overnight-error">
        <strong>官方隔日沖清單產生失敗</strong>
        <span>${escapeHtml(overnightState.error)}</span>
        <small>請確認已用 npm start 啟動，並使用 http://127.0.0.1:5174/ 開啟。</small>
      </div>
    `;
    return;
  }
  if (state.overnightView === "performance") {
    el.overnightGroups.hidden = false;
    el.overnightGroups.classList.add("is-single-group");
    if (table) table.hidden = true;
    if (!backtestState.loaded && !backtestState.loading && !backtestState.error) {
      loadBacktestSummary();
    }
    if (!verifyHistoryState.loaded && !verifyHistoryState.loading && !verifyHistoryState.error) {
      loadVerifyHistory();
    }
    el.overnightGroups.innerHTML = `${renderVerifyHistory()}${renderBacktestPerformance()}`;
    return;
  }
  if (overnightState.loading && !overnightState.loaded) {
    el.overnightGroups.hidden = false;
    el.overnightGroups.classList.remove("is-single-group");
    if (table) table.hidden = true;
    el.overnightGroups.innerHTML = `<div class="overnight-empty is-loading"><span class="mini-spinner" aria-hidden="true"></span>官方隔日沖清單產生中，第一次約需 10–30 秒…</div>`;
    return;
  }
  if (!overnightState.loaded || !overnightState.groups) {
    el.overnightGroups.hidden = true;
    el.overnightGroups.classList.remove("is-single-group");
    if (table) table.hidden = false;
    return;
  }

  const compactGroupHints = {
    strongContinuation: "收強・放量・站上均線",
    volumeDanger: "過熱／收弱・風險觀察",
    pullbackReversal: "回檔轉強・隔日觀察",
  };
  const readableGroupOrder = ["strongContinuation", "volumeDanger", "pullbackReversal"]
    .map((key) => [key, getOvernightGroupMeta(key).title, getOvernightGroupMeta(key).hint, compactGroupHints[key]]);
  const activeGroup = readableGroupOrder.find(([key]) => key === state.overnightView);
  const readableScoreGuide = {
    overview: ["分數", "公式符合度，不是勝率"],
    strongContinuation: ["強度籤", "越高代表續攻條件越完整"],
    volumeDanger: ["熱度籤", "越高代表過熱與波動越明顯"],
    pullbackReversal: ["轉強籤", "越高代表回到短線強勢的條件越多"],
  }[state.overnightView] || ["分數", "公式符合度，不是勝率"];
  const visibleGroups = state.overnightView === "overview"
    ? readableGroupOrder
    : readableGroupOrder.filter(([key]) => key === state.overnightView);
  const dateLabels = getOvernightDateLabels();
  const compactObservationLabel = dateLabels.observationDate
    ? `${compactDateLabel(dateLabels.signalDate)} → ${compactDateLabel(dateLabels.observationDate)} 觀察`
    : `${compactDateLabel(dateLabels.signalDate)} → 觀察日待確認`;
  const overviewPickLimit = 5;
  const cards = visibleGroups
    .map(([key, title, hint, compactHint]) => {
      // 關閉開關時，把注意/處置股從隔日沖清單藏起來（預設顯示）。
      const picks = (overnightState.groups[key] || []).filter((pick) => state.showSurveillance || !pick.surveillance);
      const displayedPicks = state.overnightView === "overview" ? picks.slice(0, overviewPickLimit) : picks;
      return `
        <article class="overnight-group ${state.overnightView === "overview" ? "is-overview" : "is-focused"}">
          <header>
            <div class="overnight-group-heading">
              <div class="overnight-group-titleline">
                <h2>${title}</h2>
                <strong class="overnight-group-count" title="符合條件共 ${picks.length} 檔">${picks.length}</strong>
              </div>
              <p class="overnight-group-meta">
                <span title="${dateLabels.signalLabel} → ${dateLabels.observationLabel}">${compactObservationLabel}</span>
                <span title="${hint}">${compactHint}</span>
              </p>
            </div>
          </header>
          <div class="overnight-picks">
            ${displayedPicks
              .map(
                (pick) => `
                  <button class="overnight-pick" data-overnight-code="${pick.code}" type="button">
                    ${renderScoreBadge(pick, key)}
                    <span class="pick-main">
                      <strong>${escapeHtml(pick.name)}</strong>
                      <small>${pick.code} ${formatExchangeLabel(pick.exchange)}</small>
                      ${pick.surveillance ? `<span class="surv-line">${renderSurveillanceBadge(pick.surveillance)}</span>` : ""}
                    </span>
                    <span class="pick-quote">
                      <span>
                        <small>收盤價</small>
                        <strong>${formatNumber(pick.price)}</strong>
                      </span>
                      <span>
                        <small>漲幅</small>
                        <strong class="${toneFromNet(pick.changePct)}">${formatSignedPercent(pick.changePct)}</strong>
                      </span>
                    </span>
                    <span class="pick-reasons">
                      <em>條件</em>
                      ${renderReasonChips(pick.reasons)}
                    </span>
                    <span class="pick-risks">
                      <em>風險</em>
                      ${renderRiskChips(pick.riskTags)}
                    </span>
                    <span class="pick-backtest">
                      <em>回測</em>
                      ${renderBacktestChips(pick.recentBacktest)}
                    </span>
                  </button>
                `
              )
              .join("") || `<div class="overnight-empty">目前沒有符合條件的股票</div>`}
          </div>
          ${state.overnightView === "overview" && picks.length > displayedPicks.length
            ? `<button class="overnight-overview-more" data-overnight-view="${key}" type="button">看完整 ${picks.length} 檔</button>`
            : ""}
        </article>
      `;
    })
    .join("");

  el.overnightGroups.hidden = false;
  el.overnightGroups.classList.toggle("is-single-group", state.overnightView !== "overview");
  if (table) table.hidden = true;
  const warnings = (overnightState.warnings || [])
    .map((warning) => `<span class="overnight-warning">⚠ ${escapeHtml(warning)}</span>`)
    .join("");
  el.overnightGroups.innerHTML = `
    <div class="overnight-summary">
      <div class="overnight-summary-primary">
        <!-- 這裡原本寫死「隔日沖總覽 v1」。它指的是面板版面版本，但畫面上從不顯示真正的
             公式版本（OVERNIGHT_FORMULA_VERSION 目前已是 v3），使用者看到的唯一一個「v」
             會被讀成引擎版本。標籤本身對使用者沒有資訊量，直接拿掉。 -->
        <strong>${state.overnightView === "overview" ? "隔日沖總覽" : `只看：${activeGroup?.[1] || "隔日沖分群"}`}</strong>
        <span><b>訊號日</b>${dateLabels.signalLabel}</span>
        <span><b>觀察日</b>${dateLabels.observationLabel}</span>
      </div>
      <div class="overnight-summary-facts">
        <span><b>來源</b>${overnightState.source}</span>
        <span><b>注意／處置</b>${state.showSurveillance ? `標示中 ${overnightState.surveillanceCount} 檔` : "目前隱藏"}</span>
        <span><b>週轉率</b>依官方發行股數</span>
        ${state.overnightView !== "overview" ? `<span>${activeGroup?.[2] || ""}</span>` : ""}
      </div>
      ${warnings ? `<div class="overnight-summary-warnings">${warnings}</div>` : ""}
    </div>
    ${state.overnightView === "overview" ? renderSignalVerification() : ""}
    ${state.overnightView === "overview" ? renderTodayFocusPanel() : ""}
    ${state.overnightView !== "overview" ? renderReadableScoreExplainer(state.overnightView) : ""}
    <div class="overnight-field-guide" aria-label="欄位說明">
      <span><strong>${escapeHtml(readableScoreGuide[0])}</strong>${escapeHtml(readableScoreGuide[1])}</span>
      <span><strong>收盤價</strong>訊號日官方日收</span>
      <span><strong>漲幅</strong>訊號日當日漲跌</span>
      <span><strong>30日回測</strong>有樣本才統計</span>
    </div>
    ${cards}
  `;
}

async function loadSignalVerification() {
  if (verifyState.loading) return;
  verifyState.loading = true;
  try {
    verifyState.data = await fetchApi("/api/overnight/verify");
    verifyState.error = "";
    verifyState.loaded = true;
  } catch (error) {
    if (!handleAuthRequired(error)) verifyState.error = error.message;
  } finally {
    verifyState.loading = false;
    renderOvernightGroups();
  }
}

async function loadBacktestSummary() {
  if (backtestState.loading) return;
  backtestState.loading = true;
  backtestState.error = "";
  renderOvernightGroups();
  try {
    backtestState.data = await fetchApi("/api/backtest/overnight?days=30");
    backtestState.loaded = true;
  } catch (error) {
    if (!handleAuthRequired(error)) backtestState.error = error.message;
  } finally {
    backtestState.loading = false;
    renderOvernightGroups();
  }
}

function renderSignalVerification() {
  if (verifyState.loading && !verifyState.data) {
    return `<section class="verify-panel is-pending"><strong>隔日表現驗證</strong><span>正在確認實際下一交易日...</span></section>`;
  }
  const data = verifyState.data;
  if (!data) {
    return verifyState.error
      ? `<section class="verify-panel is-pending"><strong>隔日表現驗證</strong><span>${escapeHtml(verifyState.error)}</span></section>`
      : "";
  }
  if (!data.available) {
    return `
      <section class="verify-panel is-pending">
        <strong>隔日表現驗證</strong>
        <span>${escapeHtml(data.message || "尚無可驗證的訊號")}</span>
      </section>
    `;
  }
  const summary = data.summary || {};
  const hitTone = summary.total && summary.hitPlus2 / summary.total >= 0.5 ? "positive" : "negative";
  const topRows = (data.rows || []).slice(0, 6);
  const isIntraday = data.observationPhase === "intraday";
  const phaseLabel = isIntraday ? "盤中暫定" : data.complete === false ? "正式收盤 · 部分待補" : "正式收盤";
  const coverageLabel = data.expectedSignals != null && Number.isFinite(Number(data.expectedSignals))
    ? `已驗證 ${Number(data.verifiedSignals || 0)}/${Number(data.expectedSignals || 0)}`
    : "";
  return `
    <section class="verify-panel">
      <header>
        <div>
          <strong>隔日表現驗證</strong>
          <span>${escapeHtml(compactDateLabel(data.signalDate))} 訊號 → ${escapeHtml(compactDateLabel(data.observationDate))} 實際下一交易日 · ${phaseLabel}</span>
        </div>
        <div class="verify-stats">
          ${coverageLabel ? `<span>${escapeHtml(coverageLabel)}</span>` : ""}
          <span class="${hitTone}">達+2%：${summary.hitPlus2 ?? 0}/${summary.total ?? 0}</span>
          <span class="negative">破-2%：${summary.brokeMinus2 ?? 0}/${summary.total ?? 0}</span>
          <span>${isIntraday ? "平均現價" : "平均收盤"} ${formatGrossWithNet(summary.avgCurrentReturn, summary.avgCurrentReturnNet)}</span>
        </div>
      </header>
      <div class="verify-rows">
        ${topRows
          .map((row) => `
            <button class="verify-chip ${Number.isFinite(row.currentReturn) ? (row.currentReturn >= 0 ? "is-up" : "is-down") : ""}" data-overnight-code="${row.code}" type="button">
              <strong>${escapeHtml(row.name)}</strong>
              <span>${formatSignedPercent(row.currentReturn)}</span>
              <small>高 ${formatSignedPercent(row.highReturn)}${row.hitPlus2 ? " ✓" : ""}</small>
            </button>
          `)
          .join("")}
      </div>
      <small>觀察日依官方交易日序列判定；每檔日期必須完全相等。基準＝訊號日收盤價，達標看觀察日最高、破線看觀察日最低；盤中結果不會寫入正式長期統計。</small>
    </section>
  `;
}

async function loadVerifyHistory() {
  if (verifyHistoryState.loading) return;
  verifyHistoryState.loading = true;
  try {
    verifyHistoryState.data = await fetchApi("/api/overnight/verify/history");
    verifyHistoryState.error = "";
    verifyHistoryState.loaded = true;
  } catch (error) {
    if (!handleAuthRequired(error)) verifyHistoryState.error = error.message;
  } finally {
    verifyHistoryState.loading = false;
    renderOvernightGroups();
  }
}

function renderVerifyHistory() {
  if (verifyHistoryState.loading && !verifyHistoryState.data) {
    return `<div class="overnight-empty is-loading"><span class="mini-spinner" aria-hidden="true"></span>驗證紀錄計算中…</div>`;
  }
  const data = verifyHistoryState.data;
  if (!data) {
    return verifyHistoryState.error
      ? `<div class="overnight-empty">驗證紀錄讀取失敗：${escapeHtml(verifyHistoryState.error)}</div>`
      : "";
  }
  if (!data.records?.length) {
    return `<div class="overnight-empty">${escapeHtml(data.message || "尚未累積驗證紀錄")}</div>`;
  }
  const rate = (hit, total) => (total ? `${Math.round((hit / total) * 100)}%` : "--");
  const rows = data.records
    .map((record) => (record.status !== "final" || record.complete === false)
      ? `
        <div class="verify-history-row is-pending">
          <span>${escapeHtml(compactDateLabel(record.asOf))}→${escapeHtml(compactDateLabel(record.observationDate))}</span>
          <span>${record.verified || 0}/${record.signals} 檔</span>
          <span class="verify-pending-note">${record.status === "partial" ? "部分官方行情待補，暫不納入累計" : "等待實際下一交易日的正式行情"}</span>
        </div>
      `
      : `
        <div class="verify-history-row">
          <span>${escapeHtml(compactDateLabel(record.asOf))}→${escapeHtml(compactDateLabel(record.observationDate))}</span>
          <span>${record.verified} 檔</span>
          <span class="${record.verified && record.hitPlus2 / record.verified >= 0.5 ? "positive" : ""}">${rate(record.hitPlus2, record.verified)}</span>
          <span class="${record.verified && record.brokeMinus2 / record.verified >= 0.4 ? "negative" : ""}">${rate(record.brokeMinus2, record.verified)}</span>
          <span>${formatSignedPercent(record.avgHighReturn)}</span>
          <span>${formatSignedPercent(record.avgCloseReturn)}</span>
        </div>
      `)
    .join("");
  const totals = data.totals;
  return `
    <section class="verify-history" aria-label="實際驗證紀錄">
      <header>
        <div>
          <strong>實際驗證紀錄（前向，不是回測）</strong>
          <span>每筆訊號只用官方認定的實際下一交易日對答案；部分資料不進累計。達成率是延續機率統計，不是預測保證。</span>
        </div>
        ${totals ? `
          <div class="verify-stats">
            <span>累計 ${totals.days} 天 / ${totals.signals} 檔</span>
            <span class="${totals.signals && totals.hitPlus2 / totals.signals >= 0.5 ? "positive" : ""}">達+2% ${rate(totals.hitPlus2, totals.signals)}</span>
            <span class="negative">破-2% ${rate(totals.brokeMinus2, totals.signals)}</span>
            <span>平均隔日收 ${formatGrossWithNet(totals.avgCloseReturn, totals.avgCloseReturnNet)}</span>
          </div>
        ` : ""}
      </header>
      <div class="verify-history-row is-head">
        <span>訊號→觀察</span>
        <span>驗證檔數</span>
        <span>達+2%</span>
        <span>破-2%</span>
        <span>平均最高</span>
        <span>平均收盤</span>
      </div>
      ${rows}
    </section>
  `;
}

function renderBacktestPerformance() {
  if (backtestState.loading) {
    return `<div class="overnight-empty is-loading"><span class="mini-spinner" aria-hidden="true"></span>回測計算中，第一次大約需要十幾秒（之後有快取）…</div>`;
  }
  if (backtestState.error) {
    return `<div class="overnight-error"><strong>回測讀取失敗</strong><span>${escapeHtml(backtestState.error)}</span></div>`;
  }
  const data = backtestState.data;
  if (!data?.summary) {
    return `<div class="overnight-empty">尚未載入回測資料</div>`;
  }
  const rate = (value) => (Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(0)}%` : "--");
  const ret = (value) => (Number.isFinite(Number(value)) ? formatSignedPercent(value) : "--");
  const cards = Object.entries(data.summary)
    .map(([key, item]) => `
      <article class="performance-card is-${key === "volumeDanger" ? "danger" : key === "pullbackReversal" ? "reversal" : "momentum"}">
        <header>
          <strong>${escapeHtml(item.groupName || key)}</strong>
          <span>樣本 ${item.sampleSize ?? 0} 次</span>
        </header>
        <dl>
          <div><dt>隔日達 +2%</dt><dd>${rate(item.hitPlus2Rate)}</dd></div>
          <div><dt>隔日破 -2%</dt><dd>${rate(item.brokeMinus2Rate)}</dd></div>
          <div><dt>平均開盤</dt><dd>${ret(item.avgOpenReturn)}</dd></div>
          <div><dt>平均最高</dt><dd>${ret(item.avgHighReturn)}</dd></div>
          <div><dt>平均收盤</dt><dd>${formatGrossWithNet(item.avgCloseReturn, item.avgCloseReturnNet)}</dd></div>
        </dl>
      </article>
    `)
    .join("");
  return `
    <div class="overnight-summary">
      <strong>策略表現（近 ${data.days || 30} 個交易日回測）</strong>
      <span>樣本股票：目前訊號候選 ${data.sampleCodes?.length || 0} 檔</span>
      <span>基準：訊號日收盤 → 實際下一交易日開高收</span>
      <span>產生：${escapeHtml(formatLocalTime(data.generatedAt))}</span>
    </div>
    <section class="performance-grid">${cards}</section>
    <div class="overnight-field-guide" aria-label="回測說明">
      <span><strong>注意</strong>回測樣本只涵蓋目前的訊號候選股，不是全市場，結果偏樂觀，僅供校準參考。</span>
    </div>
  `;
}

async function loadOvernightSignals({ notify = false } = {}) {
  overnightState.loading = true;
  overnightState.error = "";
  try {
    const payload = await fetchApi("/api/overnight?limit=20");
    if (!payload.ok || !payload.groups) throw new Error(payload.error || "API 回傳格式不正確");
    overnightState.loaded = true;
    overnightState.asOf = payload.asOf;
    overnightState.source = payload.source;
    overnightState.groups = payload.groups;
    overnightState.surveillanceCount = payload.surveillanceCount || 0;
    overnightState.warnings = payload.warnings || [];
    const picks = Object.values(payload.groups).flat();
    picks.forEach(upsertStockFromPick);
    try {
      await syncOfficialQuotesForCodes(picks.map((pick) => pick.code));
    } catch {
      // Keep the signal list visible if quote refresh is temporarily unavailable.
    }
    render();
    loadSignalVerification();
    if (notify) showToast("隔日沖清單已更新");
  } catch (error) {
    if (handleAuthRequired(error)) return;
    overnightState.loaded = false;
    overnightState.error = error.message;
    renderOvernightGroups();
    showToast("隔日沖清單產生失敗");
  } finally {
    overnightState.loading = false;
  }
}

function strategyNeedsReload() {
  return !strategyState.loaded && !strategyState.loading;
}

let strategyLoadSeq = 0;

async function loadStrategyBoard({ notify = false, refresh = false } = {}) {
  // 每次載入給一個遞增序號並記住當下的場景；回來時若已被新的請求取代（例如使用者切了
  // tab、又按了重新整理），就整包丟棄，避免「強勢續攻」的結果蓋到「中軌攻防」的畫面上。
  const requestId = ++strategyLoadSeq;
  const requestedScenario = strategyState.scenario;
  strategyState.loading = true;
  strategyState.error = "";
  renderStrategyBoard();
  try {
    const refreshParam = refresh ? "&refresh=1" : "";
    const payload = await fetchApi(`/api/swing?scenario=${encodeURIComponent(requestedScenario)}&limit=40${refreshParam}`);
    if (requestId !== strategyLoadSeq) return; // 已過期：有更新的請求接手了
    if (!payload.ok || !Array.isArray(payload.picks)) throw new Error(payload.error || "API 回傳格式不正確");
    strategyState.loaded = true;
    strategyState.asOf = payload.asOf || "";
    strategyState.source = payload.source || "";
    strategyState.picks = payload.picks;
    strategyState.scenarios = payload.scenarios || [];
    strategyState.matchedCount = payload.matchedCount || payload.picks.length;
    strategyState.candidateCount = payload.candidateCount || 0;
    strategyState.generatedAt = payload.generatedAt || "";
    strategyState.riskPolicy = payload.riskPolicy || "";
    strategyState.warnings = payload.warnings || [];
    if (notify) showToast("策略雷達已更新");
  } catch (error) {
    if (requestId !== strategyLoadSeq) return; // 過期的錯誤不要覆蓋目前場景的狀態
    if (handleAuthRequired(error)) return;
    strategyState.error = error.message;
    if (notify) showToast("策略雷達計算失敗");
  } finally {
    if (requestId === strategyLoadSeq) {
      strategyState.loading = false;
      renderStrategyBoard();
    }
  }
}

function renderSwingCard(pick) {
  const changeTone = toneFromNet(pick.changePct);
  const rr = Number(pick.plan?.rr);
  const rrTone = !Number.isFinite(rr) ? "rr-na" : rr >= 2 ? "rr-high" : rr >= 1 ? "rr-mid" : "rr-low";
  const score = Math.round(Number(pick.score) || 0);
  const scoreTier = score >= 80 ? "is-high" : score >= 65 ? "is-mid" : "is-base";
  const warns = (pick.scenario?.warns || [])
    .map((warn) => `<span class="swing-warn">${warn}</span>`)
    .join("");
  const entry = Number(pick.plan?.entry);
  const stop = Number(pick.plan?.structuralStop);
  const target = Number(pick.plan?.target);
  const risk = Math.max(0, entry - stop);
  const reward = Math.max(0, target - entry);
  const riskRewardBar = risk > 0 && reward > 0
    ? `
      <div class="swing-rrbar" aria-hidden="true">
        <span class="swing-rrbar-tag loss">停損 ${formatNumber(stop)}</span>
        <span class="swing-rrbar-track">
          <i class="loss" style="flex:${risk.toFixed(2)}"></i>
          <b class="swing-rrbar-entry"></b>
          <i class="gain" style="flex:${reward.toFixed(2)}"></i>
        </span>
        <span class="swing-rrbar-tag gain">目標 ${formatNumber(target)}</span>
      </div>`
    : "";
  const bollMid = Number(pick.indicators?.bollMid);
  const price = Number(pick.price);
  const distToMid = Number.isFinite(bollMid) && bollMid ? ((price - bollMid) / bollMid) * 100 : null;
  const volRatio = Number(pick.volumeRatio5);
  // facts 拆成「標籤＋數值」：只有標籤是可點名詞（gloss-link），數值不可點，避免整串都帶虛線。
  const facts = [];
  if (Number.isFinite(bollMid)) facts.push({ lb: glossLink("中軌"), v: formatNumber(bollMid) });
  if (Number.isFinite(distToMid)) facts.push({ lb: glossLink("距中軌", "中軌"), v: `${distToMid >= 0 ? "+" : ""}${distToMid.toFixed(1)}%` });
  if (Number.isFinite(volRatio)) facts.push({ lb: glossLink("量比", "量比5"), v: volRatio.toFixed(2) });
  facts.push({ lb: "均量", v: `${Number(pick.avgVolLots || 0).toLocaleString("en-US")} 張` });
  const factsHtml = facts.map((fact) => `<span>${fact.lb} ${fact.v}</span>`).join("");
  // 進場提示：先點明「進場＝收盤價」（解決『右上收盤和左下進場為何相同』的疑惑），再依場景補上較佳買點。
  // 中軌攻防的結構停損就是中軌本身，「回測中軌再買」＝「買在停損價」並不合理 → 站穩中軌（收盤）即為進場。
  // 強勢續攻的停損在更下方（月線），5 日線遠在停損之上，回測 5 日線才是風險更小、盈虧比更好的買點。
  const scenarioKey = pick.scenario?.key;
  const closePrice = Number(pick.price);
  const structStop = Number(pick.plan?.structuralStop);
  const ma5 = Number(pick.indicators?.ma5);
  let entryTipBody;
  if (
    scenarioKey === "strongContinuation" &&
    Number.isFinite(ma5) && Number.isFinite(closePrice) &&
    ma5 <= closePrice * 0.99 &&
    (!Number.isFinite(structStop) || ma5 > structStop)
  ) {
    const pullPct = ((closePrice - ma5) / closePrice) * 100;
    entryTipBody = `進場＝收盤價；想等更好價位，回測 <b>5 日線 ${formatNumber(ma5)}</b>（約 −${pullPct.toFixed(1)}%）是風險更小的買點。`;
  } else if (scenarioKey === "strongContinuation") {
    entryTipBody = `進場＝收盤價；沿上軌強勢、量能到位，現價即可進場。`;
  } else {
    entryTipBody = `進場＝收盤價；現價站穩中軌即為合理進場，跌破結構停損就出場。`;
  }
  const entryTipHtml = `<p class="swing-entry-tip"><span class="swing-entry-tip-tag">進場提示</span>${entryTipBody}</p>`;
  // 上榜亮點：把「為什麼被選出來、且划不划算」用白話講成一句，讓使用者不必自己讀那排數字去推。
  // 與場景說明(desc)互補：desc 講型態，這裡講這檔當下的強項（位置／量能／盈虧比／型態分）。
  const reasons = [];
  if (scenarioKey === "midBandDefense" && Number.isFinite(distToMid)) {
    reasons.push(Math.abs(distToMid) <= 1.5 ? "緊貼中軌、進場成本低" : "回到中軌附近");
  } else if (scenarioKey === "strongContinuation") {
    reasons.push("沿上軌強勢續攻");
  }
  if (Number.isFinite(volRatio)) {
    if (volRatio >= 1.2) reasons.push(`量能放大（量比 ${volRatio.toFixed(1)}）`);
    else if (volRatio >= 0.9) reasons.push("量能持穩");
  }
  // 「划不划算」要用**淨**盈虧比判斷（門檻也是套在淨值上）。用毛值講「相當划算」會在
  // 高風險設定上失準：毛 2.0 但停損很近時，扣掉來回成本後可能只剩 1.3。
  // 兩個數字都顯示，讓使用者看得出成本吃掉多少。
  const rrNet = Number(pick.plan?.rrNet);
  if (Number.isFinite(rr)) {
    const shown = Number.isFinite(rrNet) ? `盈虧比 ${rr.toFixed(1)}（淨 ${rrNet.toFixed(1)}）` : `盈虧比 ${rr.toFixed(1)}`;
    const judged = Number.isFinite(rrNet) ? rrNet : rr;
    reasons.push(judged >= 2 ? `${shown}、相當划算` : shown);
  }
  if (score >= 80) reasons.push(`型態分 ${score} 偏高`);
  const reasonHtml = reasons.length
    ? `<p class="swing-reason"><span class="swing-reason-tag">為何上榜</span>${reasons.join("、")}。</p>`
    : "";
  // 收盤日期標示：少數個股的官方收盤資料會比大盤晚一個交易日（當月被限流漏抓、或官方逐檔尚未更新），
  // 這時卡片的「收盤」其實是前一交易日的價格，會與右側「即時報價」不同天。把實際日期標在「收盤」旁，
  // 避免使用者以為同一天卻對不上（例如利華卡片 6/12 收 45.1，右側面板是 6/15 即時 44.9）。
  const normDate = (d) => String(d || "").replace(/\//g, "-");
  const boardDate = normDate(strategyState.asOf);
  const pickDate = normDate(pick.asOf);
  const dateLagged = pickDate && boardDate && pickDate !== boardDate;
  // 收盤一律標出日期（例「06/15 收盤」），讓使用者一眼分辨是哪一天的收盤、不會跟右側今日即時搞混。
  const closeMD = pickDate ? pickDate.slice(5).replace("-", "/") : "";
  const closeLabel = closeMD ? `${closeMD} 收盤` : "收盤";
  const closeLabelClass = dateLagged ? "swing-price-label is-lagged" : "swing-price-label";
  const closeLabelTitle = dateLagged
    ? `這檔的官方收盤資料目前到 ${pickDate.replace(/-/g, "/")}（比大盤晚一個交易日）；右側面板顯示的是最新即時報價，所以可能不同天、數字不一樣。`
    : "當日官方收盤價（當日凍結）；右側面板是即時報價，盤中兩者會不同，屬正常。";
  // 股名帶 * ＝官方標記的「彈性面額股」（每股面額非新台幣 10 元），不是錯字也不是風險股。
  const isFlexPar = /[*＊]/.test(pick.name || "");
  const nameTitle = isFlexPar
    ? ' title="股名後的 * 是官方標記的「彈性面額股」：每股面額不是新台幣 10 元（可能 0.25／1／5 元…）。因此它的股價高低不能直接跟一般股票（面額 10 元）相比，看市值才準。這不是風險警示。"'
    : "";
  return `
    <article class="swing-card" data-swing-code="${pick.code}" role="button" tabindex="0" aria-label="${escapeHtml(pick.name)} ${pick.code} 策略明細">
      <div class="swing-rank-badge ${scoreTier}" style="--score:${Math.max(6, Math.min(100, score))}%" title="策略評分 0–100：趨勢＋MACD動能＋貼近中軌＋量能＋流動性＋盈虧比綜合計算，越高代表型態越好且越划算；扣掉一買一賣手續費與證交稅之後的淨盈虧比小於 1 的設定不列入。RANK 依評分由高到低排名。">
        <small>RANK</small>
        <strong>${pick.rank}</strong>
        <em>${score}<i>分</i></em>
        <span class="swing-rank-bar"><b></b></span>
      </div>
      <div class="swing-head">
        <div class="swing-headline">
          <div class="swing-identity">
            <strong class="swing-nm"${nameTitle}>${escapeHtml(pick.name)}</strong>
            <span class="swing-code">${pick.code}</span>
            <span class="swing-market">${escapeHtml(pick.market || formatExchangeLabel(pick.exchange))}</span>
          </div>
          <span class="swing-quote-inline">
            <span class="${closeLabelClass}" title="${closeLabelTitle}">${closeLabel}</span>
            <span class="swing-price">${formatNumber(pick.price)}</span>
            <span class="swing-chg ${changeTone}">${formatSignedPercent(pick.changePct)}</span>
          </span>
        </div>
        <div class="swing-signal-line">
          <div class="swing-tags">
          <span class="swing-scenario-badge">${pick.scenario?.name ? glossLink(pick.scenario.name) : "—"}</span>
          ${pick.surveillance ? `<span class="surv-line swing-surv">${renderSurveillanceBadge(pick.surveillance)}</span>` : ""}
          ${pick.fillRisk === "limit-up-locked"
            ? `<span class="swing-warn is-alert" title="今天整天只有漲停這一個成交價，掛買單排不到，下方的「進場」價位今天買不到。訊號本身仍然成立，但這檔不會列入波段驗證統計。">漲停鎖死・今天買不到</span>`
            : ""}
          ${warns}
          </div>
          <p class="swing-desc">${escapeHtml(pick.scenario?.desc || "")}</p>
        </div>
        ${reasonHtml}
        <div class="swing-facts">${factsHtml}</div>
        ${entryTipHtml}
      </div>
      <div class="swing-plan">
        <div class="swing-stat swing-stat-entry" title="建議進場價，預設＝當日收盤價，所以和右上角的收盤是同一個數字"><span>${glossLink("進場")}</span><strong>${formatNumber(pick.plan?.entry)}</strong></div>
        <div class="swing-stat" title="初始停損：進場後先設在收盤 −5%"><span>${glossLink("建議停損")} <i class="swing-stat-hint">−5%</i></span><strong>${formatNumber(pick.plan?.initialStop)}</strong></div>
        <div class="swing-stat" title="依支撐（擺動低點／布林下軌／月線）設的較大停損；盈虧比就是用它算的"><span>${glossLink("結構停損")}</span><strong>${formatNumber(pick.plan?.structuralStop)}</strong></div>
        <div class="swing-stat swing-stat-sub" title="進階：股價漲到此價（收盤 +5%）後，改用移動停利往上跟、鎖住獲利"><span>${glossLink("啟動移停")} <i class="swing-stat-hint">+5%</i></span><strong>${formatNumber(pick.plan?.trailingTrigger)}</strong></div>
        <div class="swing-stat" title="上方壓力或波段量測幅度推估的目標價${Number.isFinite(pick.plan?.nearestResistance)
          ? `。⚠ 上方 ${formatNumber(pick.plan.nearestResistance)} 還有一個更近的擺動高點，它太貼近收盤價（2% 內）所以不當目標用，但路上會先遇到它。`
          : ""}"><span>${glossLink("目標")}</span><strong>${formatNumber(pick.plan?.target)}</strong>${
          Number.isFinite(pick.plan?.nearestResistance) ? '<i class="swing-stat-hint is-warn">前有壓力</i>' : ""
        }</div>
        <div class="swing-stat swing-rr ${rrTone}" title="盈虧比＝(目標−進場)÷(進場−結構停損)。括號內是扣掉一買一賣手續費與證交稅之後的淨值，選股門檻用的是淨值（毛值會讓「剛好過關」的設定其實賠錢）"><span>${glossLink("盈虧比")}</span><strong>${Number.isFinite(rr) ? rr.toFixed(1) : "—"}${
          Number.isFinite(pick.plan?.rrNet) ? `<i class="swing-stat-hint">淨 ${pick.plan.rrNet.toFixed(1)}</i>` : ""
        }</strong></div>
      </div>
      ${riskRewardBar}
    </article>
  `;
}

const SWING_SCENARIO_INFO = {
  midBandDefense: { name: "中軌攻防", blurb: "回檔中軌站穩＋MACD 維持金叉", emptyHint: "可能整體偏強(個股多已噴出)，或還沒有回檔貼中軌的標的。" },
  strongContinuation: { name: "上軌續攻", blurb: "沿上軌強勢＋MACD 連續金叉", emptyHint: "可能盤勢轉弱，沿上軌的強勢股不足。" },
};

function swingScenarioInfo() {
  return SWING_SCENARIO_INFO[strategyState.scenario] || SWING_SCENARIO_INFO.midBandDefense;
}

// 把 ISO 時間轉成台北時間的 HH:MM（顯示榜單何時計算）。即使使用者人在國外，計算時間也以台股時區呈現。
function formatClockFromIso(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei",
    }).format(date);
  } catch {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
}

// 把 ISO 轉成台北時區的 MM/DD（標示「計算」是哪一天，避免被當成即時時鐘）。
function formatTaipeiDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const mm = parts.find((p) => p.type === "month")?.value;
    const dd = parts.find((p) => p.type === "day")?.value;
    return mm && dd ? `${mm}/${dd}` : "";
  } catch {
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  }
}

// 策略頁與全站輪詢共用同一個盤中邊界，避免 13:31–13:35 一處顯示盤中、另一處卻顯示已收盤。
function isTaiwanMarketOpenNow(date = new Date()) {
  return isTaiwanMarketSession(date);
}

// ===== 波段前向驗證成績單（各場景實際勝率）=====
// 隔日沖有成績單、波段以前沒有。後端每天把看板 picks 存成驗證單、逐日用官方高低價推進，
// 這裡只負責 lazy 載入 /api/swing/verify 並渲染統計＋最近結案明細。
const swingVerifyState = {
  data: null,
  loading: false,
  error: "",
  at: 0,
};

function loadSwingVerify() {
  const age = Date.now() - swingVerifyState.at;
  if (swingVerifyState.loading || (swingVerifyState.data && age < 10 * 60e3) || (swingVerifyState.error && age < 60e3)) return;
  swingVerifyState.loading = true;
  swingVerifyState.at = Date.now();
  fetchApi("/api/swing/verify")
    .then((payload) => {
      swingVerifyState.data = payload;
      swingVerifyState.error = "";
    })
    .catch((error) => {
      swingVerifyState.error = error.message || "載入失敗";
    })
    .finally(() => {
      swingVerifyState.loading = false;
      swingVerifyState.at = Date.now();
      renderSwingVerifyPanel();
    });
}

function swingScenarioName(key) {
  const fromBoard = (strategyState.scenarios || []).find((item) => item.key === key)?.name;
  if (fromBoard) return fromBoard;
  return { midBandDefense: "中軌攻防", strongContinuation: "上軌續攻" }[key] || key;
}

function renderSwingVerifyPanel() {
  const panel = el.swingVerify;
  if (!panel) return;
  if (state.screen !== "strategy") return; // 只在策略雷達頁維護
  const data = swingVerifyState.data;
  if (!data) {
    panel.hidden = true;
    return;
  }
  const scenarios = data.scenarios || [];
  const hasAny = scenarios.some((s) => s.samples > 0);
  const legacySamples = (data.formulaVersions || [])
    .filter((item) => item.formulaVersion !== data.currentFormulaVersion)
    .reduce((sum, item) => sum + Number(item.samples || 0), 0);
  panel.hidden = false;
  if (!hasAny) {
    panel.innerHTML = `
      <div class="sv-head"><strong>場景勝率（前向驗證）</strong><small>現版今天起自動記錄每天的選股，之後依官方日 K 逐日對答案。${legacySamples ? `舊公式 ${legacySamples} 筆已保留，但不混入現版勝率。` : "用幾週累積出各場景的實際勝率。"}</small></div>
    `;
    return;
  }
  // 標題列右側放驗證規則摘要（完整說明在 title）；卡片明細補「平均持有天數」——
  // 內容變密、寬度自然吃滿，版面才不會左邊一小條字、右邊大片空白。
  const chips = scenarios
    .map((s) => {
      const resolved = s.wins + s.losses + s.expired;
      // 樣本不足時不顯示百分比、也不染色——1 筆結案的「100%」在視覺上會跟累積數十筆的
      // 綠字長得一樣，那是誤導。改成把累積進度講出來，讓使用者知道還要等多久。
      const minSamples = Number(s.winRateMinSamples) || 20;
      const belowMinSamples = s.winRate == null && resolved > 0;
      const rate = s.winRate != null ? `${s.winRate}%` : belowMinSamples ? `累積中 ${resolved}/${minSamples}` : "--";
      const tone = s.winRate == null ? "" : s.winRate >= 50 ? "is-up" : "is-down";
      return `
        <div class="sv-chip">
          <div class="sv-chip-top">
            <strong>${escapeHtml(swingScenarioName(s.scenario))}</strong>
            <span class="sv-rate ${tone}"><small>勝率</small> ${rate}</span>
          </div>
          <small>結案 ${resolved}（達標 ${s.wins}・停損 ${s.losses}・超時 ${s.expired}）・追蹤中 ${s.pending}${s.stalled ? `<span class="sv-stalled" title="這些單因官方日 K 長期缺漏而停在缺口前，不會自行結案，也永遠不會進入上面的勝率分母。">（含卡住 ${s.stalled}）</span>` : ""}${s.avgResultPct != null ? `・平均 ${s.avgResultPct >= 0 ? "+" : ""}${s.avgResultPct}%${s.avgResultPctNet != null ? `（淨 ${s.avgResultPctNet >= 0 ? "+" : ""}${s.avgResultPctNet}%）` : ""}` : ""}${s.avgDaysHeld != null ? `・平均持有 ${s.avgDaysHeld} 天` : ""}</small>
        </div>`;
    })
    .join("");
  const recentAll = data.recent || [];
  const recentLimit = 10;
  const recentRows = recentAll
    .slice(0, recentLimit)
    .map((r) => {
      const label = r.status === "win" ? "達標" : r.status === "loss" ? "停損" : "超時";
      const tone = (r.resultPct || 0) >= 0 ? "is-up" : "is-down";
      return `
        <div class="sv-row">
          <span>${r.resolvedAt ? `${String(r.resolvedAt).slice(4, 6)}/${String(r.resolvedAt).slice(6, 8)}` : "--"}</span>
          <span class="sv-name">${escapeHtml(r.name || r.code)} ${r.code}</span>
          <span>${escapeHtml(swingScenarioName(r.scenario))}</span>
          <span class="sv-outcome ${tone}">${label} ${r.resultPct != null ? `${r.resultPct >= 0 ? "+" : ""}${r.resultPct}%` : ""}</span>
        </div>`;
    })
    .join("");
  panel.innerHTML = `
    <div class="sv-head">
      <strong>場景勝率（前向驗證）</strong>
      <small title="每天的選股依官方日 K 逐日對答案：先碰目標＝達標、先碰結構停損＝停損；同一天兩邊都碰到，保守記停損。漏開 App 會按日期補判，中間缺 K 則停住、不跳日。&#10;處置期間的標的是分盤集合競價（每 5 或 20 分鐘撮合一次），日 K 的最高／最低價只是幾十次撮合的極值，掛在停損／目標的單未必真的撮得到；這些樣本仍計入勝率，但會單獨標出筆數。&#10;除權息當天若官方比率還沒發布（計算結果表約次一營業日才有），該單會暫停推進而不是拿事件前的停損價去比事件後的價格；等比率到齊會自動接著判，觀察天數不會被吃掉。">官方日 K 逐日補驗・雙觸保守記停損${data.dataGapCount ? `・${data.dataGapCount} 筆待補缺口` : ""}${data.corporateActionPendingCount ? `・${data.corporateActionPendingCount} 筆等官方除權息比率` : ""}${data.periodicCallCount ? `・${data.periodicCallCount} 筆分盤撮合` : ""}${legacySamples ? `・舊版 ${legacySamples} 筆另存` : ""}</small>
    </div>
    <div class="sv-chips">${chips}</div>
    ${recentRows ? `
      <details class="sv-details">
        <summary>最近 ${Math.min(recentLimit, recentAll.length)} 筆結案${recentAll.length > recentLimit ? `（共 ${recentAll.length} 筆）` : ""}</summary>
        ${recentRows}
      </details>` : ""}
  `;
}

function renderStrategyBoard() {
  // 場景勝率面板：進到策略雷達頁才 lazy 載入（10 分鐘內不重抓）。
  if (state.screen === "strategy") {
    loadSwingVerify();
    renderSwingVerifyPanel();
  }
  // 分頁標上各場景今天的命中數（資料現成：後端一次掃描已對每檔跑過所有場景偵測）。
  const scenarioCounts = {};
  (strategyState.scenarios || []).forEach((item) => { scenarioCounts[item.key] = item.count; });
  document.querySelectorAll("[data-swing-scenario]").forEach((button) => {
    const key = button.dataset.swingScenario;
    button.classList.toggle("is-active", key === strategyState.scenario);
    let badge = button.querySelector(".segment-count");
    if (Object.prototype.hasOwnProperty.call(scenarioCounts, key)) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "segment-count";
        button.appendChild(badge);
      }
      const count = scenarioCounts[key] || 0;
      badge.textContent = count;
      badge.classList.toggle("is-zero", count === 0);
    } else if (badge) {
      badge.remove();
    }
  });
  const info = swingScenarioInfo();
  if (el.strategyMeta) {
    const genClock = formatClockFromIso(strategyState.generatedAt);
    const genDateRaw = formatTaipeiDate(strategyState.generatedAt);
    const generatedToday = genDateRaw && genDateRaw === formatTaipeiDate(new Date().toISOString());
    const intraday = isTaiwanMarketOpenNow();
    // 計算時間的副標：盤中時強調「不變動」，盤後則標「本日凍結」——都在說明這份榜單一天只算一次、不會即時跳。
    const timeSub = intraday ? "盤中不變動" : generatedToday ? "本日凍結" : "已凍結";
    const timeTitle = `這份榜單於 ${genDateRaw || "--"} ${genClock} 算出（台北時間），採用 ${strategyState.asOf || "--"} 的官方收盤資料。同一基準日只算一次；要重算請按右下角「重新整理」。`;
    // 基準日用 MM/DD（與卡片「06/16 收盤」同格式、較精簡）；完整日期放 title。
    const asOfStr = String(strategyState.asOf || "");
    const baseMD = asOfStr.length >= 10 ? `${asOfStr.slice(5, 7)}/${asOfStr.slice(8, 10)}` : (asOfStr || "--");
    el.strategyMeta.innerHTML = strategyState.loaded
      ? `
        <div class="strategy-statpanel">
          <div class="strategy-statbar">
            <span class="m" title="從流動性最好的 ${strategyState.candidateCount || "—"} 檔全市場個股中（依當日成交量每日重選、非固定名單），掃出符合型態的 ${strategyState.matchedCount} 檔（畫面顯示前 ${strategyState.picks.length} 檔）">命中 <span class="m-v">${strategyState.matchedCount}</span>／${strategyState.candidateCount || "—"} 檔</span>
            <span class="m-sep" aria-hidden="true"></span>
            <span class="m" title="這份榜單依據的官方收盤基準日：${strategyState.asOf || "--"}"><span class="m-v">${baseMD}</span> 收盤</span>
            ${genClock ? `<span class="m-sep" aria-hidden="true"></span><span class="m" title="${timeTitle}">計算 <span class="m-v">${genDateRaw ? `${genDateRaw} ` : ""}${genClock}</span></span>` : ""}
            <span class="m-sep" aria-hidden="true"></span>
            <span class="m" title="注意股／處置股改為標示、不再排除（可在『更多 → 風險規則』切換隱藏）；低流動性個股仍先濾掉">${state.showSurveillance ? `含 <span class="m-v2">注意／處置股</span>` : `已隱藏 <span class="m-v2">注意／處置股</span>`}</span>
            <span class="m-sep" aria-hidden="true"></span>
            <span class="m m-note" title="波段型態當日收盤凍結（非即時）——這份榜單一天只算一次、盤中不會跳動；內容為技術統計，非買賣建議。"><span class="note-ic" aria-hidden="true">ⓘ</span>收盤凍結・非買賣建議</span>
          </div>
        </div>
      `
      : `<p class="strategy-meta-note">${info.blurb}的波段標的，附進場／停損／目標／盈虧比參考。</p>`;
  }
  if (!el.strategyBoard) return;
  if (strategyState.loading) {
    el.strategyBoard.innerHTML = `<div class="strategy-empty is-loading"><span class="mini-spinner" aria-hidden="true"></span><strong>正在掃描全市場計算「${info.name}」型態…</strong><small>第一次計算需要數十秒，之後當天會直接用快取。</small></div>`;
    return;
  }
  if (strategyState.error) {
    el.strategyBoard.innerHTML = `<div class="strategy-empty is-error">策略雷達計算失敗<small>${escapeHtml(strategyState.error)}</small></div>`;
    return;
  }
  if (strategyState.loaded && !strategyState.picks.length) {
    el.strategyBoard.innerHTML = `<div class="strategy-empty">今天沒有符合「${info.name}」的標的。<small>${info.emptyHint}可切換另一個場景，或按右下角「重新整理」再算一次。</small></div>`;
    return;
  }
  if (!strategyState.loaded) {
    el.strategyBoard.innerHTML = `<div class="strategy-empty">切到這頁會自動計算波段型態。<small>若沒有自動開始，按右下角「重新整理」。</small></div>`;
    return;
  }
  const visiblePicks = strategyState.picks.filter((pick) => state.showSurveillance || !pick.surveillance);
  // 後端一直有回 warnings（掃描覆蓋率、公司行動未定案、單一市場、last-good…），
  // 前端也一直存進 strategyState.warnings——但**全檔沒有任何讀取點**，等於沒做。
  // server.mjs 組裝這批 warnings 的地方自己寫著：「這個失敗模式在開發期間三天內出現三次
  // （證交所限流），而且畫面上完全沒有跡象」。
  //
  // 沒有它的後果不是少一行字：證交所限流那天，看板照樣列出十幾檔、每張卡片照樣寫
  // 「進場 X／停損 Y／目標 Z／盈虧比 2.0」，而那些均線、布林、MACD 是跑在**沒還原權息**的
  // 價格上——與正常日完全無法分辨。
  const boardWarnings = (strategyState.warnings || []).filter(Boolean);
  const warningHtml = boardWarnings.length
    ? `<div class="strategy-empty is-error" role="status">
        <strong>這次掃描有 ${boardWarnings.length} 項資料品質問題，下面的名單可能不完整或不準確</strong>
        <small>${escapeHtml(boardWarnings.slice(0, 3).join("；"))}${boardWarnings.length > 3 ? `（另有 ${boardWarnings.length - 3} 則）` : ""}</small>
      </div>`
    : "";
  el.strategyBoard.innerHTML = warningHtml + (visiblePicks.length
    ? visiblePicks.map(renderSwingCard).join("")
    : `<div class="strategy-empty">這個場景今天的標的都是注意/處置股，已被你隱藏。<small>到「更多 → 風險規則」可重新顯示。</small></div>`);
}

// === 策略雷達：個股波段型態健檢（搜尋任意股票 → 逐條檢核 + 交易計畫）===
const strategyInspectState = { loading: false, error: "", data: null, query: "" };

async function loadStrategyInspect(query) {
  const q = String(query || "").trim();
  if (!q) return;
  strategyInspectState.loading = true;
  strategyInspectState.error = "";
  strategyInspectState.query = q;
  renderStrategyInspect();
  try {
    const payload = await fetchApi(`/api/swing/inspect?code=${encodeURIComponent(q)}`);
    if (!payload.ok) throw new Error(payload.error || "查無資料");
    strategyInspectState.data = payload;
  } catch (error) {
    if (handleAuthRequired(error)) return;
    strategyInspectState.data = null;
    strategyInspectState.error = error.message || "健檢失敗";
  } finally {
    strategyInspectState.loading = false;
    renderStrategyInspect();
  }
}

function clearStrategyInspect() {
  strategyInspectState.data = null;
  strategyInspectState.error = "";
  strategyInspectState.query = "";
  const input = document.getElementById("strategyInspectInput");
  if (input) input.value = "";
  renderStrategyInspect();
}

function renderStrategyInspect() {
  const host = document.getElementById("strategyInspectResult");
  if (!host) return;
  const st = strategyInspectState;
  if (!st.loading && !st.error && !st.data) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  if (st.loading) {
    host.innerHTML = `<div class="strategy-empty is-loading"><span class="mini-spinner" aria-hidden="true"></span><strong>健檢「${escapeHtml(st.query)}」的波段型態…</strong></div>`;
    return;
  }
  if (st.error) {
    host.innerHTML = `<div class="inspect-card inspect-error"><button class="inspect-close" type="button" data-inspect-close aria-label="關閉">✕</button><strong>查不到「${escapeHtml(st.query)}」</strong><small>${escapeHtml(st.error)}</small></div>`;
    return;
  }
  host.innerHTML = renderInspectCard(st.data);
}

function renderInspectCard(d) {
  const v = d.verdict || {};
  const vClass = v.status === "match" ? "is-match" : v.status === "near" ? "is-near" : "is-none";
  const vIcon = v.status === "match" ? "✅" : v.status === "near" ? "⚠️" : "❌";
  const vText = v.status === "match"
    ? `符合 ${v.name}`
    : v.status === "near"
      ? `接近 ${v.name}（差 ${v.failCount} 項）`
      : "目前不符合任一波段型態";
  const changeTone = toneFromNet(d.changePct);
  const md = String(d.asOf || "").slice(5).replace("-", "/");
  const labelClass = d.stale ? "swing-price-label is-lagged" : "swing-price-label";
  const labelTitle = d.stale
    ? `這檔官方收盤資料目前到 ${d.asOf}（比大盤晚一個交易日）`
    : "當日官方收盤價";

  const scenarioBlocks = (d.scenarios || []).map((s) => {
    const sIcon = s.passed ? "✅" : s.failCount <= 2 ? "⚠️" : "❌";
    const sStat = s.passed ? "符合" : `差 ${s.failCount} 項`;
    const items = (s.checks || []).map((c) =>
      `<li class="${c.pass ? "ok" : "no"}"><span class="ic" aria-hidden="true">${c.pass ? "✓" : "✗"}</span><span class="lb">${escapeHtml(c.label)}</span><span class="dt">${escapeHtml(c.detail || "")}</span></li>`
    ).join("");
    return `<div class="inspect-scenario ${s.passed ? "is-pass" : ""}">
        <div class="inspect-scenario-head"><strong>${glossLink(s.name)}</strong><span class="inspect-scenario-stat ${s.passed ? "ok" : "no"}">${sIcon} ${sStat}</span></div>
        <ul class="inspect-checks">${items}</ul>
      </div>`;
  }).join("");

  const rr = Number(d.rr);
  const rrTone = !Number.isFinite(rr) ? "rr-na" : rr >= 2 ? "rr-high" : rr >= 1 ? "rr-mid" : "rr-low";
  const entry = Number(d.plan?.entry);
  const stop = Number(d.plan?.structuralStop);
  const target = Number(d.plan?.target);
  const risk = Math.max(0, entry - stop);
  const reward = Math.max(0, target - entry);
  const rrBar = risk > 0 && reward > 0
    ? `<div class="swing-rrbar" aria-hidden="true">
        <span class="swing-rrbar-tag loss">停損 ${formatNumber(stop)}</span>
        <span class="swing-rrbar-track"><i class="loss" style="flex:${risk.toFixed(2)}"></i><b class="swing-rrbar-entry"></b><i class="gain" style="flex:${reward.toFixed(2)}"></i></span>
        <span class="swing-rrbar-tag gain">目標 ${formatNumber(target)}</span>
      </div>`
    : "";

  return `
    <article class="inspect-card">
      <button class="inspect-close" type="button" data-inspect-close aria-label="關閉">✕</button>
      <div class="inspect-verdict ${vClass}">
        <span class="inspect-verdict-ic" aria-hidden="true">${vIcon}</span>
        <span class="inspect-verdict-tx">${vText}</span>
        <span class="inspect-verdict-score">型態分 ${Math.round(Number(d.score) || 0)}</span>
      </div>
      <div class="swing-head">
        <div class="swing-headline">
          <strong class="swing-nm">${escapeHtml(d.name)}</strong>
          <span class="swing-code">${d.code}</span>
          <span class="swing-market">${escapeHtml(d.market || "")}</span>
          <span class="swing-quote-inline">
            <span class="${labelClass}" title="${labelTitle}">${md} 收盤</span>
            <span class="swing-price">${formatNumber(d.price)}</span>
            <span class="swing-chg ${changeTone}">${formatSignedPercent(d.changePct)}</span>
          </span>
        </div>
      </div>
      <div class="inspect-scenarios">${scenarioBlocks}</div>
      <p class="inspect-foot"><span class="ic-ok">✓</span> 通過　<span class="ic-no">✗</span> 未達成　·　σ＝離中軌的標準差（0＝貼中軌、2＝貼上軌）</p>
      <div class="inspect-plan-label">交易計畫<small>不論是否符合都試算給你參考</small></div>
      <div class="swing-plan">
        <div class="swing-stat swing-stat-entry"><span>${glossLink("進場")}</span><strong>${formatNumber(d.plan?.entry)}</strong></div>
        <div class="swing-stat"><span>${glossLink("建議停損")} <i class="swing-stat-hint">−5%</i></span><strong>${formatNumber(d.plan?.initialStop)}</strong></div>
        <div class="swing-stat"><span>${glossLink("結構停損")}</span><strong>${formatNumber(d.plan?.structuralStop)}</strong></div>
        <div class="swing-stat swing-stat-sub"><span>${glossLink("啟動移停")} <i class="swing-stat-hint">+5%</i></span><strong>${formatNumber(d.plan?.trailingTrigger)}</strong></div>
        <div class="swing-stat"><span>${glossLink("目標")}</span><strong>${formatNumber(d.plan?.target)}</strong></div>
        <div class="swing-stat swing-rr ${rrTone}"><span>${glossLink("盈虧比")}</span><strong>${Number.isFinite(rr) ? rr.toFixed(1) : "—"}</strong></div>
      </div>
      ${rrBar}
      <button class="inspect-open" type="button" data-swing-code="${d.code}">查看完整個股詳情 →</button>
    </article>
  `;
}

function getActiveStrategyMeta() {
  for (const [universe, list] of Object.entries(strategies)) {
    const index = list.indexOf(state.strategy);
    if (index >= 0) {
      return { universe, index };
    }
  }
  return { universe: state.universe, index: -1 };
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
}

function recentTrendPercent(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length < 2 || !usable[0]) return 0;
  return ((usable.at(-1) - usable[0]) / usable[0]) * 100;
}

function standardDeviation(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length < 2) return 0;
  const mean = average(usable);
  const variance = average(usable.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function getStrategyScore(stock) {
  const { universe, index } = getActiveStrategyMeta();
  const spark = Array.isArray(stock.spark) ? stock.spark.map(Number).filter(Number.isFinite) : [];
  const last = spark.at(-1) || Number(stock.price) || 0;
  const recent = spark.slice(-10);
  const mean = average(recent);
  const deviation = standardDeviation(recent) || Math.max(Math.abs(mean) * 0.01, 1);
  const trend = recentTrendPercent(spark);
  const ma3 = average(spark.slice(-3));
  const ma8 = average(spark.slice(-8));
  const maBias = ma8 ? ((ma3 - ma8) / ma8) * 100 : 0;
  const bandPosition = deviation ? (last - mean) / deviation : 0;
  const change = Number(stock.change) || 0;
  const positive = Math.max(0, change);
  const negative = Math.max(0, -change);
  const flow = Number(stock.flow) || 0;
  const streak = Number(stock.streak) || 0;
  const turnover = Number(stock.turnover) || 0;
  const avgVol = Number(stock.avgVol) || 0;
  const stage = Number(stock.stage) || 0;
  const slope = Number(stock.slope) || 0;
  const flowBoost = Math.log10(Math.max(flow, 1));
  const streakBoost = Math.log10(Math.max(streak, 1));

  if (universe === "strong") {
    const scores = [
      positive * 10 + avgVol * 10 + flowBoost * 18 + trend * 1.2,
      flowBoost * 26 + streakBoost * 16 + turnover * 0.45 + positive * 3,
      trend * 5 + maBias * 10 + stage * 2.4 + slope * 1.8,
      positive * 12 + trend * 4 + avgVol * 8 + Math.max(0, slope) * 1.6,
      bandPosition * 28 + positive * 5 + avgVol * 7 + Math.max(0, maBias) * 8,
      positive * 8 + avgVol * 14 + flowBoost * 20 + Math.abs(change) * 3,
      (change >= -3 && change <= 5 ? 26 : 0) + Math.max(0, maBias) * 12 + trend * 2 + stage * 2,
      Math.max(0, -bandPosition) * 30 + negative * 8 + Math.max(0, maBias) * 6,
    ];
    return scores[index] ?? scores[0];
  }

  if (universe === "weak") {
    const scores = [
      negative * 10 + avgVol * 8 + flowBoost * 18,
      flowBoost * 24 + streakBoost * 14 + negative * 4,
      negative * 8 + Math.max(0, -maBias) * 12 + Math.max(0, -trend) * 4,
      Math.max(0, -maBias) * 14 + negative * 7 + flowBoost * 12,
      Math.max(0, -bandPosition) * 26 + negative * 5 + avgVol * 7,
      positive * 8 + Math.max(0, -maBias) * 10 + avgVol * 10,
    ];
    return scores[index] ?? scores[0];
  }

  if (universe === "intraday") {
    const scores = [
      stockIntradayScore(stock),
      positive * 16 + avgVol * 10 + Math.max(0, trend) * 8 + flowBoost * 14,
      negative * 16 + avgVol * 10 + Math.max(0, -trend) * 8 + flowBoost * 14,
    ];
    return scores[index] ?? scores[0];
  }

  if (universe === "turnover") {
    const scores = [
      turnover * 2.2 + avgVol * 10 + flowBoost * 18 + positive * 2,
      avgVol * 14 + Math.abs(change) * 7 + flowBoost * 18 + turnover,
      (stock.groups.includes("overnight") ? 28 : 0) + positive * 8 + avgVol * 9 + flowBoost * 16,
      avgVol * 12 + Math.abs(change) * 6 + flowBoost * 16 + streakBoost * 8,
    ];
    return scores[index] ?? scores[0];
  }

  return flow;
}

function getSortValue(stock, key, screen = state.screen) {
  if (key === "strategy" && screen === "screener") {
    return getStrategyScore(stock);
  }
  // 每欄的排序依據＝表頭上有箭頭標記的那個字（標的代號／漲跌幅／最高／總量／週轉率）。
  const map = {
    signal: Number(stock.code) || 0,
    price: Number(stock.change) || 0,
    stage: stock.high != null && Number.isFinite(Number(stock.high)) ? Number(stock.high) : Number(stock.price) || 0,
    flow: Number(stock.total) || 0,
    turnover: Number(stock.turnover) || 0,
  };
  return map[key] ?? (Number(stock.total) || 0);
}

function filterStocks(screen) {
  let list = [...stocks];

  if (screen === "watchlist") {
    list = getActiveWatchStocks().filter((stock) => stockMatchesWatchFilter(stock));
  } else if (screen === "overnight") {
    list = list.filter((stock) => stock.groups.includes("overnight"));
  } else if (screen === "screener") {
    const activeStrategies = strategies[state.universe] || [];
    if (activeStrategies.includes(state.strategy)) {
      list = list.filter((stock) => stockMatchesStrategy(stock, state.strategy));
    } else {
      list = list.filter((stock) => stock.groups.includes(state.universe));
    }
  } else {
    list = list.filter((stock) => stock.groups.includes(state.universe));
  }

  if (screen !== "watchlist") {
    // 關閉開關時，把注意/處置/全額交割股藏起來（預設顯示）。自選股分頁不受影響。
    if (!state.showSurveillance) {
      list = list.filter((stock) => !stock.surveillance);
    }
    if (state.direction === "up") {
      list = list.filter((stock) => stock.change > 0);
    }
    if (state.direction === "down") {
      list = list.filter((stock) => stock.change < 0);
    }
    if (state.watchOnly) {
      list = list.filter((stock) => isInAnyWatchList(stock.code));
    }
    if (state.minTurnover > 0) {
      list = list.filter((stock) => stock.turnover >= state.minTurnover);
    }
  }

  return list.sort((a, b) => {
    const first = getSortValue(a, state.sort, screen);
    const second = getSortValue(b, state.sort, screen);
    const diff = state.sortDir === "desc" ? second - first : first - second;
    if (diff !== 0) return diff;
    return a.code.localeCompare(b.code, "zh-Hant");
  });
}

function sparkline(points, change) {
  const width = 86;
  const height = 50;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const d = points
    .map((point, index) => {
      const x = (index / (points.length - 1 || 1)) * (width - 4) + 2;
      const y = height - 5 - ((point - min) / range) * (height - 12);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const direction = signedDirection(change);
  const color = direction > 0 ? "var(--red)" : direction < 0 ? "var(--green)" : "#aab4be";
  return `
    <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <line class="spark-base" x1="2" x2="${width - 2}" y1="${height / 2}" y2="${height / 2}"></line>
      <path class="spark-line" d="${d}" stroke="${color}"></path>
    </svg>
  `;
}

// 理由欄只放「別的欄位沒有」的資訊：漲跌幅、量比旁邊欄位都看得到，
// 塞數字進來只會重複又被截斷。
function getStockReason(stock, screen = state.screen) {
  const trend = recentTrendPercent(stock.spark || []);
  const avgVol = Number(stock.avgVol) || 0;

  if (screen === "watchlist") {
    if (Math.abs(stock.change) >= 5) return "最新交易日波動較大";
    if (trend >= 3) return "短線轉強";
    if (trend <= -3) return "短線轉弱";
    return "自選追蹤";
  }

  if (screen === "overnight") {
    const label = formatStrategyLabel(stock.strategies?.[0] || "") || "隔日沖訊號";
    if (avgVol >= 3) return `${label} ・ 爆量`;
    if (stock.change >= 5) return `${label} ・ 收盤強`;
    return label;
  }

  if (state.universe === "intraday") {
    if (stock.change >= 3) return "盤中急漲";
    if (stock.change <= -3) return "盤中急跌";
    if (avgVol >= 2) return "盤中放量";
    return "盤中異動";
  }

  if (state.universe === "weak") {
    if (stock.change <= -3) return "跌幅偏深";
    if (trend < 0) return "短線走弱";
    return "風險觀察";
  }

  if (state.universe === "turnover") {
    return avgVol >= 2 ? "換手熱絡" : "量能觀察";
  }

  if (avgVol >= 1.5 && stock.change > 0) return "放量上攻";
  if (trend > 1) return "短線向上";
  if (stock.change > 0) return "紅盤整理";
  return "等待轉強";
}

// 注意/處置/全額交割標籤：badge 顯示主標籤，處置/全額交割另帶短註（手機看得到），
// 完整說明（分盤撮合・預收款券・多不可當沖）放 title。
function renderSurveillanceBadge(info) {
  if (!info) return "";
  const shortNote = info.kind === "disposition" ? "分盤・預收" : info.kind === "changed" ? "預收全額" : "";
  const tip = info.label + (info.note ? `：${info.note}` : "");
  return `<span class="surv-tag is-${info.kind}" title="${escapeHtml(tip)}">${escapeHtml(info.label)}</span>${shortNote ? `<small class="surv-note">${escapeHtml(shortNote)}</small>` : ""}`;
}

function rowTemplate(stock, screen = state.screen) {
  // priceStale 只表示這筆是官方收盤／昨收，不代表漲跌方向消失。
  // 收盤相對昨收仍是有效的台股紅漲綠跌；新鮮度由「收盤」文字揭露。
  const movement = toneFromNet(stock.change);
  const hotChip = Math.abs(stock.change) > 9.7 ? (stock.change >= 0 ? "hot-red" : "hot-green") : "";
  const kbarSignal = stock.signal || signalFromChange(stock.change);
  const quoteChange = formatSignedPercent(stock.change);
  const selected = stock.code === state.selectedCode ? "is-selected" : "";
  const marked = state.watchSelection.has(stock.code) ? "is-marked" : "";
  const reason = getStockReason(stock, screen);
  const sparkValues = (stock.spark || []).map(Number).filter(Number.isFinite);
  const dayHigh = Number.isFinite(Number(stock.high)) ? Number(stock.high) : (sparkValues.length ? Math.max(...sparkValues) : null);
  const dayLow = Number.isFinite(Number(stock.low)) ? Number(stock.low) : (sparkValues.length ? Math.min(...sparkValues) : null);
  const cells = `
    <span class="stock-cell stock-main">
      <span class="kbar ${kbarSignal}"></span>
      <span class="stock-name">
        <strong>${escapeHtml(stock.name)}</strong>
        <span>${stock.code}${alertsForCode(stock.code).some((alert) => alert.active) ? `<span class="alert-bell" title="已設到價提醒">🔔</span>` : ""}</span>
        <small class="stock-reason">${escapeHtml(reason)}</small>
        ${stock.surveillance ? `<span class="surv-line">${renderSurveillanceBadge(stock.surveillance)}</span>` : ""}
      </span>
    </span>
    <span class="stock-cell quote-value ${movement} ${stock.priceStale ? "is-stale" : ""}">
      <span class="quote-price"><span class="price-chip ${hotChip}">${formatQuotePrice(stock.price)}</span></span>
      <span class="quote-change">${stock.priceStale ? '<small class="quote-kind">收盤</small>' : ""}<span>${quoteChange}</span></span>
    </span>
    <span class="stock-cell metric-stack">
      <span class="positive">${formatOptionalNumber(dayHigh)}</span>
      <span class="negative">${formatOptionalNumber(dayLow)}</span>
    </span>
    <span class="stock-cell metric-stack ${movement}">
      <span>${formatOptionalNumber(stock.unit)}</span>
      <span class="flow-split"></span>
      <span class="${stock.total > 5000 ? "flow-pill" : ""}">${formatOptionalNumber(stock.total)}</span>
    </span>
    <span class="stock-cell metric-stack">
      <span>${stock.turnover ? `${formatNumber(stock.turnover)}%` : "--"}</span>
      <span class="${stock.avgVol >= 1 ? movement : ""}">${stock.avgVol ? formatNumber(stock.avgVol) : "--"}</span>
    </span>
    <span class="stock-cell spark-cell">${sparkline(stock.spark, stock.change)}</span>
  `;

  if (screen === "watchlist") {
    const editClass = state.watchEditMode ? "is-editing" : "";
    const action = state.watchEditMode
      ? `<button class="watch-select-box ${marked}" data-watch-select="${stock.code}" type="button" aria-pressed="${state.watchSelection.has(stock.code)}" aria-label="${state.watchSelection.has(stock.code) ? "取消選取" : "選取"} ${escapeHtml(stock.name)}">
          <i data-lucide="${state.watchSelection.has(stock.code) ? "check" : "square"}"></i>
        </button>`
      : "";
    return `
      <div class="stock-row watch-stock-row ${editClass} ${selected} ${marked}" data-code="${stock.code}">
        <button class="watch-row-select" type="button" data-code="${stock.code}" aria-label="查看 ${escapeHtml(stock.name)} ${stock.code}">
          ${cells}
        </button>
        ${action}
      </div>
    `;
  }

  return `
    <button class="stock-row ${selected}" type="button" data-code="${stock.code}">
      ${cells}
    </button>
  `;
}

function renderWatchEmptyState() {
  const activeCount = getActiveWatchStocks().length;
  const title = activeCount ? `${getWatchFilterLabel()}沒有符合的自選股` : `清單 ${state.watchList} 還沒有股票`;
  const hint = activeCount
    ? "切回「全部」或調整篩選，就能看到完整清單。"
    : "加入常看的股票後，這裡會顯示即時走勢與漲跌狀態。";
  const action = activeCount
    ? `<button data-watch-filter="all" type="button">看全部</button>`
    : `<button data-empty-watch-add type="button">加入股票</button>`;
  return `
    <div class="empty-state watch-empty-state">
      <strong>${title}</strong>
      <span>${hint}</span>
      ${action}
    </div>
  `;
}

function renderRows(container, list, screen = state.screen) {
  if (!list.length) {
    // 還在第一次載入時顯示載入中，避免被誤會成「真的沒有符合的股票」。
    if (!dataState.loadedOnce && !stocks.length && !dataState.error) {
      container.innerHTML = `<div class="empty-state">行情載入中，正在抓官方報價…</div>`;
      return;
    }
    if (dataState.error && !stocks.length) {
      container.innerHTML = `<div class="empty-state">行情載入失敗：${escapeHtml(dataState.error)}<br />請按右下角「重新整理」再試一次。</div>`;
      return;
    }
    container.innerHTML = screen === "watchlist"
      ? renderWatchEmptyState()
      : `<div class="empty-state">沒有符合條件的標的</div>`;
    return;
  }
  container.innerHTML = list.map((stock) => rowTemplate(stock, screen)).join("");
}

function renderStrategies() {
  const list = strategies[state.universe] || strategies.strong;
  if (!list.includes(state.strategy)) {
    state.strategy = list[0];
  }
  el.strategyStrip.innerHTML = list
    .map((item) => `<button class="${item === state.strategy ? "is-active" : ""}" data-strategy="${item}" type="button">
      <span>${item}</span>
      <small>${countStrategyMatches(item)}</small>
    </button>`)
    .join("");
}

function renderStrategyInfo() {
  if (!el.strategyInfo) return;
  if (state.screen !== "screener") {
    el.strategyInfo.hidden = true;
    return;
  }
  const meta = getStrategyMeta(state.strategy);
  const count = filterStocks("screener").length;
  el.strategyInfo.hidden = false;
  el.strategyInfo.innerHTML = `
    <strong>${state.strategy}</strong>
    <span>${meta?.description || "本機推估策略，尚未接完整官方策略資料。"}</span>
    <small>符合 ${count} 檔 ・ 觀察池共 ${stocks.length} 檔（自選＋訊號＋預設清單，非全市場掃描）・ 價格以官方行情為準</small>
  `;
}

// ===== 處置看板：即將處置／處置中／即將出關／鉅額交易／注意股 =====
function surveillanceNeedsReload() {
  return !surveillanceBoardState.loading &&
    (!surveillanceBoardState.loaded || surveillanceBoardState.loadedDate !== getTaiwanClockParts().isoDate);
}

async function loadSurveillanceBoard({ notify = false } = {}) {
  if (surveillanceBoardState.loading) return;
  surveillanceBoardState.loading = true;
  surveillanceBoardState.error = "";
  renderSurveillanceScreen();
  try {
    const payload = await fetchApi("/api/surveillance-board");
    if (!payload.ok) throw new Error(payload.error || "處置看板資料產生失敗");
    surveillanceBoardState.data = payload;
    surveillanceBoardState.asOf = payload.asOf || "";
    surveillanceBoardState.loaded = true;
    surveillanceBoardState.loadedDate = getTaiwanClockParts().isoDate;
    maybeAlertMineNewlyListed(payload);
    if (notify) showToast("處置看板已更新");
  } catch (error) {
    if (handleAuthRequired(error)) return;
    surveillanceBoardState.error = error.message;
    if (notify) showToast("處置看板更新失敗");
  } finally {
    surveillanceBoardState.loading = false;
    renderSurveillanceScreen();
  }
}

function survStatusLine(item, tab) {
  const period = (item.startSlash && item.endSlash)
    ? `<span class="surv-period">處置 ${item.startSlash.slice(5)}–${item.endSlash.slice(5)}</span>` : "";
  if (tab === "aboutToDispose") {
    const start = item.startSlash?.slice(5) || "";
    const when = item.startsNextTradingDay
      ? `下一交易日 ${start} 起處置`
      : start ? `${start} 起處置` : "即將進入處置";
    return `<span class="surv-when is-soon">${when}</span>${period}`;
  }
  if (tab === "inDisposition" || tab === "aboutToRelease") {
    const end = item.endSlash?.slice(5) || "";
    const out = Number(item.daysToRelease) === 0
      ? "今日為處置最後一日"
      : item.releaseOnNextTradingDay
        ? `處置至下一交易日 ${end}`
        : end ? `處置至 ${end}` : "處置期間內";
    return `<span class="surv-when ${item.releaseSoon ? "is-release" : "is-in"}">${out}</span>${period}`;
  }
  if (tab === "blockTrades") {
    return `<span class="surv-when is-block">鉅額 ${item.count} 筆 · 共 ${item.valueYi} 億</span>`;
  }
  if (tab === "attention") {
    const reason = String(item.reason || "").replace(/\s+/g, "").slice(0, 24);
    return `<span class="surv-when is-attn">注意 · 累計 ${item.count} 次</span>${reason ? `<span class="surv-period surv-reason">${escapeHtml(reason)}</span>` : ""}`;
  }
  if (tab === "changedTrading") {
    const extra = item.periodic ? " · 兼分盤" : "";
    return `<span class="surv-when is-changed">全額交割${extra}</span><span class="surv-period">預收全額款券</span>`;
  }
  return "";
}

// 卡片左側色條＋狀態文字共用的「狀態分類鍵」：紅=即將處置、橘=處置中、青=即將出關、紫=鉅額、黃=注意。
function survStatusKey(item, tab) {
  if (tab === "aboutToDispose") return "soon";
  if (tab === "inDisposition" || tab === "aboutToRelease") return item.releaseSoon ? "release" : "in";
  if (tab === "blockTrades") return "block";
  if (tab === "attention") return "attn";
  if (tab === "changedTrading") return "changed";
  return "in";
}

function survCard(item, tab) {
  const price = Number.isFinite(item.price) ? formatNumber(item.price) : "--";
  const compactPriceClass = price.length >= 5 ? " is-compact" : "";
  const chg = Number.isFinite(item.changePct) ? formatSignedPercent(item.changePct) : "";
  const tone = toneFromNet(item.changePct);
  const ivBadge = item.interval ? `<span class="surv-iv">${item.interval}分盤</span>` : "";
  const mkt = formatExchangeLabel(item.exchange);
  const mktBadge = mkt ? `<span class="surv-market">${escapeHtml(mkt)}</span>` : "";
  const key = survStatusKey(item, tab);
  const mine = isInAnyWatchList(item.code);
  const newBadge = item.isNew
    ? `<span class="surv-tagbit is-new" title="${escapeHtml(item.newLabel || "較上次成功紀錄新增")}">新</span>`
    : "";
  const hotBadge = (tab === "attention" && item.nearDisposition)
    ? '<span class="surv-tagbit is-hot" title="注意累計次數偏高或持續升溫，較可能進入處置（僅供參考）">升溫</span>' : "";
  const daysBadge = (tab === "attention" && Number(item.daysOnList) >= 2)
    ? `<span class="surv-tagbit is-days" title="已連續被列為注意的天數（依本系統觀測）">連${item.daysOnList}天</span>` : "";
  const mineBadge = mine ? '<span class="surv-mine-star" title="自選股">★</span>' : "";
  const metaBits = `${mineBadge}${mktBadge}${ivBadge}${newBadge}${hotBadge}${daysBadge}`;
  const selected = state.selectedCode === item.code ? " is-selected" : "";
  return `
    <button class="surv-card is-${key}${mine ? " is-mine" : ""}${selected}" type="button" data-code="${item.code}">
      <strong class="surv-card-name">${escapeHtml(item.name || item.code)}</strong>
      <span class="surv-card-facts">
        <span class="surv-code">${escapeHtml(item.code)}</span>
        ${metaBits ? `<span class="surv-card-meta">${metaBits}</span>` : ""}
      </span>
      <span class="surv-card-quote ${tone}">
        <strong class="surv-price${compactPriceClass}">${price}</strong>
        ${chg ? `<span class="surv-change">${chg}</span>` : ""}
      </span>
      <span class="surv-card-status">${survStatusLine(item, tab)}${survMetricsHtml(item)}</span>
    </button>`;
}

// 卡片頁腳右側指標：週轉率維持輔助層級，成交量用獨立 class 提升可讀性。
function survMetricsHtml(item) {
  const parts = [];
  if ((item.quoteDateMismatch || item.priceStale) && item.quoteAsOf) {
    const label = item.priceStale ? "昨收" : `行情 ${compactDateLabel(item.quoteAsOf)}`;
    parts.push(`<span class="surv-metric-quote-date" title="此檔行情日期與看板主要行情日不同">${escapeHtml(label)}</span>`);
  }
  if (Number.isFinite(item.turnover)) parts.push(`<span class="surv-metric-turnover">週轉 ${formatNumber(item.turnover)}%</span>`);
  if (Number.isFinite(item.volumeLots)) parts.push(`<span class="surv-metric-volume">量 ${Math.round(item.volumeLots).toLocaleString("en-US")}</span>`);
  return parts.length ? `<span class="surv-metrics">${parts.join("")}</span>` : "";
}

// 自選股若「今日新進」處置/注意/全額交割，主動提醒一次（每 session 每檔只提醒一次，避免回到看板就重跳）。
const survAlertedThisSession = new Set();
function maybeAlertMineNewlyListed(payload) {
  if (!payload || !payload.hasHistory) return;
  const cats = { aboutToDispose: "處置", inDisposition: "處置", attention: "注意", changedTrading: "全額交割" };
  const fresh = [];
  const seen = new Set();
  for (const [cat, label] of Object.entries(cats)) {
    for (const it of (payload[cat] || [])) {
      if (it.isNew && isInAnyWatchList(it.code) && !seen.has(it.code) && !survAlertedThisSession.has(it.code)) {
        seen.add(it.code);
        survAlertedThisSession.add(it.code);
        fresh.push(`${it.name || it.code}（${label}）`);
      }
    }
  }
  if (fresh.length) {
    const when = payload.comparisonIsPreviousTradingDay
      ? "今日進入"
      : `較 ${payload.comparisonAsOf || "上次紀錄"} 新增於`;
    showToast(`⚠ 自選股${when}名單：${fresh.slice(0, 3).join("、")}${fresh.length > 3 ? ` 等 ${fresh.length} 檔` : ""}`);
  }
}

// 依分頁產生「精簡圖例」HTML：只留當頁會出現且不自明的 2–3 個符號，
// 完整解釋（分盤/連N天/全額交割定義…）都在「說明」彈窗 #survHelp。
function survLegendHtml(tab, data = null) {
  const parts = ['<span><b class="lg-star">★</b> 自選股</span>'];
  if (tab === "aboutToDispose" || tab === "inDisposition" || tab === "aboutToRelease") {
    parts.push('<span><b class="lg-blue">藍字</b> 即將出關</span>');
  } else if (tab === "attention") {
    parts.push('<span><b class="lg-amber">升溫</b> 較可能進入處置</span>');
  }
  const newLabel = data?.comparisonIsPreviousTradingDay ? "今日新進" : data?.comparisonAsOf ? "較上次新增" : "新進名單";
  parts.push(`<span><b class="lg-new">新</b> ${newLabel}</span>`);
  return parts.join('<i class="lg-sep">·</i>');
}

function renderSurveillanceScreen() {
  if (!el.survBoard) return;
  const data = surveillanceBoardState.data;
  if (el.survLegend) el.survLegend.innerHTML = survLegendHtml(state.surveillanceTab, data);
  if (el.survMineToggle) {
    el.survMineToggle.classList.toggle("is-on", state.survMineOnly);
    el.survMineToggle.setAttribute("aria-checked", state.survMineOnly ? "true" : "false");
  }
  renderSurvToolbar(state.surveillanceTab);
  if (el.survTabs) {
    el.survTabs.querySelectorAll("[data-surv-tab]").forEach((btn) => {
      const key = btn.dataset.survTab;
      btn.classList.toggle("is-active", key === state.surveillanceTab);
      const em = btn.querySelector("em");
      if (em) em.textContent = data?.counts?.[key] != null ? data.counts[key] : "";
    });
  }
  if (el.survAsOf) {
    const queryDate = data?.queryDate || surveillanceBoardState.asOf;
    const quoteDate = data?.quoteAsOf;
    el.survAsOf.textContent = queryDate
      ? `查詢日 ${queryDate}${quoteDate && quoteDate !== queryDate ? ` · 行情 ${quoteDate}` : ""}`
      : "";
  }

  if (surveillanceBoardState.loading && !data) {
    if (el.survIntro) el.survIntro.textContent = "";
    el.survBoard.innerHTML = `
      <div class="surv-empty is-loading">
        <span class="mini-spinner"></span>
        <strong>處置／鉅額交易資料載入中…</strong>
        <small>第一次約 10–20 秒</small>
      </div>`;
    return;
  }
  if (surveillanceBoardState.error && !data) {
    if (el.survIntro) el.survIntro.textContent = "";
    el.survBoard.innerHTML = `<div class="surv-empty">載入失敗：${escapeHtml(surveillanceBoardState.error)}<br/>請點右下角「重新整理」再試。</div>`;
    return;
  }
  if (!data) {
    if (el.survIntro) el.survIntro.textContent = "";
    el.survBoard.innerHTML = `<div class="surv-empty">切到這頁會自動載入處置／鉅額交易看板。</div>`;
    return;
  }
  const tab = state.surveillanceTab;
  const list = data[tab] || [];
  const intro = {
    aboutToDispose: "已公告、還沒開始的處置（處置起日在未來）。",
    inDisposition: "正在處置期間內，多採分盤集合競價、預收款券。",
    aboutToRelease: "處置期間即將結束（今日或下一交易日為最後處置日）。",
    blockTrades: "當日鉅額（block trade）整批成交，依代號彙整金額。",
    attention: "被交易所列為注意（多為價量異常），尚未到處置。",
    changedTrading: "變更交易方法為全額交割（買賣須預收全額款券）；通常因財務或營運疑慮。",
  }[tab];
  const emptyHints = {
    aboutToDispose: "目前沒有已公告、即將進入處置的股票。",
    inDisposition: "目前沒有處置中的股票。",
    aboutToRelease: "今日或下一交易日沒有即將結束的處置股。",
    blockTrades: "今天還沒有鉅額交易資料（盤後才會公布）。",
    attention: "今天沒有被列為注意的股票。",
    changedTrading: "目前沒有被列為全額交割的股票。",
  };
  if (el.survIntro) el.survIntro.textContent = intro || "";
  const shown = survVisibleList(list, tab);
  const emptyMsg = state.survMineOnly && list.length
    ? "你的自選股目前沒有在這個分頁。"
    : (emptyHints[tab] || "目前沒有資料。");
  const comparisonEntered = data.comparisonIsPreviousTradingDay ? data.enteredToday : data.enteredSinceComparison;
  const comparisonReleased = data.comparisonIsPreviousTradingDay ? data.releasedToday : data.releasedSinceComparison;
  const summaryLabel = data.comparisonIsPreviousTradingDay ? "較前一交易日" : data.comparisonAsOf ? `較 ${data.comparisonAsOf}` : "";
  const summary = data.hasHistory && (comparisonEntered || comparisonReleased)
    ? `<div class="surv-summary">${escapeHtml(summaryLabel)}新增處置 <b>${comparisonEntered || 0}</b> 檔　·　名單移除 <b>${comparisonReleased || 0}</b> 檔</div>`
    : "";
  el.survBoard.innerHTML = `
    ${summary}
    ${shown.length
      ? `<div class="surv-grid">${shown.map((item) => survCard(item, tab)).join("")}</div>`
      : `<div class="surv-empty">${emptyMsg}</div>`}
    ${(data.warnings || []).length ? `<div class="surv-warns">${data.warnings.map((w) => `<span>⚠ ${escapeHtml(w)}</span>`).join("")}</div>` : ""}
    <p class="surv-foot">資料來源：TWSE／TPEx 官方公告 · 技術／資訊參考，非買賣建議。</p>
  `;
}

// 哪些分頁有「分盤(5/20)」概念（處置相關才有）。
function survTabHasInterval(tab) {
  return tab === "aboutToDispose" || tab === "inDisposition" || tab === "aboutToRelease";
}

// 套用「只看自選股」＋市場/分盤篩選、搜尋、排序，回傳要顯示的清單。
function survVisibleList(list, tab) {
  let out = list.slice();
  if (state.survMineOnly) out = out.filter((i) => isInAnyWatchList(i.code));
  if (state.survMarket !== "all") {
    out = out.filter((i) => (i.exchange === "TPEx" ? "TPEx" : "TWSE") === state.survMarket);
  }
  if (survTabHasInterval(tab) && state.survInterval !== "all") {
    out = out.filter((i) => String(i.interval || "") === state.survInterval);
  }
  const q = state.survQuery.trim().toLowerCase();
  if (q) out = out.filter((i) => String(i.code).includes(q) || String(i.name || "").toLowerCase().includes(q));
  const s = state.survSort;
  const num = (v, dflt) => (Number.isFinite(v) ? v : dflt);
  if (s === "changeDesc") out.sort((a, b) => num(b.changePct, -1e9) - num(a.changePct, -1e9));
  else if (s === "changeAsc") out.sort((a, b) => num(a.changePct, 1e9) - num(b.changePct, 1e9));
  else if (s === "turnoverDesc") out.sort((a, b) => num(b.turnover, -1) - num(a.turnover, -1));
  else if (s === "code") out.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  // default：保留 server 端既有排序（出關天數／注意次數／金額）。
  return out;
}

// 依當前 state 同步工具列控制元件的顯示狀態（排序值、市場/分盤 active、分盤列是否顯示、搜尋字）。
function renderSurvToolbar(tab) {
  if (el.survSort) el.survSort.value = state.survSort;
  if (el.survSearch && document.activeElement !== el.survSearch) el.survSearch.value = state.survQuery;
  if (el.survMarketChips) {
    el.survMarketChips.querySelectorAll("[data-surv-market]").forEach((button) => {
      const selected = button.dataset.survMarket === state.survMarket;
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }
  const hasIv = survTabHasInterval(tab);
  if (el.survIntervalChips) {
    el.survIntervalChips.hidden = !hasIv;
    el.survIntervalChips.querySelectorAll("[data-surv-interval]").forEach((button) => {
      const selected = button.dataset.survInterval === state.survInterval;
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }
}

// 技術分析頁的單檔處置/注意小標記（含停牌）
function renderTechnicalSurveillance() {
  const box = el.technicalSurveillance;
  if (!box) return;
  const surv = technicalState.data?.surveillance;
  const halted = technicalState.data?.halted;
  if (!surv && !halted) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  // 停牌最嚴重（完全不能交易），優先顯示；若同時另有處置/注意標籤，併進文字提示。
  if (halted) {
    const since = halted.since ? `（自 ${halted.since.slice(5).replace("-", "/")}）` : "";
    const extra = surv ? `，另列${surv.label}` : "";
    box.className = "technical-surveillance is-halted";
    box.innerHTML = `
      <span class="ts-badge">停牌</span>
      <span class="ts-text">暫停交易中${since}，目前無法買賣${extra}</span>
    `;
    return;
  }
  let detail = "";
  if (surv.status === "aboutToDispose") {
    detail = `${surv.startSlash ? `${surv.startSlash.slice(5)} 起` : "即將"}處置${surv.startSlash ? `（期間 ${surv.startSlash.slice(5)}–${surv.endSlash.slice(5)}）` : ""}`;
  } else if (surv.status === "inDisposition") {
    const ending = Number(surv.daysToRelease) === 0
      ? "今日為最後處置日"
      : surv.releaseOnNextTradingDay
        ? `處置至下一交易日 ${surv.endSlash?.slice(5) || ""}`
        : `處置至 ${surv.endSlash?.slice(5) || "公告迄日"}`;
    detail = `處置中，${ending}`;
  } else if (surv.kind === "attention") {
    detail = "被列為注意股（價量異常）";
  } else {
    detail = surv.note || "";
  }
  box.className = `technical-surveillance is-${surv.kind}`;
  // 處置的三個交易限制拆成獨立 chips（白話、看得清楚），不再是一串暗紅小字；
  // 分盤間隔已知就寫進第一顆（「每 5 分鐘撮合一次」），不用使用者自己解讀「5 分盤」。
  const limits = surv.kind === "disposition"
    ? `<div class="ts-limits" aria-label="處置期間交易限制">
        <span>${surv.interval ? `每 ${surv.interval} 分鐘撮合一次` : "分盤集合競價"}</span>
        <span>預收款券</span>
        <span>多不可當沖</span>
      </div>`
    : "";
  box.innerHTML = `
    <span class="ts-badge">${escapeHtml(surv.label)}</span>
    <strong class="ts-text">${escapeHtml(detail)}</strong>
    ${limits}
  `;
}

function movingAverage(values, windowSize) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

const detailHistoryCache = new Map();

function ensureDetailHistory(code) {
  const clean = normalizeStockCodeInput(code);
  if (!clean) return;
  const entry = detailHistoryCache.get(clean);
  if (entry && (entry.loading || entry.candles || entry.failed)) return;
  detailHistoryCache.set(clean, { loading: true, candles: null });
  fetchApi(`/api/technical-analysis?code=${encodeURIComponent(clean)}&period=day`)
    .then((payload) => {
      const candles = Array.isArray(payload.candles)
        ? payload.candles.filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite)).slice(-60)
        : [];
      detailHistoryCache.set(clean, { loading: false, candles: candles.length >= 5 ? candles : null, failed: candles.length < 5 });
    })
    .catch(() => {
      detailHistoryCache.set(clean, { loading: false, candles: null, failed: true });
    })
    .finally(() => {
      if (state.selectedCode === clean) {
        // 重畫整個詳情面板：K線圖換成真實日K，技術均線指標也會切換成官方日K口徑。
        renderDetail();
      }
    });
}

function drawDetailHistoryChart(context, stock, candles, width, height) {
  const chartTop = 24;
  const chartBottom = height - 76;
  const chartHeight = chartBottom - chartTop;
  const left = 14;
  const rightLane = 58;
  const plotRight = width - rightLane;
  const step = (plotRight - left - 8) / Math.max(1, candles.length - 1);
  const candleWidth = Math.max(2, Math.min(8, step * 0.6));
  const prices = candles.flatMap((row) => [row.high, row.low]).filter(Number.isFinite);
  const currentPrice = Number(stock.price);
  if (Number.isFinite(currentPrice)) prices.push(currentPrice);
  const min = Math.min(...prices) * 0.995;
  const max = Math.max(...prices) * 1.005;
  const range = max - min || 1;
  const priceToY = (price) => chartBottom - ((price - min) / range) * chartHeight;
  const indexToX = (index) => left + index * step;

  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    const y = chartTop + (chartHeight / 3) * index;
    context.beginPath();
    context.moveTo(8, y);
    context.lineTo(plotRight, y);
    context.stroke();
  }
  drawTechnicalLabelLane(context, plotRight, chartTop, chartBottom, width);
  context.fillStyle = "#9fb2c6";
  context.font = "700 11px 'Stock1 Plex Mono', IBM Plex Mono, monospace";
  context.textAlign = "left";
  context.fillText(`日K ${candles.length} 根 / 官方歷史`, left, 14);

  candles.forEach((candle, index) => {
    const x = indexToX(index);
    const up = candle.close >= candle.open;
    context.strokeStyle = up ? "#ff2621" : "#21df63";
    context.fillStyle = up ? "#ff2621" : "#21df63";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, priceToY(candle.high));
    context.lineTo(x, priceToY(candle.low));
    context.stroke();
    const yOpen = priceToY(candle.open);
    const yClose = priceToY(candle.close);
    context.fillRect(x - candleWidth / 2, Math.min(yOpen, yClose), candleWidth, Math.max(2, Math.abs(yClose - yOpen)));
  });

  const closes = candles.map((row) => row.close);
  const ma5 = movingAverage(closes, Math.min(5, closes.length));
  const ma20 = movingAverage(closes, Math.min(20, closes.length));
  const drawSeries = (series, color) => {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    series.forEach((value, index) => {
      const x = indexToX(index);
      const y = priceToY(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  };
  drawSeries(ma5, "#2db7ff");
  drawSeries(ma20, "#ffd94d");

  const maxVolume = Math.max(...candles.map((row) => Number(row.volumeLots) || 0), 1);
  candles.forEach((candle, index) => {
    const x = indexToX(index);
    const bar = ((Number(candle.volumeLots) || 0) / maxVolume) * 46;
    context.fillStyle = candle.close >= candle.open ? "rgba(255, 38, 33, 0.7)" : "rgba(33, 223, 99, 0.7)";
    context.fillRect(x - candleWidth / 2, height - 16 - bar, candleWidth, bar);
  });

  context.fillStyle = "#8aa0b5";
  context.font = "700 11px 'Stock1 Plex Mono', IBM Plex Mono, monospace";
  context.textAlign = "left";
  context.fillText(String(candles[0]?.date || "").slice(5), left, height - 4);
  context.textAlign = "right";
  context.fillText(String(candles.at(-1)?.date || "").slice(5), plotRight, height - 4);

  const markPrice = Number.isFinite(currentPrice) ? currentPrice : candles.at(-1).close;
  const lastY = clampChartValue(priceToY(markPrice), chartTop + 4, chartBottom - 4);
  context.strokeStyle = "rgba(255,255,255,0.7)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(plotRight, lastY);
  context.lineTo(plotRight + 6, lastY);
  context.stroke();
  drawRightLaneBadge(context, formatNumber(markPrice), plotRight + 8, lastY, {
    background: "#686d73",
    color: "#ffffff",
    minY: chartTop + 4,
    maxY: chartBottom - 4,
    minWidth: 42,
    font: "700 13px 'Stock1 Plex Mono', IBM Plex Mono, monospace",
  });
}

// Canvas 一律以「實際可見的 CSS content box」配置 backing store。
// 隱藏頁面的 rect 會是 0；此時不可退回 canvas.width（那是 device px），否則高 DPR 下
// 每重畫一次都會再乘一次 DPR，造成 backing store 指數膨脹。
function prepareCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect?.();
  let width = Number(rect?.width) || 0;
  let height = Number(rect?.height) || 0;
  if (canvas.nodeType === 1 && width > 0 && height > 0) {
    const style = window.getComputedStyle?.(canvas);
    if (style) {
      width -= (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
      height -= (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    }
  }
  if (width <= 1 || height <= 1) return null;
  const ratio = Math.max(1, Number(window.devicePixelRatio) || 1);
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height, ratio, pixelWidth, pixelHeight };
}

function drawChart(stock) {
  if (!stock) return;
  const canvas = document.getElementById("priceChart");
  const metrics = prepareCanvas(canvas);
  if (!metrics) return;
  const { context, width, height } = metrics;

  const historyEntry = detailHistoryCache.get(stock.code);
  if (historyEntry?.candles?.length) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#151617";
    context.fillRect(0, 0, width, height);
    drawDetailHistoryChart(context, stock, historyEntry.candles, width, height);
    return;
  }
  // 備援：官方日K還沒載入時，畫「實際觀測到的價格」折線。
  // 不再用 sine 波偽造K棒影線與成交量柱——沒有的資料就不畫。
  const values = (stock.spark || []).map(Number).filter(Number.isFinite);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#151617";
  context.fillRect(0, 0, width, height);
  if (!values.length) return;

  const min = Math.min(...values) * 0.995;
  const max = Math.max(...values) * 1.005;
  const range = max - min || 1;
  const chartTop = 24;
  const chartBottom = height - 28;
  const chartHeight = chartBottom - chartTop;
  const left = 14;
  const rightLane = 58;
  const plotRight = width - rightLane;
  const step = (plotRight - left - 6) / Math.max(1, values.length - 1);
  const valueToY = (value) => chartBottom - ((value - min) / range) * chartHeight;

  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    const y = chartTop + (chartHeight / 3) * index;
    context.beginPath();
    context.moveTo(8, y);
    context.lineTo(plotRight, y);
    context.stroke();
  }
  drawTechnicalLabelLane(context, plotRight, chartTop, chartBottom, width);
  context.fillStyle = "#9fb2c6";
  context.font = "700 11px 'Stock1 Plex Mono', IBM Plex Mono, monospace";
  context.textAlign = "left";
  context.fillText("盤中觀測價（官方日K載入中）", left, 15);

  context.strokeStyle = values.at(-1) >= values[0] ? "#ff2621" : "#21df63";
  context.lineWidth = 2.4;
  context.lineJoin = "round";
  context.beginPath();
  values.forEach((value, index) => {
    const x = left + index * step;
    const y = valueToY(value);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  const lastY = valueToY(values.at(-1));
  context.strokeStyle = "white";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(plotRight, lastY);
  context.lineTo(plotRight + 6, lastY);
  context.stroke();
  drawRightLaneBadge(context, formatNumber(stock.price), plotRight + 8, lastY, {
    background: "#686d73",
    color: "#ffffff",
    minY: chartTop + 4,
    maxY: chartBottom - 4,
    minWidth: 42,
    font: "700 13px 'Stock1 Plex Mono', IBM Plex Mono, monospace",
  });
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function normalizeStockCodeInput(value) {
  return String(value || "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function isValidSecurityCode(value) {
  return /^[0-9A-Z]{4,6}$/.test(normalizeStockCodeInput(value));
}

function formatTechnicalPeriod(period) {
  if (period === "week") return "週K";
  if (period === "month") return "月K";
  return "日K";
}

function formatTechnicalValue(value, digits = 2) {
  if (value == null) return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const text = number.toFixed(digits);
  // 只在有小數點時去尾零，避免整數值（例如 2150）被誤砍成 215。
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

function getTaiwanClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(byType.weekday);
  return {
    isoDate: `${byType.year}-${byType.month}-${byType.day}`,
    weekday: weekdayIndex,
    minutes: Number(byType.hour) * 60 + Number(byType.minute),
  };
}

function isTaiwanRegularSession(date = new Date()) {
  return isTaiwanMarketSession(date);
}

function getTechnicalPriceContext(data, last) {
  const asOfIso = extractIsoDate(data?.asOf || last?.date);
  const todayIso = getTaiwanClockParts().isoDate;
  if (data?.period === "week") return { label: "週收", summaryLabel: "週收" };
  if (data?.period === "month") return { label: "月收", summaryLabel: "月收" };
  if (asOfIso && asOfIso !== todayIso) {
    const label = `${compactDateLabel(asOfIso)}收`;
    return { label, summaryLabel: label };
  }
  if (asOfIso === todayIso && isTaiwanRegularSession()) return { label: "現價", summaryLabel: "現價" };
  return { label: "收盤", summaryLabel: "收盤" };
}

function hydrateStockFromTechnical(payload) {
  const existing = stocks.find((stock) => stock.code === payload?.code);
  if (existing && existing.sourceKind !== "technical-history") return existing;
  const candles = payload?.candles || [];
  const last = candles.at(-1);
  const previous = candles.at(-2);
  if (!last) return;
  const previousClose = previous?.close ?? last.open;
  const change = Number.isFinite(previousClose) ? last.close - previousClose : 0;
  const changePct = Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : 0;
  upsertStockFromQuote({
    code: payload.code,
    name: payload.name,
    exchange: payload.exchange,
    source: payload.source,
    sourceKind: "technical-history",
    asOf: last.date,
    price: last.close,
    previousClose,
    open: last.open,
    high: last.high,
    low: last.low,
    change,
    changePct,
    unitLots: null,
    volumeLots: last.volumeLots,
    transactions: null,
  });
}

async function syncDetailQuoteForTechnical(payload) {
  if (!payload?.code) return null;
  const existing = stocks.find((stock) => stock.code === payload.code);
  if (existing && existing.sourceKind !== "technical-history") return existing;
  try {
    const quotes = await syncOfficialQuotesForCodes([payload.code]);
    const stock = stocks.find((item) => item.code === payload.code);
    if (quotes.length && stock) return stock;
  } catch {
    // Keep the technical page usable even when the quote endpoint is temporarily unavailable.
  }
  return hydrateStockFromTechnical(payload);
}

// 輸入「2330」或「台積電」都可以：純代號直接用，其他文字查官方清單取最佳符合。
async function resolveStockQuery(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return "";
  const code = normalizeStockCodeInput(text);
  const hasCjk = /[一-鿿]/.test(text);
  if (!hasCjk && isValidSecurityCode(code)) return code;
  const payload = await fetchApi(`/api/symbols?q=${encodeURIComponent(text)}`);
  const best = payload.results?.[0];
  if (!best) throw new Error(`官方清單找不到「${text}」，請確認名稱或改輸入代號。`);
  return best.code;
}

let technicalInputDirty = false;

// 進入技術分析頁時，畫面上的圖是不是「目前要看的那檔」：
// 從別的畫面點過股票（technicalCode 已換人）就需要重抓，不能停在上一檔的圖。
function technicalNeedsReload() {
  if (technicalState.loading) return false;
  const code = normalizeStockCodeInput(state.technicalCode);
  if (!code) return false;
  return !technicalState.data || technicalState.data.code !== code;
}

async function analyzeTechnicalFromInput({ notify = true } = {}) {
  // 輸入框是空的就沿用目前分析中的代號（例如清空後直接點週K），不要把圖洗掉。
  const raw = String(el.technicalCode?.value || "").trim() || state.technicalCode;
  if (!raw) {
    technicalState.data = null;
    technicalState.error = "請輸入股票代號或名稱";
    renderTechnicalAnalysis();
    return;
  }
  try {
    const code = await resolveStockQuery(raw);
    technicalInputDirty = false;
    state.technicalCode = code;
    loadTechnicalAnalysis({ notify });
  } catch (error) {
    technicalState.data = null;
    technicalState.error = error.message;
    renderTechnicalAnalysis();
  }
}

async function loadTechnicalAnalysis({ notify = false } = {}) {
  const code = normalizeStockCodeInput(state.technicalCode || el.technicalCode?.value || "");
  if (!code) {
    technicalState.error = "請先輸入股票代號";
    technicalState.data = null;
    renderTechnicalAnalysis();
    return;
  }
  state.technicalCode = code;
  // 請求序號：快速切換代號/週期時，只採用最後一次發出的請求，慢回應直接丟棄。
  const requestId = technicalState.requestId + 1;
  technicalState.requestId = requestId;
  technicalState.loading = true;
  technicalState.error = "";
  renderTechnicalAnalysis();
  try {
    const payload = await fetchApi(`/api/technical-analysis?code=${encodeURIComponent(code)}&period=${encodeURIComponent(state.technicalPeriod)}`);
    if (technicalState.requestId !== requestId) return;
    if (!payload.ok) throw new Error(payload.error || "技術分析資料產生失敗");
    technicalState.data = payload;
    technicalState.error = "";
    await syncDetailQuoteForTechnical(payload);
    state.selectedCode = payload.code;
    if (notify) showToast(`已分析 ${payload.code} ${payload.name}`);
  } catch (error) {
    if (technicalState.requestId !== requestId) return;
    technicalState.data = null;
    technicalState.error = error.message;
    if (!handleAuthRequired(error) && notify) showToast(`技術分析失敗：${error.message}`);
  } finally {
    if (technicalState.requestId === requestId) {
      technicalState.loading = false;
      render();
    }
  }
}

function updateTechnicalPeriodButtons() {
  document.querySelectorAll("[data-analysis-period]").forEach((button) => {
    const selected = button.dataset.analysisPeriod === state.technicalPeriod;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderTechnicalAnalysis() {
  if (!el.technicalSummary) return;
  // 使用者改過輸入內容（還沒按分析）時不要回寫，否則自動刷新會吃掉打到一半的字。
  if (el.technicalCode && document.activeElement !== el.technicalCode && !technicalInputDirty) {
    el.technicalCode.value = state.technicalCode;
  }
  updateTechnicalPeriodButtons();
  // 公司概況獨立於技術分析的成敗：就算官方 K 線不足也要照常顯示產業別與簡介。
  renderCompanyProfile();
  // 基本面區塊也獨立於 K 線成敗（月營收/EPS/估值/除權息，per-code lazy load）。
  renderFundamentalsPanel();
  // 這檔的處置/注意狀態小標記（資料來自 /api/technical-analysis 回傳的 surveillance）。
  renderTechnicalSurveillance();

  const data = technicalState.data;
  const periodLabel = formatTechnicalPeriod(state.technicalPeriod);
  if (technicalState.loading) {
    el.technicalStatus.hidden = false;
    el.technicalStatus.textContent = `${state.technicalCode} ${periodLabel} 分析中，正在抓官方歷史 K 線。`;
    el.technicalStatus.className = "technical-status";
    el.technicalSummary.innerHTML = renderTechnicalLoading();
    el.technicalDetailGrid.innerHTML = "";
    renderTechnicalChartMarkers(null);
    drawTechnicalChart(null);
    drawTechnicalMacdChart(null);
    return;
  }
  if (technicalState.error) {
    el.technicalStatus.hidden = false;
    el.technicalStatus.textContent = technicalState.error;
    el.technicalStatus.className = "technical-status is-error";
    el.technicalSummary.innerHTML = renderTechnicalEmpty("查不到可用的技術分析資料", "請確認股票代號，或稍後再重抓官方資料。");
    el.technicalDetailGrid.innerHTML = "";
    renderTechnicalChartMarkers(null);
    drawTechnicalChart(null);
    drawTechnicalMacdChart(null);
    return;
  }
  if (!data) {
    el.technicalStatus.hidden = false;
    el.technicalStatus.textContent = "輸入股票代號後，系統會用官方歷史資料計算技術分析。";
    el.technicalStatus.className = "technical-status";
    el.technicalSummary.innerHTML = renderTechnicalEmpty("尚未分析", "輸入股票代號後按分析，或點選日K / 週K / 月K。");
    el.technicalDetailGrid.innerHTML = "";
    renderTechnicalChartMarkers(null);
    drawTechnicalChart(null);
    drawTechnicalMacdChart(null);
    return;
  }

  const last = data.candles.at(-1);
  const macd = last?.macd || {};
  const signals = data.signals || {};
  const priceContext = getTechnicalPriceContext(data, last);
  // 官方公司行動欄位不齊時後端會把型態結論整組停掉。這裡必須跟著改寫文案——
  // 沿用「尚未同時滿足突破、量能、MACD 與均線條件」會把「沒評估」講成「評估過但沒過」。
  const suppressed = Boolean(signals.suppressed);
  // 「今天剛穿過」（breakout/breakdown）與「已經站在線的哪一側」（aboveResistance/belowSupport）
  // 是兩件事。只講事件的話，價格早就站上壓力線之後，畫面會同時顯示「壓力 3669.71」與
  // 「沒有明確突破」——使用者看到收盤 3750 高於壓力 3670，那句話等於在騙他。
  // 實例：2454 聯發科 2026-07-24。
  const trendState = suppressed
    ? "暫不判讀"
    : signals.breakout ? "突破壓力線"
      : signals.breakdown ? "跌破支撐線"
        : signals.aboveResistance ? "壓力線上方"
          : signals.belowSupport ? "支撐線下方"
            : "區間觀察";
  const badge = suppressed ? "暫不判讀" : signals.longWatch ? "做多觀察" : signals.risks?.length ? "風險提醒" : "技術觀察";
  const badgeClass = suppressed ? "is-neutral" : signals.longWatch ? "is-positive" : signals.risks?.length ? "is-risk" : "is-neutral";
  // 還原權息提示：純官方還原只放進下方明細（台股年年配息，天天掛警示等於沒警示）；
  // 只有估算還原或官方欄位不齊才升級成上方的醒目提示。
  const caNotes = data.corporateActions?.notes || [];
  if (data.corporateActions?.alert && caNotes.length) {
    el.technicalStatus.hidden = false;
    el.technicalStatus.className = "technical-status";
    el.technicalStatus.textContent = caNotes.join(" ");
  } else {
    el.technicalStatus.hidden = true;
    el.technicalStatus.className = "technical-status";
    el.technicalStatus.textContent = "";
  }
  el.technicalTitle.textContent = `${data.code} ${data.name} ${periodLabel}`;
  el.technicalSubtitle.textContent = `${priceContext.summaryLabel} ${formatTechnicalValue(last.close)} / MACD OSC ${formatTechnicalValue(macd.histogram, 4)} / ${trendState}`;
  el.technicalBadge.textContent = badge;
  el.technicalBadge.className = badgeClass;
  el.technicalSummary.innerHTML = `
    <article class="technical-score-card ${badgeClass}">
      <span>目前狀態</span>
      <strong>${badge}</strong>
      <p>${suppressed ? "官方公司行動的公式欄位未齊備，這段歷史價格沒有正確還原，暫不提供型態結論。" : signals.longWatch ? "符合做多觀察條件，但不是買賣建議。" : signals.risks?.length ? "出現風險條件，先降低解讀強度。" : "尚未同時滿足突破、量能、MACD 與均線條件。"}</p>
    </article>
    <article>
      <span>趨勢線</span>
      <strong>${trendState}</strong>
      <p>${suppressed ? "還原基礎不完整，不判斷突破或跌破。"
        : signals.breakout ? "收盤價突破近期壓力線。"
          : signals.breakdown ? "收盤價跌破上升支撐線。"
            : signals.aboveResistance ? "收盤價已在壓力線上方，但不是今天才突破的。"
              : signals.belowSupport ? "收盤價已在支撐線下方，但不是今天才跌破的。"
                : "目前沒有明確突破或跌破。"}</p>
    </article>
    <article>
      <span>MACD</span>
      <strong>${formatTechnicalValue(macd.histogram, 4)}</strong>
      <p>DIF ${formatTechnicalValue(macd.dif, 4)} / DEA ${formatTechnicalValue(macd.dea, 4)}</p>
    </article>
    <article>
      <span>量能</span>
      <strong>${formatTechnicalValue(last.volumeLots, 0)} 張</strong>
      <p>${suppressed ? "還原基礎不完整，暫不做量能判定。" : signals.checks?.volumeAbove20 ? "大於近 20 根平均量。" : "尚未高於近 20 根平均量。"}</p>
    </article>
  `;
  el.technicalDetailGrid.innerHTML = renderTechnicalDetails(data);
  renderTechnicalChartMarkers(data);
  requestAnimationFrame(() => {
    drawTechnicalChart(data);
    drawTechnicalMacdChart(data);
  });
}

function projectTrendLinePrice(line, index) {
  if (!line || !Number.isFinite(line.slope) || !Number.isFinite(line.intercept)) return null;
  const value = line.slope * index + line.intercept;
  return Number.isFinite(value) ? value : null;
}

function renderTechnicalChartMarkers(data) {
  if (!el.technicalChartMarkers) return;
  if (!data?.candles?.length) {
    el.technicalChartMarkers.hidden = true;
    el.technicalChartMarkers.innerHTML = "";
    return;
  }

  const candles = data.candles;
  const lastIndex = candles.length - 1;
  const resistance = projectTrendLinePrice(data.trendLines?.resistance, lastIndex);
  const support = projectTrendLinePrice(data.trendLines?.support, lastIndex);

  // 關鍵價位：只留壓力 / 支撐 / 回撤；收盤已在卡片副標顯示，不重複。
  const priceMarkers = [];
  if (Number.isFinite(resistance)) priceMarkers.push({ label: "壓力", value: formatTechnicalValue(resistance), tone: "resistance" });
  if (Number.isFinite(support)) priceMarkers.push({ label: "支撐", value: formatTechnicalValue(support), tone: "support" });
  if (data.fibonacci?.active) {
    data.fibonacci.levels.forEach((level) => {
      priceMarkers.push({
        label: `回撤 ${level.ratio}`,
        value: formatTechnicalValue(level.price),
        tone: level.near ? "fib-near" : "fib",
      });
    });
  }

  // 線條圖例：精簡成「色點＋短名」。條件狀態（走勢/MA/MACD/量能）已在 K 線下方的摘要卡呈現，這裡不再重複。
  const legendMarkers = [
    { value: "MA5", tone: "ma-short" },
    { value: "MA20", tone: "ma-mid" },
    { value: "DIF", tone: "macd-dif" },
    { value: "DEA", tone: "macd-dea" },
    { value: "量·OSC", tone: "volume" },
  ];

  const renderPriceMarker = (marker) => `
    <span class="technical-chart-marker is-${marker.tone}">
      <em>${escapeHtml(marker.label)}</em>
      <strong>${escapeHtml(marker.value)}</strong>
    </span>
  `;
  const renderLegendMarker = (marker) => `
    <span class="technical-chart-marker is-${marker.tone} is-legend">
      <strong>${escapeHtml(marker.value)}</strong>
    </span>
  `;

  const priceHtml = priceMarkers.map(renderPriceMarker).join("");
  const legendHtml = legendMarkers.map(renderLegendMarker).join("");
  const divider = priceHtml ? `<span class="technical-marker-divider" aria-hidden="true"></span>` : "";

  el.technicalChartMarkers.hidden = false;
  el.technicalChartMarkers.innerHTML = `${priceHtml}${divider}${legendHtml}`;
}

function renderTechnicalLoading() {
  return `
    <article class="technical-score-card">
      <span>分析中</span>
      <strong>讀取官方 K 線</strong>
      <p>正在計算 MA、MACD、swing high/low、趨勢線與費波回撤。</p>
    </article>
  `;
}

function renderTechnicalEmpty(title, text) {
  return `
    <article class="technical-score-card">
      <span>技術分析</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(text)}</p>
    </article>
  `;
}

// 還原權息明細：圖上的歷史價格已經不是當時的實際成交價，這件事一定要講。
// 用詞受規格約束——只有官方公告可以講「除權息」，跳空推測一律是「疑似／估算」。
function renderTechnicalCorporateActions(data) {
  const info = data.corporateActions;
  if (!info) return "";
  const monthDay = (compact) => `${String(compact).slice(4, 6)}/${String(compact).slice(6, 8)}`;
  // exchange-* 是交易所自己算出來的參考價（比我們套公式更可信），official 是官方公告＋公式，
  // 其餘都是跳空推測，一律講「估算」。
  const sourceLabel = (source) => (source === "exchange-result" || source === "exchange-quote"
    ? "交易所"
    : source === "official" ? "官方公告" : "估算");
  const eventList = info.events?.length
    ? info.events.map((event) => `<span>${escapeHtml(monthDay(event.date))}：×${escapeHtml(String(event.ratio ?? "--"))}（${escapeHtml(sourceLabel(event.source))}）</span>`).join("")
    // 「沒有偵測到」不等於「沒有發生」。偵測涵蓋除權息（官方參考價／公告公式）與 >10.5% 的
    // 跳空推測；幅度小於這個門檻的減資不會被發現，圖上會維持原始跳空。這是資料源的限制
    // （官方沒有機器可讀的減資／面額變更端點），寫成「沒有公司行動」會是過度宣稱。
    : '<span title="偵測範圍：官方除權息參考價與公告公式，加上超過 10.5% 的跳空推估。幅度小於 10.5% 的減資沒有官方端點可查，不會被偵測到，圖上會保留原始跳空。">'
      + "這段區間沒有偵測到公司行動，圖上就是原始成交價。</span>";
  const notes = (info.notes || []).map((note) => `<p>${escapeHtml(note)}</p>`).join("");
  return `
    <article>
      <h3>還原權息</h3>
      <div class="technical-level-list">${eventList}</div>
      ${notes}
    </article>
  `;
}

function renderTechnicalDetails(data) {
  const signals = data.signals || {};
  const fib = data.fibonacci || {};
  const suppressed = Boolean(signals.suppressed);
  const signalTags = signals.signals?.length ? signals.signals : ["尚未出現明確突破訊號"];
  const riskTags = signals.risks?.length ? signals.risks : ["目前沒有觸發風險條件"];
  const fibLevels = fib.active
    ? fib.levels.map((level) => `<span>${level.ratio}：${formatTechnicalValue(level.price)}${level.near ? " / 回測觀察區" : ""}</span>`).join("")
    : `<span>${suppressed ? "還原基礎不完整，暫不繪製費波回撤。" : "尚未偵測到突破，暫不繪製費波回撤。"}</span>`;
  const support = data.trendLines?.support;
  const resistance = data.trendLines?.resistance;
  // 停判期間四個條件全是未評估，不能畫成「評估過但沒過」的灰勾。
  const checksBlock = suppressed
    ? `<p>官方公司行動的公式欄位未齊備，四項條件都沒有評估。</p>`
    : `
      <div class="technical-checks">
        <span class="${signals.checks?.closeAboveResistance ? "is-pass" : ""}">突破壓力線</span>
        <span class="${signals.checks?.macdOk ? "is-pass" : ""}">MACD 轉強</span>
        <span class="${signals.checks?.volumeAbove20 ? "is-pass" : ""}">量大於 20 均量</span>
        <span class="${signals.checks?.aboveMovingAverages ? "is-pass" : ""}">站上 MA5 / MA20</span>
      </div>
    `;
  const signalBlock = suppressed
    ? `<div class="technical-chip-list"><span>暫不判讀突破與風險</span></div>`
    : `
      <div class="technical-chip-list">${signalTags.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      <div class="technical-chip-list is-risk">${riskTags.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    `;
  return `
    <article>
      <h3>做多觀察條件</h3>
      ${checksBlock}
    </article>
    <article>
      <h3>突破與風險</h3>
      ${signalBlock}
    </article>
    ${renderTechnicalCorporateActions(data)}
    <article>
      <h3>費波回撤</h3>
      <div class="technical-level-list">${fibLevels}</div>
    </article>
    <article>
      <h3>趨勢線依據</h3>
      <p>支撐線：${support ? `${support.points[0].date} ${formatTechnicalValue(support.points[0].price)} → ${support.points[1].date} ${formatTechnicalValue(support.points[1].price)}` : "高低點不足"}</p>
      <p>壓力線：${resistance ? `${resistance.points[0].date} ${formatTechnicalValue(resistance.points[0].price)} → ${resistance.points[1].date} ${formatTechnicalValue(resistance.points[1].price)}` : "高低點不足"}</p>
    </article>
  `;
}

function drawTechnicalCanvasLegend(context, items, x, y, maxX) {
  let cursorX = x;
  let cursorY = y;
  context.save();
  context.font = "700 13px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif";
  context.textBaseline = "middle";
  items.forEach((item) => {
    const textWidth = Math.ceil(context.measureText(item.label).width);
    const itemWidth = textWidth + 38;
    if (cursorX > x && cursorX + itemWidth > maxX) {
      cursorX = x;
      cursorY += 18;
    }
    context.strokeStyle = item.color;
    context.lineWidth = item.width || 3;
    context.lineCap = "round";
    if (item.dash) context.setLineDash(item.dash);
    context.beginPath();
    context.moveTo(cursorX, cursorY);
    context.lineTo(cursorX + 22, cursorY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#cfe0ef";
    context.fillText(item.label, cursorX + 29, cursorY + 0.5);
    cursorX += itemWidth;
  });
  context.restore();
  return cursorY;
}

// 價格軸「漂亮刻度」：1-2-2.5-5×10^n 步進，刻度值都是整齊數（150/200/250…），
// 取代舊的「範圍÷4」等分（會出現 342.1/277.8 這種難讀的數字）。
function niceTicks(min, max, targetCount = 5) {
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) return [];
  const rough = range / Math.max(1, targetCount);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  // Heckbert 式就近取整：挑「最接近」的漂亮步進，而不是第一個 ≥ 的（那會偏粗、格線太少）。
  const fraction = rough / pow;
  const step = pow * (fraction < 1.5 ? 1 : fraction < 2.25 ? 2 : fraction < 3.5 ? 2.5 : fraction < 7 ? 5 : 10);
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(Math.round(value * 1000) / 1000); // 消掉 2.5 步進的浮點殘渣
  }
  return ticks;
}

// 日期軸刻度：優先打在「月界」（跨年帶年份），比等距取樣好讀——
// 視窗很寬時抽稀成季界/年界；縮到不足兩個月界時回傳 null（呼叫端退回逐根取樣）。
function buildDateTicks(visible) {
  const dateOf = (i) => String(visible[i]?.date || "");
  const bounds = [];
  for (let i = 1; i < visible.length; i += 1) {
    if (dateOf(i) && dateOf(i - 1).slice(0, 7) !== dateOf(i).slice(0, 7)) bounds.push(i);
  }
  if (bounds.length < 2) return null;
  let list = bounds;
  if (bounds.length > 18) {
    const yearly = bounds.filter((i) => dateOf(i).slice(5, 7) === "01");
    if (yearly.length >= 2) {
      return yearly.map((i) => ({ i, label: `${dateOf(i).slice(0, 4)}年` }));
    }
  }
  if (list.length > 9) {
    const quarterly = list.filter((i) => ["01", "04", "07", "10"].includes(dateOf(i).slice(5, 7)));
    list = quarterly.length >= 2 ? quarterly : list.filter((_, idx) => idx % 2 === 0);
  }
  return list.map((i, idx) => {
    const d = dateOf(i);
    const month = Number(d.slice(5, 7));
    // 第一個刻度與每年 1 月帶上年份，一眼定位「現在看的是哪一年」。
    const label = idx === 0 || month === 1 ? `${d.slice(0, 4)}/${month}月` : `${month}月`;
    return { i, label };
  });
}

function drawTechnicalChart(data, options = {}) {
  const canvas = options.canvas || el.technicalChart;
  if (!canvas) return null;
  const metrics = prepareCanvas(canvas);
  if (!metrics) return null;
  const { context, width, height } = metrics;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0d1218";
  context.fillRect(0, 0, width, height);

  if (!data?.candles?.length) {
    context.fillStyle = "#b8cadc";
    context.font = "700 18px Microsoft JhengHei, sans-serif";
    context.textAlign = "center";
    context.fillText("等待技術分析資料", width / 2, height / 2);
    return null;
  }

  const candles = data.candles;
  // 放大檢視時整體 UI 元素（座標字、價格標籤、留白）依畫布寬度等比放大，讓關鍵數字看得舒服。
  const uiScale = options.enlarged ? Math.max(1.35, Math.min(2.1, width / 720)) : 1;
  const fontPx = (px) => Math.round(px * uiScale);
  const left = options.enlarged ? Math.round(40 * uiScale) : 58;
  // 放大時右側價格標籤（壓／撐／收）字級放大，留更寬的軌道避免被切掉。
  const right = options.enlarged ? Math.round(90 * uiScale) : (width >= 520 ? 128 : 116);
  // 放大時不在畫布上畫標題／圖例（改由彈窗 header 顯示），頂部留白可縮小。
  const top = options.enlarged ? Math.round(22 * uiScale) : (width >= 620 ? 56 : 72);
  // 放大時在底部多保留一塊 MACD 副圖；內嵌小圖維持原本價＋量比例（MACD 走另一張 canvas）。
  const showMacd = !!options.enlarged;
  const priceBottom = Math.round(height * (showMacd ? 0.56 : 0.76));
  const volumeTop = priceBottom + (showMacd ? Math.round(8 * uiScale) : 16);
  const volumeBottom = showMacd ? Math.round(height * 0.68) : (height - 32);
  const macdTop = showMacd ? Math.round(height * 0.73) : 0;
  const macdBottom = showMacd ? (height - Math.round(26 * uiScale)) : 0;
  const lineBottom = showMacd ? macdBottom : volumeBottom;
  const plotRight = width - right;
  const candleRight = plotRight - 12;
  const labelX = plotRight + 8;
  const chartWidth = Math.max(1, candleRight - left);
  // 可視視窗（縮放／平移）：預設整段；放大檢視可傳入 viewStart/viewEnd 只畫一段。
  const total = candles.length;
  const viewStart = Number.isInteger(options.viewStart) ? Math.max(0, Math.min(options.viewStart, total - 1)) : 0;
  const viewEnd = Number.isInteger(options.viewEnd) ? Math.max(viewStart, Math.min(options.viewEnd, total - 1)) : total - 1;
  const isFullView = viewStart === 0 && viewEnd === total - 1;
  const visible = candles.slice(viewStart, viewEnd + 1);
  const visN = Math.max(1, visible.length);
  const step = chartWidth / Math.max(1, visN - 1);
  const candleWidth = Math.max(3, Math.min(options.enlarged ? 16 : 9, step * 0.64));
  const fibPrices = (data.fibonacci?.levels || []).map((level) => level.price).filter(Number.isFinite);
  const priceValues = visible.flatMap((candle) => [candle.high, candle.low, candle.maShort, candle.maMid]).filter(Number.isFinite);
  // 整段檢視才把壓力/支撐/回撤價位納入範圍；放大某一段時只看該段 K 棒的高低，K 棒才會填滿畫面。
  if (isFullView) priceValues.push(...fibPrices);
  const min = Math.min(...priceValues) * 0.985;
  const max = Math.max(...priceValues) * 1.015;
  const range = max - min || 1;
  const priceToY = (price) => priceBottom - ((price - min) / range) * (priceBottom - top);
  const lx = (i) => left + i * step; // 可視範圍內的本地索引 → x（畫圖用）
  const indexToX = (index) => left + (index - viewStart) * step; // 絕對索引 → x（趨勢線／游標用）

  // 價格軸：1-2-5 漂亮刻度（150/200/250…），格線與標籤同一組；面板頂/底再補一條框線。
  context.strokeStyle = "rgba(255,255,255,0.08)";
  context.lineWidth = 1;
  for (const frameY of [top, priceBottom]) {
    context.beginPath();
    context.moveTo(left, frameY);
    context.lineTo(width - right, frameY);
    context.stroke();
  }
  drawTechnicalLabelLane(context, plotRight, top, priceBottom, width);
  context.fillStyle = "#8aa0b5";
  context.font = `700 ${fontPx(11)}px 'Stock1 Plex Mono', IBM Plex Mono, monospace`;
  context.textAlign = "right";
  for (const tickPrice of niceTicks(min, max, 5)) {
    const gridY = priceToY(tickPrice);
    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.beginPath();
    context.moveTo(left, gridY);
    context.lineTo(width - right, gridY);
    context.stroke();
    // 貼著面板頂/底的標籤跳過：頂部避免壓到讀數，底部避免撞「Volume」窗格標籤。
    if (gridY < top + fontPx(10) || gridY > priceBottom - fontPx(10)) continue;
    context.fillText(formatNumber(tickPrice), left - 8, gridY + fontPx(4));
  }
  // 放大檢視改由彈窗 header 顯示標題與圖例，畫布上不再重複（讓左上角讀數面板有完整空間）。
  if (!options.enlarged) {
    context.fillStyle = "#cfe0ef";
    context.font = "700 13px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif";
    context.textAlign = "left";
    context.fillText(`${data.code} ${data.name} ${formatTechnicalPeriod(data.period)}`, left, 18);
    drawTechnicalCanvasLegend(context, [
      { label: "MA5", color: "#2db7ff", width: 3 },
      { label: "MA20", color: "#ffd94d", width: 3 },
      { label: "壓力線", color: "#ff8093", width: 3, dash: [9, 6] },
      { label: "支撐線", color: "#4ce6d4", width: 3, dash: [9, 6] },
    ], left, 36, plotRight - 8);
  }

  // 放大且縮放某一段時，把價格面板的趨勢線／均線／K 棒裁切在面板內，避免延伸到座標軌。
  const clipPrice = options.enlarged && !isFullView;
  if (clipPrice) {
    context.save();
    context.beginPath();
    context.rect(left - candleWidth, top - 2, (plotRight - left) + candleWidth, (priceBottom - top) + 4);
    context.clip();
  }

  drawTechnicalTrendLine(context, data.trendLines?.support, indexToX, priceToY, candles.length, "#4ce6d4", "支撐", { labelX, plotRight, top, bottom: priceBottom, compact: true, showTick: false });
  drawTechnicalTrendLine(context, data.trendLines?.resistance, indexToX, priceToY, candles.length, "#ff8093", "壓力", { labelX, plotRight, top, bottom: priceBottom, compact: true, showTick: false });
  drawTechnicalFibonacci(context, data.fibonacci, left, plotRight, priceToY, { labelX, plotRight, top, bottom: priceBottom, compact: true, showTicks: false });

  drawTechnicalSeries(context, visible.map((item) => item.maShort), lx, priceToY, "#2db7ff", 1.7);
  drawTechnicalSeries(context, visible.map((item) => item.maMid), lx, priceToY, "#ffd94d", 1.7);

  visible.forEach((candle, i) => {
    const x = lx(i);
    const yOpen = priceToY(candle.open);
    const yClose = priceToY(candle.close);
    const yHigh = priceToY(candle.high);
    const yLow = priceToY(candle.low);
    const up = candle.close >= candle.open;
    context.strokeStyle = up ? "#ff4a45" : "#21df63";
    context.fillStyle = up ? "#ff3430" : "#16c95b";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, yHigh);
    context.lineTo(x, yLow);
    context.stroke();
    context.fillRect(x - candleWidth / 2, Math.min(yOpen, yClose), candleWidth, Math.max(2, Math.abs(yClose - yOpen)));
  });

  if (clipPrice) context.restore();

  const maxVolume = Math.max(...visible.map((item) => item.volumeLots || 0), 1);
  visible.forEach((candle, i) => {
    const x = lx(i);
    const barHeight = ((candle.volumeLots || 0) / maxVolume) * (volumeBottom - volumeTop);
    context.fillStyle = candle.close >= candle.open ? "rgba(255, 52, 48, 0.52)" : "rgba(33, 223, 99, 0.52)";
    context.fillRect(x - candleWidth / 2, volumeBottom - barHeight, candleWidth, barHeight);
  });
  // 均量線（5）：用絕對索引計算，視窗左緣也連續。放大檢視才畫，避免內嵌小圖變亂。
  if (options.enlarged) {
    const volToY = (v) => volumeBottom - (Math.max(0, v) / maxVolume) * (volumeBottom - volumeTop);
    const volMa = visible.map((_candle, i) => {
      const abs = viewStart + i;
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, abs - 4); k <= abs; k += 1) {
        const v = candles[k]?.volumeLots;
        if (Number.isFinite(v)) { sum += v; count += 1; }
      }
      return count ? sum / count : null;
    });
    drawTechnicalSeries(context, volMa, lx, volToY, "#ffb454", 1.5);
  }
  context.fillStyle = "#9fb2c6";
  context.font = `700 ${fontPx(11)}px 'Stock1 Plex Mono', IBM Plex Mono, monospace`;
  context.textAlign = "left";
  context.fillText("Volume", left, volumeTop - 6);
  if (options.enlarged) {
    const volW = context.measureText("Volume").width;
    context.fillStyle = "#ffb454";
    context.fillText("均量5", left + volW + fontPx(10), volumeTop - 6);
  }

  context.fillStyle = "#8aa0b5";
  context.font = `700 ${fontPx(11)}px 'Stock1 Plex Mono', IBM Plex Mono, monospace`;
  context.textAlign = "center";
  const drawDateTick = (tickX, tickLabel) => {
    // 放大時補上淡淡的垂直日期格線，方便對齊 K 棒（貫穿價量與 MACD）。
    if (options.enlarged) {
      context.strokeStyle = "rgba(255, 255, 255, 0.045)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(tickX, top);
      context.lineTo(tickX, lineBottom);
      context.stroke();
    }
    context.fillText(tickLabel, tickX, height - fontPx(8));
  };
  // 日期軸優先打「月界／季界／年界」；縮到視窗內不足兩個月界才退回逐根等距取樣。
  const monthTicks = buildDateTicks(visible);
  if (monthTicks) {
    monthTicks.forEach(({ i, label }) => drawDateTick(lx(i), label));
  } else {
    const dateTickCount = Math.min(options.enlarged ? 7 : 5, visN);
    for (let tick = 0; tick < dateTickCount; tick += 1) {
      const localIndex = Math.round((visN - 1) * (tick / Math.max(1, dateTickCount - 1)));
      const tickDate = String(visible[localIndex]?.date || "");
      drawDateTick(lx(localIndex), data.period === "month" ? tickDate.slice(0, 7) : tickDate.slice(5));
    }
  }

  // MACD 副圖（放大檢視）：零軸 + OSC 柱 + DIF/DEA 線。數值由游標層同步顯示「被檢視那根」。
  let macdInfo = null;
  if (showMacd && macdBottom > macdTop) {
    const macdValues = visible.flatMap((item) => [item.macd?.dif, item.macd?.dea, item.macd?.histogram]).filter(Number.isFinite);
    if (macdValues.length) {
      const macdAbs = Math.max(...macdValues.map((value) => Math.abs(value)), 0.01);
      const macdMid = (macdTop + macdBottom) / 2;
      const macdToY = (value) => macdMid - (value / macdAbs) * ((macdBottom - macdTop) * 0.44);
      macdInfo = { mid: macdMid, toY: macdToY };
      // 標題（數值改由游標層顯示，跟著被檢視那根）
      context.fillStyle = "#9fb2c6";
      context.font = `700 ${fontPx(10)}px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif`;
      context.textAlign = "left";
      context.fillText("MACD 8,17,9", left, macdTop - fontPx(5));
      // 零軸
      context.strokeStyle = "rgba(255, 255, 255, 0.22)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, macdMid);
      context.lineTo(plotRight, macdMid);
      context.stroke();
      // OSC 柱
      visible.forEach((candle, i) => {
        const hist = candle.macd?.histogram;
        if (!Number.isFinite(hist)) return;
        const x = lx(i);
        const y = macdToY(hist);
        context.fillStyle = hist >= 0 ? "#ff605c" : "#29d7b1";
        context.fillRect(x - candleWidth / 2, Math.min(macdMid, y), candleWidth, Math.max(1, Math.abs(macdMid - y)));
      });
      drawTechnicalSeries(context, visible.map((item) => item.macd?.dif), lx, macdToY, "#f2f7fc", 1.6);
      drawTechnicalSeries(context, visible.map((item) => item.macd?.dea), lx, macdToY, "#a78bfa", 1.9);
    }
  }

  const last = candles.at(-1);
  // 收盤虛線：對齊「目前可視範圍最後一根」，縮放／平移後仍正確。
  const lastVisible = visible.at(-1) || last;
  const lastX = lx(visN - 1);
  const lastY = priceToY(lastVisible.close);
  context.strokeStyle = "rgba(255,255,255,0.3)";
  context.lineWidth = 1;
  context.setLineDash([3, 4]);
  context.beginPath();
  context.moveTo(lastX + 4, lastY);
  context.lineTo(plotRight + 1, lastY);
  context.stroke();
  context.setLineDash([]);

  const lastIndex = candles.length - 1;
  const resistanceValue = projectTrendLinePrice(data.trendLines?.resistance, lastIndex);
  const supportValue = projectTrendLinePrice(data.trendLines?.support, lastIndex);
  // 右側價格軌：高價（≥500）取整數，低價留一位小數，和左側座標一致、也讓標籤更精簡。
  const laneValue = (price) => formatTechnicalValue(price, price >= 500 ? 0 : 1);
  const laneMarkers = [
    {
      label: "收",
      value: laneValue(last.close),
      price: last.close,
      color: "#f2f7fc",
      textColor: "#ffffff",
      background: "rgba(70, 78, 87, 0.96)",
      primary: true,
    },
  ];
  if (Number.isFinite(resistanceValue)) {
    laneMarkers.push({ label: "壓", value: laneValue(resistanceValue), price: resistanceValue, color: "#ff8093", dash: [4, 4] });
  }
  if (Number.isFinite(supportValue)) {
    laneMarkers.push({ label: "撐", value: laneValue(supportValue), price: supportValue, color: "#4ce6d4", dash: [4, 4] });
  }
  // MA5/MA20 最新值也掛右軸（線色小籤、和頂部圖例同色），與收/壓/撐共用同一套避讓。
  if (Number.isFinite(last?.maShort)) {
    laneMarkers.push({ label: "MA5", value: laneValue(last.maShort), price: last.maShort, color: "#2db7ff" });
  }
  if (Number.isFinite(last?.maMid)) {
    laneMarkers.push({ label: "MA20", value: laneValue(last.maMid), price: last.maMid, color: "#ffd94d" });
  }
  if (data.fibonacci?.active) {
    data.fibonacci.levels.forEach((level) => {
      if (!Number.isFinite(level.price)) return;
      laneMarkers.push({
        label: String(level.ratio),
        value: laneValue(level.price),
        price: level.price,
        color: level.near ? "#d8ccff" : "#9d7cff",
      });
    });
  }
  const laneLabelX = plotRight + (options.enlarged ? Math.round(8 * uiScale) : 13);
  const priceLane = drawTechnicalRightLane(context, laneMarkers, {
    top,
    bottom: priceBottom,
    plotRight,
    labelX: laneLabelX,
    valueToY: priceToY,
    // 上限改用 labelX 起算，確保標籤右緣不會超出畫布被切掉。
    maxBadgeWidth: width - laneLabelX - (options.enlarged ? Math.round(8 * uiScale) : 16),
    scale: uiScale,
  });

  // 回傳座標換算，給放大檢視的十字游標把指標位置對應回 K 棒。
  return {
    uiScale,
    candles,
    width,
    height,
    left,
    plotRight,
    candleRight,
    laneLabelX,
    laneBadgeWidth: priceLane?.badgeWidth || 0,
    laneFontPx: priceLane?.fontPx || 0,
    laneBadges: priceLane?.badges || [],
    top,
    priceBottom,
    volumeTop,
    volumeBottom,
    macdTop,
    macdBottom,
    macd: macdInfo,
    lineBottom,
    step,
    candleWidth,
    chartWidth,
    viewStart,
    viewEnd,
    min,
    max,
    range,
    indexToX,
    priceToY,
    yToPrice: (y) => min + ((priceBottom - y) / (priceBottom - top)) * range,
    // 由 x 推回「絕對」K 棒索引（含可視視窗位移）。
    indexFromX: (x) => Math.max(viewStart, Math.min(viewEnd, viewStart + Math.round((x - left) / step))),
  };
}

// ===== 技術分析放大檢視（全螢幕 + 可拖曳十字游標，滑鼠／觸控通用） =====
const ZOOM_MIN_BARS = 18; // 縮放時最少顯示幾根 K 棒
const zoomChartState = {
  open: false,
  geometry: null,
  index: -1,
  pointerY: null,
  locked: false,
  viewStart: 0,
  viewCount: 0,
  readoutContentKey: "",
  readoutLayoutKey: "",
  readoutWidth: 0,
  readoutHeight: 0,
  readoutToolBounds: null,
};
let resetZoomPointerInteraction = () => {};

function invalidateZoomReadoutLayout({ content = false } = {}) {
  zoomChartState.readoutLayoutKey = "";
  zoomChartState.readoutWidth = 0;
  zoomChartState.readoutHeight = 0;
  zoomChartState.readoutToolBounds = null;
  if (content) zoomChartState.readoutContentKey = "";
}

function openTechnicalZoom(event) {
  if (!technicalState.data?.candles?.length) {
    showToast("先分析個股，才有圖可以放大");
    return;
  }
  if (!el.technicalZoomModal) return;
  openDialogLayer(el.technicalZoomModal, {
    trigger: event?.currentTarget || document.activeElement,
    initialFocus: ".chart-zoom-modal",
  });
  zoomChartState.open = true;
  finishOpenZoom();
}

// 從任一列表的明細小圖（#priceChart）點進來：把該檔載入技術分析後開放大圖。
// 沿用技術頁同一套放大檢視（看每根/縮放平移/畫線/MACD/切週期）。固定先看日K，與小圖一致。
async function openZoomForStock(code, trigger = document.activeElement) {
  const clean = normalizeStockCodeInput(code);
  if (!clean) {
    showToast("先選一檔個股，才有圖可以放大");
    return;
  }
  if (!el.technicalZoomModal) return;
  state.technicalPeriod = "day";
  state.technicalCode = clean;
  technicalInputDirty = false;
  // 已經載好同一檔的日K → 直接開，零延遲。
  if (technicalState.data?.code === clean && technicalState.data?.period === "day" && technicalState.data?.candles?.length) {
    openDialogLayer(el.technicalZoomModal, { trigger, initialFocus: ".chart-zoom-modal" });
    zoomChartState.open = true;
    finishOpenZoom();
    return;
  }
  // 還沒載：先把放大圖外殼打開、顯示載入中，再背景抓官方完整技術分析。
  const stock = getSelectedStock();
  const name = stock && stock.code === clean ? ` ${stock.name}` : "";
  openDialogLayer(el.technicalZoomModal, { trigger, initialFocus: ".chart-zoom-modal" });
  zoomChartState.open = true;
  zoomChartState.locked = false;
  if (el.zoomChartReadout) el.zoomChartReadout.hidden = true;
  if (el.zoomChartTitle) el.zoomChartTitle.textContent = `${clean}${name} 載入中…`;
  closeZoomHelp();
  showZoomStatus("正在抓官方歷史 K 線…");
  refreshLucideIcons();
  await loadTechnicalAnalysis({ notify: false });
  // 載入期間使用者可能已關掉放大圖；或又點了別檔。
  if (!zoomChartState.open || state.technicalCode !== clean) return;
  if (technicalState.data?.code === clean && technicalState.data?.candles?.length) {
    finishOpenZoom();
  } else {
    closeTechnicalZoom();
    showToast(technicalState.error || `${clean} 沒有足夠的官方 K 線可以放大`);
  }
}

// 放大圖「資料已就緒」後的共用初始化：重設視窗、標題、畫線工具並開始繪圖。
// 由 openTechnicalZoom（技術頁）與 openZoomForStock（從各列表的明細小圖）共用。
function finishOpenZoom() {
  resetZoomPointerInteraction();
  invalidateZoomReadoutLayout({ content: true });
  zoomChartState.locked = false;
  zoomChartState.index = technicalState.data.candles.length - 1;
  zoomChartState.pointerY = null;
  // 每次開啟都回到「看全部」。
  zoomChartState.viewStart = 0;
  zoomChartState.viewCount = technicalState.data.candles.length;
  if (el.zoomChartTitle) {
    el.zoomChartTitle.textContent = `${technicalState.data.code} ${technicalState.data.name} ${formatTechnicalPeriod(technicalState.data.period)}`;
  }
  updateZoomPeriodButtons();
  showZoomStatus("");
  // 畫線工具：每次開啟回到游標模式，重建色票與狀態。
  drawState.tool = "cursor";
  drawState.pending = null;
  drawState.hoverId = null;
  renderDrawColors();
  updateDrawToolsUI();
  refreshLucideIcons();
  // 等彈窗 layout 完成、量得到尺寸再繪圖。用 setTimeout（背景分頁 rAF 會被節流），
  // 並「補畫直到讀數面板出現」自我修正首次開啟的版面競態。
  setTimeout(() => renderZoomWithRetry(8), 40);
  // 第一次打開放大圖，自動秀一次操作說明（看過就只能從右上角「？」再叫出來）。
  let helpSeen = true;
  try { helpSeen = !!localStorage.getItem(ZOOM_HELP_KEY); } catch {}
  if (!helpSeen) setTimeout(openZoomHelp, 380);
  else closeZoomHelp();
}

function renderZoomWithRetry(tries) {
  if (!zoomChartState.open) return;
  try {
    drawZoomChart();
    updateZoomReadout(zoomChartState.index);
  } catch {
    // 冷啟動偶發狀況，稍後再試。
  }
  if (tries > 0 && el.zoomChartReadout && el.zoomChartReadout.hidden) {
    setTimeout(() => renderZoomWithRetry(tries - 1), 50);
  }
}

function closeTechnicalZoom() {
  if (!el.technicalZoomModal) return;
  resetZoomPointerInteraction();
  closeZoomHelp();
  closeDialogLayer(el.technicalZoomModal);
  zoomChartState.open = false;
  zoomChartState.geometry = null;
  // 全螢幕圖關閉後釋放大型 backing store；下次開啟會依實際 content box 重建。
  [el.zoomChartCanvas, el.zoomCrosshairCanvas].forEach((canvas) => {
    if (!canvas) return;
    canvas.width = 1;
    canvas.height = 1;
  });
}

const ZOOM_HELP_KEY = "stock1.zoomHelpSeen.v1";
function openZoomHelp(event) {
  if (!el.zoomChartHelp) return;
  openDialogLayer(el.zoomChartHelp, {
    trigger: event?.currentTarget || document.activeElement,
    initialFocus: "#zoomChartHelpClose",
  });
  refreshLucideIcons();
  try { localStorage.setItem(ZOOM_HELP_KEY, "1"); } catch {}
}
function closeZoomHelp() {
  if (el.zoomChartHelp) closeDialogLayer(el.zoomChartHelp);
}

function updateZoomPeriodButtons() {
  if (!el.zoomChartPeriods) return;
  el.zoomChartPeriods.querySelectorAll("[data-zoom-period]").forEach((button) => {
    const selected = button.dataset.zoomPeriod === state.technicalPeriod;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function showZoomStatus(text) {
  const node = el.zoomChartStatus;
  if (!node) return;
  if (text) {
    node.textContent = text;
    node.hidden = false;
  } else {
    node.hidden = true;
    node.textContent = "";
  }
}

// 放大圖內切換 日/週/月：重新抓該週期官方歷史，再重繪。
async function setZoomPeriod(period) {
  if (!zoomChartState.open || state.technicalPeriod === period) return;
  state.technicalPeriod = period;
  invalidateZoomReadoutLayout({ content: true });
  updateZoomPeriodButtons();
  zoomChartState.locked = false;
  if (el.zoomChartReadout) el.zoomChartReadout.hidden = true;
  showZoomStatus(`載入${formatTechnicalPeriod(period)}資料中…`);
  try {
    await loadTechnicalAnalysis({ notify: false });
  } catch {
    // 結果由下方依 technicalState 判斷。
  }
  if (!zoomChartState.open) return;
  if (!technicalState.data?.candles?.length) {
    showZoomStatus(technicalState.error || "這個週期的官方歷史資料不足");
    return;
  }
  showZoomStatus("");
  zoomChartState.index = technicalState.data.candles.length - 1;
  zoomChartState.pointerY = null;
  zoomChartState.viewStart = 0;
  zoomChartState.viewCount = technicalState.data.candles.length;
  if (el.zoomChartTitle) {
    el.zoomChartTitle.textContent = `${technicalState.data.code} ${technicalState.data.name} ${formatTechnicalPeriod(technicalState.data.period)}`;
  }
  renderZoomWithRetry(8);
}

function drawZoomChart() {
  if (!zoomChartState.open || !el.zoomChartCanvas || !technicalState.data) return;
  const total = technicalState.data.candles.length;
  // 夾住可視視窗（縮放／平移），確保永遠合法。
  let count = zoomChartState.viewCount;
  if (!Number.isInteger(count) || count <= 0 || count > total) count = total;
  count = Math.max(Math.min(ZOOM_MIN_BARS, total), Math.min(total, count));
  let start = Number.isInteger(zoomChartState.viewStart) ? zoomChartState.viewStart : 0;
  start = Math.max(0, Math.min(start, total - count));
  zoomChartState.viewCount = count;
  zoomChartState.viewStart = start;
  const viewEnd = start + count - 1;
  const geometry = drawTechnicalChart(technicalState.data, { canvas: el.zoomChartCanvas, enlarged: true, viewStart: start, viewEnd });
  zoomChartState.geometry = geometry;
  if (!geometry) return;
  // 未鎖定時才把游標夾回可視範圍；鎖定代表使用者指定的是同一根 K 棒，
  // 不能因 resize／重畫就悄悄換成視窗邊緣的另一根。
  if (!zoomChartState.locked && (zoomChartState.index < start || zoomChartState.index > viewEnd)) {
    zoomChartState.index = Math.max(start, Math.min(viewEnd, zoomChartState.index < 0 ? viewEnd : zoomChartState.index));
  }
  // 游標層尺寸對齊底圖。
  const cross = el.zoomCrosshairCanvas;
  if (cross) prepareCanvas(cross);
  drawZoomCrosshair();
}

function redrawZoom() {
  drawZoomChart();
  updateZoomReadout(zoomChartState.index);
}

// 以 centerAbsIndex 為定點縮放：factor>1 → 看更多根（縮小）；factor<1 → 看更少根（放大）。
function zoomViewBy(factor, centerAbsIndex, centerX) {
  const geometry = zoomChartState.geometry;
  if (!geometry) return;
  const totalBars = geometry.candles.length;
  const minBars = Math.min(ZOOM_MIN_BARS, totalBars);
  let count = Math.round(zoomChartState.viewCount * factor);
  count = Math.max(minBars, Math.min(totalBars, count));
  if (count === zoomChartState.viewCount) return;
  const stepNew = geometry.chartWidth / Math.max(1, count - 1);
  let start = Math.round(centerAbsIndex - (centerX - geometry.left) / stepNew);
  start = Math.max(0, Math.min(start, totalBars - count));
  zoomChartState.viewStart = start;
  zoomChartState.viewCount = count;
  redrawZoom();
}

// 平移：以「根」為單位移動可視視窗。
function panViewByBars(deltaBars) {
  const geometry = zoomChartState.geometry;
  if (!geometry || !deltaBars) return;
  const totalBars = geometry.candles.length;
  const start = Math.max(0, Math.min(zoomChartState.viewStart + deltaBars, totalBars - zoomChartState.viewCount));
  if (start === zoomChartState.viewStart) return;
  zoomChartState.viewStart = start;
  redrawZoom();
}

function resetZoomView() {
  const total = technicalState.data?.candles?.length || 0;
  if (!total) return;
  zoomChartState.viewStart = 0;
  zoomChartState.viewCount = total;
  redrawZoom();
}

// ===== 手動畫線工具：趨勢線／水平線，以「日期＋價格」錨定（縮放／平移／切週期都不跑位），存 localStorage =====
const DRAW_COLORS = ["#ffce82", "#4ce6d4", "#ff7b87", "#6cc6ff", "#eaf2fb"];
const DRAW_STORE_KEY = "stock1.chartDrawings.v1";
const drawState = {
  tool: "cursor",   // cursor | trend | horizontal | erase
  color: DRAW_COLORS[0],
  pending: null,    // 趨勢線第一點 {date, price}
  pointer: null,    // 目前指標 {x, y}（css px，相對 canvas）
  hoverId: null,    // 橡皮擦 hover 高亮
  byCode: loadDrawingsStore(),
};

function loadDrawingsStore() {
  try {
    const obj = JSON.parse(window.localStorage.getItem(DRAW_STORE_KEY) || "{}");
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}
const MAX_DRAWINGS_PER_CODE = 40; // localStorage 有 5-10MB 上限，畫線無上限會默默塞爆
function saveDrawingsStore() {
  try {
    window.localStorage.setItem(DRAW_STORE_KEY, JSON.stringify(drawState.byCode));
  } catch {
    // 容量滿/隱私模式：告知使用者，而不是默默丟失新畫的線
    showToast("畫線太多存不下了，這條線重整後會消失（可用橡皮擦清掉舊線）");
  }
}
function currentDrawCode() { return String(technicalState.data?.code || state.technicalCode || ""); }
function currentDrawings() { return (drawState.byCode[currentDrawCode()] ||= []); }
function addDrawing(drawing) {
  drawing.id = `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const arr = currentDrawings();
  arr.push(drawing);
  while (arr.length > MAX_DRAWINGS_PER_CODE) arr.shift(); // 超限裁最舊的
  saveDrawingsStore();
}
function removeDrawing(id) {
  const arr = currentDrawings();
  const i = arr.findIndex((d) => d.id === id);
  if (i >= 0) { arr.splice(i, 1); saveDrawingsStore(); }
}
function undoDrawing() { const arr = currentDrawings(); if (arr.length) { arr.pop(); saveDrawingsStore(); } }
function clearDrawings() { drawState.byCode[currentDrawCode()] = []; saveDrawingsStore(); }

const drawDateNum = (s) => Number(String(s || "").replace(/\D/g, "")) || 0;
function indexForDate(candles, date) {
  if (!candles || !candles.length) return 0;
  const target = drawDateNum(date);
  const lastI = candles.length - 1;
  if (target <= drawDateNum(candles[0].date)) return 0;
  if (target >= drawDateNum(candles[lastI].date)) return lastI;
  let lo = 0;
  let hi = lastI;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (drawDateNum(candles[mid].date) < target) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(drawDateNum(candles[lo - 1].date) - target) <= Math.abs(drawDateNum(candles[lo].date) - target)) return lo - 1;
  return lo;
}
// 像素 → 錨點(日期, 價格)
function pixelToAnchor(geometry, x, y) {
  const candle = geometry.candles[geometry.indexFromX(x)];
  const clampedY = Math.max(geometry.top, Math.min(geometry.priceBottom, y));
  return { date: candle ? candle.date : "", price: geometry.yToPrice(clampedY) };
}
// 錨點 → 像素
function anchorToPixel(geometry, anchor) {
  return { x: geometry.indexToX(indexForDate(geometry.candles, anchor.date)), y: geometry.priceToY(anchor.price) };
}
// 趨勢線延伸後在圖左右緣的兩端點（給渲染與命中測試共用）
function trendEndpoints(geometry, d) {
  const a = anchorToPixel(geometry, d.p1);
  const b = anchorToPixel(geometry, d.p2);
  const left = geometry.left;
  const right = geometry.candleRight;
  if (a.x === b.x) return { x1: a.x, y1: geometry.top, x2: a.x, y2: geometry.priceBottom, a, b };
  const m = (b.y - a.y) / (b.x - a.x);
  return { x1: left, y1: a.y + m * (left - a.x), x2: right, y2: a.y + m * (right - a.x), a, b };
}
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function hitTestDrawing(geometry, x, y) {
  const left = geometry.left;
  const right = geometry.candleRight;
  let best = null;
  let bestD = 10;
  for (const d of currentDrawings()) {
    let dist = Infinity;
    if (d.type === "h") {
      if (x >= left - 4 && x <= right + 4) dist = Math.abs(y - geometry.priceToY(d.price));
    } else if (d.type === "trend") {
      const e = trendEndpoints(geometry, d);
      dist = distToSegment(x, y, e.x1, e.y1, e.x2, e.y2);
    }
    if (dist < bestD) { bestD = dist; best = d.id; }
  }
  return best;
}

// 在游標層渲染所有畫線 + 預覽。
function renderZoomDrawings(ctx, geometry) {
  const left = geometry.left;
  const right = geometry.candleRight;
  const top = geometry.top;
  const bottom = geometry.priceBottom;
  const seg = (x1, y1, x2, y2, color, w, dash) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const hTags = [];
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  for (const d of currentDrawings()) {
    const hovered = drawState.tool === "erase" && d.id === drawState.hoverId;
    const color = hovered ? "#ff5a54" : (d.color || "#ffce82");
    const w = hovered ? 3 : 1.8;
    if (d.type === "h") {
      const y = geometry.priceToY(d.price);
      seg(left, y, right, y, color, w);
      hTags.push({ y, price: d.price, color });
    } else if (d.type === "trend") {
      const e = trendEndpoints(geometry, d);
      seg(e.x1, e.y1, e.x2, e.y2, color, w);
      ctx.fillStyle = color;
      [e.a, e.b].forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, hovered ? 4 : 3, 0, Math.PI * 2); ctx.fill(); });
    }
  }
  // 趨勢線第一點已放、預覽到指標
  if (drawState.tool === "trend" && drawState.pending && drawState.pointer) {
    const a = anchorToPixel(geometry, drawState.pending);
    seg(a.x, a.y, drawState.pointer.x, drawState.pointer.y, drawState.color, 1.6, [6, 5]);
    ctx.fillStyle = drawState.color;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 水平線預覽（跟著指標 y）
  if (drawState.tool === "horizontal" && drawState.pointer) {
    const y = Math.max(top, Math.min(bottom, drawState.pointer.y));
    seg(left, y, right, y, drawState.color, 1.4, [6, 5]);
  }
  ctx.restore();
  // 水平線價格標籤（畫在右側軌，不裁切）
  const scale = geometry.uiScale || 1;
  ctx.font = `700 ${Math.round(11 * scale)}px 'Stock1 Plex Mono', IBM Plex Mono, monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const t of hTags) {
    const txt = formatTechnicalValue(t.price, t.price >= 500 ? 0 : 1);
    const w = ctx.measureText(txt).width + Math.round(12 * scale);
    const bx = right + Math.round(3 * scale);
    roundRect(ctx, bx, t.y - Math.round(9 * scale), w, Math.round(18 * scale), Math.round(4 * scale));
    ctx.fillStyle = "rgba(10, 15, 21, 0.92)";
    ctx.fill();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 0.5, t.y - Math.round(9 * scale) + 0.5, w - 1, Math.round(18 * scale) - 1, Math.round(4 * scale));
    ctx.stroke();
    ctx.fillStyle = t.color;
    ctx.fillText(txt, bx + Math.round(6 * scale), t.y + 0.5);
  }
  ctx.textBaseline = "alphabetic";
}

// 畫線模式：指標按下放點／刪除。
function handleDrawPointerDown(clientX, clientY) {
  const g = zoomChartState.geometry;
  const cross = el.zoomCrosshairCanvas;
  if (!g || !cross) return;
  const rect = cross.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  drawState.pointer = { x, y };
  if (drawState.tool === "horizontal") {
    addDrawing({ type: "h", price: pixelToAnchor(g, x, y).price, color: drawState.color });
  } else if (drawState.tool === "trend") {
    const anchor = pixelToAnchor(g, x, y);
    if (!drawState.pending) {
      drawState.pending = anchor;
    } else {
      addDrawing({ type: "trend", p1: drawState.pending, p2: anchor, color: drawState.color });
      drawState.pending = null;
    }
  } else if (drawState.tool === "erase") {
    const id = hitTestDrawing(g, x, y);
    if (id) { removeDrawing(id); drawState.hoverId = null; }
  }
  drawZoomCrosshair();
}

function handleDrawPointerMove(clientX, clientY) {
  const g = zoomChartState.geometry;
  const cross = el.zoomCrosshairCanvas;
  if (!g || !cross) return;
  const rect = cross.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  drawState.pointer = { x, y };
  if (drawState.tool === "erase") drawState.hoverId = hitTestDrawing(g, x, y);
  // 鎖定時仍可預覽／擦除畫線，但不得偷偷換掉已鎖定的 K 棒讀數。
  if (!zoomChartState.locked) {
    zoomChartState.index = g.indexFromX(x);
    zoomChartState.pointerY = y;
  }
  drawZoomCrosshair();
  updateZoomReadout(zoomChartState.index);
}

function setDrawTool(tool) {
  drawState.tool = tool;
  drawState.pending = null;
  drawState.hoverId = null;
  updateDrawToolsUI();
  if (zoomChartState.open) drawZoomCrosshair();
}

function renderDrawColors() {
  if (!el.zoomChartColors) return;
  el.zoomChartColors.innerHTML = DRAW_COLORS
    .map((c) => `<button type="button" class="zoom-color-swatch${c === drawState.color ? " is-active" : ""}" data-draw-color="${c}" style="--sw:${c}" aria-label="顏色 ${c}" aria-pressed="${c === drawState.color}"></button>`)
    .join("");
}

function updateDrawToolsUI() {
  // 色票群只在「會用到顏色」的工具（趨勢線／水平線）才滑出。
  const usesColor = drawState.tool === "trend" || drawState.tool === "horizontal";
  el.zoomChartTools?.classList.toggle("is-drawing", usesColor);
  el.zoomChartTools?.querySelectorAll("[data-draw-tool]").forEach((b) => {
    const selected = b.dataset.drawTool === drawState.tool;
    b.classList.toggle("is-active", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
  el.zoomChartColors?.querySelectorAll("[data-draw-color]").forEach((b) => {
    const selected = b.dataset.drawColor === drawState.color;
    b.classList.toggle("is-active", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
  invalidateZoomReadoutLayout();
}

function drawZoomCrosshair() {
  const cross = el.zoomCrosshairCanvas;
  const geometry = zoomChartState.geometry;
  if (!cross || !geometry) return;
  const ctx = cross.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const cssW = cross.width / ratio;
  const cssH = cross.height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // 先畫使用者的手動畫線（在十字游標底下），永遠隨縮放／平移重新定位。
  renderZoomDrawings(ctx, geometry);

  const index = zoomChartState.index;
  if (index == null || index < 0) return;
  const candle = geometry.candles[index];
  if (!candle) return;
  const scale = geometry.uiScale || 1;
  const locked = zoomChartState.locked;
  const x = geometry.indexToX(index);

  // 垂直線／高亮貫穿到 MACD 副圖底部（若有）。
  const colBottom = geometry.lineBottom || geometry.volumeBottom;
  // 被檢視那根的「直欄高亮」：墊一條半透明直欄，一眼看出在看哪一根。
  const bandW = Math.max(8 * scale, geometry.step * 0.9);
  ctx.fillStyle = locked ? "rgba(255, 206, 130, 0.1)" : "rgba(255, 255, 255, 0.055)";
  ctx.fillRect(x - bandW / 2, geometry.top - 6, bandW, colBottom - geometry.top + 6);

  // 鎖定時用實線、較亮，當作明確的「凍結」訊號。
  ctx.strokeStyle = locked ? "rgba(255, 206, 130, 0.98)" : "rgba(245, 196, 90, 0.92)";
  ctx.lineWidth = Math.max(1, scale * (locked ? 1.1 : 0.85));
  ctx.setLineDash(locked ? [] : [5, 5]);
  // 垂直線（價格區 + 量能區 + MACD）
  ctx.beginPath();
  ctx.moveTo(x, geometry.top - 6);
  ctx.lineTo(x, colBottom);
  ctx.stroke();
  // 水平線：跟著手指／滑鼠的 Y（夾在價格區內），沒有就對齊收盤。
  let hy = Number.isFinite(zoomChartState.pointerY) ? zoomChartState.pointerY : geometry.priceToY(candle.close);
  hy = Math.max(geometry.top, Math.min(geometry.priceBottom, hy));
  ctx.beginPath();
  ctx.moveTo(geometry.left, hy);
  ctx.lineTo(geometry.plotRight, hy);
  ctx.stroke();
  ctx.setLineDash([]);

  // 收盤點（鎖定時加一圈外環強調）
  const cy = geometry.priceToY(candle.close);
  const dotR = 3.5 * Math.min(scale, 1.6);
  if (locked) {
    ctx.strokeStyle = "rgba(255, 206, 130, 0.95)";
    ctx.lineWidth = Math.max(1.5, scale);
    ctx.beginPath();
    ctx.arc(x, cy, dotR + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffce82";
  ctx.beginPath();
  ctx.arc(x, cy, dotR, 0, Math.PI * 2);
  ctx.fill();

  // 游標日期籤：貼在日期軸上（垂直線正下方），不用回頭看左上讀數卡就知道指到哪一天。
  const dateLabel = String(candle.date || "").replace(/-/g, "/");
  if (dateLabel) {
    ctx.save();
    ctx.font = `700 ${Math.round(12 * scale)}px 'Stock1 Plex Mono', IBM Plex Mono, monospace`;
    const dPadX = Math.round(8 * scale);
    const dW = Math.ceil(ctx.measureText(dateLabel).width) + dPadX * 2;
    const dH = Math.round(20 * scale);
    const dX = Math.max(geometry.left, Math.min(geometry.plotRight - dW, x - dW / 2));
    const dY = Math.min(cssH - dH - 2, colBottom + Math.round(3 * scale));
    ctx.fillStyle = locked ? "rgba(255, 206, 130, 0.98)" : "rgba(245, 196, 90, 0.94)";
    roundRect(ctx, dX, dY, dW, dH, 4);
    ctx.fill();
    ctx.fillStyle = "#211603";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(dateLabel, dX + dW / 2, dY + dH / 2 + 0.5);
    ctx.restore();
  }

  // 價格讀數：做成「貼在水平線上、停在版面乾淨處」的小標籤。維持在游標的精確高度（hy）讓語意明確，
  // 只沿著水平線往右找「最靠右的乾淨空檔」擺放——不擠進右側價格欄，也不蓋到 K 棒／讀數面板／工具列。
  const price = geometry.yToPrice(hy);
  const label = formatTechnicalValue(price, price >= 500 ? 0 : 1);
  ctx.font = `700 ${Math.round(12.5 * scale)}px 'Stock1 Plex Mono', IBM Plex Mono, monospace`;
  const padX = Math.round(9 * scale);
  const tagH = Math.round(22 * scale);
  const tagW = Math.ceil(ctx.measureText(label).width) + padX * 2;
  const bandPad = Math.round(4 * scale);
  const bandTop = hy - tagH / 2 - bandPad;
  const bandBot = hy + tagH / 2 + bandPad;

  // 蒐集會在「這條水平線高度」擋到標籤的 x 區間：縱向觸及此高度的 K 棒，以及浮動的讀數面板／工具列。
  const obstacles = [];
  const cw = (geometry.candleWidth || 6) + bandPad;
  for (let i = geometry.viewStart; i <= geometry.viewEnd; i += 1) {
    const c = geometry.candles[i];
    if (!c) continue;
    const hiY = geometry.priceToY(c.high);
    const loY = geometry.priceToY(c.low);
    if (hiY <= bandBot && loY >= bandTop) {
      const cx = geometry.indexToX(i);
      obstacles.push([cx - cw / 2, cx + cw / 2]);
    }
  }
  const canvasRect = cross.getBoundingClientRect();
  [el.zoomChartReadout, el.zoomChartTools].forEach((node) => {
    if (!node || node.hidden) return;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ry1 = r.top - canvasRect.top;
    const ry2 = r.bottom - canvasRect.top;
    if (ry1 <= bandBot && ry2 >= bandTop) {
      obstacles.push([r.left - canvasRect.left - bandPad, r.right - canvasRect.left + bandPad]);
    }
  });

  // 在 [left, plotRight) 內把障礙扣掉，算出所有「寬度夠的乾淨間隙」。
  const slotMin = geometry.left + 2;
  const slotMax = geometry.plotRight - 4;
  const merged = [];
  obstacles
    .map(([a, b]) => [Math.max(slotMin, a), Math.min(slotMax, b)])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0])
    .forEach((iv) => {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    });
  const gaps = [];
  let cur = slotMin;
  merged.forEach(([a, b]) => {
    if (a - cur >= tagW) gaps.push([cur, a]);
    cur = Math.max(cur, b);
  });
  if (slotMax - cur >= tagW) gaps.push([cur, slotMax]);
  // 擺放原則：讀數緊貼「十字交叉點（垂直線 x）」——你正在看的地方，但**刻意往左或右錯開一點點**，
  // 不正壓在游標上（避免被鼠標箭頭擋到）。clear 用固定像素（鼠標大小不隨圖縮放）。預設往左
  // （箭頭主體朝右下，左側最乾淨）；左側被擋才換右側。整條被擋（罕見）才退而求其次。
  const anchorX = x;
  const clear = 18;                       // 與游標保持的水平淨距（避開鼠標箭頭），固定像素
  const edgePad = Math.round(8 * scale);  // 與真實障礙邊緣的呼吸空間
  const exclLo = anchorX - clear;
  const exclHi = anchorX + clear;
  let tagX = null;
  let bestDist = Infinity;
  const consider = (cand, g0, g1) => {
    const lo = g0 + edgePad;
    const hi = g1 - edgePad - tagW;
    const c = hi >= lo ? Math.max(lo, Math.min(hi, cand)) : (g0 + g1) / 2 - tagW / 2;
    // 必須落在 gap 內、且不與游標排除帶 [exclLo, exclHi] 重疊。
    if (c >= g0 - 0.5 && c + tagW <= g1 + 0.5 && (c + tagW <= exclLo || c >= exclHi)) {
      const d = Math.abs(c + tagW / 2 - anchorX);
      if (d < bestDist) { bestDist = d; tagX = c; }
    }
  };
  gaps.forEach(([g0, g1]) => {
    consider(exclLo - tagW, g0, g1); // 先試游標左側（預設偏好）
    consider(exclHi, g0, g1);        // 再試游標右側
  });
  if (tagX == null) tagX = exclLo - tagW; // 退路：放游標左側，下面再夾回畫布
  tagX = Math.max(slotMin, Math.min(slotMax - tagW, tagX));
  const tagYtop = Math.max(geometry.top + 1, Math.min(geometry.priceBottom - tagH - 1, hy - tagH / 2));

  // 標籤就騎在水平線上（線從中間穿過），語意清楚不需引線；右側軸緣點一個小點標出實際價位，方便對照右欄。
  ctx.fillStyle = "rgba(245, 196, 90, 0.9)";
  ctx.beginPath();
  ctx.arc(geometry.plotRight + 1, hy, 2.4 * Math.min(scale, 1.6), 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, tagX, tagYtop, tagW, tagH, Math.round(5 * scale));
  ctx.fillStyle = "rgb(245, 196, 90)";
  ctx.fill();
  ctx.strokeStyle = "rgba(26, 18, 6, 0.55)";
  ctx.lineWidth = 1;
  roundRect(ctx, tagX + 0.5, tagYtop + 0.5, tagW - 1, tagH - 1, Math.round(5 * scale));
  ctx.stroke();
  ctx.fillStyle = "#1a1206";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, tagX + tagW / 2, tagYtop + tagH / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // MACD 副圖：在被檢視那根的 DIF/DEA 線上點出對應點（數值顯示在讀數面板）。
  if (geometry.macd && candle.macd) {
    const m = candle.macd;
    const toY = geometry.macd.toY;
    const macdDotR = 3 * Math.min(scale, 1.6);
    if (Number.isFinite(m.dif)) {
      ctx.fillStyle = "#f2f7fc";
      ctx.beginPath();
      ctx.arc(x, toY(m.dif), macdDotR, 0, Math.PI * 2);
      ctx.fill();
    }
    if (Number.isFinite(m.dea)) {
      ctx.fillStyle = "#a78bfa";
      ctx.beginPath();
      ctx.arc(x, toY(m.dea), macdDotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function updateZoomReadout(index) {
  const box = el.zoomChartReadout;
  const geometry = zoomChartState.geometry;
  if (!box || !geometry) return;
  const candle = geometry.candles[index];
  if (!candle) {
    box.hidden = true;
    return;
  }
  const prev = geometry.candles[index - 1];
  const change = prev && Number.isFinite(prev.close) ? candle.close - prev.close : null;
  const changePct = change != null && prev.close ? (change / prev.close) * 100 : null;
  // 台股慣例：漲（紅）跌（綠）。
  const dir = change == null ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
  const changeText = change == null
    ? "—"
    : `${arrow} ${formatTechnicalValue(Math.abs(change), 2)} (${formatTechnicalValue(Math.abs(changePct), 2)}%)`;
  // 台股漲跌停（±10%）：達 ±9.9% 就標出來（tick 進位留 0.1% 容差），使用者不用自己心算。
  const limitBadge = changePct != null && changePct >= 9.9
    ? `<span class="zoom-limit is-limit-up">漲停</span>`
    : changePct != null && changePct <= -9.9
      ? `<span class="zoom-limit is-limit-down">跌停</span>`
      : "";
  const vol = Number.isFinite(candle.volumeLots) ? Math.round(candle.volumeLots).toLocaleString("en-US") : "—";
  // 高價（≥500）取整數、低價留一位小數，讓面板更精簡也更好排版。
  const hv = (price) => (Number.isFinite(price) ? formatTechnicalValue(price, price >= 500 ? 0 : 1) : "—");
  const tick = (label, value, cls = "") => `<span class="zoom-tick"><em>${label}</em><b class="${cls}">${escapeHtml(String(value))}</b></span>`;
  const macd = candle.macd || {};
  const oscCls = !Number.isFinite(macd.histogram) ? "" : macd.histogram >= 0 ? "is-osc-up" : "is-osc-down";
  const macdRow = (Number.isFinite(macd.histogram) || Number.isFinite(macd.dif) || Number.isFinite(macd.dea))
    ? `<div class="zoom-metrics zoom-macd">
        <span class="zoom-tick"><em>OSC</em><b class="${oscCls}">${escapeHtml(formatTechnicalValue(macd.histogram, 3))}</b></span>
        ${tick("DIF", formatTechnicalValue(macd.dif, 2), "is-dif")}
        ${tick("DEA", formatTechnicalValue(macd.dea, 2), "is-dea")}
      </div>`
    : "";
  const contentKey = [
    technicalState.data?.code,
    technicalState.data?.period,
    index,
    zoomChartState.locked ? 1 : 0,
    candle.date,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volumeLots,
    candle.maShort,
    candle.maMid,
    macd.histogram,
    macd.dif,
    macd.dea,
  ].join("|");
  const contentChanged = contentKey !== zoomChartState.readoutContentKey;
  box.hidden = false;
  if (contentChanged) {
    zoomChartState.readoutContentKey = contentKey;
    zoomChartState.readoutLayoutKey = "";
    box.classList.toggle("is-up", dir === "up");
    box.classList.toggle("is-down", dir === "down");
    box.classList.toggle("is-flat", dir === "flat");
    box.classList.toggle("is-locked", zoomChartState.locked);
    box.innerHTML = `
      <div class="zoom-readout-head">
        <span class="zoom-readout-date">${escapeHtml(String(candle.date || ""))}</span>
        <span class="zoom-readout-period">${escapeHtml(formatTechnicalPeriod(technicalState.data?.period || "day"))}</span>
        <span class="zoom-readout-lock">🔒 已鎖定</span>
      </div>
      <div class="zoom-readout-price">
        <b class="zoom-readout-close">${hv(candle.close)}</b>
        <span class="zoom-readout-change">${changeText}</span>
        ${limitBadge}
      </div>
      <div class="zoom-ohl">
        ${tick("開", hv(candle.open))}
        ${tick("高", hv(candle.high), "is-hi")}
        ${tick("低", hv(candle.low), "is-lo")}
      </div>
      <div class="zoom-metrics">
        <span class="zoom-tick zoom-vol"><em>量</em><b>${escapeHtml(vol)}<i>張</i></b></span>
        ${tick("MA5", hv(candle.maShort), "is-ma5")}
        ${tick("MA20", hv(candle.maMid), "is-ma20")}
      </div>
      ${macdRow}
    `;
  }
  positionZoomReadout();
}

// 讀數面板智慧定位：永遠待在價格圖內（避開左側 Y 軸座標與右側價格標籤），
// 並滑動到游標的「對角」角落，才不會擋到正在看的那根 K 棒與十字游標。
function positionZoomReadout() {
  const box = el.zoomChartReadout;
  const geometry = zoomChartState.geometry;
  if (!box || !geometry || box.hidden) return;
  const m = Math.round(12 * (geometry.uiScale || 1));
  const plotW = geometry.plotRight - geometry.left;
  const plotH = geometry.priceBottom - geometry.top;
  // 寬度上限縮進圖內，確保左右都不壓到座標／價格標籤。
  const maxW = Math.max(168, Math.min(390, plotW - 2 * m));
  // 太窄（手機）時統計改單欄，長數字（成交量）才不會溢出。
  const narrow = maxW < 240;
  const layoutKey = `${zoomChartState.readoutContentKey}|${Math.round(maxW)}|${narrow ? 1 : 0}`;
  let hw = zoomChartState.readoutWidth;
  let hh = zoomChartState.readoutHeight;
  if (layoutKey !== zoomChartState.readoutLayoutKey || !hw || !hh) {
    box.style.maxWidth = `${maxW}px`;
    box.classList.toggle("is-narrow", narrow);
    hw = box.offsetWidth;
    hh = box.offsetHeight;
    zoomChartState.readoutLayoutKey = layoutKey;
    zoomChartState.readoutWidth = hw;
    zoomChartState.readoutHeight = hh;
    zoomChartState.readoutToolBounds = null;
  }

  const index = zoomChartState.index;
  const candle = geometry.candles[index];
  const cx = geometry.indexToX(index);
  const cy = Number.isFinite(zoomChartState.pointerY)
    ? Math.max(geometry.top, Math.min(geometry.priceBottom, zoomChartState.pointerY))
    : geometry.priceToY(candle ? candle.close : geometry.yToPrice(geometry.top));
  const midX = geometry.left + plotW / 2;
  const midY = geometry.top + plotH / 2;

  // 用門檻做遲滯，避免游標在中線附近時面板來回跳動。
  let side = zoomChartState.hudSide || "L";
  if (cx > midX + plotW * 0.1) side = "L";
  else if (cx < midX - plotW * 0.1) side = "R";
  let vert = zoomChartState.hudVert || "B";
  if (cy > midY + plotH * 0.1) vert = "T";
  else if (cy < midY - plotH * 0.1) vert = "B";
  zoomChartState.hudSide = side;
  zoomChartState.hudVert = vert;

  let leftPx = side === "L" ? geometry.left + m : geometry.plotRight - m - hw;
  let topPx = vert === "T" ? geometry.top + m : geometry.priceBottom - m - hh;
  leftPx = Math.max(4, Math.min(leftPx, geometry.width - hw - 4));

  // 避開浮動的畫線工具列：只要面板水平範圍會疊到工具列，就把上緣壓到它底下。
  // 不限定 vert==='T'：面板很高時即使對齊底部，上緣仍可能頂到工具列（窄螢幕尤其明顯）。
  let minTop = 4;
  let toolBounds = zoomChartState.readoutToolBounds;
  if (!toolBounds && el.zoomChartTools && box.offsetParent) {
    const sRect = box.offsetParent.getBoundingClientRect();
    const tRect = el.zoomChartTools.getBoundingClientRect();
    toolBounds = {
      left: tRect.left - sRect.left,
      right: tRect.right - sRect.left,
      bottom: tRect.bottom - sRect.top,
    };
    zoomChartState.readoutToolBounds = toolBounds;
  }
  if (toolBounds) {
    const overlapsX = leftPx < toolBounds.right + 8 && leftPx + hw > toolBounds.left - 8;
    if (overlapsX) minTop = toolBounds.bottom + 10;
  }
  const topCap = Math.max(minTop, geometry.height - hh - 4);
  topPx = Math.max(minTop, Math.min(topPx, topCap));
  box.style.left = `${Math.round(leftPx)}px`;
  box.style.top = `${Math.round(topPx)}px`;
  box.style.right = "auto";
  box.style.bottom = "auto";
}

function handleZoomPointer(event) {
  const geometry = zoomChartState.geometry;
  const cross = el.zoomCrosshairCanvas;
  if (!zoomChartState.open || !geometry || !cross) return;
  // 鎖定後游標凍結在該根 K 棒，移動／拖曳都不更動，方便把手指移開細看。
  if (zoomChartState.locked) return;
  const rect = cross.getBoundingClientRect();
  const index = geometry.indexFromX(event.clientX - rect.left);
  zoomChartState.index = index;
  zoomChartState.pointerY = event.clientY - rect.top;
  drawZoomCrosshair();
  updateZoomReadout(index);
}

// 點兩下：鎖定／解除鎖定目前這根 K 棒。
function toggleZoomLock() {
  zoomChartState.locked = !zoomChartState.locked;
  drawZoomCrosshair();
  updateZoomReadout(zoomChartState.index);
  showToast(zoomChartState.locked ? "已鎖定這根 K 棒 · 再點兩下解除" : "已解除鎖定");
}

// 鍵盤逐根移動：把游標移到指定 K 棒，水平線對齊該根收盤。
function stepZoomToIndex(target) {
  const geometry = zoomChartState.geometry;
  if (!geometry || !zoomChartState.open) return;
  const index = Math.max(0, Math.min(geometry.candles.length - 1, target));
  zoomChartState.index = index;
  const candle = geometry.candles[index];
  if (candle) zoomChartState.pointerY = geometry.priceToY(candle.close);
  // 移到可視範圍外時，順勢把視窗捲過去（縮放狀態下逐根也能一路看下去）。
  if (index < zoomChartState.viewStart || index > zoomChartState.viewStart + zoomChartState.viewCount - 1) {
    const total = geometry.candles.length;
    let start = index < zoomChartState.viewStart ? index : index - zoomChartState.viewCount + 1;
    start = Math.max(0, Math.min(start, total - zoomChartState.viewCount));
    zoomChartState.viewStart = start;
    redrawZoom();
    return;
  }
  drawZoomCrosshair();
  updateZoomReadout(index);
}

function stepZoomIndex(delta) {
  stepZoomToIndex((zoomChartState.index ?? 0) + delta);
}

function drawTechnicalMacdChart(data) {
  const canvas = el.technicalMacdChart;
  if (!canvas) return null;
  const metrics = prepareCanvas(canvas);
  if (!metrics) return null;
  const { context, width, height } = metrics;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0b1016";
  context.fillRect(0, 0, width, height);

  if (!data?.candles?.length) {
    context.fillStyle = "#b8cadc";
    context.font = "700 16px Microsoft JhengHei, sans-serif";
    context.textAlign = "center";
    context.fillText("等待 MACD 資料", width / 2, height / 2);
    return;
  }

  const candles = data.candles;
  // 與主圖使用相同左右邊界，讓上下兩張圖的 K 棒位置對齊。
  const left = 58;
  const right = width >= 520 ? 128 : 116;
  const top = 48;
  const bottom = height - 22;
  const plotRight = width - right;
  const candleRight = plotRight - 12;
  const chartWidth = Math.max(1, candleRight - left);
  const step = chartWidth / Math.max(1, candles.length - 1);
  const candleWidth = Math.max(3, Math.min(9, step * 0.62));
  const macdValues = candles.flatMap((item) => [item.macd?.dif, item.macd?.dea, item.macd?.histogram]).filter(Number.isFinite);

  if (!macdValues.length) {
    context.fillStyle = "#b8cadc";
    context.font = "700 16px Microsoft JhengHei, sans-serif";
    context.textAlign = "center";
    context.fillText("MACD 資料不足", width / 2, height / 2);
    return;
  }

  const macdAbs = Math.max(...macdValues.map((value) => Math.abs(value)), 0.01);
  const macdMid = (top + bottom) / 2;
  const macdToY = (value) => macdMid - (value / macdAbs) * ((bottom - top) * 0.44);
  const indexToX = (index) => left + index * step;

  const last = candles.at(-1)?.macd || {};
  context.fillStyle = "#d8e6f3";
  context.font = "700 13px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif";
  context.textAlign = "left";
  context.fillText(`OSC ${formatTechnicalValue(last.histogram, 4)}`, left, 16);
  drawTechnicalCanvasLegend(context, [
    { label: "DIF 白線", color: "#f2f7fc", width: 3 },
    { label: "DEA 紫線", color: "#a78bfa", width: 3 },
    { label: "OSC 柱", color: "#ff605c", width: 5 },
  ], left + 130, 16, plotRight - 8);

  drawTechnicalGrid(context, left, right, top, bottom, width, 3);
  drawTechnicalLabelLane(context, plotRight, top, bottom, width);
  context.strokeStyle = "rgba(255,255,255,0.32)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, macdMid);
  context.lineTo(plotRight, macdMid);
  context.stroke();

  candles.forEach((candle, index) => {
    const hist = candle.macd?.histogram;
    if (!Number.isFinite(hist)) return;
    const x = indexToX(index);
    context.fillStyle = hist >= 0 ? "#ff605c" : "#29d7b1";
    context.fillRect(x - candleWidth / 2, Math.min(macdMid, macdToY(hist)), candleWidth, Math.max(1, Math.abs(macdMid - macdToY(hist))));
  });
  drawTechnicalSeries(context, candles.map((item) => item.macd?.dif), indexToX, macdToY, "#f2f7fc", 2);
  drawTechnicalSeries(context, candles.map((item) => item.macd?.dea), indexToX, macdToY, "#a78bfa", 2.4);

  const macdLaneMarkers = [];
  if (Number.isFinite(last.histogram)) {
    macdLaneMarkers.push({
      label: "柱",
      value: formatTechnicalValue(last.histogram, 2),
      price: last.histogram,
      color: last.histogram >= 0 ? "#ff605c" : "#29d7b1",
      primary: true,
    });
  }
  if (Number.isFinite(last.dif)) {
    macdLaneMarkers.push({ label: "DIF", value: formatTechnicalValue(last.dif, 2), price: last.dif, color: "#f2f7fc" });
  }
  if (Number.isFinite(last.dea)) {
    macdLaneMarkers.push({ label: "DEA", value: formatTechnicalValue(last.dea, 2), price: last.dea, color: "#a78bfa" });
  }
  drawTechnicalRightLane(context, macdLaneMarkers, {
    top,
    bottom,
    plotRight,
    labelX: plotRight + 13,
    valueToY: macdToY,
    maxBadgeWidth: width - plotRight - 16,
  });

  context.fillStyle = "#b8cadc";
  context.font = "700 12px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif";
  context.textAlign = "left";
  context.fillText(`DIF ${formatTechnicalValue(last.dif, 4)}   DEA ${formatTechnicalValue(last.dea, 4)}`, left, height - 8);
}

function drawTechnicalGrid(context, left, right, top, bottom, width, count) {
  context.strokeStyle = "rgba(255,255,255,0.08)";
  context.lineWidth = 1;
  for (let index = 0; index <= count; index += 1) {
    const y = top + ((bottom - top) / count) * index;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
  }
}

function clampChartValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawTechnicalLabelLane(context, plotRight, top, bottom, width) {
  context.save();
  context.fillStyle = "rgba(255,255,255,0.025)";
  context.fillRect(plotRight + 1, top, width - plotRight - 2, bottom - top);
  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.setLineDash([3, 5]);
  context.beginPath();
  context.moveTo(plotRight, top);
  context.lineTo(plotRight, bottom);
  context.stroke();
  context.restore();
}

function drawRightLaneTick(context, plotRight, y, color, options = {}) {
  const minY = options.minY ?? 0;
  const maxY = options.maxY ?? 9999;
  const tickY = clampChartValue(y, minY, maxY);
  const startX = plotRight + (options.offsetX ?? 8);
  const length = options.length ?? 24;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = options.lineWidth ?? 3;
  context.lineCap = "round";
  if (options.dash) context.setLineDash(options.dash);
  context.beginPath();
  context.moveTo(startX, tickY);
  context.lineTo(startX + length, tickY);
  context.stroke();
  if (options.dot) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(startX + length + 5, tickY, 3.5, 0, Math.PI * 2);
    context.fill();
  }
  if (options.text) {
    const font = options.font || "700 12px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif";
    context.setLineDash([]);
    context.font = font;
    context.textAlign = "left";
    context.textBaseline = "middle";
    const text = String(options.text);
    const textX = startX + length + 7;
    const textWidth = Math.ceil(context.measureText(text).width);
    context.fillStyle = "rgba(8,12,16,0.72)";
    roundRect(context, textX - 4, tickY - 10, textWidth + 8, 20, 5);
    context.fill();
    context.fillStyle = options.textColor || color;
    context.fillText(text, textX, tickY + 0.5);
  }
  context.restore();
  return tickY;
}

function layoutRightLaneMarkers(markers, minY, maxY, gap = 33) {
  const sorted = markers
    .map((marker, index) => ({
      ...marker,
      index,
      y: clampChartValue(marker.y, minY, maxY),
    }))
    .sort((a, b) => a.y - b.y);

  sorted.forEach((marker, index) => {
    if (index === 0) return;
    marker.y = Math.max(marker.y, sorted[index - 1].y + gap);
  });

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const marker = sorted[index];
    marker.y = clampChartValue(marker.y, minY, maxY);
    if (index < sorted.length - 1) {
      marker.y = Math.min(marker.y, sorted[index + 1].y - gap);
    }
    marker.y = clampChartValue(marker.y, minY, maxY);
  }

  return sorted;
}

// 把右側所有價位標籤（收盤、壓力、支撐、費波）收進同一條標籤欄：
// 自動錯開避免互相重疊，再用折線把標籤連回實際價位。
function drawTechnicalRightLane(context, markers, lane) {
  const usable = (markers || []).filter((marker) => Number.isFinite(marker.price));
  if (!usable.length) return null;
  const entries = usable.map((marker) => ({
    ...marker,
    anchorY: clampChartValue(lane.valueToY(marker.price), lane.top + 2, lane.bottom - 2),
    y: lane.valueToY(marker.price),
  }));
  const scale = lane.scale || 1;
  const px = (value) => Math.round(value * scale);
  const maxBadgeWidth = Math.max(px(40), lane.maxBadgeWidth || 999);
  const innerPad = px(12); // 徽章內水平留白（左右合計）；文字從 labelX + innerPad/2 起算
  const textOf = (m) => `${m.label} ${m.value}`;
  const fontFor = (m, fp) => `700 ${m.primary ? fp + 1 : fp}px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif`;
  const widestText = (fp) => {
    let w = 0;
    entries.forEach((m) => { context.font = fontFor(m, fp); w = Math.max(w, Math.ceil(context.measureText(textOf(m)).width)); });
    return w;
  };
  // 自動縮字：把最寬的標籤（多半是回撤價）縮到塞得進欄位，確保連小數都完整、不被切。
  // 下限用「絕對」小字級（不隨 uiScale 放大），這樣高價股的長標籤（如「0.382 486.8」）也縮得進去。
  let fontPx = px(13);
  const floorPx = 12;
  let maxTextW = widestText(fontPx);
  while (maxTextW + innerPad > maxBadgeWidth && fontPx > floorPx) {
    fontPx -= 1;
    maxTextW = widestText(fontPx);
  }
  // 統一徽章寬度＝最寬標籤所需寬（夾在欄位內），讓整排徽章對齊、右緣不超出畫布。
  const badgeWidth = Math.min(maxBadgeWidth, maxTextW + innerPad);
  const laidOut = layoutRightLaneMarkers(entries, lane.top + 15, lane.bottom - 15, px(28));
  laidOut.forEach((marker) => {
    const isPrimary = Boolean(marker.primary);
    const text = textOf(marker);
    context.save();

    context.strokeStyle = marker.color;
    context.globalAlpha = isPrimary ? 0.9 : 0.6;
    context.lineWidth = isPrimary ? 1.6 : 1.1;
    if (marker.dash) context.setLineDash(marker.dash);
    const elbowX = lane.labelX - 6;
    context.beginPath();
    context.moveTo(lane.plotRight + 1, marker.anchorY);
    context.lineTo(elbowX, marker.anchorY);
    context.lineTo(elbowX, marker.y);
    context.lineTo(lane.labelX - 1, marker.y);
    context.stroke();
    context.setLineDash([]);

    context.globalAlpha = 1;
    context.fillStyle = marker.color;
    context.beginPath();
    context.arc(lane.plotRight + 1, marker.anchorY, (isPrimary ? 3.6 : 3) * Math.min(scale, 1.5), 0, Math.PI * 2);
    context.fill();

    const badgeHeight = px(isPrimary ? 27 : 24);
    const badgeY = marker.y - badgeHeight / 2;
    const badgeRadius = px(6);
    context.fillStyle = marker.background || "rgba(10, 15, 21, 0.94)";
    roundRect(context, lane.labelX, badgeY, badgeWidth, badgeHeight, badgeRadius);
    context.fill();
    context.strokeStyle = marker.color;
    context.globalAlpha = isPrimary ? 0.95 : 0.7;
    context.lineWidth = Math.max(1, scale * 0.9);
    roundRect(context, lane.labelX + 0.5, badgeY + 0.5, badgeWidth - 1, badgeHeight - 1, badgeRadius);
    context.stroke();
    context.globalAlpha = 1;

    // 文字裁切在徽章內：即使極端情況也不會溢出畫布把小數切掉。
    context.save();
    roundRect(context, lane.labelX, badgeY, badgeWidth, badgeHeight, badgeRadius);
    context.clip();
    context.font = fontFor(marker, fontPx);
    context.fillStyle = marker.textColor || marker.color;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(text, lane.labelX + px(6), marker.y + 0.5);
    context.restore();

    context.restore();
  });
  // 回傳各徽章中心 y 與高度，供放大圖游標讀數「智慧避讓」不蓋到這些靜態標籤。
  return { labelX: lane.labelX, badgeWidth, fontPx, badges: laidOut.map((m) => ({ y: m.y, h: px(m.primary ? 27 : 24) })) };
}

function drawRightLaneBadge(context, text, x, y, options = {}) {
  const font = options.font || "700 12px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif";
  const height = options.height || 27;
  const minY = options.minY ?? 0;
  const maxY = options.maxY ?? 9999;
  context.save();
  context.font = font;
  const width = Math.max(options.minWidth || 42, Math.ceil(context.measureText(text).width) + 15);
  const top = clampChartValue(y - height / 2, minY, Math.max(minY, maxY - height));
  context.fillStyle = options.background || "rgba(45,50,57,0.92)";
  roundRect(context, x, top, width, height, 6);
  context.fill();
  if (options.border) {
    context.strokeStyle = options.border;
    context.lineWidth = 1;
    roundRect(context, x + 0.5, top + 0.5, width - 1, height - 1, 6);
    context.stroke();
  }
  context.fillStyle = options.color || "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x + width / 2, top + height / 2 + 0.5);
  context.restore();
  return { x, y: top, width, height };
}

function drawTechnicalSeries(context, values, indexToX, valueToY, color, width = 2) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  let started = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = indexToX(index);
    const y = valueToY(value);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  });
  if (started) context.stroke();
}

function drawTechnicalTrendLine(context, line, indexToX, priceToY, length, color, label, lane = {}) {
  if (!line) return;
  const startIndex = line.points[0].index;
  const endIndex = length - 1;
  const x1 = indexToX(startIndex);
  const y1 = priceToY(line.slope * startIndex + line.intercept);
  const x2 = indexToX(endIndex);
  const y2 = priceToY(line.slope * endIndex + line.intercept);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.shadowColor = color;
  context.shadowBlur = 7;
  context.setLineDash([9, 6]);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.restore();
  context.setLineDash([]);
  if (lane.labelX) {
    const connectorEnd = lane.showTick === false && Number.isFinite(lane.plotRight)
      ? lane.plotRight + 1
      : lane.labelX - 4;
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(connectorEnd, y2);
    context.stroke();
    if (lane.compact) {
      if (lane.showTick !== false) {
        const valueText = formatTechnicalValue(line.slope * endIndex + line.intercept);
        drawRightLaneTick(context, lane.plotRight ?? lane.labelX - 8, y2, color, {
          minY: lane.top + 4,
          maxY: lane.bottom - 4,
          length: 8,
          lineWidth: 3,
          dot: true,
          text: valueText,
          textColor: color,
        });
      }
      return;
    }
    drawRightLaneBadge(context, label, lane.labelX, y2, {
      background: "rgba(13,18,24,0.82)",
      border: color,
      color,
      minWidth: 36,
      height: 22,
      minY: lane.top + 4,
      maxY: lane.bottom - 4,
      font: "700 12px Microsoft JhengHei, sans-serif",
    });
  }
}

function drawTechnicalFibonacci(context, fibonacci, left, right, priceToY, lane = {}) {
  if (!fibonacci?.active) return;
  context.font = "700 12px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif";
  const labels = fibonacci.levels
    .map((level, index) => ({ level, index, y: priceToY(level.price) }))
    .sort((a, b) => a.y - b.y);
  const minY = (lane.top ?? 0) + 18;
  const maxY = (lane.bottom ?? 9999) - 18;
  labels.forEach((item, index) => {
    if (index > 0 && item.y - labels[index - 1].labelY < 19) {
      item.labelY = labels[index - 1].labelY + 19;
    } else {
      item.labelY = item.y;
    }
  });
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const item = labels[index];
    item.labelY = clampChartValue(item.labelY, minY, maxY);
    if (index < labels.length - 1 && labels[index + 1].labelY - item.labelY < 19) {
      item.labelY = labels[index + 1].labelY - 19;
    }
    item.labelY = clampChartValue(item.labelY, minY, maxY);
  }
  labels.sort((a, b) => a.index - b.index).forEach(({ level, y, labelY }) => {
    context.strokeStyle = level.near ? "rgba(157,124,255,0.88)" : "rgba(157,124,255,0.34)";
    context.lineWidth = level.near ? 2 : 1;
    context.setLineDash(level.near ? [] : [2, 7]);
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.setLineDash([]);
    const labelText = `${level.ratio} ${formatTechnicalValue(level.price)}`;
    if (lane.labelX) {
      if (lane.compact && lane.showTicks === false) return;
      context.strokeStyle = "rgba(157,124,255,0.48)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(right, y);
      context.lineTo(lane.labelX - 3, labelY);
      context.stroke();
      if (lane.compact) {
        drawRightLaneTick(context, lane.plotRight ?? right, labelY, level.near ? "#d8ccff" : "#9d7cff", {
          minY,
          maxY,
          length: level.near ? 27 : 19,
          lineWidth: level.near ? 4 : 2,
          dash: level.near ? null : [3, 5],
        });
        return;
      }
      drawRightLaneBadge(context, labelText, lane.labelX, labelY, {
        background: level.near ? "rgba(64,45,130,0.86)" : "rgba(28,24,45,0.82)",
        border: level.near ? "rgba(216,204,255,0.72)" : "rgba(157,124,255,0.35)",
        color: level.near ? "#f1ebff" : "#cfc1ff",
        minWidth: 64,
        height: 22,
        minY,
        maxY,
        font: "700 11px 'Stock1 Plex Mono', IBM Plex Mono, Microsoft JhengHei, sans-serif",
      });
    }
  });
}

// 個股明細的「到價提醒」盒：目前這檔的提醒清單＋新增表單。
// 使用者輸入到一半時不重繪（同公司簡介的作法），避免 10 秒輪詢吃掉打到一半的數字。
function renderPriceAlertBox(stock) {
  const box = el.priceAlertBox;
  if (!box) return;
  if (!stock) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  if (box.contains(document.activeElement)) return;
  box.hidden = false;
  const alerts = alertsForCode(stock.code);
  const rows = alerts
    .map((alert) => `
      <div class="alert-row ${alert.triggeredAt ? "is-done" : ""}">
        <span class="alert-cond">${alert.op === "<=" ? "跌到" : "漲到"} ${formatNumber(alert.price)}</span>
        <span class="alert-state">${alert.triggeredAt ? `已觸發 ${escapeHtml(formatLocalTime(alert.triggeredAt))}` : "等待中"}</span>
        <button class="alert-del" data-alert-remove="${escapeHtml(alert.id)}" type="button" aria-label="刪除這個提醒">刪除</button>
      </div>
    `)
    .join("");
  const price = Number(stock.price);
  const placeholder = Number.isFinite(price) ? String(price) : "目標價";
  const runtimeHint = getSelectedSource() === "official"
    ? "僅在頁面顯示於前景時，每 10 秒用最新即時價判斷"
    : "券商模式不自動輪詢；按「重新整理」取得新報價後才判斷";
  box.innerHTML = `
    <div class="alert-head">
      <strong>到價提醒</strong>
      <small>${authState.user ? `${runtimeHint}（跳提示＋音效，觸發一次即停）` : "登入後可設定（更多 → 帳號管理）"}</small>
    </div>
    ${rows}
    ${authState.user ? `
      <form class="alert-form" data-alert-form data-alert-code="${escapeHtml(stock.code)}">
        <select name="op" aria-label="提醒條件">
          <option value=">=">漲到</option>
          <option value="<=">跌到</option>
        </select>
        <input name="price" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="${escapeHtml(placeholder)}" aria-label="目標價" required />
        <button type="submit">新增</button>
      </form>` : ""}
  `;
}

function getQuoteDisplayContext(stock, now = new Date()) {
  const noLive = stock?.priceStale === true;
  const sourceKind = stock?.sourceKind || "";
  const quoteDate = extractIsoDate(stock?.asOf);
  const today = getTaiwanClockParts(now).isoDate;
  const realtimeSource = sourceKind === "realtime" || sourceKind === "broker-realtime";
  const staleByDate = Boolean(realtimeSource && quoteDate && quoteDate !== today);
  let label;
  if (noLive) {
    label = isTaiwanRegularSession(now)
      ? "暫無即時成交・顯示昨收"
      : quoteDate
        ? `${compactDateLabel(quoteDate)} 收盤`
        : "最近收盤";
  } else if (staleByDate) {
    label = `最後成交 ${compactDateLabel(quoteDate)}`;
  } else if (realtimeSource && quoteDate === today && !isTaiwanRegularSession(now)) {
    label = "今日收盤";
  } else if (sourceKind === "daily-close" && quoteDate && quoteDate !== today) {
    label = `${compactDateLabel(quoteDate)} 收盤`;
  } else {
    label = {
      "realtime": "盤中即時",
      "daily-close": "今日收盤",
      "broker-realtime": "券商即時",
      "overnight-signal": "訊號日收盤",
      "technical-history": "歷史日K",
    }[sourceKind] || "官方資料";
  }
  return { label, noLive, staleByDate, stale: noLive || staleByDate };
}

function getDetailScreenContext(stock) {
  if (state.screen !== "surveillance" || !surveillanceBoardState.data || !stock?.code) return "";
  const tab = state.surveillanceTab;
  const visible = survVisibleList(surveillanceBoardState.data[tab] || [], tab);
  return visible.some((item) => item.code === stock.code) ? "" : "不在目前篩選";
}

function renderDetail() {
  const stock = getSelectedStock();
  renderPriceAlertBox(stock);
  if (!stock) {
    // 股票池尚未載入（啟動瞬間）：清空所有欄位顯示等待狀態，報價進來後 render() 會重畫。
    const placeholders = {
      detailName: "資料載入中",
      detailTags: "正在抓官方報價",
      detailPrice: "--",
      detailChange: "",
    };
    for (const [id, text] of Object.entries(placeholders)) {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    }
    // 報價還沒進來，不該留著上一檔的漲跌底色與 stale 邊框。
    document.getElementById("priceHero")?.classList.remove("is-up", "is-down", "is-flat", "is-stale");
    return;
  }
  const indicatorAliasMap = {
    主力成交量: "量價摘要",
    量能集中: "量價摘要",
    外資投信: "法人籌碼",
    自營商: "法人籌碼",
    融資融券: "風險提醒",
    布林均線: "技術均線",
  };
  if (indicatorAliasMap[state.indicator]) state.indicator = indicatorAliasMap[state.indicator];
  if (!indicatorLabels.includes(state.indicator)) state.indicator = indicatorLabels[0];
  if (state.detailTab === "K線") state.detailTab = "均線";
  const validDetailTabs = ["即時", "均線", "法人", "基本面"];
  if (!validDetailTabs.includes(state.detailTab)) state.detailTab = "即時";
  const quoteContext = getQuoteDisplayContext(stock);
  const noLive = quoteContext.noLive; // 即時無成交價，顯示的 price 是退回的官方收盤價（不是真現價）
  const changeNum = Number(stock.change) || 0;
  const isFlat = Math.abs(changeNum) < 0.005; // 漲跌幅四捨五入後為 0.00% ＝平盤
  // 凌晨／盤後看到上一交易日「最後成交」仍有明確漲跌方向，應維持台股紅漲綠跌；
  // 收盤價仍有相對昨收的有效漲跌；是否即時由上方「收盤」標記揭露。
  // 只有平盤才使用中性色，避免把實際收漲／收跌誤畫成灰色。
  const neutral = isFlat;
  // 原本這裡還有一個 movement，只被下面「第 5 格」的渲染用掉，而那是死碼：
  // .chart-metric.positive 從來沒有可見效果（em 與 strong 各有明確色，會蓋掉繼承來的顏色），
  // 而且就算補上規則也是拿「股價方向」去染總量／週轉／法人合計／殖利率四個不同的東西。
  document.getElementById("detailName").textContent = `${stock.code} ${stock.name}`;
  const exchangeLabel = formatExchangeLabel(stock.exchange);
  const sourceKindLabel = quoteContext.label;
  const tagsEl = document.getElementById("detailTags");
  // 「最後成交 07/24」已經是判讀過的結論，後面再接一次完整時戳「2026/07/24 13:30:00」
  // 等於同一個日期講兩次，格式還不一致，而且在 430px 的欄寬剛好把副標擠成兩行。
  // 結論已含那個日期時只補時間；沒含時保留原樣。完整時戳移到 title。
  const asOfText = String(stock.asOf || "");
  const asOfDateMatch = asOfText.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  const asOfMonthDay = asOfDateMatch ? `${asOfDateMatch[2]}/${asOfDateMatch[3]}` : "";
  const asOfTime = (asOfText.match(/\d{2}:\d{2}/) || [""])[0];
  const asOfLabel = asOfMonthDay && sourceKindLabel.includes(asOfMonthDay) ? asOfTime : asOfText;
  tagsEl.textContent = stock.official
    ? [exchangeLabel, sourceKindLabel, asOfLabel, getDetailScreenContext(stock)].filter(Boolean).join(" ・ ")
    : `${formatStrategyLabel(stock.strategies[0])} ・ ${stock.groups.includes("overnight") ? "隔日沖訊號" : "盤中觀察"} ・ 本機推估`;
  tagsEl.title = stock.official
    ? `資料來源：${stock.source || "官方"}${asOfText ? ` / ${asOfText}` : ""}`
    : "";
  document.getElementById("detailPrice").textContent = formatQuotePrice(stock.price);
  document.getElementById("detailChange").textContent = noLive
    ? `收盤 ${stock.priceChange !== undefined && stock.priceChange !== null ? `${formatSignedPrice(stock.priceChange)} ` : ""}(${formatSignedPercent(stock.change)})`
    : isFlat
      ? "平盤 0.00%"
      : stock.priceChange !== undefined && stock.priceChange !== null
        ? `${formatSignedPrice(stock.priceChange)} (${formatSignedPercent(stock.change)})`
        : `${stock.change >= 0 ? "▲" : "▼"}${Math.abs(stock.change).toFixed(2)}%`;
  // 漲跌方向與新鮮度都用 class 交給 CSS（與 .market-pill / .chart-zoom-readout 同機制）。
  // 舊寫法是 app.js 唯一一處 inline 顏色，而 #434a56 是全 repo 唯一出現的那個色碼；
  // 更麻煩的是 inline style 會永久遮蔽 CSS 裡的背景規則，樣式沒有辦法覆寫。
  const heroEl = document.getElementById("priceHero");
  heroEl.classList.toggle("is-up", !neutral && changeNum > 0);
  heroEl.classList.toggle("is-down", !neutral && changeNum < 0);
  heroEl.classList.toggle("is-flat", neutral);
  // 新鮮度第一次有視覺編碼：底色仍守台股紅漲綠跌（方向不可被新鮮度蓋掉），
  // 「這不是即時成交」只用琥珀邊框揭露，配色沿用 .market-pill.is-stale。
  heroEl.classList.toggle("is-stale", Boolean(noLive));
  // 策略基準收盤：若這檔同時在策略雷達榜單上（多半是從卡片點進來的），把卡片用的「官方收盤（當日凍結）」
  // 並排顯示在即時報價下方，讓使用者一眼看懂上方即時 vs 榜單基準的關係，不必回去卡片對照。
  const basisEl = document.getElementById("detailStrategyBasis");
  if (basisEl) {
    const basis = (strategyState.picks || []).find((pick) => pick.code === stock.code);
    if (basis) {
      const iso = String(basis.asOf || "");
      const monthDay = iso.length >= 10 ? `${iso.slice(5, 7)}/${iso.slice(8, 10)} ` : "";
      const scenarioName = basis.scenario?.name
        ? `${basis.scenario.name}${basis.rank ? ` RANK ${basis.rank}` : ""}`
        : "策略雷達";
      basisEl.innerHTML = `<span class="dsb-tag">📌 ${scenarioName}</span><span class="dsb-body">策略基準：<b>${monthDay}收盤 ${formatNumber(basis.price)}</b>；上方是${escapeHtml(quoteContext.label)}，盤中或跨交易日時兩者不同，屬正常。</span>`;
      basisEl.hidden = false;
    } else {
      basisEl.hidden = true;
      basisEl.innerHTML = "";
    }
  }
  const spark = stock.spark.length ? stock.spark : [stock.price];
  const dailyClosesForTabs = getDailyClosesForStock(stock);
  const maTabSeries = dailyClosesForTabs && dailyClosesForTabs.length >= 5 ? dailyClosesForTabs : spark;
  const maTabIsDaily = maTabSeries === dailyClosesForTabs;
  const ma5 = average(maTabSeries.slice(-5));
  const maLongLength = Math.min(20, maTabSeries.length);
  const maLong = average(maTabSeries.slice(-maLongLength));
  const institutional = stock.institutional;
  const institutionalStatus = institutionalState.loading
    ? "法人載入中"
    : institutional
      ? `法人 ${institutional.asOf}`
      : institutionalState.error
        ? "法人更新失敗"
        : "法人無資料";
  // 價與均線的差才有方向（均價本身是水準值）。這與同一面板往下約 200px 的「技術均線」指標
  // 用的是同一個判斷（buildIndicatorDetail 的 stock.price >= ma5），兩處顏色從此一致。
  const priceNum = finiteNumberOrNull(stock.price);
  const maDiffTone = (maValue) => (
    priceNum === null || finiteNumberOrNull(maValue) === null ? "na" : metricToneFromNet(priceNum - maValue)
  );
  // 紅綠色盲下 MA 那兩格的顏色是**唯一**的編碼（法人有 +/-、營收 YoY 有 ▲▼，均線什麼都沒有），
  // 所以再給一個文字編碼。用詞與同一面板往下 200px 的「技術均線」指標一致。
  const maFlag = (tone) => (tone === "up" ? "價在上" : tone === "down" ? "價在下" : "");
  // 收盤位置：收在當日最低＝最弱的形態，收在最高＝最強。三個數字本來都在畫面上，
  // 只是被當成不相關的並列數字，從來沒有人把它們關聯起來。
  // 這裡只比對已有的值、不新增任何計算或門檻，所以徽章永遠不會和畫面上的數字矛盾。
  const dayHighNum = finiteNumberOrNull(stock.high ?? Math.max(...spark));
  const dayLowNum = finiteNumberOrNull(stock.low ?? Math.min(...spark));
  // 高＝低（一價到底／漲停鎖死／spark 只有一點）時收盤位置無定義；
  // noLive 時 price 是退回的官方收盤價、不是這一天的成交，兩種情形都不標。
  const canFlagPosition = dayHighNum !== null && dayLowNum !== null
    && dayHighNum > dayLowNum && priceNum !== null && !noLive;
  const atDayHigh = canFlagPosition && Math.abs(priceNum - dayHighNum) < 1e-9;
  const atDayLow = canFlagPosition && Math.abs(priceNum - dayLowNum) < 1e-9;
  // 「張」在五個格子裡各印一次，還把最長的字串塞進最窄的格子（實測 +1,200 張 溢出 3px）。
  // 單位改由註腳講一次。formatShareLots 本身不動——formatters.test.mjs 直接驗它。
  const netLots = (value) => String(formatShareLots(value)).replace(/\s*張$/, "");
  const detailMetrics = {
    即時: [
      // 開高低都是「水準值」，沒有正負可言 → 不上色，語意由 label 承擔。
      // 舊寫法把「高」寫死紅、「低」寫死綠，在下跌 3.23% 的日子裡紅色的最高價會被讀成利多。
      { label: "開", value: formatNumber(stock.open ?? spark[0]), tone: "neutral" },
      { label: "高", value: formatNumber(stock.high ?? Math.max(...spark)), tone: "neutral", flag: atDayHigh ? "收最高" : "" },
      { label: "低", value: formatNumber(stock.low ?? Math.min(...spark)), tone: "neutral", flag: atDayLow ? "收最低" : "" },
      // 成交量是水準值；而且 --yellow 是注意股專用色、--violet 是處置股專用色，
      // 明細面板不該佔用風險標示的色彩語彙。
      { label: "單量", value: formatOptionalNumber(stock.unit), tone: "neutral" },
      { label: "總量", value: formatOptionalNumber(stock.total), tone: "neutral" },
    ],
    均線: [
      { label: "昨收", value: formatNumber(stock.previousClose ?? spark[0]), tone: "neutral" },
      { label: maTabIsDaily ? "MA5" : "盤中均", value: formatNumber(ma5), tone: maDiffTone(ma5), flag: maFlag(maDiffTone(ma5)) },
      { label: maTabIsDaily && maLongLength >= 20 ? "MA20" : `${maLongLength}筆均`, value: formatNumber(maLong), tone: maDiffTone(maLong), flag: maFlag(maDiffTone(maLong)) },
      // 量比與週轉率的「高低算好算壞」沒有既定門檻，強度判斷留在下方「量價摘要」（那裡已有門檻與說明）。
      { label: "量比5", value: stock.avgVol ? formatNumber(stock.avgVol) : "--", tone: stock.avgVol ? "neutral" : "na" },
      { label: "週轉", value: stock.turnover ? `${formatNumber(stock.turnover)}%` : "--", tone: stock.turnover ? "neutral" : "na" },
    ],
    法人: institutional
      ? [
          // 買賣超本身就有正負，紅綠必須跟著值走。舊寫法把投信寫死紅、自營寫死綠，
          // 於是「紅色的 -800（賣超）」與「綠色的 +500（買超）」會直接讀成相反的意思。
          { label: "外陸資", value: netLots(institutional.foreignNet), tone: metricToneFromNet(institutional.foreignNet) },
          // 官方 T86 的「三大法人合計」含外資自營商，但它不在外陸資／投信／自營三欄裡。
          // 少了這一格，畫面上四個數字永遠加不起來（實測差額正好等於外資自營商）。
          { label: "外資自營", value: netLots(institutional.foreignDealerNet), tone: metricToneFromNet(institutional.foreignDealerNet) },
          { label: "投信", value: netLots(institutional.trustNet), tone: metricToneFromNet(institutional.trustNet) },
          { label: "自營", value: netLots(institutional.dealerNet), tone: metricToneFromNet(institutional.dealerNet) },
          { label: "合計", value: netLots(institutional.totalNet), tone: metricToneFromNet(institutional.totalNet) },
          // 「狀態」原本是第 6 格。6 欄格線是 span2×3 ＋ span3×2＝剛好 5 格，
          // 第 6 格會長出只填 1/3 的孤行；而且「法人 2026-07-24」是句子，塞進 111px 必然截字。
          // 已移到格線下方的註腳（detailNotes）。
        ]
      : [
          // 沒有資料時舊寫法的顏色最花（紅／綠／黃／紫），真正的錯誤反而最不顯眼。
          // 而且 label 與有資料時對不起來（外資 vs 外陸資、少了外資自營與合計），
          // 切分頁時格子會跳。改成與有資料分支一一對應的 5 格。
          { label: "外陸資", value: "未揭露", tone: "na" },
          { label: "外資自營", value: "未揭露", tone: "na" },
          { label: "投信", value: "未揭露", tone: "na" },
          { label: "自營", value: "未揭露", tone: "na" },
          { label: "合計", value: "未揭露", tone: "na" },
        ],
    // 切到基本面籤才 lazy 抓（其餘時候只讀既有快取，不觸發網路）。
    基本面: fundamentalsChips(
      state.detailTab === "基本面"
        ? ensureFundamentals(stock.code)
        : fundamentalsState.byCode.get(String(stock.code || "").trim()) || null
    ),
  };
  document.getElementById("chartMetrics").innerHTML = (detailMetrics[state.detailTab] || detailMetrics["即時"])
    .map((metric) => `
      <span class="chart-metric is-${metric.tone || "neutral"}">
        <em>${glossMaybe(metric.label)}</em>
        <strong>${escapeHtml(metric.value)}</strong>
        ${metric.flag ? `<b class="cm-flag">${escapeHtml(metric.flag)}</b>` : ""}
      </span>
    `)
    .join("");
  // 狀態／來源／單位這類句子放在格線下方講一次，不佔數字格（會截字，也會長出孤行）。
  const fundamentalsEntry = fundamentalsState.byCode.get(String(stock.code || "").trim()) || null;
  const detailNotes = {
    即時: "",
    均線: maTabIsDaily ? "" : "資料不足 5 個交易日，暫以盤中樣本計算均價。",
    法人: institutional
      ? `${institutionalStatus}・買賣超單位：張`
      : `${institutionalStatus}・來源 ${institutionalState.source || "TWSE/TPEx"}`,
    基本面: fundamentalsNote(fundamentalsEntry),
  };
  const noteText = detailNotes[state.detailTab] || "";
  const noteEl = document.getElementById("chartMetricsNote");
  if (noteEl) {
    noteEl.textContent = noteText;
    noteEl.hidden = !noteText;
    // 載入失敗要比「還沒抓到」顯眼，與格子的 is-warn 同一套判準。
    const failed = (state.detailTab === "法人" && Boolean(institutionalState.error))
      || (state.detailTab === "基本面" && Boolean(fundamentalsEntry?.error));
    noteEl.classList.toggle("is-warn", failed);
  }
  document.querySelectorAll(".detail-tabs button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.detailTab === state.detailTab);
  });
  document.getElementById("indicatorBlocks").innerHTML = indicatorLabels
    .map((label) => {
      const meta = getIndicatorButtonMeta(label, stock);
      return `
        <button class="${label === state.indicator ? "is-active" : ""} is-${meta.tone}" data-indicator="${label}" type="button" aria-pressed="${label === state.indicator}">
          <span>${label}</span>
          <small>${meta.badge}</small>
        </button>
      `;
    })
    .join("");
  const indicatorDetails = buildIndicatorDetail(stock);
  const indicatorDetail = indicatorDetails[state.indicator] || indicatorDetails[indicatorLabels[0]];
  document.getElementById("indicatorDetail").innerHTML = `
    <header class="is-${escapeHtml(indicatorDetail.statusTone || "neutral")}">
      <div>
        <strong>${escapeHtml(indicatorDetail.title)}</strong>
        <span>${escapeHtml(indicatorDetail.summary)}</span>
      </div>
      <em>${escapeHtml(indicatorDetail.status)}</em>
    </header>
    <div class="indicator-metrics">
      ${indicatorDetail.metrics.map((metric) => `
        <div class="indicator-metric ${metric.tone || "neutral"}">
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
        </div>
      `).join("")}
    </div>
    <p>${escapeHtml(indicatorDetail.note)}</p>
  `;
  document.getElementById("watchToggle").innerHTML = (watchLists[state.watchList] || watchLists[1]).has(stock.code) ? '<i data-lucide="bell-check"></i>' : '<i data-lucide="bell-plus"></i>';
  renderStockNotes(stock);
  ensureDetailHistory(stock.code);
  refreshLucideIcons();
  requestAnimationFrame(() => drawChart(stock));
}

async function loadStockNotes(code) {
  if (notesState.loading) return;
  notesState.loading = true;
  notesState.code = code;
  try {
    const payload = await fetchApi(`/api/notes?code=${encodeURIComponent(code)}`);
    if (notesState.code !== code) return;
    notesState.notes = payload.notes || [];
    notesState.error = "";
  } catch (error) {
    if (!handleAuthRequired(error)) notesState.error = error.message;
  } finally {
    notesState.loading = false;
    renderStockNotes(getSelectedStock());
  }
}

async function submitStockNote(code, text) {
  try {
    const payload = await fetchApi("/api/notes", {
      method: "POST",
      body: JSON.stringify({ code, text }),
    });
    notesState.code = code;
    notesState.notes = payload.notes || [];
    notesState.error = "";
    notesFeedState.loaded = false;
    renderStockNotes(getSelectedStock());
    showToast("備註已分享給所有帳號");
  } catch (error) {
    if (!handleAuthRequired(error)) {
      notesState.error = error.message;
      renderStockNotes(getSelectedStock());
    }
  }
}

async function deleteStockNote(code, id) {
  try {
    const payload = await fetchApi(`/api/notes?code=${encodeURIComponent(code)}&id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    notesState.notes = payload.notes || [];
    notesFeedState.loaded = false;
    renderStockNotes(getSelectedStock());
    showToast("備註已刪除");
  } catch (error) {
    if (!handleAuthRequired(error)) showToast(`刪除失敗：${error.message}`);
  }
}

function renderStockNotes(stock) {
  const container = document.getElementById("stockNotes");
  if (!container || !stock) return;
  // 使用者正在輸入時不重繪，避免打到一半被清掉。
  if (container.contains(document.activeElement)) return;

  if (notesState.code !== stock.code) {
    notesState.notes = [];
    notesState.error = "";
    loadStockNotes(stock.code);
  }
  const notes = notesState.code === stock.code ? notesState.notes : [];
  const canDelete = (note) => authState.user && (note.userId === authState.user.id || authState.user.role === "admin");
  const list = notes.length
    ? [...notes]
        .reverse()
        .map((note) => `
          <div class="note-item">
            <div class="note-meta">
              <strong>${escapeHtml(note.userName || "")}</strong>
              <span>${escapeHtml(formatLocalTime(note.createdAt))}</span>
              ${canDelete(note)
                ? `<button data-note-delete="${escapeHtml(note.id)}" type="button" aria-label="刪除備註">刪除</button>`
                : ""}
            </div>
            <p>${escapeHtml(note.text)}</p>
          </div>
        `)
        .join("")
    : `<p class="notes-hint">${notesState.loading ? "備註載入中..." : "還沒有人留言。"}</p>`;
  const composer = authState.user
    ? `
      <form class="note-form" data-note-form>
        <textarea name="text" rows="2" maxlength="500" aria-label="新增共享備註" placeholder="例如：今天爆量但收下影線，明天開高我想出一半"></textarea>
        <button class="primary-button" type="submit">送出</button>
      </form>
    `
    : `<p class="notes-hint">備註所有人可見；要留言請先到「更多 → 帳號管理」登入。</p>`;
  container.innerHTML = `
    <header><strong>共享備註</strong><span>${escapeHtml(stock.code)} / 所有帳號共見</span></header>
    <div class="note-list">${list}</div>
    ${notesState.error ? `<p class="notes-hint is-error">${escapeHtml(notesState.error)}</p>` : ""}
    ${composer}
  `;
}

// ===== 基本面 =====
// per-code lazy load：成功後 30 分鐘內不重抓；失敗 60 秒後允許重試。
function ensureFundamentals(code) {
  const clean = String(code || "").trim();
  if (!clean) return null;
  const entry = fundamentalsState.byCode.get(clean);
  const age = entry ? Date.now() - (entry.at || 0) : Infinity;
  const fresh = entry && (entry.loading || (entry.data && age < 30 * 60e3) || (entry.error && age < 60e3));
  if (fresh) return entry;
  const next = { loading: true, data: entry?.data || null, error: "", at: Date.now() };
  fundamentalsState.byCode.set(clean, next);
  fetchApi(`/api/fundamentals?code=${encodeURIComponent(clean)}`)
    .then((payload) => {
      if (payload?.ok === false) {
        next.error = payload.error || "基本面載入失敗";
      } else {
        next.data = payload;
        next.error = "";
      }
    })
    .catch((error) => {
      next.error = error.message || "基本面載入失敗";
    })
    .finally(() => {
      next.loading = false;
      next.at = Date.now();
      // 這是背景載入的回呼，使用者可能正在「更多 → 帳號管理」打密碼或券商金鑰。
      // 一般 render() 會重建 active screen 並清掉未送出草稿；背景重繪一律走受保護版本。
      renderLiveDataUpdate();
    });
  return next;
}

// 官方月營收單位是「千元」→ 顯示成台股慣用的 億／萬。
function formatRevenueYi(thousandTwd) {
  if (!Number.isFinite(thousandTwd)) return "--";
  const yi = thousandTwd / 100000;
  if (yi >= 100) return `${Math.round(yi).toLocaleString("zh-TW")} 億`;
  if (yi >= 1) return `${yi.toFixed(1)} 億`;
  return `${Math.round(thousandTwd / 10).toLocaleString("zh-TW")} 萬`;
}

// 基本面分頁的註腳：狀態／來源這類句子不放進數字格。
// 刻意與 fundamentalsChips 分開回傳，不改它的簽章（既有測試直接驗那個陣列的長度與內容）。
function fundamentalsNote(entry) {
  if (entry?.data) return "";
  if (entry?.loading) return "基本面載入中";
  if (entry?.error) return "基本面載入失敗，稍後會自動重試。";
  return "尚未取得基本面資料。";
}

// detail panel「基本面」籤的 5 顆 chip（獨立函式方便測試）。
function fundamentalsChips(entry) {
  const f = entry?.data;
  if (!f) {
    // 沒有資料時全部走 na 灰。舊寫法在無資料時反而顏色最花（紅／綠／黃／紫），
    // 錯誤訊息完全不突出。「狀態」是句子不是數字（實測「基本面載入中」在 111px 格子裡溢出 21px），
    // 已移到格線下方的註腳（見 fundamentalsNote）；這裡改成與有資料分支一一對應的 5 格，
    // 切分頁時格子不會跳。
    return [
      { label: "月營收", value: "N/A", tone: "na" },
      { label: "營收YoY", value: "N/A", tone: "na" },
      { label: "EPS", value: "N/A", tone: "na" },
      { label: "本益比", value: "N/A", tone: "na" },
      { label: "殖利率", value: "N/A", tone: "na" },
    ];
  }
  const rev = f.revenue?.latest;
  const eps = f.eps?.latest;
  const val = f.valuation;
  return [
    { label: rev ? `${Number(rev.yearMonth.slice(5, 7))}月營收` : "月營收", value: rev ? formatRevenueYi(rev.revenue) : "--", tone: "neutral" },
    // 營收 YoY 有正負，紅綠必須跟著值走。舊寫法寫死紅，於是「▼15.30%」是紅色的
    // ——箭頭說衰退、顏色說成長，兩個編碼互相打臉。現在 ▲▼ 與色相永遠同向。
    { label: "營收YoY", value: Number.isFinite(rev?.yoy) ? formatSignedPercent(rev.yoy) : "--", tone: metricToneFromNet(rev?.yoy) },
    // EPS 是水準值，本身不上色；但虧損（負 EPS）是有方向的事實，值得標出來。
    // 舊寫法寫死綠，賺錢與賠錢同色。
    { label: eps ? `EPS ${eps.period.slice(4)}` : "EPS", value: eps ? formatNumber(eps.eps) : "--", tone: finiteNumberOrNull(eps?.eps) === null ? "na" : Number(eps.eps) < 0 ? "down" : "neutral" },
    // 本益比與殖利率的「高低算好算壞」是主觀判斷，沒有可依據的門檻（也不得新增）→ 不上色。
    { label: "本益比", value: Number.isFinite(val?.pe) ? formatNumber(val.pe) : "--", tone: Number.isFinite(val?.pe) ? "neutral" : "na" },
    { label: "殖利率", value: Number.isFinite(val?.dividendYield) ? `${formatNumber(val.dividendYield)}%` : "--", tone: Number.isFinite(val?.dividendYield) ? "neutral" : "na" },
  ];
}

// 技術分析頁的基本面區塊：月營收長條（歷史逐月累積）＋EPS 近 4 季＋估值＋下次除權息。
function renderFundamentalsPanel() {
  const container = el.fundamentalsPanel;
  if (!container) return;
  const code = String(state.technicalCode || "").trim();
  if (!code) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const entry = ensureFundamentals(code);
  container.hidden = false;
  const f = entry?.data;
  if (!f) {
    const status = entry?.loading ? "載入中…" : entry?.error ? entry.error : "暫無資料";
    container.innerHTML = `<div class="fund-head"><strong>基本面</strong><span class="fund-asof">${escapeHtml(status)}</span></div>`;
    return;
  }
  const rev = f.revenue?.latest;
  const revHist = (f.revenue?.history || []).slice(-12);
  const maxRev = Math.max(...revHist.map((h) => h.revenue || 0), 1);
  const bars = revHist.map((h) => {
    const heightPct = Math.max(8, Math.round(((h.revenue || 0) / maxRev) * 100));
    const up = !Number.isFinite(h.yoy) || h.yoy >= 0;
    const tip = `${h.period} 營收 ${formatRevenueYi(h.revenue)}${Number.isFinite(h.yoy) ? `，YoY ${h.yoy.toFixed(1)}%` : ""}`;
    return `
      <div class="rev-bar-item" title="${escapeHtml(tip)}">
        <i class="rev-bar ${up ? "is-up" : "is-down"}" style="height:${heightPct}%"></i>
        <small>${escapeHtml(h.period.slice(5))}</small>
      </div>`;
  }).join("");
  const revHint = revHist.length < 3
    ? `<p class="fund-hint">長條圖會隨每月官方公布逐月累積（目前 ${revHist.length} 期）。</p>`
    : "";
  const epsHist = (f.eps?.history || []).slice(-4);
  const epsRows = epsHist.length
    ? epsHist.map((h) => `<div class="fund-row"><span>${escapeHtml(h.period)}</span><b>${formatNumber(h.eps)}</b></div>`).join("")
    : `<div class="fund-row is-empty">暫無資料</div>`;
  const val = f.valuation;
  const valRows = val
    ? `
      <div class="fund-row"><span>本益比</span><b>${Number.isFinite(val.pe) ? formatNumber(val.pe) : "--（虧損或無值）"}</b></div>
      <div class="fund-row"><span>殖利率</span><b>${Number.isFinite(val.dividendYield) ? `${formatNumber(val.dividendYield)}%` : "--"}</b></div>
      <div class="fund-row"><span>股價淨值比</span><b>${Number.isFinite(val.pbr) ? formatNumber(val.pbr) : "--"}</b></div>
      ${Number.isFinite(val.dps) ? `<div class="fund-row"><span>每股股利</span><b>${formatNumber(val.dps)}</b></div>` : ""}`
    : `<div class="fund-row is-empty">暫無資料</div>`;
  const nextDiv = (f.dividends || [])[0];
  const dividendFreshness = String(f.freshness?.dividends?.status || "fresh");
  const emptyDividendText = dividendFreshness === "unavailable"
    ? "除權息來源暫時無法確認"
    : dividendFreshness === "stale"
      ? "沿用資料中未見近期除權息"
      : "近期無除權息";
  // 現金與配股**不是互斥的**——「除權息」本來就是兩者都有。舊寫法是三元式，
  // 只要有現金就不顯示配股：6944 是配股 30%＋息 17 元（參考價 1030→779），
  // 畫面卻只寫「現金 17 元」，配股 30% 完全看不到 → 使用者不會去補登除權配股紀錄
  // → 帳本的股數就會一直少（而漏登的後果不只是假虧損，是之後想賣會被賣超檢查擋下）。
  //
  // 比率一律同時給百分比與「每仟股 N 股」：官方 OpenAPI 回的是比率（0.1），
  // 但同一份報表的網頁版是以每仟股股數呈現，只印裸的 0.1 會讓人不知道單位（見 D-41）。
  const ratioText = (ratio) => `${formatNumber(ratio * 100)}%（每仟股 ${formatNumber(ratio * 1000)} 股）`;
  const divParts = [];
  if (Number.isFinite(nextDiv?.cashDividend) && nextDiv.cashDividend > 0) {
    divParts.push(`現金 ${formatNumber(nextDiv.cashDividend)} 元`);
  }
  if (Number.isFinite(nextDiv?.stockRatio) && nextDiv.stockRatio > 0) {
    divParts.push(`配股 ${ratioText(nextDiv.stockRatio)}`);
  }
  if (Number.isFinite(nextDiv?.subscriptionRatio) && nextDiv.subscriptionRatio > 0) {
    const price = Number.isFinite(nextDiv.subscriptionPrice) && nextDiv.subscriptionPrice > 0
      ? `＠${formatNumber(nextDiv.subscriptionPrice)} 元` : "";
    divParts.push(`現增 ${ratioText(nextDiv.subscriptionRatio)}${price}`);
  }
  const divRows = nextDiv
    ? `<div class="fund-row"><span>${escapeHtml(nextDiv.kind || "除權息")} ${nextDiv.exDate ? `${nextDiv.exDate.slice(4, 6)}/${nextDiv.exDate.slice(6, 8)}` : ""}</span><b>${divParts.length ? escapeHtml(divParts.join("・")) : "--"}</b></div>`
    : `<div class="fund-row is-empty">${emptyDividendText}</div>`;
  const yoyDirection = signedDirection(rev?.yoy);
  const yoyBadge = Number.isFinite(rev?.yoy)
    ? `<b class="${yoyDirection > 0 ? "is-pos" : yoyDirection < 0 ? "is-neg" : ""}">YoY ${formatSignedPercent(rev.yoy)}</b>`
    : "";
  // YoY 破 100% 多半是去年同月基期異常（停工/事件），不是真的翻倍成長——標注避免誤讀。
  const yoyBaseWarn = Number.isFinite(rev?.yoy) && rev.yoy > 100
    ? `<p class="fund-hint is-warn">YoY 超過 100%：去年同月基期偏低，別直接當持續成長率解讀。</p>`
    : "";
  const asOfBits = [
    rev ? `月營收 ${rev.yearMonth}` : "",
    val?.asOf ? `估值 ${val.asOf.slice(4, 6)}/${val.asOf.slice(6, 8)}` : "",
  ].filter(Boolean).join(" · ");
  container.innerHTML = `
    <div class="fund-head">
      <strong>基本面</strong>
      <span class="fund-asof">${escapeHtml(asOfBits)}</span>
    </div>
    ${(() => {
      // 只印第 1 則會漏掉最重要的那則。buildFundamentals 是把「比率量級異常」（疑似上游把
      // 單位從比率改成每仟股股數，會讓整段 K 線塌陷）unshift 到最前面**之後**，
      // 才 unshift 各來源的新鮮度警告——於是那條 D-41 的防護網被擠到 index 1，
      // 在最需要它的時候顯示不出來。改成比照 renderDataTrustCompact：前 2 則＋剩餘則數，
      // 完整清單放 title。
      const warnings = f.warnings || [];
      if (!warnings.length) return "";
      const shown = warnings.slice(0, 2).join("；");
      const rest = warnings.length > 2 ? `（另有 ${warnings.length - 2} 則）` : "";
      return `<p class="fund-hint is-warn" title="${escapeHtml(warnings.join("\n"))}">${escapeHtml(shown)}${rest}</p>`;
    })()}
    <div class="fund-grid">
      <div class="fund-block fund-block-rev">
        <header>月營收 ${yoyBadge}</header>
        ${revHist.length ? `<div class="rev-bars">${bars}</div>` : `<div class="fund-row is-empty">暫無資料</div>`}
        ${yoyBaseWarn}
        ${revHint}
      </div>
      <div class="fund-block">
        <header>每股盈餘 EPS <b class="fund-note">單季</b></header>
        ${epsRows}
        <p class="fund-hint">官方只公布最新一季；近 4 季合計會隨歷史累積自動補齊。</p>
      </div>
      <div class="fund-block">
        <header>估值</header>
        ${valRows}
      </div>
      <div class="fund-block">
        <header>除權息</header>
        ${divRows}
      </div>
    </div>
  `;
}

async function loadCompanyInfo(code) {
  const clean = String(code || "").trim();
  if (!clean) return;
  companyState.loading = true;
  companyState.code = clean;
  companyState.error = "";
  companyState.editing = false;
  renderCompanyProfile();
  try {
    const payload = await fetchApi(`/api/company?code=${encodeURIComponent(clean)}`);
    if (companyState.code !== clean) return;
    companyState.data = payload;
    companyState.error = "";
  } catch (error) {
    if (companyState.code !== clean) return;
    if (!handleAuthRequired(error)) companyState.error = error.message;
  } finally {
    if (companyState.code === clean) {
      companyState.loading = false;
      renderCompanyProfile();
    }
  }
}

async function saveCompanySummary(code, summary) {
  const clean = String(code || "").trim();
  if (!clean) return;
  try {
    const payload = await fetchApi("/api/company", {
      method: "PUT",
      body: JSON.stringify({ code: clean, summary }),
    });
    companyState.code = clean;
    companyState.data = payload;
    companyState.error = "";
    companyState.editing = false;
    renderCompanyProfile();
    showToast("公司簡介已更新");
  } catch (error) {
    if (!handleAuthRequired(error)) {
      companyState.error = error.message;
      renderCompanyProfile();
    }
  }
}

function renderCompanyProfile() {
  const container = el.companyProfile;
  if (!container) return;
  const code = String(state.technicalCode || "").trim();
  if (!code) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  // 切換到別檔時先清空再載入（與共享備註相同的同步策略）。
  if (companyState.code !== code) {
    companyState.data = null;
    companyState.error = "";
    companyState.editing = false;
    loadCompanyInfo(code);
  }
  // 使用者正在編輯（textarea 取得焦點）時不重繪，避免打到一半被清掉。
  if (container.contains(document.activeElement)) return;

  const data = companyState.code === code ? companyState.data : null;
  const industry = data?.industry || "";
  const summary = data?.summary || "";
  container.hidden = false;

  const industryChip = industry
    ? `<span class="company-industry-chip">${escapeHtml(industry)}</span>`
    : `<span class="company-industry-chip is-empty">產業別未知</span>`;
  const errorHtml = companyState.error
    ? `<p class="company-summary-text is-error">${escapeHtml(companyState.error)}</p>`
    : "";

  // 編輯狀態才展開成表單；其餘時候整個概況收成一行。
  if (companyState.editing && authState.user) {
    container.innerHTML = `
      <div class="company-profile-row">
        <strong>公司概況</strong>
        ${industryChip}
      </div>
      ${errorHtml}
      <form class="company-form" data-company-form>
        <textarea name="summary" rows="3" maxlength="800" aria-label="公司簡介內容" placeholder="例如：原料藥與保健食品代工，主力產品為機能性益生菌與膠原蛋白原料。">${escapeHtml(summary)}</textarea>
        <div class="company-form-actions">
          <button class="primary-button" type="submit">儲存</button>
          <button class="ghost-button" type="button" data-company-cancel>取消</button>
        </div>
      </form>
    `;
    return;
  }

  const updatedMeta = data?.updatedByName
    ? `${data.updatedByName} · ${formatLocalTime(data.updatedAt)} 更新`
    : "";
  const summaryHtml = summary
    ? `<p class="company-summary-inline"${updatedMeta ? ` title="${escapeHtml(updatedMeta)}"` : ""}>${escapeHtml(summary)}</p>`
    : `<p class="company-summary-inline is-empty">${companyState.loading ? "載入中…" : "尚無公司簡介"}</p>`;
  const editControl = authState.user
    ? `<button class="company-edit-button" type="button" data-company-edit>${summary ? "編輯" : "新增簡介"}</button>`
    : `<span class="company-summary-meta">登入後可編輯</span>`;

  container.innerHTML = `
    <div class="company-profile-row">
      <strong>公司概況</strong>
      ${industryChip}
      ${summaryHtml}
      ${editControl}
    </div>
    ${errorHtml}
  `;
}

function resetSearchState() {
  searchState.token += 1;
  searchState.query = "";
  searchState.loading = false;
  searchState.remote = [];
  searchState.error = "";
  window.clearTimeout(searchState.timer);
}

// 用官方全市場清單（上市＋上櫃）搜尋代號或名稱。
async function loadSymbolSearch(query) {
  const token = ++searchState.token;
  searchState.loading = true;
  renderSearchResults(query);
  try {
    const payload = await fetchApi(`/api/symbols?q=${encodeURIComponent(query)}`);
    if (searchState.token !== token || searchState.query !== query) return;
    searchState.remote = payload.results || [];
    searchState.error = "";
  } catch (error) {
    if (searchState.token !== token) return;
    searchState.remote = [];
    searchState.error = error.message;
  } finally {
    if (searchState.token === token) {
      searchState.loading = false;
      renderSearchResults(query);
    }
  }
}

function handleSearchInput(value) {
  const text = String(value || "").trim();
  searchState.query = text;
  searchState.error = "";
  window.clearTimeout(searchState.timer);
  if (!text) {
    searchState.remote = [];
    searchState.loading = false;
    searchState.token += 1;
    renderSearchResults(text);
    return;
  }
  renderSearchResults(text);
  searchState.timer = window.setTimeout(() => loadSymbolSearch(text), 250);
}

function renderSearchResults(query = searchState.query) {
  const text = query.trim().toUpperCase();
  const matches = stocks
    .filter((stock) => !text || stock.code.includes(text) || String(stock.name).toUpperCase().includes(text))
    .slice(0, 12);
  const localCodes = new Set(matches.map((stock) => stock.code));
  const remoteRows = (searchState.remote || []).filter((item) => !localCodes.has(item.code)).slice(0, 20 - matches.length);

  const localHtml = matches
    .map(
      (stock) => `
        <button class="search-result" data-code="${stock.code}" type="button">
          <span>
            <strong>${escapeHtml(stock.name)}</strong>
            <span>${stock.code}${formatExchangeLabel(stock.exchange) ? ` ・ ${formatExchangeLabel(stock.exchange)}` : ""} ・ ${stock.official ? "官方資料" : formatStrategyLabel(stock.strategies[0])}</span>
          </span>
          <strong class="${toneFromNet(stock.change)}">${stock.changeText}</strong>
        </button>
      `
    )
    .join("");

  const remoteHtml = remoteRows
    .map(
      (item) => `
        <button class="search-result" data-code="${item.code}" type="button">
          <span>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${item.code} ・ ${formatExchangeLabel(item.exchange)} ・ 官方清單</span>
          </span>
          <strong class="${toneFromNet(item.changePct)}">${formatSignedPercent(item.changePct)}</strong>
        </button>
      `
    )
    .join("");

  const total = matches.length + remoteRows.length;
  const statusHtml = searchState.loading && !total
    ? `<div class="search-status">正在搜尋官方清單...</div>`
    : searchState.error
      ? `<div class="search-status is-error">${escapeHtml(searchState.error)}</div>`
      : !total
        ? `<div class="search-status">${text ? `找不到「${escapeHtml(query.trim())}」，試試其他關鍵字。` : "輸入股票代號或名稱（例如 2330 或 台積電）。ETF 也可以加入自選股。"}</div>`
        : "";

  el.searchResults.innerHTML = `${localHtml}${remoteHtml}${statusHtml}`;
}

function showToast(message, duration) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  stack.appendChild(toast);
  // 顯示時間跟著訊息長度走（長訊息如同步失敗說明要留得住）；
  // 重要通知（例如到價提醒）由呼叫端指定更長的 duration。
  const holdMs = Number.isFinite(duration)
    ? duration
    : Math.min(6500, Math.max(1900, String(message).length * 85));
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 180);
  }, holdMs);
}

function updateActiveNav() {
  document.querySelectorAll(".nav-action").forEach((button) => {
    const active = button.dataset.screen === state.screen;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("is-active", screen.dataset.screenPanel === state.screen);
  });
  const titleMap = {
    overnight: "隔日沖",
    screener: "盤中選股",
    strategy: "策略雷達",
    watchlist: "自選股",
    technical: "技術分析",
    surveillance: "處置看板",
    more: "更多",
  };
  el.title.textContent = titleMap[state.screen];
}

function renderWatchTabs() {
  document.querySelectorAll(".watch-tabs button[data-watch-list]").forEach((button) => {
    const listKey = button.dataset.watchList;
    button.classList.toggle("is-active", listKey === state.watchList);
    if (listKey === "hold") {
      button.innerHTML = "<span>庫存損益</span>";
      return;
    }
    const count = (watchLists[listKey] || new Set()).size;
    button.innerHTML = `<span>清單 ${listKey}</span><em>${count}</em>`;
  });
}

function syncTabListAccessibility(tabList, selectedTab = null) {
  if (!tabList) return;
  const tabs = [...tabList.children].filter((child) => child.matches?.("button"));
  if (!tabs.length) return;
  const activeTab = tabs.includes(selectedTab)
    ? selectedTab
    : tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
  tabs.forEach((tab) => {
    const selected = tab === activeTab;
    if (selectedTab) tab.classList.toggle("is-active", selected);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.tabIndex = selected ? 0 : -1;
  });
}

function syncTabAccessibility() {
  document.querySelectorAll('[role="tablist"]').forEach((tabList) => {
    syncTabListAccessibility(tabList);
  });
}

function renderWatchBrief() {
  if (!el.watchBrief) return;
  const stats = getWatchStats();
  const filterOptions = [
    { key: "all", label: "全部", count: stats.activeStocks.length },
    { key: "up", label: "上漲", count: stats.upCount },
    { key: "down", label: "下跌", count: stats.downCount },
    { key: "active", label: "強波動", count: stats.activeCount },
  ];
  const strongest = stats.strongest;
  const strongestTone = strongest ? toneFromNet(strongest.change) : "muted";
  const avgTone = stats.activeStocks.length ? toneFromNet(stats.avgChange) : "muted";
  const avgText = stats.activeStocks.length ? formatSignedPercent(stats.avgChange) : "--";

  el.watchBrief.innerHTML = `
    <div class="watch-brief-top">
      <div class="watch-brief-lead">
        <span>自選股清單 ${state.watchList}</span>
        <strong>${stats.visibleStocks.length}<small>/ ${stats.activeStocks.length} 檔</small></strong>
      </div>
      <div class="watch-brief-stats">
        <div class="wb-stat">
          <span>平均漲跌</span>
          <em class="${avgTone}">${avgText}</em>
        </div>
        <div class="wb-stat">
          <span>最新最強</span>
          <strong>${strongest ? escapeHtml(strongest.name) : "--"}</strong>
          <em class="${strongestTone}">${strongest ? escapeHtml(strongest.changeText) : "尚無資料"}</em>
        </div>
      </div>
    </div>
    <div class="watch-brief-controls">
      <div class="watch-quick-filters" aria-label="自選股快速篩選">
        ${filterOptions
          .map(
            (option) => `
              <button class="segment ${state.watchFilter === option.key ? "is-active" : ""}" data-watch-filter="${option.key}" type="button" aria-pressed="${state.watchFilter === option.key}">
                ${option.label}<span class="segment-count ${option.count === 0 ? "is-zero" : ""}">${option.count}</span>
              </button>
            `
          )
          .join("")}
      </div>
      <p class="watch-brief-hint">按「管理」才會進入刪除模式</p>
    </div>
  `;
}

function renderWatchManager() {
  const activeList = watchLists[state.watchList] || watchLists[1];
  [...state.watchSelection].forEach((code) => {
    if (!activeList.has(code)) state.watchSelection.delete(code);
  });
  const selectedCount = state.watchSelection.size;
  const visibleCount = filterStocks("watchlist").length;
  renderWatchTabs();
  renderWatchBrief();
  if (el.watchManageBar) {
    el.watchManageBar.hidden = !state.watchEditMode;
  }
  if (el.watchManageSummary) {
    el.watchManageSummary.textContent = selectedCount
      ? `已選 ${selectedCount} 檔`
      : "管理模式：點選股票列，選取要移除的股票";
  }
  if (el.watchRemoveSelected) {
    el.watchRemoveSelected.disabled = selectedCount === 0;
    const removeLabel = el.watchRemoveSelected.querySelector("span");
    if (removeLabel) {
      removeLabel.textContent = selectedCount ? `移除 ${selectedCount} 檔` : "移除所選";
    }
  }
  if (el.watchSelectVisible) {
    el.watchSelectVisible.disabled = visibleCount === 0;
  }
  if (el.watchClearSelection) {
    el.watchClearSelection.disabled = selectedCount === 0;
  }
  if (el.watchTableHead) {
    el.watchTableHead.classList.toggle("is-editing", state.watchEditMode);
  }
  if (el.watchEdit) {
    el.watchEdit.classList.toggle("is-editing", state.watchEditMode);
    el.watchEdit.setAttribute("aria-pressed", state.watchEditMode ? "true" : "false");
    el.watchEdit.innerHTML = state.watchEditMode
      ? '<i data-lucide="check"></i><span>完成</span>'
      : '<i data-lucide="list-minus"></i><span>管理</span>';
  }
}

let persistedSelectedCode = "";

function refreshLucideIcons() {
  // createIcons 會掃描整份 document；只有新 render 真的產生尚未轉換的 <i> 時才需要呼叫。
  // 已轉成 SVG 的靜態圖示不必在每次 10 秒行情更新時重掃一次。
  if (window.lucide && document.querySelector("i[data-lucide]")) {
    window.lucide.createIcons();
  }
}

function renderActiveScreen() {
  const activeScreen = document.querySelector(`[data-screen-panel="${state.screen}"]`);
  activeScreen?.querySelectorAll(".table-head button").forEach((button) => {
    const sorted = button.dataset.sort === state.sort;
    button.classList.toggle("is-sorted", sorted);
    if (sorted) button.dataset.sortDir = state.sortDir;
    else delete button.dataset.sortDir;
  });

  if (state.screen === "overnight") {
    document.querySelectorAll("[data-overnight-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.overnightView === state.overnightView);
    });
    renderRows(el.overnightRows, filterStocks("overnight"), "overnight");
    renderOvernightGroups();
    return;
  }

  if (state.screen === "screener") {
    renderStrategies();
    document.querySelectorAll("[data-universe]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.universe === state.universe);
    });
    document.querySelectorAll(".focus-switch button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.focus === state.focus);
    });
    const screenerHead = document.querySelector('[data-screen-panel="screener"] .screen-head');
    screenerHead?.classList.toggle("is-turnover-mode", state.universe === "turnover");
    renderRows(el.screenerRows, filterStocks("screener"), "screener");
    renderStrategyInfo();
    return;
  }

  if (state.screen === "strategy") {
    renderStrategyBoard();
    return;
  }

  if (state.screen === "watchlist") {
    renderRows(el.watchRows, filterStocks("watchlist"), "watchlist");
    renderWatchManager();
    renderHoldingsPanel();
    return;
  }

  if (state.screen === "technical") {
    renderTechnicalAnalysis();
    return;
  }

  if (state.screen === "surveillance") {
    renderSurveillanceScreen();
    return;
  }

  if (state.screen === "more") renderMorePanel();
}

function isEditableDraftControl(node) {
  if (!(node instanceof Element)) return false;
  if (node.matches("textarea, select, [contenteditable=true]")) return true;
  if (!node.matches("input")) return false;
  return !["button", "submit", "reset", "hidden", "image", "file"].includes(String(node.type || "text").toLowerCase());
}

function hasUnsavedFormDraft(root) {
  if (!root) return false;
  return [...root.querySelectorAll("input, textarea, select")].some((control) => {
    const type = String(control.type || "").toLowerCase();
    if (["button", "submit", "reset", "hidden", "image", "file"].includes(type)) return false;
    if (type === "checkbox" || type === "radio") return control.checked !== control.defaultChecked;
    if (control instanceof HTMLSelectElement) {
      const options = [...control.options];
      if (control.multiple) return options.some((option) => option.selected !== option.defaultSelected);
      const explicitDefault = options.findIndex((option) => option.defaultSelected);
      // 單選 select 沒寫 selected 時，瀏覽器會隱含選第一項；這是初始值，不是使用者草稿。
      const defaultIndex = explicitDefault >= 0 ? explicitDefault : (options.length ? 0 : -1);
      return control.selectedIndex !== defaultIndex;
    }
    return control.value !== control.defaultValue;
  });
}

// 作用中清單和明細會以 innerHTML 更新；背景行情刷新前記住可重建控制項的穩定 data-* 身分，
// 重畫後把鍵盤焦點放回同一筆資料。使用者已移到別處時不搶焦點。
function captureLiveFocus() {
  const active = document.activeElement;
  if (!(active instanceof Element) || active === document.body || active === document.documentElement) return null;
  const scope = active.closest("[id]");
  return {
    element: active,
    id: active.id || "",
    scopeId: scope?.id || "",
    tagName: active.tagName.toLowerCase(),
    data: [...active.attributes]
      .filter((attribute) => attribute.name.startsWith("data-"))
      .map((attribute) => [attribute.name, attribute.value]),
  };
}

function restoreLiveFocus(snapshot) {
  if (!snapshot || snapshot.element.isConnected) return;
  const current = document.activeElement;
  if (current && current !== document.body && current !== document.documentElement) return;

  let replacement = snapshot.id ? document.getElementById(snapshot.id) : null;
  if (!replacement && snapshot.data.length) {
    const scope = snapshot.scopeId ? document.getElementById(snapshot.scopeId) : document;
    replacement = [...(scope?.getElementsByTagName(snapshot.tagName) || [])].find((candidate) =>
      snapshot.data.every(([name, value]) => candidate.getAttribute(name) === value)
    ) || null;
  }
  if (replacement instanceof HTMLElement && !replacement.hasAttribute("disabled") && !replacement.closest("[hidden]")) {
    replacement.focus({ preventScroll: true });
  }
}

function render({ preserveLiveDrafts = false, restoreFocus = false } = {}) {
  const focusSnapshot = restoreFocus ? captureLiveFocus() : null;
  const activeScreen = document.querySelector(`[data-screen-panel="${state.screen}"]`);
  const detailPanel = document.getElementById("detailPanel");
  const active = document.activeElement;
  const activeEditable = isEditableDraftControl(active);
  // 背景輪詢絕不能清掉尚未送出的券商憑證、密碼、帳號或到價表單。
  // 一般使用者動作仍走 render() 預設路徑，成功送出後可正常清空敏感欄位。
  const preserveActiveScreen = preserveLiveDrafts && Boolean(activeScreen) && (
    (activeEditable && activeScreen.contains(active))
    || (state.screen === "more" && hasUnsavedFormDraft(activeScreen))
  );
  const preserveDetail = preserveLiveDrafts && Boolean(detailPanel) && (
    (activeEditable && detailPanel.contains(active))
    || hasUnsavedFormDraft(detailPanel)
  );

  if (state.selectedCode && state.selectedCode !== persistedSelectedCode) {
    persistedSelectedCode = state.selectedCode;
    try {
      window.localStorage.setItem(
        SELECTED_CODE_STORAGE_KEY,
        JSON.stringify({ code: state.selectedCode, date: getTaiwanClockParts().isoDate })
      );
    } catch {
      // 無法寫入儲存空間時忽略，只是下次開啟不會記住。
    }
  }
  updateActiveNav();
  if (!preserveActiveScreen) renderActiveScreen();
  const filterButton = document.getElementById("filterOpen");
  if (filterButton) {
    const filterActive = state.direction !== "all" || state.minTurnover > 0 || state.watchOnly;
    filterButton.classList.toggle("has-active-filter", filterActive);
    filterButton.title = filterActive ? "篩選條件套用中（清單已被過濾，點開調整）" : "篩選";
  }
  renderMarketPill();
  renderDataStatus();
  if (!preserveDetail) renderDetail();
  syncTabAccessibility();
  refreshLucideIcons();
  if (restoreFocus) restoreLiveFocus(focusSnapshot);
}

function renderLiveDataUpdate() {
  render({ preserveLiveDrafts: true, restoreFocus: true });
}

document.addEventListener("keydown", (event) => {
  const currentTab = event.target.closest?.('[role="tab"]');
  const tabList = currentTab?.parentElement?.closest?.('[role="tablist"]');
  if (!currentTab || !tabList || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...tabList.children].filter((child) => child.matches?.('[role="tab"]'));
  if (tabs.length < 2) return;
  event.preventDefault();
  const currentIndex = Math.max(0, tabs.indexOf(currentTab));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[nextIndex].focus();
  tabs[nextIndex].click();
});

document.addEventListener("submit", (event) => {
  if (event.target === el.technicalForm) {
    event.preventDefault();
    state.screen = "technical";
    analyzeTechnicalFromInput({ notify: true });
    return;
  }
  if (event.target.closest("#strategyInspectForm")) {
    event.preventDefault();
    loadStrategyInspect(document.getElementById("strategyInspectInput")?.value || "");
    return;
  }
  const brokerForm = event.target.closest("[data-broker-settings-form]");
  if (brokerForm) {
    event.preventDefault();
    saveBrokerSettingsFromForm(brokerForm);
  }
  const adminForm = event.target.closest("[data-admin-user-form]");
  if (adminForm) {
    event.preventDefault();
    createAdminUserFromForm(adminForm);
  }
  const passwordForm = event.target.closest("[data-password-form]");
  if (passwordForm) {
    event.preventDefault();
    changeOwnPasswordFromForm(passwordForm);
  }
  const noteForm = event.target.closest("[data-note-form]");
  if (noteForm) {
    event.preventDefault();
    const textarea = noteForm.querySelector("textarea");
    const text = String(textarea?.value || "").trim();
    if (!text) return;
    textarea.value = "";
    textarea.blur();
    submitStockNote(state.selectedCode, text);
  }
  const companyForm = event.target.closest("[data-company-form]");
  if (companyForm) {
    event.preventDefault();
    const textarea = companyForm.querySelector("textarea");
    const summary = String(textarea?.value || "").trim();
    textarea?.blur();
    saveCompanySummary(state.technicalCode, summary);
  }
  const alertForm = event.target.closest("[data-alert-form]");
  if (alertForm) {
    event.preventDefault();
    const op = alertForm.elements.op?.value || ">=";
    const price = alertForm.elements.price?.value || "";
    if (addPriceAlert(alertForm.dataset.alertCode, op, price)) {
      alertForm.reset();
      alertForm.elements.price?.blur();
      render();
    }
  }
  const dividendReceiveForm = event.target.closest("[data-dividend-receive-form]");
  if (dividendReceiveForm) {
    event.preventDefault();
    const record = tradesState.records.find((item) => item.id === dividendReceiveForm.dataset.recordId);
    const receivedDate = String(dividendReceiveForm.elements.receivedDate?.value || "");
    const receivedAmount = Number(dividendReceiveForm.elements.receivedAmount?.value);
    const receiveMode = dividendReceiveForm.dataset.receiveMode || "receive";
    const expectedStatus = receiveMode === "correct" ? "received" : "receivable";
    if (!record || record.side !== "dividend" || record.status !== expectedStatus) {
      showToast("這筆股利狀態已在其他視窗變更，請重新整理後再試");
      return;
    }
    if (!isValidTradeDateInput(receivedDate)) {
      showToast("請選擇有效的入帳日，且不可晚於台北今天");
      return;
    }
    if (compactTradeDate(receivedDate) < tradeDateOf(record)) {
      showToast("入帳日不可早於股利認列日");
      return;
    }
    if (!Number.isFinite(receivedAmount) || receivedAmount < 0) {
      showToast("實收金額必須是 0 或正數");
      return;
    }
    document.activeElement?.blur?.();
    const submitButton = dividendReceiveForm.querySelector("[data-dividend-receive]");
    if (submitButton && !tradesState.mutating) {
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
      submitButton.textContent = "儲存中…";
    }
    updateTradeRecord(record.id, { status: "received", receivedDate, receivedAmount });
    return;
  }
  const tradeForm = event.target.closest("[data-trade-form]");
  if (tradeForm) {
    event.preventDefault();
    const editingId = String(tradesEditingId || "");
    const editingRecord = editingId ? tradesState.records.find((record) => record.id === editingId) : null;
    if (editingId && (!editingRecord || editingRecord.side === "dividend")) {
      showToast("找不到要修正的交易紀錄，請重新整理後再試");
      return;
    }
    const sideValue = tradeForm.elements.side?.value;
    const code = normalizeStockCodeInput(tradeForm.elements.code?.value);
    const instrumentType = tradeForm.elements.instrumentType?.value || "stock";
    const session = tradeForm.elements.session?.value || "unknown";
    const requestedDayTradeStatus = sideValue === "sell" ? tradeForm.elements.dayTradeStatus?.value || "none" : "none";
    const canKeepLegacyDayTrade = editingRecord && tradeDayTradeOf(editingRecord).status === "legacyDeclared";
    const allowedDayTradeStatuses = new Set([
      "none",
      "brokerConfirmed",
      "userConfirmed",
      ...(canKeepLegacyDayTrade ? ["legacyDeclared"] : []),
    ]);
    const dayTradeStatus = allowedDayTradeStatuses.has(requestedDayTradeStatus) ? requestedDayTradeStatus : "none";
    const isConfirmedDayTrade = ["brokerConfirmed", "userConfirmed"].includes(dayTradeStatus);
    const matchedText = String(tradeForm.elements.matchedShares?.value || "").trim();
    const matchedShares = isConfirmedDayTrade
      ? Number(matchedText)
      : dayTradeStatus === "legacyDeclared" ? Number(tradeDayTradeOf(editingRecord).matchedShares || 0) : 0;
    const feeText = String(tradeForm.elements.feeAmountTwd?.value || "").trim();
    const taxText = String(tradeForm.elements.taxAmountTwd?.value || "").trim();
    const executedTime = String(tradeForm.elements.executedTime?.value || "").trim();
    const stockMeta = stocks.find((stock) => stock.code === code);
    const market = stockMeta?.exchange === "TPEx" ? "TPEx" : stockMeta?.exchange ? "TWSE" : "unknown";
    const fields = {
      code,
      market,
      instrumentType,
      instrumentSource: "user",
      side: sideValue === "sell" ? "sell" : sideValue === "dividend" ? "dividend" : "buy",
      price: Number(tradeForm.elements.price?.value),
      shares: Number(tradeForm.elements.shares?.value),
      date: tradeForm.elements.date?.value || "",
      tradeDate: tradeForm.elements.date?.value || "",
      executedAt: executedTime
        ? `${tradeForm.elements.date?.value || ""}T${executedTime.length === 5 ? `${executedTime}:00` : executedTime}+08:00`
        : "",
      session: sideValue === "dividend" ? "unknown" : session,
      brokerAccountId: editingRecord?.brokerAccountId || "default",
      currency: "TWD",
      dayTrade: {
        status: dayTradeStatus,
        matchedShares,
        pairId: String(editingRecord?.dayTrade?.pairId || ""),
      },
      ...(feeText ? { feeAmountTwd: Number(feeText), feeSource: "broker" } : {}),
      ...(sideValue === "sell" && taxText ? { taxAmountTwd: Number(taxText), taxSource: "broker" } : {}),
      ...(sideValue === "dividend" ? {
        status: "received",
        receivedDate: tradeForm.elements.date?.value || "",
        receivedAmount: Number(tradeForm.elements.receivedAmount?.value),
        fee: null,
        feeAmountTwd: null,
      } : {}),
    };
    if (!isValidSecurityCode(fields.code)) {
      showToast("請輸入 4～6 碼的英數證券代號");
      return;
    }
    if (editingRecord && fields.side === "dividend") {
      showToast("買賣紀錄不能改成股利；請另新增一筆股利紀錄");
      return;
    }
    if (!isValidTradeDateInput(fields.date)) {
      showToast("請選擇有效的成交日，且不可晚於台北今天");
      return;
    }
    if (!Number.isFinite(fields.price) || fields.price <= 0 || !Number.isInteger(fields.shares) || fields.shares <= 0) {
      showToast("成交價要是正數，股數要是正整數（1 張 = 1000 股）");
      return;
    }
    if (feeText && (!Number.isFinite(fields.feeAmountTwd) || fields.feeAmountTwd < 0)) {
      showToast("券商實際手續費必須是 0 或正數");
      return;
    }
    if (taxText && (!Number.isFinite(fields.taxAmountTwd) || fields.taxAmountTwd < 0)) {
      showToast("券商實際證交稅必須是 0 或正數");
      return;
    }
    if (isConfirmedDayTrade) {
      if (fields.side !== "sell" || instrumentType !== "stock") {
        showToast("股票當沖減半稅率只適用已確認的股票賣出");
        return;
      }
      if (!Number.isInteger(matchedShares) || matchedShares <= 0 || matchedShares > fields.shares) {
        showToast("請填券商確認的當沖配對股數，且不可超過本筆成交股數");
        return;
      }
      if (["oddLot", "block"].includes(session)) {
        showToast("零股與鉅額交易不適用現股當沖");
        return;
      }
    }
    if (fields.side === "dividend" && (!String(tradeForm.elements.receivedAmount?.value || "").trim() || !Number.isFinite(fields.receivedAmount) || fields.receivedAmount < 0)) {
      showToast("手動記錄已入帳股利時，請填實際收到的總金額");
      return;
    }
    document.activeElement?.blur?.(); // 讓面板可重繪
    const submitButton = tradeForm.querySelector('button[type="submit"]');
    if (submitButton && !tradesState.mutating) {
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
      submitButton.textContent = "儲存中…";
    }
    if (editingRecord) {
      saveEditedTradeRecord(editingRecord.id, fields, {
        feeProvided: feeText !== "",
        taxProvided: fields.side === "sell" && taxText !== "",
      });
    } else {
      addTradeRecord(fields);
    }
  }
});

// 交易紀錄刪除＋除息日「記應收」及實際入帳／更正（庫存損益面板）。
document.addEventListener("click", (event) => {
  const editCancel = event.target.closest("[data-trade-edit-cancel]");
  if (editCancel) {
    editCancel.blur();
    cancelTradeEdit();
    return;
  }
  const editBtn = event.target.closest("[data-trade-edit]");
  if (editBtn) {
    editBtn.blur();
    beginTradeEdit(editBtn.dataset.tradeEdit);
    return;
  }
  const loadMore = event.target.closest("[data-trade-load-more]");
  if (loadMore) {
    // 必須先 blur：真實瀏覽器點擊會把焦點留在這顆 button 上，而 renderHoldingsPanel()
    // 遇到 panel 內有 activeElement 就會 early-return（保護表單輸入），畫面因此完全不動。
    // jsdom 的 .click() 不移動焦點，所以既有測試看不出來。其餘同層 handler 都已 blur。
    loadMore.blur();
    tradesHistoryLimit = Math.min(tradesState.records.length, tradesHistoryLimit + 40);
    renderHoldingsPanel();
    return;
  }
  const removeBtn = event.target.closest("[data-trade-remove]");
  if (removeBtn) {
    removeBtn.blur();
    removeTradeRecord(removeBtn.dataset.tradeRemove);
    return;
  }
  const caQuick = event.target.closest("[data-corporate-action-quick]");
  if (caQuick) {
    // 必須先 blur：renderHoldingsPanel 遇到 panel 內有 activeElement 就會 early-return，
    // 沒 blur 的話畫面完全不動（「載入更多」踩過同一個坑）。
    caQuick.blur();
    if (!tradesState.mutating) {
      caQuick.disabled = true;
      caQuick.setAttribute("aria-busy", "true");
      caQuick.textContent = "儲存除權配股中…";
    }
    const exDate = caQuick.dataset.exDate;
    addTradeRecord({
      id: `ca-${caQuick.dataset.code}-${exDate}`,
      code: caQuick.dataset.code,
      side: "corporateAction",
      date: exDate,
      tradeDate: exDate,
      stockRatio: Number(caQuick.dataset.stockRatio) || 0,
      subscriptionRatio: Number(caQuick.dataset.subscriptionRatio) || 0,
      subscriptionPrice: Number(caQuick.dataset.subscriptionPrice) || 0,
      createdAt: new Date().toISOString(),
    });
    return;
  }
  const divQuick = event.target.closest("[data-dividend-quick]");
  if (divQuick) {
    divQuick.blur();
    if (!tradesState.mutating) {
      divQuick.disabled = true;
      divQuick.setAttribute("aria-busy", "true");
      divQuick.textContent = "儲存應收中…";
    }
    const relatedTrade = tradesState.records.find((record) => record.code === divQuick.dataset.code && record.side !== "dividend");
    const exDate = divQuick.dataset.exDate;
    addTradeRecord({
      id: divQuick.dataset.recordId,
      code: divQuick.dataset.code,
      market: divQuick.dataset.exchange === "TPEx" ? "TPEx" : "TWSE",
      instrumentType: relatedTrade ? tradeInstrumentOf(relatedTrade) : "stock",
      instrumentSource: relatedTrade?.instrumentSource || "user",
      side: "dividend",
      price: Number(divQuick.dataset.cash),
      shares: Number(divQuick.dataset.shares),
      date: exDate,
      tradeDate: exDate,
      executedAt: "",
      session: "unknown",
      brokerAccountId: relatedTrade?.brokerAccountId || "default",
      currency: "TWD",
      dayTrade: { status: "none", matchedShares: 0, pairId: "" },
      exDate,
      eventId: divQuick.dataset.eventId,
      entitledShares: Number(divQuick.dataset.shares),
      source: "official-event",
      status: "receivable",
      fee: null,
      feeAmountTwd: null,
    });
  }
});
document.addEventListener("change", (event) => {
  const personalBackupFile = event.target.closest("#personalBackupFile");
  if (personalBackupFile) {
    void previewPersonalBackupFile(personalBackupFile);
    return;
  }
  if (event.target.closest("#personalBackupConfirm")) {
    syncPersonalBackupControls();
    return;
  }
  const tradeCodeInput = event.target.closest('[data-trade-form] input[name="code"]');
  if (tradeCodeInput) {
    const form = tradeCodeInput.closest("[data-trade-form]");
    tradeCodeInput.value = normalizeStockCodeInput(tradeCodeInput.value);
    form.dataset.productUserEditVersion = "0";
    refreshTradeInstrumentProfile(form);
    return;
  }
  const tradeControl = event.target.closest('[data-trade-form] select[name="side"], [data-trade-form] select[name="instrumentType"], [data-trade-form] [data-trade-daytrade-status]');
  if (tradeControl) {
    const form = tradeControl.closest("[data-trade-form]");
    if (tradeControl.name === "instrumentType") {
      form.dataset.productUserEditVersion = String(Number(form.dataset.productUserEditVersion || 0) + 1);
    }
    syncTradeFormControls(form, { focusDividend: tradeControl.name === "side" && tradeControl.value === "dividend" });
    return;
  }
  const discountInput = event.target.closest("[data-trade-discount]");
  if (!discountInput) return;
  discountInput.blur();
  saveTradeSettings(discountInput.value);
});

document.addEventListener("input", (event) => {
  if (event.target.closest("#personalBackupPassword")) syncPersonalBackupControls();
});

// 到價提醒的刪除（detail 面板與「更多 → 訊號提醒」兩處共用同一個 data 屬性）。
document.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-alert-remove]");
  if (!removeBtn) return;
  removePriceAlert(removeBtn.dataset.alertRemove);
  render();
});

el.loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  loginWithCredentials(el.loginUsername?.value || "", el.loginPassword?.value || "");
});
document.getElementById("loginClose")?.addEventListener("click", () => setLoginGateVisible(false, ""));

function openStrategyLegend(trigger = document.activeElement) {
  const legend = document.getElementById("strategyLegend");
  if (!legend) return;
  openDialogLayer(legend, { trigger, initialFocus: "#strategyLegendClose" });
  document.getElementById("strategyLegendToggle")?.setAttribute("aria-expanded", "true");
}

function closeStrategyLegend() {
  const legend = document.getElementById("strategyLegend");
  if (legend) closeDialogLayer(legend);
  document.getElementById("strategyLegendToggle")?.setAttribute("aria-expanded", "false");
}

// 原生 button 會自行把 Enter／Space 轉成 click；這兩種既有自訂 role=button 元件則用同一條
// 委派路徑補齊鍵盤操作。卡片內若是另一個可互動控制項，交還給該控制項，避免連帶開啟卡片。
document.addEventListener("keydown", (event) => {
  if (event.repeat || !["Enter", " ", "Spacebar"].includes(event.key)) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const glossTrigger = target.closest("[data-glossary-term]");
  if (glossTrigger) {
    event.preventDefault();
    glossTrigger.click();
    return;
  }

  const swingCard = target.closest(".swing-card[data-swing-code][role=button]");
  if (!swingCard) return;
  const nestedControl = target.closest("button, a[href], input, select, textarea, summary, [contenteditable=true], [role=button], [tabindex]");
  if (nestedControl && nestedControl !== swingCard) return;
  event.preventDefault();
  swingCard.click();
});

document.addEventListener("click", async (event) => {
  // 名詞點擊：攔在最前面 → 開名詞解釋並跳到該詞，且不讓事件冒泡去觸發「點卡片開詳情」。
  const glossTrigger = event.target.closest("[data-glossary-term]");
  if (glossTrigger) {
    const glossOpener = glossTrigger.closest("button, a[href], [role=button], [tabindex]") || document.activeElement;
    openGlossaryAtTerm(glossTrigger.dataset.glossaryTerm || "", glossOpener);
    return;
  }

  const noteDelete = event.target.closest("[data-note-delete]");
  if (noteDelete) {
    deleteStockNote(state.selectedCode, noteDelete.dataset.noteDelete);
    return;
  }

  if (event.target.closest("[data-company-edit]")) {
    companyState.editing = true;
    renderCompanyProfile();
    return;
  }

  if (event.target.closest("[data-company-cancel]")) {
    companyState.editing = false;
    renderCompanyProfile();
    return;
  }

  const noteOpen = event.target.closest("[data-note-open]");
  if (noteOpen) {
    const code = normalizeStockCodeInput(noteOpen.dataset.noteOpen);
    await ensureStockForDetailCode(code);
    state.selectedCode = code;
    state.technicalCode = code;
    render();
    openDetailPanel(noteOpen);
    return;
  }

  const reloadNotesFeed = event.target.closest('[data-action="reload-notes-feed"]');
  if (reloadNotesFeed) {
    loadNotesFeed();
    return;
  }

  if (event.target.id === "personalBackupModal") {
    closePersonalBackupRestore();
    return;
  }
  const closePersonalBackup = event.target.closest('[data-action="close-personal-backup"]');
  if (closePersonalBackup) {
    closePersonalBackupRestore();
    return;
  }
  const downloadBackup = event.target.closest('[data-action="download-personal-backup"]');
  if (downloadBackup) {
    await downloadPersonalBackup(downloadBackup);
    return;
  }
  const openPersonalRestore = event.target.closest('[data-action="open-personal-restore"]');
  if (openPersonalRestore) {
    openPersonalBackupRestore(openPersonalRestore);
    return;
  }
  const applyPersonalRestore = event.target.closest('[data-action="restore-personal-backup"]');
  if (applyPersonalRestore) {
    await restorePersonalBackup();
    return;
  }

  const sourceOption = event.target.closest("[data-source-option]");
  if (sourceOption) {
    const nextSource = sourceOption.dataset.sourceOption === "broker" ? "broker" : "official";
    if (nextSource === "broker") {
      if (!authState.user) {
        // 未登入：先帶去教學頁看怎麼申請與串接，不直接擋在登入畫面。
        state.screen = "more";
        state.morePanel = "brokerGuide";
        render();
        showToast("券商資料需要登入後設定，先看這頁的申請教學");
        return;
      }
      if (!sourceState.sources?.broker && !sourceState.loading) {
        await loadSourceStatus();
      }
      if (!isBrokerSourceReady()) {
        switchToOfficialFallback(sourceState.sources?.broker?.message || "券商 API 未設定", {
          notify: true,
          refresh: getSelectedSource() !== "official",
        });
        // 還沒設定富邦 API：直接帶去教學與設定頁，而不是只留一句提示。
        state.screen = "more";
        state.morePanel = "brokerGuide";
        if (!brokerSettingsState.loaded) loadBrokerSettings();
        render();
        return;
      }
    }
    if (sourceState.selected !== nextSource) {
      sourceState.selected = nextSource;
      saveDataSource();
      dataState.mode = nextSource;
      dataState.error = "";
      marketState.error = "";
      render();
      loadMarketSummary({ notify: true });
      loadMarketData({ notify: true });
      showToast(`已切換為${getSelectedSourceLabel()}`);
    }
    return;
  }

  const adminReset = event.target.closest("[data-admin-reset]");
  if (adminReset) {
    resetAdminUserPassword(adminReset.dataset.adminReset, adminReset.dataset.adminUsername || "");
    return;
  }
  const adminDelete = event.target.closest("[data-admin-delete]");
  if (adminDelete) {
    deleteAdminUser(adminDelete.dataset.adminDelete, adminDelete.dataset.adminUsername || "");
    return;
  }

  const moreAction = event.target.closest('[data-action="refresh-data"], [data-action="open-filter"], [data-action="test-broker"], [data-action="delete-broker"], [data-action="reload-users"], [data-action="logout"], [data-action="toggle-surveillance"]');
  if (moreAction) {
    if (moreAction.dataset.action === "refresh-data") {
      loadMarketSummary({ notify: true });
      loadMarketData({ notify: true });
      loadOvernightSignals({ notify: true });
    }
    if (moreAction.dataset.action === "toggle-surveillance") {
      setShowSurveillance(!state.showSurveillance);
      showToast(state.showSurveillance ? "已顯示注意/處置股（含風險標示）" : "已隱藏注意/處置股");
    }
    if (moreAction.dataset.action === "open-filter") {
      openFilterDrawer(moreAction);
    }
    if (moreAction.dataset.action === "test-broker") {
      testBrokerSettings();
    }
    if (moreAction.dataset.action === "delete-broker") {
      deleteBrokerSettings();
    }
    if (moreAction.dataset.action === "reload-users") {
      loadAdminUsers();
    }
    if (moreAction.dataset.action === "logout") {
      logout();
    }
    return;
  }

  const watchFilter = event.target.closest("[data-watch-filter]");
  if (watchFilter) {
    state.watchFilter = watchFilter.dataset.watchFilter;
    clearWatchSelection();
    render();
    return;
  }

  const emptyWatchAdd = event.target.closest("[data-empty-watch-add]");
  if (emptyWatchAdd) {
    openWatchAddModal();
    return;
  }

  const watchSelect = event.target.closest("[data-watch-select]");
  if (watchSelect) {
    toggleWatchSelection(watchSelect.dataset.watchSelect);
    render();
    return;
  }

  const watchRemove = event.target.closest("[data-watch-remove]");
  if (watchRemove) {
    const code = watchRemove.dataset.watchRemove;
    const stock = stocks.find((item) => item.code === code);
    const list = watchLists[state.watchList] || watchLists[1];
    list.delete(code);
    saveWatchLists();
    if (state.selectedCode === code) {
      const nextStock = stocks.find((item) => list.has(item.code));
      if (nextStock) {
        state.selectedCode = nextStock.code;
      }
    }
    render();
    showToast(`${stock?.name || code} 已從自選股清單 ${state.watchList} 刪除`);
    return;
  }

  const watchTab = event.target.closest("[data-watch-list]");
  if (watchTab) {
    state.screen = "watchlist";
    state.watchList = watchTab.dataset.watchList;
    state.watchFilter = "all";
    state.watchEditMode = false;
    clearWatchSelection();
    render();
    return;
  }

  const detailTab = event.target.closest("[data-detail-tab]");
  if (detailTab) {
    state.detailTab = detailTab.dataset.detailTab;
    renderDetail();
    syncTabListAccessibility(detailTab.closest('[role="tablist"]'), detailTab);
    return;
  }

  const indicator = event.target.closest("[data-indicator]");
  if (indicator) {
    state.indicator = indicator.dataset.indicator;
    renderDetail();
    return;
  }

  const analysisPeriod = event.target.closest("[data-analysis-period]");
  if (analysisPeriod) {
    state.screen = "technical";
    state.technicalPeriod = analysisPeriod.dataset.analysisPeriod;
    render();
    analyzeTechnicalFromInput({ notify: true });
    return;
  }

  const setting = event.target.closest("[data-setting]");
  if (setting) {
    const settingName = setting.dataset.setting;
    if (settingName === "glossary") {
      openGlossary("", true, setting);
      return;
    }
    state.morePanel = settingName;
    if (settingName === "backup" && !authState.user) {
      setLoginGateVisible(true, "登入後才能備份或復原個人資料");
      render();
      return;
    }
    if (settingName === "backup") {
      render();
      return;
    }
    if (settingName === "system" && !authState.user) {
      setLoginGateVisible(true, "登入後才能管理帳號");
      render();
      return;
    }
    if (settingName === "system") {
      if (authState.user?.role === "admin" && !adminUsersState.loaded) loadAdminUsers();
      showToast("帳號管理");
      render();
      return;
    }
    if (settingName === "notesFeed") {
      if (!notesFeedState.loaded) loadNotesFeed();
      render();
      return;
    }
    if (settingName === "source") {
      showToast(`${getSelectedSourceLabel()}：${dataState.error || dataState.source || "等待更新"}`);
    } else if (settingName === "brokerGuide") {
      if (!brokerSettingsState.loaded) loadBrokerSettings();
      showToast("券商 API 金鑰請只放在後端設定，不要放手機網頁");
    } else if (settingName === "alerts") {
      showToast("目前只有畫面內提示，尚未接手機推播");
    } else if (settingName === "risk") {
      showToast("風險規則已固定套用在隔日沖公式");
    }
    render();
    return;
  }

  const overnightPick = event.target.closest("[data-overnight-code]");
  if (overnightPick) {
    const code = normalizeStockCodeInput(overnightPick.dataset.overnightCode);
    await ensureStockForDetailCode(code);
    state.selectedCode = code;
    state.technicalCode = state.selectedCode;
    render();
    openDetailPanel(overnightPick);
    return;
  }

  const legendToggle = event.target.closest("#strategyLegendToggle");
  if (legendToggle) {
    const legend = document.getElementById("strategyLegend");
    if (legend) {
      const willOpen = legend.hidden;
      if (willOpen) openStrategyLegend(legendToggle);
      else closeStrategyLegend();
    }
    return;
  }

  // 關閉「看懂每個數字」浮層：點 ✕ 按鈕、或點半透明背景（點 modal 內容不會觸發）。
  if (event.target.closest("#strategyLegendClose") || event.target.id === "strategyLegend") {
    closeStrategyLegend();
    return;
  }

  const swingScenario = event.target.closest("[data-swing-scenario]");
  if (swingScenario) {
    const key = swingScenario.dataset.swingScenario;
    const scenarioChanged = key !== strategyState.scenario;
    if (scenarioChanged) {
      strategyState.scenario = key;
      strategyState.loaded = false;
      strategyState.picks = [];
      strategyState.matchedCount = 0;
      strategyState.warnings = [];
    }
    state.screen = "strategy";
    render();
    // 換場景一定重抓（即使另一個場景還在載入中也要抓新的）；序號守門會丟棄過期的舊回應。
    if (scenarioChanged || strategyNeedsReload()) loadStrategyBoard();
    return;
  }

  const survTab = event.target.closest("[data-surv-tab]");
  if (survTab) {
    state.surveillanceTab = survTab.dataset.survTab;
    renderSurveillanceScreen();
    syncTabListAccessibility(survTab.closest('[role="tablist"]'), survTab);
    return;
  }

  if (event.target.closest("#survMineToggle")) {
    setSurvMineOnly(!state.survMineOnly);
    return;
  }
  const survMarketChip = event.target.closest("[data-surv-market]");
  if (survMarketChip) {
    state.survMarket = survMarketChip.dataset.survMarket;
    renderSurveillanceScreen();
    return;
  }
  const survIvChip = event.target.closest("[data-surv-interval]");
  if (survIvChip) {
    state.survInterval = survIvChip.dataset.survInterval;
    renderSurveillanceScreen();
    return;
  }

  const survCardEl = event.target.closest(".surv-card");
  if (survCardEl) {
    const code = normalizeStockCodeInput(survCardEl.dataset.code);
    await ensureStockForDetailCode(code);
    state.selectedCode = code;
    state.technicalCode = code;
    render();
    openDetailPanel(survCardEl);
    return;
  }

  if (event.target.closest("[data-inspect-close]")) {
    clearStrategyInspect();
    return;
  }

  const swingPick = event.target.closest("[data-swing-code]");
  if (swingPick) {
    const code = normalizeStockCodeInput(swingPick.dataset.swingCode);
    await ensureStockForDetailCode(code);
    state.selectedCode = code;
    state.technicalCode = state.selectedCode;
    render();
    openDetailPanel(swingPick);
    return;
  }

  const nav = event.target.closest(".nav-action");
  if (nav) {
    if (state.screen !== nav.dataset.screen) {
      try {
        history.pushState({ view: "screen", screen: nav.dataset.screen }, "");
      } catch {
        // 歷史 API 不可用時仍正常切換畫面。
      }
    }
    state.screen = nav.dataset.screen;
    if (state.screen !== "watchlist") {
      state.watchEditMode = false;
      clearWatchSelection();
    }
    if (state.screen === "screener" && state.universe === "overnight") {
      state.universe = "strong";
      state.sort = "strategy";
      state.sortDir = "desc";
    }
    render();
    if (state.screen === "technical" && technicalNeedsReload()) {
      loadTechnicalAnalysis();
    }
    if (state.screen === "strategy" && strategyNeedsReload()) {
      loadStrategyBoard();
    }
    if (state.screen === "surveillance" && surveillanceNeedsReload()) {
      loadSurveillanceBoard();
    }
    return;
  }

  const overnightView = event.target.closest("[data-overnight-view]");
  if (overnightView) {
    state.screen = "overnight";
    state.overnightView = overnightView.dataset.overnightView;
    state.watchEditMode = false;
    clearWatchSelection();
    render();
    return;
  }

  const segment = event.target.closest(".segment");
  if (segment) {
    state.universe = segment.dataset.universe;
    state.screen = state.universe === "overnight" ? "overnight" : "screener";
    state.watchEditMode = false;
    clearWatchSelection();
    if (state.screen === "screener") {
      state.sort = "strategy";
      state.sortDir = "desc";
    }
    render();
    return;
  }

  const strategy = event.target.closest("[data-strategy]");
  if (strategy) {
    state.strategy = strategy.dataset.strategy;
    state.sort = "strategy";
    state.sortDir = "desc";
    render();
    return;
  }

  const focus = event.target.closest(".focus-switch button");
  if (focus) {
    state.focus = focus.dataset.focus;
    state.strategy = focus.dataset.focus === "danger" ? "換手高危" : "量能熱區";
    state.universe = "turnover";
    state.sort = "strategy";
    state.sortDir = "desc";
    render();
    return;
  }

  const sort = event.target.closest(".table-head button[data-sort]");
  if (sort) {
    if (state.sort === sort.dataset.sort) {
      state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
    } else {
      state.sort = sort.dataset.sort;
      state.sortDir = "desc";
    }
    render();
    return;
  }

  const searchResult = event.target.closest(".search-result");
  if (searchResult) {
    const code = normalizeStockCodeInput(searchResult.dataset.code);
    state.selectedCode = code;
    state.technicalCode = code;
    if (state.addMode) {
      if (!addCodeToWatchList(code, state.watchList)) return;
      state.screen = "watchlist";
      state.watchFilter = "all";
      state.addMode = false;
      closeSearchModal();
      render();
      showToast(`已加入自選股清單 ${state.watchList}`);
      // 名稱搜尋來的股票可能還沒有報價：補抓一次，列表才會立刻出現。
      ensureStockForDetailCode(code).then(() => render());
      return;
    }
    closeSearchModal({ restoreFocus: false });
    await ensureStockForDetailCode(code);
    render();
    openDetailPanel(searchResult);
    return;
  }

  const stockRow = event.target.closest(".stock-row");
  if (stockRow) {
    if (state.screen === "watchlist" && state.watchEditMode) {
      toggleWatchSelection(stockRow.dataset.code);
      render();
      return;
    }
    state.selectedCode = stockRow.dataset.code;
    state.technicalCode = state.selectedCode;
    render();
    openDetailPanel(stockRow);
    return;
  }
});

function closeSearchModal({ restoreFocus = true } = {}) {
  state.addMode = false;
  resetSearchState();
  closeDialogLayer(el.searchModal, { restoreFocus });
}

document.getElementById("searchOpen").addEventListener("click", (event) => {
  state.addMode = false;
  resetSearchState();
  openDialogLayer(el.searchModal, { trigger: event.currentTarget, initialFocus: "#searchInput" });
  el.searchInput.value = "";
  el.searchInput.placeholder = "輸入股票名稱或代號";
  renderSearchResults();
});

function openWatchAddModal(trigger = document.activeElement) {
  state.watchEditMode = false;
  clearWatchSelection();
  state.addMode = true;
  resetSearchState();
  openDialogLayer(el.searchModal, { trigger, initialFocus: "#searchInput" });
  el.searchInput.value = "";
  el.searchInput.placeholder = `搜尋並加入自選股清單 ${state.watchList}`;
  renderSearchResults();
}

document.getElementById("watchAdd").addEventListener("click", (event) => {
  openWatchAddModal(event.currentTarget);
});

document.getElementById("watchEdit").addEventListener("click", () => {
  state.watchEditMode = !state.watchEditMode;
  clearWatchSelection();
  render();
});

document.getElementById("watchSelectVisible").addEventListener("click", () => {
  selectVisibleWatchStocks();
  render();
});

document.getElementById("watchClearSelection").addEventListener("click", () => {
  clearWatchSelection();
  render();
});

document.getElementById("watchRemoveSelected").addEventListener("click", () => {
  const removedCount = removeSelectedWatchStocks();
  render();
  if (removedCount) {
    showToast(`已從自選股清單 ${state.watchList} 移除 ${removedCount} 檔`);
  }
});

document.getElementById("searchClose").addEventListener("click", () => {
  closeSearchModal();
});

el.searchModal.addEventListener("click", (event) => {
  if (event.target === el.searchModal) {
    closeSearchModal();
  }
});

el.searchInput.addEventListener("input", (event) => {
  handleSearchInput(event.target.value);
});

el.technicalCode?.addEventListener("input", () => {
  technicalInputDirty = el.technicalCode.value.trim() !== state.technicalCode;
});

el.searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const firstResult = el.searchResults.querySelector(".search-result");
  if (firstResult) firstResult.click();
});

function openFilterDrawer(trigger = document.activeElement) {
  el.directionFilter.value = state.direction;
  el.turnoverFilter.value = state.minTurnover;
  el.turnoverValue.textContent = `${state.minTurnover}%`;
  el.watchOnlyFilter.checked = state.watchOnly;
  openDialogLayer(el.filterDrawer, { trigger, initialFocus: "#filterClose" });
}

function closeFilterDrawer() {
  closeDialogLayer(el.filterDrawer);
}

document.getElementById("filterOpen").addEventListener("click", (event) => {
  openFilterDrawer(event.currentTarget);
});

document.getElementById("filterClose").addEventListener("click", () => {
  closeFilterDrawer();
});

el.filterDrawer.addEventListener("click", (event) => {
  if (event.target === el.filterDrawer) {
    closeFilterDrawer();
  }
});

el.turnoverFilter.addEventListener("input", (event) => {
  el.turnoverValue.textContent = `${event.target.value}%`;
});

document.getElementById("filterApply").addEventListener("click", () => {
  state.direction = el.directionFilter.value;
  state.minTurnover = Number(el.turnoverFilter.value);
  state.watchOnly = el.watchOnlyFilter.checked;
  closeFilterDrawer();
  render();
});

document.getElementById("detailClose").addEventListener("click", () => {
  closeDetailPanel();
});

document.getElementById("watchToggle").addEventListener("click", () => {
  const stock = getSelectedStock();
  if (!stock) return;
  const list = watchLists[state.watchList] || watchLists[1];
  if (list.has(stock.code)) {
    list.delete(stock.code);
    state.watchSelection.delete(stock.code);
    saveWatchLists();
    showToast(`已移出自選股清單 ${state.watchList}`);
  } else {
    if (!addCodeToWatchList(stock.code, state.watchList)) return;
    showToast(`已加入自選股清單 ${state.watchList}`);
  }
  render();
});

document.getElementById("marketPill").addEventListener("click", () => {
  marketState.selected = marketState.selected === "tx" ? "taiex" : "tx";
  renderMarketPill();
  const market = marketState.markets[marketState.selected];
  showToast(market ? `${market.label}：${formatMarketMove(market.change)} / ${market.asOf}` : "市場資料尚未載入");
});

document.getElementById("refreshData").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  const originalHTML = button.innerHTML;
  button.classList.add("is-updating");
  button.innerHTML = '<span class="mini-spinner" aria-hidden="true"></span>更新中…';
  refreshGlobalLoadingBar(true); // 使用者主動按 → 立刻顯示頂端進度條（不等 400ms 去抖動）
  try {
    const tasks = [ensureMarketSessionStatus({ force: true }), loadMarketSummary(), loadMarketData({ notify: true }), loadOvernightSignals()];
    if (state.screen === "technical") {
      tasks.push(loadTechnicalAnalysis());
    }
    if (state.screen === "strategy") {
      strategyState.loaded = false;
      strategyState.error = "";
      tasks.push(loadStrategyBoard({ notify: true, refresh: true }));
    }
    if (state.screen === "surveillance") {
      surveillanceBoardState.loaded = false;
      surveillanceBoardState.error = "";
      tasks.push(loadSurveillanceBoard({ notify: true }));
    }
    if (state.screen === "overnight" && state.overnightView === "performance") {
      backtestState.loaded = false;
      backtestState.error = "";
      verifyHistoryState.loaded = false;
      verifyHistoryState.error = "";
      tasks.push(loadBacktestSummary(), loadVerifyHistory());
    }
    await Promise.allSettled(tasks);
  } finally {
    button.disabled = false;
    button.classList.remove("is-updating");
    button.innerHTML = originalHTML;
  }
});

let autoRefreshInFlight = false;

async function refreshLiveData() {
  if (document.hidden || autoRefreshInFlight || getSelectedSource() !== "official") return;
  // 鎖要在第一個 await 前取得；否則 timer 與 visibilitychange 可同時通過 guard，
  // 各送一整組市場／個股請求。等待交易日曆時頁面狀態也可能改變，完成後必須重驗。
  autoRefreshInFlight = true;
  try {
    await ensureMarketSessionStatus();
    if (document.hidden || getSelectedSource() !== "official") return;
    const stockSession = isTaiwanMarketSession();
    const futuresNightSession = isTaiwanFuturesNightSession();
    if (!stockSession && !futuresNightSession) return;

    let quoteApplied = false;
    if (stockSession) {
      const [, quoteResult] = await Promise.all([
        loadMarketSummary({ renderNow: false }),
        loadMarketData({ renderNow: false }),
      ]);
      quoteApplied = quoteResult === true;
    } else {
      // 夜盤時段只有台指期在動，個股報價不再變動，只更新市場指數。
      await loadMarketSummary({ renderNow: false });
    }
    // 同一輪的市場摘要、個股與到價狀態只提交一次，避免畫面抖動與重複排程圖表。
    renderLiveDataUpdate();
    if (quoteApplied) refreshSupplementalMarketData({ liveUpdate: true });
  } finally {
    autoRefreshInFlight = false;
  }
}

window.setInterval(refreshLiveData, 10 * 1000);

document.addEventListener("visibilitychange", () => {
  // 瀏覽器回到前景時立即補一次；in-flight guard 會合併和 10 秒 timer 撞在一起的情況。
  if (!document.hidden) {
    void refreshLiveData();
    scheduleCanvasRedraw("detail", "technical", "zoom");
  }
});

// PWA：只在安全環境註冊（localhost 就算，符合我們「各自在自己電腦跑」的用法；
// 未來部署 HTTPS 後手機也能「加到主螢幕」）。sw.js 走 network-first，
// 整包複製更新 code 後重整一次就是新版，不會卡舊快取。
if (window.isSecureContext && navigator.serviceWorker) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // 註冊失敗（例如直接開 file://）不影響看盤功能
    });
  });
}

// 三種圖表共用同一個 resize 排程：同一幀不論 ResizeObserver／window resize
// 進來多少次，每個可見圖最多重畫一次。
const canvasRedrawDirty = new Set();
let canvasRedrawFrame = 0;
function scheduleCanvasRedraw(...kinds) {
  kinds.forEach((kind) => canvasRedrawDirty.add(kind));
  if (canvasRedrawFrame) return;
  canvasRedrawFrame = window.requestAnimationFrame(() => {
    canvasRedrawFrame = 0;
    const dirty = new Set(canvasRedrawDirty);
    canvasRedrawDirty.clear();
    if (dirty.has("detail")) drawChart(getSelectedStock());
    if (dirty.has("technical") && state.screen === "technical") {
      drawTechnicalChart(technicalState.data);
      drawTechnicalMacdChart(technicalState.data);
    }
    if (dirty.has("zoom") && zoomChartState.open) {
      invalidateZoomReadoutLayout();
      drawZoomChart();
      updateZoomReadout(zoomChartState.index);
    }
  });
}

let canvasResizeObserver = null;
function initCanvasResizeObserver() {
  if (canvasResizeObserver || typeof window.ResizeObserver !== "function") return;
  const targetKinds = new Map([
    [el.priceChart?.parentElement, "detail"],
    [el.technicalChart?.closest(".technical-chart-card"), "technical"],
    [el.zoomChartStage, "zoom"],
  ].filter(([target]) => target));
  canvasResizeObserver = new window.ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const kind = targetKinds.get(entry.target);
      if (kind) scheduleCanvasRedraw(kind);
    });
  });
  targetKinds.forEach((_kind, target) => canvasResizeObserver.observe(target));
}

let canvasDprMedia = null;
function watchCanvasDpr() {
  canvasDprMedia?.removeEventListener?.("change", watchCanvasDpr);
  canvasDprMedia = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) || null;
  canvasDprMedia?.addEventListener?.("change", watchCanvasDpr, { once: true });
  if (canvasDprMedia) scheduleCanvasRedraw("detail", "technical", "zoom");
}

initCanvasResizeObserver();
watchCanvasDpr();
window.addEventListener("resize", () => scheduleCanvasRedraw("detail", "technical", "zoom"));

window.addEventListener("popstate", (event) => {
  // 手機返回鍵：先關個股詳情，再退回上一個主畫面。
  if (el.detailPanel.classList.contains("is-open")) {
    closeDetailPanel({ viaHistory: true });
    return;
  }
  const entry = event.state;
  if (entry?.view === "screen" && entry.screen) {
    state.screen = entry.screen;
    if (state.screen !== "watchlist") {
      state.watchEditMode = false;
      clearWatchSelection();
    }
    render();
    if (state.screen === "technical" && technicalNeedsReload()) {
      loadTechnicalAnalysis();
    }
    if (state.screen === "strategy" && strategyNeedsReload()) {
      loadStrategyBoard();
    }
    if (state.screen === "surveillance" && surveillanceNeedsReload()) {
      loadSurveillanceBoard();
    }
  }
});

// === 名詞 / 觀念解釋（全站可開的詞彙表）===
// 目的：朋友看不懂某些功能/名詞時，從 header「📖」或「更多」點開即可查；可搜尋、可依分類篩。
// def 內含刻意排版的 HTML（<strong> 等）→ 輸出時不 escape；term/aliases/分類值才 escape。
const GLOSSARY_CATS = ["看盤基礎", "隔日沖（短線）", "策略雷達（波段）", "技術指標", "風險與制度"];
const GLOSSARY = [
  // —— 看盤基礎 ——
  { term: "漲跌幅", cat: "看盤基礎", def: "今天的收盤（或現價）相對<strong>昨天收盤</strong>漲跌的百分比。台股慣例<strong>紅漲綠跌</strong>（和歐美相反），本 App 全站都照這個顏色。" },
  { term: "振幅", cat: "看盤基礎", def: "當天<strong>最高價到最低價</strong>的範圍占昨收的百分比，衡量盤中波動大小。振幅大代表上下劇烈、風險較高。" },
  { term: "收盤位置", aliases: ["位置"], cat: "看盤基礎", def: "收盤價落在「當日最高～最低」區間的位置：<strong>0%＝收在最低</strong>、<strong>100%＝收在最高</strong>。越高代表買盤把價守在高檔、收盤越強勢。" },
  { term: "量比5", aliases: ["量比", "量能"], cat: "看盤基礎", def: "今天成交量 ÷ 最近 5 日平均量。<strong>大於 1</strong>＝今天比近期熱、有放量；<strong>小於 1</strong>＝量縮。判斷「有沒有量」最快的指標。" },
  { term: "週轉率", cat: "看盤基礎", def: "當日成交股數 ÷ 公司流通在外股數，看「換手」熱度。小型股週轉率高常代表題材熱、波動大。" },
  { term: "單量 / 總量", aliases: ["單量", "總量"], cat: "看盤基礎", def: "<strong>單量</strong>＝最近一筆成交的張數；<strong>總量</strong>＝今天累計成交張數（<strong>1 張＝1000 股</strong>）。" },
  { term: "三大法人（外資／投信／自營）", aliases: ["法人", "外資", "投信", "自營", "三大法人", "法人籌碼"], cat: "看盤基礎", def: "<strong>法人</strong>＝用大資金操作的機構。<strong>外資</strong>＝國外機構（影響大盤最大）；<strong>投信</strong>＝國內基金公司（常做中小型股、有作帳行情）；<strong>自營</strong>＝券商用自有資金買賣（偏短線）。詳情面板「法人」頁顯示三者的<strong>買賣超</strong>（正＝買超、負＝賣超）；法人同步買超常是較強的支撐。" },
  { term: "即時 vs 收盤（昨收）", aliases: ["即時", "收盤", "昨收", "凍結"], cat: "看盤基礎", def: "<strong>即時報價</strong>會隨盤中跳動；<strong>收盤</strong>是當日結算後固定的價。盤中還沒收盤、又拿不到即時價時，會先顯示<strong>昨收</strong>（前一交易日收盤）。所以策略卡片（收盤、整天凍結）和右側面板（即時）盤中本來就可能不同，屬正常。" },

  // —— 隔日沖（短線）——
  { term: "隔日沖", cat: "隔日沖（短線）", def: "一種<strong>短線</strong>操作——依訊號日收盤型態，觀察<strong>實際下一交易日</strong>的延續慣性，通常抱約 1 個交易日。本 App 會用官方交易日曆確認觀察日，不把週末或連假算成隔日。" },
  { term: "強勢續攻（隔日沖）", aliases: ["強勢續攻"], cat: "隔日沖（短線）", def: "隔日沖型態：訊號日收盤強（收在高檔、量能放大、站上均線），觀察下一交易日是否延續。和策略雷達的「<strong>上軌續攻</strong>」是不同週期——後者是抱數天到數週的波段。" },
  { term: "爆量高危", cat: "隔日沖（短線）", def: "今天爆量、振幅大或收盤轉弱的股，屬<strong>高風險</strong>，用來提醒控管追高，<strong>不是買進建議</strong>。" },
  { term: "回檔轉強", cat: "隔日沖（短線）", def: "訊號日小漲收紅 K、守住短均、回檔後重新轉強，觀察下一交易日能否延續。" },
  { term: "強度（分）", aliases: ["強度"], cat: "隔日沖（短線）", def: "隔日沖卡片的 0~100 分，代表「續攻條件的完整度」，<strong>不是下一交易日上漲的機率</strong>。" },
  { term: "回測（隔日表現回測）", aliases: ["回測"], cat: "隔日沖（短線）", def: "把型態套用到過去相同情況，統計<strong>實際下一交易日</strong>的表現。卡片上「回測 N 次 / +2 X% / 收 Y%」＝過去出現 N 次、其中下一交易日最高漲過 +2% 的比例與收盤平均報酬。是歷史統計，不是勝率保證。" },

  // —— 策略雷達（波段）——
  { term: "波段", cat: "策略雷達（波段）", def: "比隔日沖長的操作週期，通常抱<strong>數天到數週</strong>，賺一整段趨勢。「策略雷達」篩的就是這種、並附完整進出場計畫。" },
  { term: "掃描範圍（前 240 檔）", aliases: ["240", "掃描範圍", "候選池", "掃描池"], cat: "策略雷達（波段）", def: "策略雷達不是掃全台股，而是每個交易日從<strong>上市櫃普通股</strong>中排除停牌、下市與日量太小的標的，再取<strong>當日成交量最大的前 240 檔</strong>掃型態。注意／處置／變更交易股<strong>保留並醒目標示</strong>，可由風險開關隱藏，不會偷偷從候選池消失。所以「命中 8／240」的 240＝<strong>當天的候選池</strong>，<strong>不是全市場只有 240 檔</strong>。這份名單依當日成交量每個交易日重選；低量股容易滑價、想賣卻賣不掉，本來就不適合波段，所以不納入。" },
  { term: "中軌攻防", cat: "策略雷達（波段）", def: "波段型態——股價回檔到<strong>布林中軌</strong>（約等於月線 MA20）附近站穩、MACD 維持金叉，準備再往上攻。較穩、常是剛起漲的位置。" },
  { term: "上軌續攻", aliases: ["強勢續攻（波段）"], cat: "策略雷達（波段）", def: "波段型態——股價沿<strong>布林上軌</strong>強勢延伸（距中軌 1.3~3σ）、均線多頭、MACD 連續金叉。較強、趨勢已發動。<small>（舊名「強勢續攻」，為和隔日沖區隔而改名。）</small>" },
  { term: "RANK / 評分", aliases: ["RANK", "評分", "型態分"], cat: "策略雷達（波段）", def: "評分 0~100，綜合趨勢、MACD 動能、貼軌位置、量能、流動性、盈虧比算出，越高代表型態越好且越划算；<strong>RANK</strong> 就是依分數由高到低排名，RANK 1＝當日最高分。盈虧比小於 1 的不列入。" },
  { term: "進場", cat: "策略雷達（波段）", def: "建議進場價，預設<strong>＝當日收盤價</strong>（所以常和右上角「收盤」是同一個數字）。" },
  { term: "建議停損（−5%）", aliases: ["建議停損", "初始停損"], cat: "策略雷達（波段）", def: "進場後的<strong>初始停損</strong>，固定設在收盤 −5%，控制單筆最大虧損。" },
  { term: "結構停損", cat: "策略雷達（波段）", def: "依下方<strong>支撐</strong>（擺動低點／布林下軌／月線）設的較大停損，是盈虧比計算用的防守價。" },
  { term: "啟動移停（+5%）", aliases: ["啟動移停", "移動停利"], cat: "策略雷達（波段）", def: "進階——股價漲到收盤 +5% 後，改用「<strong>移動停利</strong>」往上跟，鎖住已有獲利。" },
  { term: "目標", cat: "策略雷達（波段）", def: "推估的目標價，取上方壓力或波段量測幅度（本波回檔前的高低差往上投射）。" },
  { term: "盈虧比", aliases: ["風險報酬比", "RR"], cat: "策略雷達（波段）", def: "＝（目標 − 進場）÷（進場 − 結構停損），也就是「<strong>賺的空間 ÷ 賠的風險</strong>」，越大越划算；小於 1（風險大於報酬）的設定 App 會<strong>直接濾掉</strong>。卡片底部色條：綠＝到停損的風險、紅＝到目標的空間。" },

  // —— 技術指標 ——
  { term: "均線（MA5 / MA20 / MA60）", aliases: ["均線", "MA", "月線", "季線", "週線"], cat: "技術指標", def: "最近 N 日收盤的平均線。MA5＝週線、<strong>MA20≈月線</strong>、MA60≈季線。價在均線上方＝偏多；短均在長均之上（MA5＞MA20）＝<strong>多頭排列</strong>。" },
  { term: "MACD / 金叉", aliases: ["MACD", "金叉", "DIF", "DEA"], cat: "技術指標", def: "用兩條 EMA 的差（DIF）與其平均（DEA）衡量動能。DIF 由下往上穿過 DEA＝<strong>金叉</strong>（動能轉強）。本 App 要求「<strong>連續</strong>金叉幾天」才算數，濾掉只有一根 K 的假訊號。" },
  { term: "布林通道（中軌／上軌／下軌、σ）", aliases: ["布林", "布林通道", "中軌", "上軌", "下軌", "標準差", "sigma", "σ"], cat: "技術指標", def: "以 MA20 為<strong>中軌</strong>，上下各加減「2 倍標準差」畫出<strong>上軌、下軌</strong>。<strong>σ（標準差）</strong>衡量價格離中軌多遠：0σ＝貼中軌、2σ＝貼上軌。貼上軌＝強勢延伸、貼中軌＝回檔防守。" },
  { term: "ATR", aliases: ["平均真實波幅"], cat: "技術指標", def: "平均真實波幅，衡量近期每天平均波動多少，常用來抓合理的停損距離。" },

  // —— 風險與制度 ——
  { term: "注意股 / 處置股", aliases: ["注意股", "處置股", "分盤交易"], cat: "風險與制度", def: "證交所對股價／週轉異常的股票發布「<strong>注意</strong>」（只是提醒、無交易限制），情節更重會「<strong>處置</strong>」——常需<strong>分盤集合競價</strong>（每 5 或 20 分才撮合）、<strong>預收全額款券</strong>、多半<strong>不能當沖</strong>。本 App 的選股清單<strong>會顯示並標示</strong>這些股票（可在『更多 → 風險規則』切換隱藏），讓你知情而非靜默濾掉。" },
  { term: "變更交易 / 全額交割", aliases: ["變更交易", "全額交割"], cat: "風險與制度", def: "財務或經營有疑慮被列管的股票，買進要先<strong>全額付款</strong>（全額交割）。風險高；本 App 會<strong>保留並醒目標示</strong>，讓你自行判斷，也可在風險規則中切換隱藏。" },
  { term: "彈性面額股（股名帶 *）", aliases: ["彈性面額", "星號", "*"], cat: "風險與制度", def: "股名後的「<strong>*</strong>」是官方標記「每股面額不是新台幣 10 元」的股票，<strong>不是錯字、也不是風險警示</strong>。它的股價高低不能直接和一般股（面額 10 元）相比，要看市值才準。" },
  { term: "還原股價（除權息）", aliases: ["還原股價", "除權息", "除息", "除權"], cat: "風險與制度", def: "除權息當天股價會因配息／配股產生制度性跳空，<strong>不等於真的大跌</strong>。App 優先用官方現金股利、股票股利與現增資料還原歷史價；舊區段若只有大跳空可推估，會明示「<strong>疑似／估算還原</strong>」，不把推測冒充官方事件。官方公告欄位未齊時，策略雷達會暫停該檔判定，避免錯算均線。<br><strong>偵測範圍的界線</strong>：官方只提供除權息的機器可讀資料，<strong>沒有減資、面額變更、股票分割的端點</strong>。這幾類事件靠「跳空超過 10.5%」推估——減資 10% 以上與所有股票分割都會被抓到並標成估算，但<strong>幅度小於 10.5% 的減資偵測不到</strong>，那段圖會保留原始跳空。所以技術分析頁寫「沒有偵測到公司行動」是指<strong>沒查到</strong>，不是保證沒發生。" },
  { term: "流動性", aliases: ["流動性", "滑價", "低流動性"], cat: "風險與制度", def: "一檔股票好不好買賣、進出會不會大幅影響價格。量太小（低流動性）容易<strong>滑價</strong>、想賣卻賣不掉，不適合波段，所以策略雷達只掃<strong>流動性前 240 檔</strong>（這 240 檔依當日成交量<strong>每個交易日重選</strong>，不是固定名單）。" },
];
const glossaryState = { cat: "", q: "" };

function renderGlossary() {
  const body = document.getElementById("glossaryBody");
  const catsEl = document.getElementById("glossaryCats");
  if (!body || !catsEl) return;
  const chips = [{ label: "全部", value: "" }, ...GLOSSARY_CATS.map((c) => ({ label: c, value: c }))];
  catsEl.innerHTML = chips
    .map((c) => `<button type="button" class="glossary-chip${glossaryState.cat === c.value ? " is-active" : ""}" data-glossary-cat="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`)
    .join("");
  const q = glossaryState.q.trim().toLowerCase();
  const stripTags = (s) => String(s).replace(/<[^>]+>/g, "");
  const matched = GLOSSARY.filter((item) => {
    if (glossaryState.cat && item.cat !== glossaryState.cat) return false;
    if (!q) return true;
    const hay = `${item.term} ${(item.aliases || []).join(" ")} ${stripTags(item.def)}`.toLowerCase();
    return hay.includes(q);
  });
  if (!matched.length) {
    body.innerHTML = `<p class="glossary-empty">找不到「${escapeHtml(glossaryState.q)}」相關的名詞。<br />換個關鍵字試試，例如「量比」「布林」「盈虧比」。</p>`;
    return;
  }
  const byCat = new Map();
  for (const item of matched) {
    if (!byCat.has(item.cat)) byCat.set(item.cat, []);
    byCat.get(item.cat).push(item);
  }
  body.innerHTML = GLOSSARY_CATS.filter((c) => byCat.has(c))
    .map(
      (c) => `
      <section class="glossary-section">
        <h3>${escapeHtml(c)}</h3>
        <dl>
          ${byCat
            .get(c)
            .map(
              (item) => `
            <div data-term-idx="${GLOSSARY.indexOf(item)}">
              <dt>${escapeHtml(item.term)}${item.aliases && item.aliases.length ? `<span class="glossary-alias">${escapeHtml(item.aliases.join(" / "))}</span>` : ""}</dt>
              <dd>${item.def}</dd>
            </div>`
            )
            .join("")}
        </dl>
      </section>`
    )
    .join("");
}

function openGlossary(presetQuery = "", focusInput = true, trigger = document.activeElement) {
  const modal = document.getElementById("glossaryModal");
  const input = document.getElementById("glossarySearch");
  if (!modal) return;
  glossaryState.cat = "";
  glossaryState.q = presetQuery || "";
  if (input) input.value = glossaryState.q;
  renderGlossary();
  openDialogLayer(modal, {
    trigger,
    initialFocus: focusInput ? "#glossarySearch" : ".glossary-modal",
  });
}

function closeGlossary() {
  const modal = document.getElementById("glossaryModal");
  if (modal) closeDialogLayer(modal);
}

// 找名詞在 GLOSSARY 的索引：先精準比對 term、再比對 aliases、最後做包含式模糊比對，
// 讓卡片只要傳短標籤（如「量比」「建議停損」）也能對到正確條目。
function findGlossaryIndex(term) {
  const t = String(term || "").trim();
  if (!t) return -1;
  let i = GLOSSARY.findIndex((g) => g.term === t);
  if (i >= 0) return i;
  i = GLOSSARY.findIndex((g) => (g.aliases || []).includes(t));
  if (i >= 0) return i;
  i = GLOSSARY.findIndex((g) => g.term.includes(t));
  if (i >= 0) return i;
  return GLOSSARY.findIndex((g) => (g.aliases || []).some((a) => a.includes(t) || t.includes(a)));
}

// 從卡片/面板的名詞點進來：開整份名詞表 → 捲到該詞、閃一下 highlight。
// 不聚焦搜尋框（避免手機跳鍵盤，也讓目標詞保持在視窗內）。
function openGlossaryAtTerm(term, trigger = document.activeElement) {
  openGlossary("", false, trigger);
  const idx = findGlossaryIndex(term);
  if (idx < 0) return;
  requestAnimationFrame(() => {
    const node = document.querySelector(`#glossaryBody [data-term-idx="${idx}"]`);
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.classList.add("is-flash");
    setTimeout(() => node.classList.remove("is-flash"), 1700);
  });
}

// 把文字包成可點的名詞（虛線底線提示），點擊 → 開名詞解釋並跳到該詞。term 預設＝顯示文字。
function glossLink(label, term = label) {
  return `<span class="gloss-link" data-glossary-term="${escapeHtml(term)}" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="glossaryModal" title="點看「${escapeHtml(term)}」說明">${escapeHtml(label)}</span>`;
}

// 把卡片/面板上的「指標標籤、風險標、回測、強度」對應到名詞表的條目；
// 對得到就回可點 gloss-link、對不到就原樣輸出（escape）。供隔日沖卡片、詳情指標等共用。
const METRIC_GLOSS_TERMS = {
  "漲幅": "漲幅", "量比5": "量比5", "量比": "量比5", "位置": "收盤位置", "收盤位置": "收盤位置",
  "振幅": "振幅", "高振幅": "振幅", "低流動性": "流動性", "爆量過熱": "量比5", "收盤轉弱": "收盤位置",
  "週轉": "週轉率", "週轉未接": "週轉率",
  "單量": "單量 / 總量", "總量": "單量 / 總量", "昨收": "即時 vs 收盤（昨收）",
  "MA5": "均線", "MA20": "均線", "盤中均": "均線",
  "外資": "三大法人（外資／投信／自營）", "投信": "三大法人（外資／投信／自營）", "自營": "三大法人（外資／投信／自營）",
  "回測": "回測（隔日表現回測）",
  "強度": "強度（分）", "熱度": "強度（分）", "轉強": "強度（分）",
};
function metricTerm(label) {
  const key = String(label || "").trim();
  if (METRIC_GLOSS_TERMS[key]) return METRIC_GLOSS_TERMS[key];
  if (/MA\d|均線/.test(key)) return "均線";
  return null;
}
function glossMaybe(label, term) {
  const t = term || metricTerm(label);
  return t ? glossLink(label, t) : escapeHtml(label);
}

document.getElementById("glossaryOpen")?.addEventListener("click", (event) => openGlossary("", true, event.currentTarget));
document.getElementById("glossaryClose")?.addEventListener("click", closeGlossary);

// 技術分析放大檢視：點圖或「放大」鈕開啟；X／點背景／Esc 關閉；游標用 Pointer Events（滑鼠＋觸控通用）。
el.technicalZoomOpen?.addEventListener("click", openTechnicalZoom);
el.technicalChart?.addEventListener("click", openTechnicalZoom);
// 各列表共用的明細小圖：點圖／點「放大」鈕 → 用技術頁同一套放大檢視看這檔（隔日沖/盤中選股/策略雷達/自選股皆可）。
el.priceChart?.addEventListener("click", (event) => openZoomForStock(state.selectedCode, event.currentTarget));
el.detailZoomOpen?.addEventListener("click", (event) => { event.stopPropagation(); openZoomForStock(state.selectedCode, event.currentTarget); });
el.technicalChart?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openTechnicalZoom(event);
});
el.priceChart?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openZoomForStock(state.selectedCode, event.currentTarget);
});
// 處置看板工具列：搜尋（即時過濾，不奪焦）、排序（存偏好）。
el.survSearch?.addEventListener("input", () => { state.survQuery = el.survSearch.value; renderSurveillanceScreen(); });
el.survSort?.addEventListener("change", () => {
  state.survSort = el.survSort.value;
  try { window.localStorage.setItem(SURV_SORT_KEY, state.survSort); } catch {}
  renderSurveillanceScreen();
});
// 處置看板說明卡：開／關（X／點背景／Esc）。
el.survHelpOpen?.addEventListener("click", (event) => {
  if (!el.survHelp) return;
  openDialogLayer(el.survHelp, { trigger: event.currentTarget, initialFocus: "#survHelpClose" });
  refreshLucideIcons();
});
el.survHelpClose?.addEventListener("click", () => { if (el.survHelp) closeDialogLayer(el.survHelp); });
el.survHelp?.addEventListener("click", (event) => { if (event.target === el.survHelp) closeDialogLayer(el.survHelp); });
el.zoomChartClose?.addEventListener("click", closeTechnicalZoom);
el.technicalZoomModal?.addEventListener("click", (event) => {
  if (event.target === el.technicalZoomModal) closeTechnicalZoom();
});
// 操作說明：放大圖右上角「？」、內嵌技術頁「？」都開同一張；X／「知道了」／點背景關閉。
el.zoomChartHelpOpen?.addEventListener("click", openZoomHelp);
el.technicalHelpOpen?.addEventListener("click", openZoomHelp);
el.zoomChartHelpClose?.addEventListener("click", closeZoomHelp);
el.zoomChartHelpGot?.addEventListener("click", closeZoomHelp);
el.zoomChartHelp?.addEventListener("click", (event) => {
  if (event.target === el.zoomChartHelp) closeZoomHelp();
});
el.zoomChartPeriods?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-zoom-period]");
  if (button) setZoomPeriod(button.dataset.zoomPeriod);
});
el.zoomChartTools?.addEventListener("click", (event) => {
  const toolBtn = event.target.closest("[data-draw-tool]");
  if (toolBtn) { setDrawTool(toolBtn.dataset.drawTool); return; }
  const swatch = event.target.closest("[data-draw-color]");
  if (swatch) { drawState.color = swatch.dataset.drawColor; updateDrawToolsUI(); return; }
  const actionBtn = event.target.closest("[data-draw-action]");
  if (actionBtn) {
    if (actionBtn.dataset.drawAction === "undo") {
      undoDrawing();
      if (zoomChartState.open) drawZoomCrosshair();
    } else if (actionBtn.dataset.drawAction === "clear") {
      if (currentDrawings().length && window.confirm("清除這檔的所有畫線？")) {
        clearDrawings();
        if (zoomChartState.open) drawZoomCrosshair();
      }
    }
  }
});
if (el.zoomCrosshairCanvas) {
  const crossCanvas = el.zoomCrosshairCanvas;
  let zoomLastTapTime = 0;
  let zoomLastTapX = 0;
  const zoomPointers = new Map();   // pointerId -> { x, y, type }
  let zoomPanLastX = null;          // 滑鼠拖曳平移：上一個 clientX
  let zoomPinch = null;             // 雙指縮放：{ startDist, startCount, centerAbsIndex }
  let zoomPointerMoveFrame = 0;
  let pendingZoomPointerMove = null;
  let zoomDrawTouchCandidate = null; // 畫線觸控延後到 pointerup 才提交，先等是否出現第二指
  let zoomGestureUsedMultiTouch = false;

  const localX = (clientX) => clientX - crossCanvas.getBoundingClientRect().left;
  const touchPoints = () => [...zoomPointers.values()].filter((p) => p.type === "touch");
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function startPinch(pts) {
    const g = zoomChartState.geometry;
    if (!g) return;
    const midX = (pts[0].x + pts[1].x) / 2 - crossCanvas.getBoundingClientRect().left;
    zoomPinch = { startDist: Math.max(1, dist(pts[0], pts[1])), startCount: zoomChartState.viewCount, centerAbsIndex: g.indexFromX(midX) };
  }
  function handlePinch(pts) {
    const g = zoomChartState.geometry;
    if (!g || !zoomPinch) return;
    const midX = (pts[0].x + pts[1].x) / 2 - crossCanvas.getBoundingClientRect().left;
    const d = Math.max(1, dist(pts[0], pts[1]));
    const total = g.candles.length;
    const minBars = Math.min(ZOOM_MIN_BARS, total);
    let count = Math.max(minBars, Math.min(total, Math.round(zoomPinch.startCount * (zoomPinch.startDist / d))));
    const stepNew = g.chartWidth / Math.max(1, count - 1);
    let start = Math.max(0, Math.min(Math.round(zoomPinch.centerAbsIndex - (midX - g.left) / stepNew), total - count));
    if (count !== zoomChartState.viewCount || start !== zoomChartState.viewStart) {
      zoomChartState.viewCount = count;
      zoomChartState.viewStart = start;
      redrawZoom();
    }
  }

  crossCanvas.addEventListener("pointerdown", (event) => {
    try { crossCanvas.setPointerCapture?.(event.pointerId); } catch { /* 某些指標無法 capture，忽略即可 */ }
    zoomPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    // 畫線模式：放點／刪除（雙指仍可縮放）。
    if (drawState.tool !== "cursor") {
      if (event.pointerType === "touch") {
        const pts = touchPoints();
        if (pts.length >= 2) {
          zoomGestureUsedMultiTouch = true;
          zoomDrawTouchCandidate = null;
          if (!zoomChartState.locked) startPinch(pts);
          return;
        }
        // 第一指先只提供預覽；若後續出現第二指，就確定是 pinch 而不是畫線。
        zoomGestureUsedMultiTouch = false;
        zoomDrawTouchCandidate = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
        handleDrawPointerMove(event.clientX, event.clientY);
        return;
      }
      handleDrawPointerDown(event.clientX, event.clientY);
      return;
    }
    const now = Date.now();
    const isDoubleTap = now - zoomLastTapTime < 320 && Math.abs(event.clientX - zoomLastTapX) < 32;
    zoomLastTapTime = now;
    zoomLastTapX = event.clientX;
    // 點兩下（滑鼠雙擊／手機快速點兩下）→ 鎖定／解除目前位置這根 K 棒。
    if (isDoubleTap && zoomChartState.geometry) {
      if (!zoomChartState.locked) {
        zoomChartState.index = zoomChartState.geometry.indexFromX(localX(event.clientX));
        zoomChartState.pointerY = event.clientY - crossCanvas.getBoundingClientRect().top;
      }
      toggleZoomLock();
      return;
    }
    if (event.pointerType === "touch") {
      const pts = touchPoints();
      if (pts.length >= 2) {
        if (!zoomChartState.locked) startPinch(pts);
        return;
      } // 雙指 → 縮放／平移
      handleZoomPointer(event);                          // 單指 → 十字游標
    } else {
      zoomPanLastX = zoomChartState.locked ? null : event.clientX; // 鎖定時不啟動平移
    }
  });

  function processZoomPointerMove(event) {
    if (!zoomChartState.open) return;
    // 畫線模式：預覽／hover（雙指仍可縮放）。
    if (drawState.tool !== "cursor") {
      if (event.pointerType === "touch" && touchPoints().length >= 2) {
        zoomGestureUsedMultiTouch = true;
        zoomDrawTouchCandidate = null;
        if (!zoomChartState.locked) handlePinch(touchPoints());
        return;
      }
      if (event.pointerType === "touch" && zoomDrawTouchCandidate?.pointerId === event.pointerId) {
        zoomDrawTouchCandidate.clientX = event.clientX;
        zoomDrawTouchCandidate.clientY = event.clientY;
      }
      handleDrawPointerMove(event.clientX, event.clientY);
      return;
    }
    if (event.pointerType === "touch") {
      const pts = touchPoints();
      if (pts.length >= 2) { handlePinch(pts); return; }  // 雙指縮放
      if (zoomChartState.locked) return;
      handleZoomPointer(event);                            // 單指十字游標
      return;
    }
    // 滑鼠：按住拖曳＝平移；單純移動(hover)＝十字游標。
    if (zoomChartState.locked) return;
    if ((event.buttons & 1) && zoomPanLastX != null && zoomChartState.geometry) {
      const deltaBars = -Math.round((event.clientX - zoomPanLastX) / zoomChartState.geometry.step);
      if (deltaBars !== 0) { panViewByBars(deltaBars); zoomPanLastX = event.clientX; }
      return;
    }
    handleZoomPointer(event);
  }

  function flushZoomPointerMove() {
    if (zoomPointerMoveFrame) {
      window.cancelAnimationFrame?.(zoomPointerMoveFrame);
      zoomPointerMoveFrame = 0;
    }
    const pending = pendingZoomPointerMove;
    pendingZoomPointerMove = null;
    if (pending) processZoomPointerMove(pending);
  }

  crossCanvas.addEventListener("pointermove", (event) => {
    if (zoomPointers.has(event.pointerId)) {
      zoomPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    }
    // Pointer Events 在高更新率滑鼠／觸控板上一幀可能進來數十次；只保留最新座標，
    // 每個 animation frame 最多重畫一次，避免重複 canvas＋readout layout。
    pendingZoomPointerMove = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      buttons: event.buttons,
    };
    if (zoomPointerMoveFrame) return;
    zoomPointerMoveFrame = window.requestAnimationFrame(() => {
      zoomPointerMoveFrame = 0;
      const pending = pendingZoomPointerMove;
      pendingZoomPointerMove = null;
      if (pending) processZoomPointerMove(pending);
    });
  });

  const endZoomPointer = (event, { cancelled = false } = {}) => {
    // pointerup 前先套用最後一筆移動，拖曳／雙指手勢才不會少掉收尾距離。
    if (pendingZoomPointerMove) flushZoomPointerMove();
    const shouldCommitDrawTouch = !cancelled && drawState.tool !== "cursor" &&
      event.pointerType === "touch" && !zoomGestureUsedMultiTouch &&
      zoomDrawTouchCandidate?.pointerId === event.pointerId && touchPoints().length === 1;
    if (shouldCommitDrawTouch) {
      handleDrawPointerDown(event.clientX, event.clientY);
    }
    zoomPointers.delete(event.pointerId);
    if (touchPoints().length < 2) zoomPinch = null;
    if (event.pointerType === "touch" && touchPoints().length === 0) {
      zoomDrawTouchCandidate = null;
      zoomGestureUsedMultiTouch = false;
    }
    if (event.pointerType !== "touch") zoomPanLastX = null;
  };
  crossCanvas.addEventListener("pointerup", (event) => endZoomPointer(event));
  crossCanvas.addEventListener("pointercancel", (event) => endZoomPointer(event, { cancelled: true }));

  // 滾輪：以游標為定點縮放。
  crossCanvas.addEventListener("wheel", (event) => {
    if (!zoomChartState.open || !zoomChartState.geometry || zoomChartState.locked) return;
    event.preventDefault();
    const cx = localX(event.clientX);
    zoomViewBy(event.deltaY > 0 ? 1.18 : 1 / 1.18, zoomChartState.geometry.indexFromX(cx), cx);
  }, { passive: false });

  resetZoomPointerInteraction = () => {
    if (zoomPointerMoveFrame) window.cancelAnimationFrame?.(zoomPointerMoveFrame);
    zoomPointerMoveFrame = 0;
    pendingZoomPointerMove = null;
    zoomPointers.clear();
    zoomPanLastX = null;
    zoomPinch = null;
    zoomDrawTouchCandidate = null;
    zoomGestureUsedMultiTouch = false;
    zoomLastTapTime = 0;
    zoomLastTapX = 0;
  };
}
document.addEventListener("keydown", (event) => {
  if (!el.technicalZoomModal || el.technicalZoomModal.hidden || topDialogLayer() !== el.technicalZoomModal) return;
  // 畫線模式時，方向鍵/縮放鍵交給瀏覽器，避免和放點衝突的誤觸（保留 Delete 刪除 hover 線）。
  if (drawState.tool !== "cursor") {
    if ((event.key === "Delete" || event.key === "Backspace") && drawState.hoverId) {
      event.preventDefault();
      removeDrawing(drawState.hoverId);
      drawState.hoverId = null;
      drawZoomCrosshair();
    }
    return;
  }
  // 鍵盤左右鍵：一根一根看（鎖定中也能逐根移動，方便精準對齊）。
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    stepZoomIndex(event.key === "ArrowLeft" ? -1 : 1);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const len = zoomChartState.geometry?.candles?.length || 0;
    if (len) stepZoomToIndex(event.key === "Home" ? 0 : len - 1);
  } else if (!zoomChartState.locked && (event.key === "ArrowUp" || event.key === "+" || event.key === "=")) {
    event.preventDefault();
    const mid = zoomChartState.viewStart + Math.floor(zoomChartState.viewCount / 2);
    zoomViewBy(1 / 1.25, mid, zoomChartState.geometry ? (zoomChartState.geometry.left + zoomChartState.geometry.chartWidth / 2) : 0);
  } else if (!zoomChartState.locked && (event.key === "ArrowDown" || event.key === "-" || event.key === "_")) {
    event.preventDefault();
    const mid = zoomChartState.viewStart + Math.floor(zoomChartState.viewCount / 2);
    zoomViewBy(1.25, mid, zoomChartState.geometry ? (zoomChartState.geometry.left + zoomChartState.geometry.chartWidth / 2) : 0);
  } else if (event.key === "0" || event.key === "r" || event.key === "R") {
    event.preventDefault();
    resetZoomView();
  }
});
document.getElementById("glossarySearch")?.addEventListener("input", (event) => {
  glossaryState.q = event.target.value || "";
  renderGlossary();
});
const glossaryModalEl = document.getElementById("glossaryModal");
glossaryModalEl?.addEventListener("click", (event) => {
  if (event.target === glossaryModalEl) {
    closeGlossary();
    return;
  }
  const chip = event.target.closest("[data-glossary-cat]");
  if (chip) {
    glossaryState.cat = chip.dataset.glossaryCat || "";
    renderGlossary();
  }
});

// 單一 capture handler：Tab 只在最上層循環；Esc 一次只處理一層，避免三個 listener 連續關閉。
document.addEventListener("keydown", (event) => {
  const top = topDialogLayer();
  if (event.key === "Tab" && top) {
    trapDialogTab(event);
    return;
  }
  if (event.key !== "Escape") return;
  if (!top) {
    closeDetailPanel();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();

  if (top === el.zoomChartHelp) {
    closeZoomHelp();
  } else if (top === el.technicalZoomModal) {
    // 畫線中：先取消未完成的線，再退回游標；第三次才真正關閉放大圖。
    if (drawState.pending) {
      drawState.pending = null;
      drawZoomCrosshair();
    } else if (drawState.tool !== "cursor") {
      setDrawTool("cursor");
    } else {
      closeTechnicalZoom();
    }
  } else if (top === document.getElementById("glossaryModal")) {
    closeGlossary();
  } else if (top === document.getElementById("strategyLegend")) {
    closeStrategyLegend();
  } else if (top === el.searchModal) {
    closeSearchModal();
  } else if (top === el.filterDrawer) {
    closeFilterDrawer();
  } else if (top === el.survHelp) {
    closeDialogLayer(el.survHelp);
  } else if (top === document.getElementById("personalBackupModal")) {
    closePersonalBackupRestore();
  } else if (top === el.loginGate) {
    setLoginGateVisible(false, "");
  } else if (top === el.detailPanel) {
    closeDetailPanel();
  } else {
    closeDialogLayer(top);
  }
}, true);

async function initializeApp() {
  try {
    history.replaceState({ view: "screen", screen: state.screen }, "");
  } catch {
    // 歷史 API 不可用時略過。
  }
  render();
  // 目前先做本機看盤：未登入也能看行情；登入只影響自選股同步與券商設定。
  const isAuthenticated = await loadCurrentUser();
  if (isAuthenticated) {
    await loadWatchListsFromServer();
    await loadAlertsFromServer();
    await loadTradesFromServer();
    await loadBrokerSettings();
  } else if (getSelectedSource() === "broker") {
    sourceState.selected = "official";
    saveDataSource();
  }
  await loadSourceStatus();
  if (getSelectedSource() === "broker" && !isBrokerSourceReady()) {
    switchToOfficialFallback(sourceState.sources?.broker?.message || "券商 API 未設定");
  }
  loadMarketSummary();
  loadMarketData();
  loadOvernightSignals();
  if (state.screen === "technical") {
    loadTechnicalAnalysis();
  }
  if (state.screen === "strategy") {
    loadStrategyBoard();
  }
  if (state.screen === "surveillance") {
    loadSurveillanceBoard();
  }
}

initializeApp();
