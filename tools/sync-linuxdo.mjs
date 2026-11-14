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

// 帖子标题里的「卖点词」：画质、字幕、集数进度、附带季、发布标注。
// 用词元（空格/括号切开后逐段）过滤，比一串正则替换干净得多——先前把「杜比视界」拆掉只留「视界」就是正则替换的坑。
const NOISE_TOKEN =
  /^(4k|8k|1080p|720p|2160p|hdr|dv|nf|web|web-dl|sdr|uhd|imax|bluray|蓝光|高清|超清|国语|粤语|国粤|中字|中文字幕|国语中字|中英|中英字幕|简繁|简中|简繁英|官中|双语|字幕|内封|内封简繁|内封官中|内封中英|内封简繁英|更|更新|更至|更新至|最新|已更新|全集|完结|完结季|纯净收藏版|臻享|臻彩|高码|高码率|60帧|双更|双更臻享|每周五|正式版|加码|重映版|版|修复|易和谐|nsfw|胆小勿看|首更|首播|加长版|加长)$/i;

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

// 方括号里如果是画质/集数/附带季这类噪音就整段丢掉，如果是片名（【奥德赛】4K）就把括号本身去掉、留住内容
const BRACKET_NOISE = /^(4k|8k|1080p|720p|web|hdr|dv|nf|sdr|uhd|imax|更|更新|中字|中文字幕|双语|内封|简中|简繁|官中|全集|完结|附|含|修复|纯净|收藏|nsfw|易和谐|胆小|首更|首播|加长)\b/i;

function unwrapBrackets(input) {
  return input
    .replace(/【([^】]*)】/g, (match, inner) => (BRACKET_NOISE.test(String(inner).trim()) ? " " : ` ${inner} `))
    .replace(/\[([^\]]*)\]/g, (match, inner) => (BRACKET_NOISE.test(String(inner).trim()) ? " " : ` ${inner} `));
}

function tidyTitle(raw) {
  let title = String(raw || "").replace(/[\u200e\u200f\u00a0]/g, " ").trim();
  title = unwrapBrackets(title)
    .replace(/【/g, " ")
    .replace(/】/g, " ")
    .replace(/「/g, " ")
    .replace(/」/g, " ")
    .replace(/[更全]\s*[至新]?\s*\d+\s*集/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  title = title.replace(/^(教程|课程|资源|影视|动漫|韩剧|韩影|美剧|英剧|日剧|日影|国剧|台剧|港剧|漫剧|短剧|综艺|纪录片)\s*/, "").trim();
  title = title.replace(/\s*\d+月\d+日(更新)?\s*$/, "").trim();
  title = title.replace(/[（(【「『]+[^）)】」』]*$/, "").trim();
  // 帖子标题常带 emoji 和一大段推广语，只留前面的片名
  title = title.replace(/^\p{Extended_Pictographic}\s*/u, "").trim();
  if (title.length > 18 && title.includes("，")) title = title.split("，")[0].trim();

  // 先把括号统一成空格，再逐个词元过滤噪音
  title = title.replace(/[（）()【】\[\]「」『』]/g, " ").replace(/[｜|]/g, " ");
  // 集数进度（「第179集」「更至103集」「全8集」「11.07期」）先整段去掉，免得粘在片名后面
  title = title
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/附[前面]*[0-9一二三四五六七八九十]+季[全集]*/g, " ")
    .replace(/(?:至|到|更至|更新至|已更新|已更|全|共)?\s*第?\s*\d+\s*集/g, " ")
    .replace(/\d+\.\d+\s*期/g, " ")
    .replace(/(臻享|臻彩|加码|加长|重映|正式|纯净收藏|收藏|修复)版/g, " ")
    .replace(/[，,\s]*[至到]\s*$/g, " ");
  const tokens = title
    .split(/\s+/)
    .map((t) => t.replace(/^[，,、：:·\-—]+|[，,、：:·\-—]+$/g, "").trim())
    .filter(
      (t) =>
        t &&
        !NOISE_TOKEN.test(t) &&
        !/^(杜比|内封|简繁|简中|官中|国粤|英日|中英|双语|高清|超清|Netflix|网飞|泰语|韩语|日语|英语|原声|4k|8k|1080p|720p)/i.test(t) &&
        !/^(动漫|动画|剧集|新剧|影片)$/.test(t) &&
        !/^\p{Script=Hangul}+$/u.test(t) &&
        !/(字幕|音轨|双语|中字)$/.test(t) &&
        !/^附[前面]*[0-9一二三四五六七八九十]+季/.test(t) &&
        !/^含[0-9\-—~]/.test(t) &&
        !/版$/.test(t)
    );
  title = tokens.join(" ").replace(/\s+/g, " ").trim();
  // 词元过滤后仍可能留下「更至」「最新」这类残缺进度词
  title = title.replace(/(更新|更至|更新至|最新|已更新|已更)\s*/g, " ").replace(/\s+/g, " ").trim();
  title = title.replace(/[，,、：:·\-—]+$/g, "").trim();
  // 「更」「总」这类被切剩的单字也去掉
  title = title.replace(/\s+(更|总|第|集|至|到)$/g, "").replace(/^(更|总|第|集|至|到)\s+/g, "").trim();
  // 「漫剧 漫剧XXX」这种同词重复的前缀压一次
  title = title.replace(/^(漫剧|短剧|剧集)\s+\1/, "$1");

  // 多剧合帖（「A & B 双更」）只留第一部；但第一部太短（「谷雨&玫瑰战争」）就保留完整，
  // 免得只剩个认不出来的半截名字
  const parts = title.split(/\s*[&＆]\s*/);
  title = parts.length > 1 && parts[0].trim().length >= 4 ? parts[0].trim() : parts.join("，");
  title = title.replace(/[，,、]{2,}/g, "，").replace(/^[，,、\s]+|[，,、\s]+$/g, "").trim();
  // 清完只剩画质词/单字的，不是片名
  if (title.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return "";
  return title || String(raw).trim();
}

// 「沧元图3 (2026)」「沧元图 第三季【更至103集】」「沧元图第 第103集」本质是同一部剧，
// 用系列名做归并键：去年份、去集数、去画质尾巴，把「第X季」统一成数字季。
function seriesKey(title) {
  let key = String(title || "")
    .replace(/（\d{4}）|\(\d{4}\)|\d{4}/g, "")
    .replace(/第(十一|十二|一|二|三|四|五|六|七|八|九|十)季/g, (m, cn) => `${CN_NUM[cn]}季`)
    .replace(/最终季|完结季|新季|全集|完结/g, "")
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .replace(/年番\s*([0-9一二三四五六七八九十]+)/g, "")
    .replace(/第?\d+\s*集/g, "")
    .replace(/Ⅱ|II/g, "2")
    .replace(/附[前面]*[0-9一二三四五六七八九十]+季.*$/g, "")
    .replace(/(1080p|720p|2160p|4k|8k|hdr|dv|nf|web|sdr|uhd|imax|中字|中英|双语|字幕|内封|简繁|简中|官中|国语|粤语|臻彩|高码率|高码|纯净收藏版)/gi, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
  key = key.replace(/季$/g, "");
  // 「沧元图3」「牧神记 年番2」这类季数尾巴并到主名下，同一部剧只留一张卡
  key = key.replace(/(?<=\p{Script=Han})\d+$/gu, "");
  return key;
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

// Jina 阅读器开始要 API Key（直连 r.jina.ai 401、直连 linux.do 403），聚合站抓不到 linux.do 时，
// 用浏览器侧抓下来的帖子快照补位：data/ldo-extra.json 由人工/浏览器流程生成，24 小时内有效。
const extraFile = process.env.LDO_EXTRA || path.join("E:\\codex_out\\linux", "data", "ldo-extra.json");
let extraCount = 0;
try {
  if (fs.existsSync(extraFile)) {
    const stamp = fs.statSync(extraFile).mtimeMs;
    if (Date.now() - stamp < 24 * 60 * 60 * 1000) {
      const extra = JSON.parse(fs.readFileSync(extraFile, "utf8"));
      for (const item of extra) {
        if (!Array.isArray(item.share) || !item.share.length) continue;
        netdisk.push(item);
        extraCount++;
      }
    }
  }
} catch (error) {
  console.warn("读取 ldo-extra.json 失败：", error.message);
}

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
  if (!title) continue;
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
  // 清完只剩画质词的（「iMAX UHD」「NF DV」）不算片名
  if (!title) {
    skipped.无片名++;
    if (process.env.SYNC_DEBUG) skippedList.push(`[空标题] ${item.title}`);
    continue;
  }
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
  let type = pickType(`${item.title} ${item.drive || ""}`);
  // 论坛帖子自带标签，电影名（如「奥德赛」「心乡迷踪」）标题里没有剧/集字样会被判成「其他」，
  // 带「影视」标签的按标签补回影视；但训练营/教程这类即使挂了影视标签也还是课程。
  const tagFilm = Array.isArray(item.tags) && item.tags.includes("影视");
  if (tagFilm && type === "其他") type = "影视";
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
// 按「系列名」归并，取最短的那个标题做展示名，前端再把链接合并成一条。
const bestBySeries = new Map();
for (const row of rows) {
  const key = seriesKey(row.title).replace(/第$/g, "");
  if (!key) continue;
  const prev = bestBySeries.get(key);
  const better =
    !prev ||
    row.title.length < prev.title.length ||
    (row.title.length === prev.title.length && String(row.updated || "") > String(prev.updated || ""));
  if (better) bestBySeries.set(key, row);
}
function canonTitle(title) {
  const key = seriesKey(title).replace(/第$/g, "");
  const best = bestBySeries.get(key);
  if (!best) return title;
  return best.title.length <= title.length ? best.title : title;
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
