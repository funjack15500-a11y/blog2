import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 用法：node tools/build-updates.mjs [--base <sha>]
// 作用：维护一份「最近 7 天变更累计」的更新流 updates.json，供外部轮询。
//       - 每轮先算出「当前数据 vs HEAD」的差异（新增/变更/移除）
//       - 把这些变化按标题合并进 tools/updates-history.json，并打上时间戳
//       - 丢掉超过 7 天的记录，剩下的输出成 updates.json
//       这样即使外部一天只抓一次、而站点一天推两次，中间的变更也不会被下一次提交冲掉。
//       --base 参数只在首次播种历史时用，正常运行时对比 HEAD。

const root = path.resolve(import.meta.dirname, "..");
const dataFile = path.join(root, "resource-data.json");
const autoFile = path.join(root, "auto-resources.js");
const outFile = path.join(root, "updates.json");
const historyFile = path.join(root, "tools", "updates-history.json");
const site = "https://resourceai.de5.net/";

const WINDOW_DAYS = Number(process.env.UPDATE_WINDOW_DAYS || 7);
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const now = Date.now();

const argIndex = process.argv.indexOf("--base");
const BASE_REF = argIndex > -1 && process.argv[argIndex + 1] ? process.argv[argIndex + 1] : "HEAD";

function git(args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"]
  });
}

function showFile(ref, rel) {
  try {
    return git(["show", `${ref}:${rel}`]);
  } catch {
    return "";
  }
}

function parseArray(text) {
  if (!text) return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

// 同一部剧可能拆成多行（不同集数/不同网盘），先按剧名归并，再比版本与链接
function group(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.title || "").trim().toLowerCase();
    if (!key) continue;
    const item = map.get(key) || { title: row.title, version: [], category: [], quark: new Set(), baidu: new Set() };
    const version = String(row.version || "").trim();
    if (version && !item.version.includes(version)) item.version.push(version);
    const category = String(row.category || "").trim();
    if (category && !item.category.includes(category)) item.category.push(category);
    if (row.quark) item.quark.add(row.quark);
    if (row.baidu) item.baidu.add(row.baidu);
    map.set(key, item);
  }
  return map;
}

const currentRows = [...JSON.parse(fs.readFileSync(dataFile, "utf8")), ...parseArray(fs.readFileSync(autoFile, "utf8"))];
const baseRows = [...parseArray(showFile(BASE_REF, "resource-data.json")), ...parseArray(showFile(BASE_REF, "auto-resources.js"))];

const nowGroups = group(currentRows);
const baseGroups = group(baseRows);
const sameLinks = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const changes = [];

if (baseGroups.size) {
  for (const [key, item] of nowGroups) {
    const prev = baseGroups.get(key);
    const payload = {
      title: item.title,
      version: item.version.join(" / ") || "—",
      category: item.category.join(" / ") || "—",
      quark: [...item.quark],
      baidu: [...item.baidu]
    };
    if (!prev) {
      changes.push({ ...payload, key, change: "added" });
      continue;
    }
    const prevVersion = prev.version.join(" / ");
    if (prevVersion !== payload.version || !sameLinks(prev.quark, item.quark) || !sameLinks(prev.baidu, item.baidu)) {
      changes.push({ ...payload, key, change: "updated", prevVersion: prevVersion || "—" });
    }
  }
  for (const [key, prev] of baseGroups) {
    if (nowGroups.has(key)) continue;
    changes.push({
      title: prev.title,
      version: prev.version.join(" / ") || "—",
      category: prev.category.join(" / ") || "—",
      quark: [...prev.quark],
      baidu: [...prev.baidu],
      key,
      change: "removed"
    });
  }
}

// 读历史，把本轮变化打上时间戳并进去（同标题只留最新一条）
let history = [];
if (fs.existsSync(historyFile)) {
  try {
    history = JSON.parse(fs.readFileSync(historyFile, "utf8")).items || [];
  } catch {
    history = [];
  }
}

const byKey = new Map(history.map((item) => [item.key, item]));
for (const change of changes) {
  byKey.set(change.key, { ...change, at: new Date(now).toISOString() });
}

const kept = [...byKey.values()]
  .filter((item) => now - Date.parse(item.at || 0) <= WINDOW_MS)
  .sort((a, b) => String(b.at).localeCompare(String(a.at)));

fs.writeFileSync(historyFile, JSON.stringify({ updatedAt: new Date(now).toISOString(), windowDays: WINDOW_DAYS, items: kept }, null, 2));

const counts = kept.reduce((acc, item) => ((acc[item.change] = (acc[item.change] || 0) + 1), acc), {});
const payload = {
  generatedAt: new Date(now).toISOString(),
  windowDays: WINDOW_DAYS,
  site,
  total: currentRows.length,
  changed: kept.length,
  added: counts.added || 0,
  updated: counts.updated || 0,
  removed: counts.removed || 0,
  items: kept.map(({ key, ...rest }) => rest)
};

const text = JSON.stringify(payload, null, 2);
fs.writeFileSync(outFile, text);
fs.writeFileSync(path.join(root, "dist", "updates.json"), text);
console.log(
  JSON.stringify({
    base: BASE_REF,
    thisRun: changes.length,
    window: `${WINDOW_DAYS}d`,
    changed: payload.changed,
    added: payload.added,
    updated: payload.updated,
    removed: payload.removed,
    bytes: Buffer.byteLength(text, "utf8")
  })
);
