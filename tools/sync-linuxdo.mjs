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
  // 帖子标题常带 emoji 和一大段推广语，只留前面的片名
  title = title.replace(/^\p{Extended_Pictographic}\s*/u, "").trim();
  if (title.length > 18 && title.includes("，")) title = title.split("，")[0].trim();
  // 尾部噪音：集数进度、画质、字幕、双更之类的卖点
  title = title
    .replace(/[（(]?(4K|8K|高清|超清|中文字幕|双语字幕|双更臻享|臻享|臻彩|高码率|杜比|HDR|60帧|全集|完结)[）)]?/gi, " ")
    .replace(/[（(]\s*(更新|更至|更新至|最新)?\s*第?\s*\d+\s*集\s*[）)]/g, " ")
    .replace(/(更新|更至|更新至|最新|已更新|已更|全量?)\s*第?\s*\d+\s*集/g, " ")
    .replace(/(更新|更至|更新至|最新|已更新|已更)?\s*第?\s*\d+\s*集\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 多剧合帖（「A & B 双更」）只留第一部，B 通常自己也有独立帖
  title = title.split(/\s*[&＆]\s*/)[0].trim();
  title = title.replace(/[，,、]{2,}/g, "，").replace(/^[，,、\s]+|[，,、\s]+$/g, "").trim();
  return title || String(raw).trim();
}

function pickType(text) {
  // 「AI恋爱短剧教学」「短剧实战课」这类挂“剧”字的其实是课程，先按课判
  if (/课|教学|教程|训练营|实战|慕课|极客时间|学院|班|考证|备考|网校/.test(text)) return "课程";
  // 英语分级动画、启蒙动画这类是学习资料，不是剧集
  if (/学英语|英语启蒙|分级动画|启蒙动画|英语学习/.test(text)) return "课程";
  // 「某某讲某某 166 集」这种是讲座课，不是剧
  if (/讲/.test(text) && /\d+\s*集/.test(text)) return "课程";
  if (/源码|资料|合集|书单|信息|文档|模板|素材|字体|壁纸|付费文章|文集|研报|资讯/.test(text)) return "资料包";
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

// 只收影视/剧集类；课程、付费文章、资料包一律进不来
const KEEP_TYPES = new Set(["影视"]);

// 先保留上几次同步进来的条目，避免它们退出 7 天窗口后从库里消失
for (const row of existingRows()) {
  const title = tidyTitle(row.title);
  const type = String(row.category || "").includes("影视") ? "影视" : pickType(row.title);
  // 老条目也重新判一次：以前漏进来的课程 / 付费文章 / 资料包要清出去
  const recheck = pickType(`${row.title} ${row.version || ""}`);
  if (!KEEP_TYPES.has(type) || /^(课程|资料包)$/.test(recheck)) continue;
  if (title.length <= 10 && /主演|领衔|出品|执导/.test(title)) continue;
  // 「｜动漫｜」这类只有装饰符号的老条目，也要清出去
  if (/^[\p{P}\p{S}\s]*(动漫|动画|影视|剧集|资源|网盘)?[\p{P}\p{S}\s]*$/u.test(title)) continue;
  // 「某某讲某某」是讲座课，不是剧集
  if (/讲/.test(title) && !/[剧番季]/.test(title)) continue;
  const key = `${title}|${row.quark}|${row.baidu}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({ ...row, title });
}

let added = 0;
const skipped = { 迅雷: 0, 无夸克百度: 0, 非影视: 0, 无片名: 0 };
const skippedList = [];

for (const item of netdisk) {
  const providers = item.share.filter((s) => PROVIDER_FIELD[s.provider]);
  if (!providers.length) {
    if (item.share.length) skipped.迅雷++;
    else skipped.无夸克百度++;
    continue;
  }
  const title = tidyTitle(item.title);
  // 「赵本山特别主演 4K高清」这类只有主演没有片名的推广帖，指认不出是哪部剧
  if (title.length <= 10 && /主演|领衔|出品|执导/.test(title) && !/《/.test(item.title)) {
    skipped.无片名++;
    continue;
  }
  // 「｜动漫｜」这种只剩装饰符号+类目词的标题，不是片名
  if (/^[\p{P}\p{S}\s]*(动漫|动画|影视|剧集|资源|网盘)?[\p{P}\p{S}\s]*$/u.test(title)) {
    skipped.无片名++;
    if (process.env.SYNC_DEBUG) skippedList.push(`[无片名] ${item.title}`);
    continue;
  }
  const version = pickVersion(item.title);
  const type = pickType(`${item.title} ${item.drive || ""}`);
  if (!KEEP_TYPES.has(type)) {
    skipped.非影视++;
    if (process.env.SYNC_DEBUG) skippedList.push(`[${type}] ${item.title}`);
    continue;
  }
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
  const category = String(row.category || "").includes("网盘资源") ? row.category : `网盘资源 · ${pickType(row.title)}`;
  keys.add(key);
  unique.push({ ...row, category });
}

const sorted = unique
  .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")))
  .slice(0, MAX_KEEP);

const text = `window.AUTO_RESOURCES=${JSON.stringify(sorted)};\n`;
fs.writeFileSync(autoFile, text);
fs.writeFileSync(path.join(root, "dist", "auto-resources.js"), text);

// 浏览器会把 auto-resources.js 缓存住，内容更新了页面还显示旧条目。
// 每次同步在 script 地址上加一个版本参数，强制重新拉取。
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
for (const htmlPath of [path.join(root, "index.html"), path.join(root, "dist", "index.html")]) {
  if (!fs.existsSync(htmlPath)) continue;
  const html = fs.readFileSync(htmlPath, "utf8");
  const patched = html.replace(/(\.\/(?:auto|manual)-resources\.js)(\?v=[^"]*)?/g, `$1?v=${stamp}`);
  if (patched !== html) fs.writeFileSync(htmlPath, patched);
}

console.log(
  JSON.stringify(
    {
      聚合站网盘条数: netdisk.length,
      本次新增行: added,
      跳过: skipped,
      被过滤样本: process.env.SYNC_DEBUG ? skippedList : undefined,
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
