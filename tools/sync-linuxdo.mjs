import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 用法：node tools/sync-linuxdo.mjs
// 作用：把「每日优惠情报」聚合站里 LINUX DO 资源荟萃的网盘资源，整理成资源AI小站能吃的条目，
//       写进 auto-resources.js（前端按标题归并），不影响人工维护的 resource-data.json / manual-resources.js。
// 前置：聚合站服务要活着（默认 http://127.0.0.1:3000），否则读不到最新条目。

const root = path.resolve(import.meta.dirname, "..");
const autoFile = path.join(root, "auto-resources.js");
const endpoint = process.env.AGGREGATOR_URL || "http://127.0.0.1:3000/api/state";
const MAX_KEEP = 240;

const PROVIDER_FIELD = { 夸克网盘: "quark", 百度网盘: "baidu" };

function pickVersion(text) {
  const match = String(text).match(/[更全]\s*[至新]?\s*\d+\s*集/) || String(text).match(/更新\s*\d+\s*集/);
  return match ? match[0].replace(/\s+/g, "") : "—";
}

function tidyTitle(raw) {
  let title = String(raw || "").replace(/[\u200e\u200f\u00a0]/g, " ").trim();
  title = title
    .replace(/【[^】]*】/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/【/g, " ")
    .replace(/】/g, " ")
    .replace(/「/g, " ")
    .replace(/」/g, " ")
    .replace(/[更全]\s*[至新]?\s*\d+\s*集/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  title = title.replace(/^(教程|课程|资源|影视|动漫)\s*/, "").trim();
  title = title.replace(/\s*\d+月\d+日(更新)?\s*$/, "").trim();
  title = title.replace(/[（(【「『]+[^）)】」』]*$/, "").trim();
  return title || String(raw).trim();
}

function pickType(text) {
  if (/课|教程|训练营|实战|慕课|极客时间|学院|班|考证|备考|网校/.test(text)) return "课程";
  if (/源码|资料|合集|书单|信息|文档|模板|素材|字体|壁纸/.test(text)) return "资料包";
  if (/剧|番|季|集|电影|剧场版|综艺|纪录片|动漫|动画/.test(text)) return "影视";
  return "其他";
}

async function loadState() {
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`聚合站返回 HTTP ${res.status}`);
  return res.json();
}

function existingRows() {
  if (!fs.existsSync(autoFile)) return [];
  const text = fs.readFileSync(autoFile, "utf8");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

const state = await loadState();
const netdisk = (state.items || []).filter(
  (item) => item.category === "网盘资源" && Array.isArray(item.share) && item.share.length
);

const rows = [];
const seen = new Set();
const push = (row) => {
  const key = `${row.title}|${row.quark}|${row.baidu}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push(row);
};

// 先保留上几次同步进来的条目，避免它们退出 7 天窗口后从库里消失
for (const row of existingRows()) {
  const title = tidyTitle(row.title);
  const key = `${title}|${row.quark}|${row.baidu}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({ ...row, title });
}

let added = 0;
const skipped = { 迅雷: 0, 无夸克百度: 0 };

for (const item of netdisk) {
  const providers = item.share.filter((s) => PROVIDER_FIELD[s.provider]);
  if (!providers.length) {
    if (item.share.length) skipped.迅雷++;
    else skipped.无夸克百度++;
    continue;
  }
  const title = tidyTitle(item.title);
  const version = pickVersion(item.title);
  const type = pickType(`${item.title} ${item.drive || ""}`);
  const category = `网盘资源 · ${type}`;
  const updated = String(item.publishedAt || "").slice(0, 10) || "—";

  for (const share of providers) {
    const field = PROVIDER_FIELD[share.provider];
    const row = { title, version, category, updated, quark: "", baidu: "" };
    row[field] = share.url;
    const key = `${title}|${row.quark}|${row.baidu}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
    added++;
  }
}

// 同一个资源常被不同人用不同标题重复发（「现在就出发 第四季」vs「现在就出发 第四季 现在就出发4(2026)11.07期」），
// 把长标题归一成最短的那个标题，前端按标题归并时链接自然合并到一条上。
const norm = (value) => String(value).replace(/\s+/g, "").toLowerCase();
const canonical = [];
for (const row of [...rows].sort((a, b) => a.title.length - b.title.length)) {
  const n = norm(row.title);
  if (n.length < 4) continue;
  if (canonical.find((c) => norm(c.title).includes(n))) continue;
  canonical.push(row);
}
function canonTitle(title) {
  const n = norm(title);
  let best = null;
  for (const c of canonical) {
    const cn = norm(c.title);
    if (cn.length >= 4 && (cn.includes(n) || n.includes(cn)) || cn === n) {
      if (!best || cn.length < norm(best).length) best = c.title;
    }
  }
  return best || title;
}

const renamed = rows.map((row) => ({ ...row, title: canonTitle(row.title) }));
const unique = [];
const keys = new Set();
for (const row of renamed) {
  const key = `${row.title}|${row.quark}|${row.baidu}`;
  if (keys.has(key)) continue;
  keys.add(key);
  unique.push({ ...row, category: `网盘资源 · ${pickType(row.title)}` });
}

const sorted = unique
  .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")))
  .slice(0, MAX_KEEP);

const text = `window.AUTO_RESOURCES=${JSON.stringify(sorted)};\n`;
fs.writeFileSync(autoFile, text);
fs.writeFileSync(path.join(root, "dist", "auto-resources.js"), text);

console.log(
  JSON.stringify(
    {
      聚合站网盘条数: netdisk.length,
      本次新增行: added,
      跳过: skipped,
      文件总行: sorted.length,
      bytes: Buffer.byteLength(text, "utf8"),
    },
    null,
    2
  )
);

try {
  execFileSync(process.execPath, [path.join(root, "tools", "build-updates.mjs")], { cwd: root, stdio: "inherit" });
} catch (error) {
  console.error("生成 updates.json 失败：", error.message);
}
