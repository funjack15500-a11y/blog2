import fs from "node:fs";
import path from "node:path";

// 用法：node tools/remove-dead-links.mjs            # 只试算，不写文件
//      node tools/remove-dead-links.mjs --apply    # 真的把死链从源表里摘掉
// 依据 link-check-report.json 里 status=invalid 的链接，把 影视资源.html 源表中的
// 对应 <a> 摘除；若某一行摘完已没有任何网盘入口，整行删除，避免留下空条目。

const root = path.resolve(import.meta.dirname, "..");
const htmlFile = path.join(root, "影视资源.html");
const reportFile = path.join(root, "link-check-report.json");
const apply = process.argv.includes("--apply");

const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const dead = new Set(report.results.filter((row) => row.status === "invalid").map((row) => row.url));
if (!dead.size) {
  console.log("检测报告里没有失效链接，什么都不用做。");
  process.exit(0);
}

const decode = (value = "") =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const hrefOf = (anchor) => {
  const match = anchor.match(/<a\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return decode(match?.slice(1).find(Boolean) || "");
};

const html = fs.readFileSync(htmlFile, "utf8");
let removedLinks = 0;
let removedRows = 0;

const next = html.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (whole, inner) => {
  let touched = false;
  const cleaned = inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (anchor) => {
    if (!dead.has(hrefOf(anchor))) return anchor;
    touched = true;
    removedLinks++;
    return "";
  });
  if (!touched) return whole;
  if (!/<a\b[^>]*\bhref=/i.test(cleaned)) {
    removedRows++;
    return ""; // 这一行的网盘入口全没了，整行摘掉
  }
  const start = whole.indexOf(inner);
  return whole.slice(0, start) + cleaned + whole.slice(start + inner.length);
});

if (!removedLinks) {
  console.log("源表里没有匹配到这些失效链接，可能已经被手工清过了。");
  process.exit(0);
}

console.log(JSON.stringify({ apply, deadLinks: dead.size, removedLinks, removedRows }, null, 2));

if (apply) {
  fs.writeFileSync(htmlFile, next, "utf8");
  console.log("已写回 影视资源.html，请接着运行 node tools/build-resource-data.mjs");
} else {
  console.log("试算完成，加 --apply 才会落盘。");
}
