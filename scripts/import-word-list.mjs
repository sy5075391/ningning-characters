import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const [basicHtmlPath, commonHtmlPath] = process.argv.slice(2);

if (!basicHtmlPath || !commonHtmlPath) {
  console.error("用法: node scripts/import-word-list.mjs <基础字表.html> <常用字表.html>");
  process.exit(1);
}

const han = /[\p{Unified_Ideograph}〇]/gu;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(words) {
  return [...new Set(words)];
}

function extractBasicWords(html) {
  const article = html.match(/<article\b[\s\S]*?<\/article>/u)?.[0] ?? "";
  const list = article.match(/<h2\s+id=共300字按笔画排列[\s\S]*?<\/div>/u)?.[0] ?? "";
  const paragraphs = [...list.matchAll(/<p>([\s\S]*?)<\/p>/gu)].map((match) => match[1]).join(" ");
  const withoutVariants = paragraphs.replace(/（[^）]*）/gu, "");
  const words = unique(withoutVariants.match(han) ?? []);
  assert(words.length === 300, `基础字表应有 300 字，实际得到 ${words.length} 字`);
  return words;
}

function extractNumberedWords(html, headingId, expectedCount) {
  const start = html.indexOf(`id=${headingId}`);
  assert(start >= 0, `找不到 ${headingId}`);
  const nextHeading = html.indexOf("<h2", start + 1);
  const section = html.slice(start, nextHeading < 0 ? undefined : nextHeading);
  const pairs = [...section.matchAll(/<td>(\d+)<\/td>\s*<td>([\p{Unified_Ideograph}〇])<\/td>/gu)];
  const words = pairs.map((match, index) => {
    assert(Number(match[1]) === index + 1, `${headingId} 序号在 ${index + 1} 处不连续`);
    return match[2];
  });
  assert(words.length === expectedCount, `${headingId} 应有 ${expectedCount} 字，实际得到 ${words.length} 字`);
  assert(unique(words).length === expectedCount, `${headingId} 存在重复字`);
  return words;
}

const [basicHtml, commonHtml] = await Promise.all([
  readFile(basicHtmlPath, "utf8"),
  readFile(commonHtmlPath, "utf8"),
]);
const basicWords = extractBasicWords(basicHtml);
const tableOne = extractNumberedWords(commonHtml, "字表一2500-字", 2500);
const tableTwo = extractNumberedWords(commonHtml, "字表二1000-字", 1000);
const selected = [...tableOne, ...tableTwo.slice(0, 500)];
const words = unique([...basicWords, ...selected]);

assert(selected.length === 3000, "常用字选取数量不是 3000");
assert(words.length === 3000, `合并基础字排序后应有 3000 字，实际得到 ${words.length} 字`);

await mkdir("data", { recursive: true });
await writeFile("data/recognition-3000.txt", `${words.join("")}\n`, "utf8");
await writeFile(
  "word-list.js",
  [
    '"use strict";',
    "",
    "// 教育部《义务教育语文课程常用字表》前 3000 字；基础识字 300 字优先。",
    `window.RECOGNITION_WORDS = "${words.join("")}";`,
    "",
  ].join("\n"),
  "utf8",
);

console.log(`已生成 ${words.length} 个不重复汉字`);
