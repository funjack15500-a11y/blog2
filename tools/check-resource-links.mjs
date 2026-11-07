import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataFile = path.join(root, "resource-data.json");
const reportFile = path.join(root, "link-check-report.json");
const backupFile = path.join(root, "resource-data.before-link-check.json");
const apply = process.argv.includes("--apply");
const concurrency = Number(process.argv.find((v) => v.startsWith("--concurrency="))?.split("=")[1] || 4);
const timeoutMs = Number(process.argv.find((v) => v.startsWith("--timeout="))?.split("=")[1] || 15000);
const rows = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const urls = [...new Set(rows.flatMap((row) => [row.quark, row.baidu]).filter(Boolean))];

const invalidPatterns = [
  /分享(?:已)?(?:被)?取消/, /分享(?:已)?失效/, /链接(?:已)?失效/, /链接不存在/,
  /文件(?:已)?(?:被)?删除/, /文件不存在/, /分享不存在/, /该分享已被取消/,
  /分享内容不存在/, /来晚了.{0,20}(?:失效|删除|取消)/, /页面不存在/
];
const blockedPatterns = [/验证码/, /安全验证/, /访问过于频繁/, /请求频繁/, /稍后再试/, /登录后查看/];

function platform(url) {
  if (url.includes("pan.quark.cn")) return "quark";
  if (url.includes("pan.baidu.com")) return "baidu";
  return "other";
}

async function check(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept-language": "zh-CN,zh;q=0.9"
      }
    });
    const body = (await response.text()).slice(0, 1500000);
    // Baidu embeds generic error-message templates in otherwise valid pages.
    // Treating those strings as the current share state causes false deletion.
    const invalidMatch = platform(url) === "baidu" ? null : invalidPatterns.find((pattern) => pattern.test(body));
    const blockedMatch = blockedPatterns.find((pattern) => pattern.test(body));
    let status = "valid";
    let reason = `HTTP ${response.status}`;
    if ([404, 410].includes(response.status)) {
      status = "invalid";
      reason = `HTTP ${response.status}`;
    } else if (invalidMatch) {
      status = "invalid";
      reason = `页面提示：${invalidMatch.source}`;
    } else if (response.status === 429 || response.status >= 500 || blockedMatch) {
      status = "unknown";
      reason = response.status === 429 ? "访问频率受限" : blockedMatch ? `需要验证：${blockedMatch.source}` : `服务异常 HTTP ${response.status}`;
    } else if (!response.ok) {
      status = "unknown";
      reason = `HTTP ${response.status}`;
    }
    return { url, platform: platform(url), status, reason, httpStatus: response.status, finalUrl: response.url, elapsedMs: Date.now() - started };
  } catch (error) {
    return { url, platform: platform(url), status: "unknown", reason: error.name === "AbortError" ? "请求超时" : error.message, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const results = new Array(urls.length);
let cursor = 0;
let finished = 0;
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= urls.length) return;
    results[index] = await check(urls[index]);
    finished++;
    if (finished % 25 === 0 || finished === urls.length) {
      const invalid = results.filter((item) => item?.status === "invalid").length;
      const unknown = results.filter((item) => item?.status === "unknown").length;
      console.log(`[${finished}/${urls.length}] invalid=${invalid} unknown=${unknown}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
}

await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
const invalidUrls = new Set(results.filter((item) => item.status === "invalid").map((item) => item.url));
const cleaned = rows.map((row) => ({
  ...row,
  quark: invalidUrls.has(row.quark) ? "" : row.quark,
  baidu: invalidUrls.has(row.baidu) ? "" : row.baidu
})).filter((row) => row.quark || row.baidu);
const summary = {
  checkedAt: new Date().toISOString(),
  apply,
  totalRowsBefore: rows.length,
  totalRowsAfter: apply ? cleaned.length : rows.length,
  uniqueLinks: urls.length,
  valid: results.filter((item) => item.status === "valid").length,
  invalid: invalidUrls.size,
  unknown: results.filter((item) => item.status === "unknown").length,
  removedRows: apply ? rows.length - cleaned.length : 0
};
fs.writeFileSync(reportFile, JSON.stringify({ summary, results }, null, 2));
if (apply) {
  if (!fs.existsSync(backupFile)) fs.copyFileSync(dataFile, backupFile);
  fs.writeFileSync(dataFile, JSON.stringify(cleaned));
  fs.writeFileSync(path.join(root, "resource-data.js"), `window.RESOURCE_DATA=${JSON.stringify(cleaned)};`);
  fs.copyFileSync(dataFile, path.join(root, "dist", "resource-data.json"));
  fs.copyFileSync(path.join(root, "resource-data.js"), path.join(root, "dist", "resource-data.js"));
}
console.log(JSON.stringify(summary, null, 2));
console.log(`Report: ${reportFile}`);
