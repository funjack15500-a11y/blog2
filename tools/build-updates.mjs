import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 用法：node tools/build-updates.mjs
// 作用：把 resource-data.json 与「上一次提交（HEAD）」的版本做对比，生成 updates.json，
//       供外部抓「今天更新了什么」，不用自己 diff 六百多条。
// 约定：updates.json 描述的是「相对已提交版本」的变化，所以要在 git commit 之前运行；
//       如果当前没有变化，脚本会保留上一次的 updates.json 不动。

const root = path.resolve(import.meta.dirname, "..");
const dataFile = path.join(root, "resource-data.json");
const outFile = path.join(root, "updates.json");
const site = "https://resourceai.de5.net/";

const readRows = (text) => JSON.parse(text);

// auto-resources.js 是同步脚本写出来的外部网盘资源，也要算进更新流
function autoRows(text) {
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

function headRows() {
  try {
    const sha = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const text = execFileSync("git", ["-C", root, "show", "HEAD:resource-data.json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let autoText = "";
    try {
      autoText = execFileSync("git", ["-C", root, "show", "HEAD:auto-resources.js"], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
      autoText = "";
    }
    return { rows: [...readRows(text), ...autoRows(autoText)], base: sha };
  } catch (error) {
    return { rows: [], base: "unknown" };
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

const base = headRows();
const autoPath = path.join(root, "auto-resources.js");
const autoText = fs.existsSync(autoPath) ? fs.readFileSync(autoPath, "utf8") : "";
const current = [...readRows(fs.readFileSync(dataFile, "utf8")), ...autoRows(autoText)];
const baseGroups = group(base.rows);
const nowGroups = group(current);

const sameLinks = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const items = [];

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
    items.push({ ...payload, change: "added" });
    continue;
  }
  const prevVersion = prev.version.join(" / ");
  const changed = prevVersion !== payload.version || !sameLinks(prev.quark, item.quark) || !sameLinks(prev.baidu, item.baidu);
  if (changed) items.push({ ...payload, change: "updated", prevVersion: prevVersion || "—" });
}

for (const [key, prev] of baseGroups) {
  if (nowGroups.has(key)) continue;
  items.push({
    title: prev.title,
    version: prev.version.join(" / ") || "—",
    category: prev.category.join(" / ") || "—",
    change: "removed"
  });
}

const counts = items.reduce((acc, item) => ((acc[item.change] = (acc[item.change] || 0) + 1), acc), {});

if (!items.length) {
  console.log(JSON.stringify({ changed: 0, message: "与 HEAD 相比没有变化，updates.json 保持原样" }));
  process.exit(0);
}

const payload = {
  generatedAt: new Date().toISOString(),
  baseCommit: base.base,
  site,
  total: current.length,
  changed: items.length,
  added: counts.added || 0,
  updated: counts.updated || 0,
  removed: counts.removed || 0,
  items
};

const text = JSON.stringify(payload, null, 2);
fs.writeFileSync(outFile, text);
fs.writeFileSync(path.join(root, "dist", "updates.json"), text);
console.log(JSON.stringify({ generatedAt: payload.generatedAt, changed: payload.changed, added: payload.added, updated: payload.updated, removed: payload.removed, bytes: Buffer.byteLength(text, "utf8") }));
