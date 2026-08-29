import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../src/shared/docx-export.js", import.meta.url), "utf8");
const { buildAiResearchDocxBytes, markdownToWordDocumentXml, sanitizeDocxFilename } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function zipEntry(bytes, wanted) {
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    if (name === wanted) return decoder.decode(bytes.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  throw new Error(`ZIP entry missing: ${wanted}`);
}

const markdown = `# 荣耀年轻用户 NPS 研究

## 核心结论
这是一段包含 **关键洞察**、*补充说明* 和 \`NPS\` 的正文。

- 保持产品体验优势
- 优先修复售后旅程

1. 完成定量问卷
2. 复盘关键人群

> 本结论仅用于研究决策。

| 指标 | 当前值 | 目标值 |
| --- | ---: | ---: |
| NPS | 32 | 40 |
`;

const xml = markdownToWordDocumentXml(markdown, { projectTitle: "荣耀年轻用户NPS研究", exportedAt: new Date("2026-08-29T00:00:00Z") });
assert.match(xml, /DocumentTitle/);
assert.match(xml, /项目：荣耀年轻用户NPS研究/);
assert.match(xml, /w:numId w:val="1"/);
assert.match(xml, /w:numId w:val="2"/);
assert.match(xml, /w:tblW w:w="9360" w:type="dxa"/);
assert.match(xml, /w:tblInd w:w="120" w:type="dxa"/);
assert.match(xml, /w:shd w:fill="E8EEF5"/);
assert.match(xml, /w:b/);
assert.match(xml, /w:i/);

const bytes = buildAiResearchDocxBytes({ content: markdown, projectTitle: "荣耀年轻用户NPS研究", exportedAt: new Date("2026-08-29T00:00:00Z") });
assert.equal(bytes[0], 0x50);
assert.equal(bytes[1], 0x4b);
assert.match(zipEntry(bytes, "[Content_Types].xml"), /wordprocessingml\.document\.main\+xml/);
assert.match(zipEntry(bytes, "word/styles.xml"), /w:line="300"/);
assert.match(zipEntry(bytes, "word/numbering.xml"), /w:numFmt w:val="bullet"/);
assert.match(zipEntry(bytes, "word/document.xml"), /荣耀年轻用户 NPS 研究/);
assert.equal(sanitizeDocxFilename('荣耀/NPS:*?"<>|.'), "荣耀_NPS_______");

if (process.env.DOCX_FIXTURE_PATH) {
  const longContent = `${markdown}\n${Array.from({ length: 12 }, (_, index) => `## 模块 ${index + 1}\n这是用于验证长内容自动分页的研究说明。回答保持完整，不依赖固定页面高度。\n\n- 研究要点 A\n- 研究要点 B\n\n| 检查项 | 状态 | 说明 |\n| --- | --- | --- |\n| 内容完整性 | 通过 | 第 ${index + 1} 模块已写入 |`).join("\n\n")}`;
  await writeFile(process.env.DOCX_FIXTURE_PATH, buildAiResearchDocxBytes({ content: longContent, projectTitle: "荣耀年轻用户NPS研究", exportedAt: new Date("2026-08-29T00:00:00Z") }));
}

console.log("DOCX export smoke test passed: complete package, preset styles, lists, tables, and safe filename");
