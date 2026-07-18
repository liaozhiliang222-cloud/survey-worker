import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name, nextName) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing function: ${name}`);
  const end = source.indexOf(`function ${nextName}(`, start + marker.length);
  if (end < 0) throw new Error(`Missing boundary function: ${nextName}`);
  return source.slice(start, end).trim().replace(/\basync\s*$/, "");
}

const context = vm.createContext({});
vm.runInContext([
  extractFunction("decodeXmlText", "readZipText"),
  extractFunction("normalizeTemplateText", "pptxToTemplateText"),
  extractFunction("docxParagraphXmlToText", "docxTableXmlToMarkdown"),
  extractFunction("docxTableXmlToMarkdown", "docxXmlToStructuredTemplateText"),
  extractFunction("docxXmlToStructuredTemplateText", "docxToAiPlanTemplateText"),
  extractFunction("inferTemplateSections", "extractTemplateExamples"),
  extractFunction("extractTemplateGranularity", "analyzeAiPlanTemplate")
].join("\n"), context);

const syntheticXml = `
<w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>一、研究背景</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>验证核心需求</w:t></w:r></w:p>
  <w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>阶段</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>周期</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>问卷设计</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2天</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>
</w:body>`;
const syntheticText = context.docxXmlToStructuredTemplateText(syntheticXml);
assert.match(syntheticText, /^## 一、研究背景/m);
assert.match(syntheticText, /^- 验证核心需求/m);
assert.match(syntheticText, /^\| 阶段 \| 周期 \|$/m);

const referencePath = process.argv[2];
if (referencePath) {
  const powershellPath = referencePath.replace(/'/g, "''");
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `$archive=[IO.Compression.ZipFile]::OpenRead('${powershellPath}');`,
    "$entry=$archive.GetEntry('word/document.xml');",
    "$reader=[IO.StreamReader]::new($entry.Open(),[Text.Encoding]::UTF8);",
    "$xml=$reader.ReadToEnd(); $reader.Dispose(); $archive.Dispose();",
    "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($xml))"
  ].join(" ");
  const encoded = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
  const xml = Buffer.from(encoded, "base64").toString("utf8");
  const structured = context.docxXmlToStructuredTemplateText(xml);
  const sections = context.inferTemplateSections(structured);
  const granularity = context.extractTemplateGranularity(structured, sections);
  assert.ok(sections.length >= 4, "Reference template should retain its main sections.");
  assert.ok(granularity.totalTableRows >= 10, "Reference template tables should survive DOCX import.");
  assert.match(structured, /主要调研内容/);
  assert.match(structured, /时间计划|调研时间|时间规划/);
  assert.doesNotMatch(structured, /<w:(?:tabs|rPr|pPr)\b/);
  console.log(JSON.stringify({ sections: sections.length, tableRows: granularity.totalTableRows, bullets: granularity.totalBullets }));
}

assert.match(source, /混合模式下，模板是本次交付规格/);
assert.match(source, /不强制扩写为通用详细方案/);
assert.match(source, /家中饲养猫或狗/);
const exampleStart = source.indexOf('document.querySelector("#loadAiPlanExample")');
const exampleEnd = source.indexOf('document.querySelector("#generateAiBrief")', exampleStart);
const exampleHandler = source.slice(exampleStart, exampleEnd);
assert.doesNotMatch(exampleHandler, /乳制品|牛奶/);
assert.match(html, /项目名称 \/ 业务场景[\s\S]*field-badge optional/);
assert.match(html, /核心研究模块[\s\S]*field-badge required/);
assert.match(html, /附加研究模块[\s\S]*可多选/);
assert.match(html, /混合模式：结构 \+ 风格 \+ 颗粒度复刻/);
console.log("AI plan template smoke test passed.");
