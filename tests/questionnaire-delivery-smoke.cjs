const {test}=require('node:test');
const assert=require('node:assert/strict');
const delivery=require('../questionnaire-delivery.js');
const quality=require('../questionnaire-quality.js');
const f=require('./fixtures/questionnaire-quality-cases.cjs');
const sample=`# 客户问卷
## 一、问卷说明与编程约定
**目标人群**：日常饮食人群
**编程通用约定**：
- 内部编码说明
**样本条件表**：
| 条件ID | 来源字段 |
| R1 | audience |
## 二、问卷正文
### 开场白
您好，请按真实情况回答。
S1. 您通常何时加盐？
题型：单选题
| 编码 | 选项内容 | 逻辑与备注 |
|---|---|---|
| 1 | 烹饪中 | 跳至S2 |
> 设计思路：用时点区分行为。
这句仍然是设计解释。

S2. 您是否购买过？
题型：单选题
QC1. 本题是注意力检测，请选择比较同意。
题型：单选题
| 1 | 比较同意 | 正确答案 |
QC2. 过去3个月是否参加过市场调研？
题型：单选题
### 结束语
谢谢您的参与。
## 三、待复核清单
- S1还需内部复核
### 编程规则（不向受访者展示）
\`\`\`questionnaire-rules
{"version":1,"rules":[{"id":"QC_RULE","kind":"quality","questionIds":["QC1"]}],"routes":[]}
\`\`\`
## 四、原始研究需求
私人需求附件原文
`;
test('client version removes internal sections while preserving complete client questions and routing notes',()=>{
  const text=delivery.clientText(sample);
  for(const unwanted of ['编程约定','编程规则','questionnaire-rules','设计思路','设计解释','内部编码','来源字段','待复核','原始研究需求','私人需求','QC1','注意力','正确答案'])assert.ok(!text.includes(unwanted),unwanted);
  for(const kept of ['目标人群','您好','S1.','跳至S2','S2.','QC2.','谢谢您的参与'])assert.ok(text.includes(kept),kept);
});
test('attention removal retains other QC questions and prunes only dedicated attention quality rules',()=>{
  const text=delivery.prepare(sample);
  assert.ok(!quality.parseQuestions(text).some(q=>q.id==='QC1'));
  assert.ok(quality.parseQuestions(text).some(q=>q.id==='QC2'));
  assert.equal(quality.readContract(text).value.rules.length,0);
  assert.match(text,/样本条件表/);
});
test('client rendering never changes source or weakens eligibility references to removed items',()=>{
  const text=sample.replace('"kind":"quality"','"kind":"eligibility"');
  const result=delivery.prepare(text);
  assert.equal(quality.readContract(result).value.rules[0].questionIds[0],'QC1');
  assert.match(text,/QC1\. 本题/);
});
test('client cleanup is idempotent and strips generated audit reports',()=>{
  const internal=quality.finalize(f.goodDraft,{brief:f.brief,audience:f.audience}).output;
  const result=delivery.clientText(internal);
  assert.equal(delivery.clientText(result),result);
  assert.ok(!/系统规则检查|questionnaire-rules|本题请选/.test(result));
});
test('embedded internal JSON can be removed without deleting subsequent modules',()=>{
  const text='S1. 前题\n### 编程规则\n```questionnaire-rules\n{}\n```\n### 模块B：行为\nB1. 后题';
  assert.match(delivery.clientText(text),/B1\. 后题/);
  assert.ok(!delivery.clientText('S1. 保留\n```questionnaire-rules\n{"version":1').includes('version'));
});
test('attention text is identified by purpose, not merely QC prefix or ordinary choices',()=>{
  const text='QC2. 最近参调情况？\nQ1. 请选择您最重要的需求？\nQ2. 你认为设计思路有吸引力吗？\n| 1 | 注意力改善 | |';
  assert.equal(delivery.clientText(text),text);
});
test('bold type fields stay inside removed attention blocks; ordinary instructions remain',()=>{
  const text='Q1. 本题请选择您最常用的渠道？\nQC1. 本题请选比较同意。\n**题型：单选题**\n| 1 | 比较同意 | 正确答案 |\n## 结束语\n谢谢';
  const client=delivery.clientText(text);
  assert.match(client,/Q1\. 本题请选择您最常用的渠道/);
  assert.ok(!client.includes('正确答案'));
  assert.match(client,/谢谢/);
});
