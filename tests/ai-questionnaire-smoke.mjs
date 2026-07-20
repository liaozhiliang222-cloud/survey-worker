import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function extractFunction(name, nextName) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing function: ${name}`);
  const end = source.indexOf(`function ${nextName}(`, start + marker.length);
  if (end < 0) throw new Error(`Missing boundary function: ${nextName}`);
  return source.slice(start, end).trim();
}

const context = vm.createContext({});
vm.runInContext([
  extractFunction("xmlEscape", "makeCrcTable"),
  extractFunction("wordParagraph", "wordTable"),
  extractFunction("wordTable", "parseMarkdownTable"),
  extractFunction("parseMarkdownTable", "markdownToWordDocumentXml"),
  extractFunction("markdownToWordDocumentXml", "createDocxBlob"),
].join("\n"), context);

context.aiStudyTypeLabels = { concept: "Concept", ua: "UA", brand: "Brand", nps: "NPS", pricing: "Pricing", kano: "Kano" };
vm.runInContext([
  extractFunction("aiStudyTypeValues", "getAiStudyTypes"),
  extractFunction("targetAiQuestionCount", "aiStudyTypeName"),
].join("\n"), context);
assert.deepEqual(JSON.parse(JSON.stringify(context.targetAiQuestionCount(["concept"], "short"))), { min: 25, max: 34, target: 29, level: "精简短卷" });
assert.deepEqual(JSON.parse(JSON.stringify(context.targetAiQuestionCount(["concept"], "long"))), { min: 49, max: 60, target: 54, level: "专业长卷" });
assert.deepEqual(JSON.parse(JSON.stringify(context.targetAiQuestionCount(["concept", "pricing", "brand"], "long"))), { min: 59, max: 70, target: 64, level: "专业长卷" });

const documentXml = context.markdownToWordDocumentXml([
  "便携咖啡新品概念测试 调研问卷",
  "",
  "一、问卷说明",
  "",
  "**S1. 请问您的年龄是？**",
].join("\n"));
assert.match(documentXml, /<w:pStyle w:val="Heading1"\/><w:jc w:val="center"\/>/);
assert.match(documentXml, /<w:t xml:space="preserve">便携咖啡新品概念测试 调研问卷<\/w:t>/);
assert.match(documentXml, /<w:pStyle w:val="Heading2"\/>[\s\S]*一、问卷说明/);
assert.match(documentXml, /<w:pStyle w:val="Heading3"\/>[\s\S]*S1\. 请问您的年龄是/);
assert.match(source, /w:styleId="Heading1"[\s\S]{0,500}w:sz w:val="44"/);
assert.match(source, /w:eastAsia="Microsoft YaHei"/);

const promptStart = source.indexOf("function buildAiQuestionnairePrompt(");
const promptEnd = source.indexOf("function sanitizeAiQuestionnaireOutput(", promptStart);
const prompt = source.slice(promptStart, promptEnd);
assert.match(prompt, /主流专业调研公司的正式定量问卷交付习惯/);
assert.match(prompt, /甄别题不得直接询问受访者是否属于目标人群/);
assert.match(prompt, /多选题通常提供6-12个/);
assert.match(prompt, /矩阵属性通常提供8-15项/);
assert.match(prompt, /不得按固定答题时长压缩内容/);
assert.doesNotMatch(prompt, /期望时长：|config\.duration/);

const screenerStart = source.indexOf("function baseAiQuestions(");
const screenerEnd = source.indexOf("function bodyAiQuestions(", screenerStart);
const screener = source.slice(screenerStart, screenerEnd);
assert.match(screener, /过去3个月内，您对该品类有过哪些实际行为/);
assert.match(screener, /在购买该品类产品时，您通常扮演什么角色/);
assert.doesNotMatch(screener, /是否属于本次研究目标人群/);

assert.doesNotMatch(html, /id="aiDuration"/);
assert.match(html, /id="aiQuestionnaireLengthMode"/);
assert.match(html, /option value="short"/);
assert.match(html, /option value="long" selected/);
assert.match(html, /field-badge required/);
assert.match(html, /field-badge optional/);
assert.doesNotMatch(source, /querySelector\("#aiDuration"\)/);
assert.match(source, /`# \$\{config\.project\} 调研问卷`/);
assert.match(source, /function targetAiQuestionCount\(studyTypes, lengthMode = "long"\)/);
assert.match(source, /Math\.min\(36, 29 \+ Math\.max\(0, selectedTypeCount - 1\) \* 3\)/);
assert.match(source, /Math\.min\(64, 54 \+ Math\.max\(0, selectedTypeCount - 1\) \* 5\)/);
assert.match(source, /max: Math\.min\(70, target \+ 6\)/);
assert.match(source, /lengthMode: document\.querySelector\("#aiQuestionnaireLengthMode"\)/);
assert.equal((source.match(/maxTokens: 32000/g) || []).length, 2);
assert.match(source, /buildAiQuestionnairePrompt\(\), \{[\s\S]{0,80}maxTokens: 32000/);
assert.match(source, /buildAiRevisionPrompt\(instruction, lastAiQuestionnaireText\), \{ maxTokens: 32000 \}/);
assert.match(styles, /#aiStudyType,[\s\S]{0,160}min-width: 0/);
assert.match(styles, /#aiStudyType \.multiselect-trigger \{[\s\S]{0,100}width: 100%;[\s\S]{0,100}box-sizing: border-box/);
assert.match(source, /const selectedStudyTypes = Array\.from\(document\.querySelectorAll/);
assert.match(source, /missing\.push\(\{ label: "研究需求"/);

console.log("AI questionnaire smoke test passed: professional prompt, objective screener, no duration field, styled Word title");
