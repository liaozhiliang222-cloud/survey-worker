import assert from "node:assert/strict";
import { buildQualitativeExcelPrompt, fillQualitativeSummaryTemplate, inspectQualitativeSummaryTemplate, parseQualitativeExcelHarnessReply, qualitativeExcelInternals } from "../lib/qualitative-excel.mjs";
import { parseProjectFile } from "../lib/project-file-parser.mjs";

const encoder = new TextEncoder();
const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:I5"/><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>客户访谈小结框架</t></is></c><c r="E1" s="1" t="inlineStr"><is><t>用户1</t></is></c><c r="F1" s="1" t="inlineStr"><is><t>用户2</t></is></c><c r="G1" s="1" t="inlineStr"><is><t>用户3</t></is></c><c r="H1" s="1" t="inlineStr"><is><t>用户4</t></is></c><c r="I1" s="1" t="inlineStr"><is><t>用户5</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>模块</t></is></c><c r="B2" t="inlineStr"><is><t>重点关注</t></is></c><c r="C2" t="inlineStr"><is><t>序号</t></is></c><c r="D2" t="inlineStr"><is><t>问题设置</t></is></c><c r="E2" s="1" t="inlineStr"><is><t>旧姓名</t></is></c><c r="F2" s="1" t="inlineStr"><is><t>旧姓名</t></is></c><c r="G2" s="1" t="inlineStr"><is><t>旧姓名</t></is></c><c r="H2" s="1" t="inlineStr"><is><t>旧姓名</t></is></c><c r="I2" s="1" t="inlineStr"><is><t>旧姓名</t></is></c></row>
${[1,2,3].map((sequence,index)=>`<row r="${index+3}"><c r="A${index+3}" t="inlineStr"><is><t>${index?"":"基本信息"}</t></is></c><c r="B${index+3}" t="inlineStr"><is><t>关注${sequence}</t></is></c><c r="C${index+3}"><v>${sequence}</v></c><c r="D${index+3}" t="inlineStr"><is><t>问题${sequence}</t></is></c>${["E","F","G","H","I"].map(column=>`<c r="${column}${index+3}" s="2" t="inlineStr"><is><t>旧答案</t></is></c>`).join("")}</row>`).join("\n")}
</sheetData></worksheet>`;
const files = new Map([
  ["[Content_Types].xml", encoder.encode(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)],
  ["_rels/.rels", encoder.encode(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
  ["xl/workbook.xml", encoder.encode(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="用户访谈小结" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
  ["xl/_rels/workbook.xml.rels", encoder.encode(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)],
  ["xl/worksheets/sheet1.xml", encoder.encode(sheetXml)],
]);
const source = qualitativeExcelInternals.writeZip(files);
const sourceBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const template = await inspectQualitativeSummaryTemplate(sourceBuffer);
assert.equal(template.kind, "qualitative_summary_template");
assert.equal(template.question_count, 3);
assert.equal(template.respondent_capacity, 5);

const parsedProjectFile = await parseProjectFile(sourceBuffer, { extension: "xlsx", fileName: "template.xlsx" });
assert.equal(parsedProjectFile.structuredData.kind, "qualitative_summary_template");
assert.equal(parsedProjectFile.structuredData.question_count, 3);

const reply = JSON.stringify({ respondents: Array.from({ length: 6 }, (_, respondentIndex) => ({ interview_id: `i${respondentIndex + 1}`, name: `受访者${respondentIndex + 1}`, items: template.questions.map((question) => ({ sequence: question.sequence, coverage: question.sequence === 3 ? "not_covered" : "covered", summary: question.sequence === 3 ? "" : `发现${respondentIndex + 1}-${question.sequence}`, evidence_refs: ["第1段"] })) })) });
const parsedReply = parseQualitativeExcelHarnessReply(`\`\`\`json\n${reply}\n\`\`\``);
const generated = await fillQualitativeSummaryTemplate(sourceBuffer, parsedReply);
assert.equal(generated.respondent_count, 6);
assert.equal(generated.sheet_count, 2);
const outputFiles = await qualitativeExcelInternals.readZip(generated.bytes.buffer.slice(generated.bytes.byteOffset, generated.bytes.byteOffset + generated.bytes.byteLength));
const decoder = new TextDecoder();
const firstSheet = decoder.decode(outputFiles.get("xl/worksheets/sheet1.xml"));
assert.match(firstSheet, /受访者1/);
assert.match(firstSheet, /• 发现1-1/);
assert.match(firstSheet, /本次访谈未涉及/);
assert.doesNotMatch(firstSheet, /旧答案|旧姓名/);
assert.match(decoder.decode(outputFiles.get("xl/workbook.xml")), /用户访谈小结_2/);

const prompt = buildQualitativeExcelPrompt({ project: { title: "测试项目" }, template, interviews: [{ id: "i1", file_name: "张三访谈.txt", parsed_text: "受访者：我重视交通便利。" }], userMessage: "生成" });
assert.match(prompt, /仅输出一个合法 JSON 对象/);
assert.match(prompt, /问题1/);
assert.match(prompt, /我重视交通便利/);

console.log("qualitative excel smoke passed");
