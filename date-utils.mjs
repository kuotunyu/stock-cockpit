// 日期原語：民國／西元互轉、台北時區當日、compact(YYYYMMDD) 格式轉換與純日曆位移。
// 不做 IO、不讀環境變數、不持有可變狀態；除了內建 Intl 之外不相依任何東西，
// 也絕不反向 import server.mjs（會形成循環）。
// server.mjs 於檔首 import 這些名字並沿用原有的 export，呼叫端與對外介面都不變。

// 民國年 ↔ 西元年只差 1911；以前六處各自寫 ±1911，任何一處打錯都不會有測試抓到，收斂成兩個函式。
export function rocYearToWestern(year) {
  return Number(year) + 1911;
}

export function westernYearToRoc(year) {
  return Number(year) - 1911;
}

export function formatDate(value) {
  const text = String(value || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
  }
  if (/^\d{7}$/.test(text)) {
    const year = rocYearToWestern(text.slice(0, 3));
    return `${year}/${text.slice(3, 5)}/${text.slice(5, 7)}`;
  }
  return text || "";
}

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const taipeiTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function toTaipeiCompactDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(taipeiDateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

export function toTaipeiTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return taipeiTimeFormatter.format(date);
}

export function toCompactDate(value = new Date()) {
  if (value instanceof Date) {
    return toTaipeiCompactDate(value);
  }
  const text = String(value || "").replace(/\D/g, "");
  if (/^\d{8,}/.test(text)) return text.slice(0, 8);
  if (/^\d{7}$/.test(text)) {
    const year = rocYearToWestern(text.slice(0, 3));
    return `${year}${text.slice(3, 5)}${text.slice(5, 7)}`;
  }
  return "";
}

export function compactToIsoDate(value) {
  const text = toCompactDate(value);
  if (!text) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export function compactToSlashDate(value) {
  const text = toCompactDate(value);
  if (!text) return "";
  return `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
}

export function compactToRocSlashDate(value) {
  const text = toCompactDate(value);
  if (!text) return "";
  const year = westernYearToRoc(text.slice(0, 4));
  return `${year}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
}

export function addMonthsCompact(value, delta) {
  const text = toCompactDate(value);
  if (!text) return "";
  const date = new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1 + delta, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}01`;
}

export function addDaysCompact(value, delta) {
  const text = toCompactDate(value);
  if (!text) return "";
  const date = new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)) + delta));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}
