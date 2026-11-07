import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "影视资源.html"), "utf8");
const decode = (value = "") => value
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const text = (value = "") => decode(value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const href = (value = "") => decode(value.match(/<a\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)?.slice(1).find(Boolean) || "");

const blocks = [...html.matchAll(/<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>|<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
let category = "影视资源";
const rows = [];
for (const block of blocks) {
  if (/^<h[12]/i.test(block[0])) {
    category = text(block[2]).replace(/快捷查询.*$/, "").slice(0, 48) || category;
    continue;
  }
  const table = block[3] || "";
  const header = text(table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || table.slice(0, 1200));
  if (!header.includes("剧名") || (!header.includes("夸克") && !header.includes("百度"))) continue;
  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (!cells.length) continue;
    const title = text(cells[0]);
    if (!title || title === "剧名") continue;
    rows.push({
      title,
      version: text(cells[1]) || "—",
      category,
      updated: text(cells[4] || cells.at(-1)) || "—",
      quark: href(cells[2]),
      baidu: href(cells[3])
    });
  }
}
const unique = [...new Map(rows.map((row) => [`${row.title}|${row.version}|${row.quark}|${row.baidu}`, row])).values()];
fs.writeFileSync(path.join(root, "resource-data.json"), JSON.stringify(unique));
fs.writeFileSync(path.join(root, "resource-data.js"), `window.RESOURCE_DATA=${JSON.stringify(unique)};`);
fs.copyFileSync(path.join(root, "resource-data.json"), path.join(root, "dist", "resource-data.json"));
fs.copyFileSync(path.join(root, "resource-data.js"), path.join(root, "dist", "resource-data.js"));
console.log(`Generated ${unique.length} resource rows.`);
