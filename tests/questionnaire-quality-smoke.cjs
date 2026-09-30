const { test } = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../questionnaire-quality.js');
const fixtures = require('./fixtures/questionnaire-quality-cases.cjs');
const config = { brief: fixtures.brief, audience: fixtures.audience };
const codes = (result) => new Set(result.issues.map((i) => i.code));

test('real failure types have question-level evidence, not a green checklist', () => {
  const result = quality.audit(fixtures.badDraft, config);
  for (const expected of ['HARD_SCREEN_NO_SOURCE', 'WEAK_SCREENER', 'INTEREST_IS_NOT_ELIGIBILITY', 'SCALE_TIME_MISMATCH', 'DOUBLE_BARREL', 'EXCLUSIVE_OPTION', 'SINGLE_QC_REJECTION', 'CONCEPT_CLAIM', 'MISSING_TARGET', 'RULES_UNVERIFIED']) assert.ok(codes(result).has(expected), expected);
  assert.ok(result.issues.every((i) => i.evidence && i.suggestion));
  assert.equal(result.issues.find((i) => i.code === 'SCALE_TIME_MISMATCH').question, 'D2');
  assert.equal(result.status, '需修改');
});
test('parser accepts Markdown, subquestions, and omits appendix examples', () => {
  const ids = quality.parseQuestions(fixtures.badDraft).map((q) => q.id);
  assert.ok(ids.includes('F1A'));
  assert.ok(ids.includes('QC1'));
  assert.ok(!ids.includes('S88'));
  assert.equal(quality.parseQuestions(fixtures.badDraft).find((q) => q.id === 'D2').options.length, 4);
});
test('fixed timing and multi-signal QC do not produce false positives', () => {
  const result = quality.audit(fixtures.goodDraft, config);
  assert.equal(result.summary.errors, 0, JSON.stringify(result.issues));
  assert.equal(result.summary.pending, 0);
  assert.equal(result.rules[0].sourceVerified, true);
  assert.equal(result.status, '待人工复核');
});
test('fabricated source quotes cannot authorize confirmed eligibility', () => {
  const contract = structuredClone(fixtures.contract);
  contract.rules[0].source.quote = '年龄必须为18-65岁，排除医生';
  const result = quality.audit(fixtures.withContract(undefined, contract), config);
  assert.ok(codes(result).has('UNSUPPORTED_RULE'));
  assert.ok(codes(result).has('ROUTE_PENDING'));
});
test('a topic quote cannot authorize age/industry exclusion', () => {
  const contract = structuredClone(fixtures.contract);
  contract.rules[0].source = { field: 'brief', quote: fixtures.brief };
  const result = quality.audit(fixtures.withContract(fixtures.badDraft, contract), config);
  assert.ok(codes(result).has('SOURCE_SCOPE_MISMATCH'));
});
test('suggestions and pending conditions never become confirmed', () => {
  for (const status of ['proposed', 'pending']) {
    const contract = structuredClone(fixtures.contract);
    contract.rules[0].status = status;
    const result = quality.audit(fixtures.withContract(undefined, contract), config);
    assert.ok(codes(result).has('PENDING_ELIGIBILITY'));
    assert.ok(codes(result).has('ROUTE_PENDING'));
  }
});
test('quota, interest segments and QC cannot substitute for qualification', () => {
  for (const kind of ['quota', 'segment', 'quality']) {
    const contract = structuredClone(fixtures.contract);
    contract.rules[0].kind = kind;
    assert.ok(codes(quality.audit(fixtures.withContract(undefined, contract), config)).has('ROUTE_NOT_ELIGIBILITY'));
  }
});
test('nonexistent references, duplicate IDs and loops are visible', () => {
  const contract = structuredClone(fixtures.contract);
  contract.routes[0].next = 'S1';
  contract.rules[0].questionIds.push('S99');
  contract.routes.push({ id: 'BROKEN', ruleIds: ['MISSING'], entry: 'D99', exit: 'D2', next: 'E1' });
  const result = quality.audit(fixtures.withContract(fixtures.baseGood + '\nS1. 重复题目？', contract), config);
  for (const code of ['DUPLICATE_ID', 'ROUTE_BACKWARD', 'RULE_QUESTION_MISSING', 'ROUTE_TARGET_MISSING', 'ROUTE_NOT_ELIGIBILITY']) assert.ok(codes(result).has(code), code);
});
test('malformed or multiple contract blocks fail closed', () => {
  for (const suffix of ['```questionnaire-rules\n{\n```', '```questionnaire-rules\n{"version":1}\n```', fixtures.goodDraft]) {
    assert.ok(codes(quality.audit(fixtures.goodDraft + '\n' + suffix, config)).has('RULES_UNVERIFIED'));
  }
});
test('empty/null/malformed rules cannot crash validation', () => {
  for (const rules of [[null], [{}], [{ id: 'R1', kind: 'eligibility', status: 'confirmed', questionIds: [], condition: 'none' }]]) {
    const result = quality.audit(fixtures.withContract(undefined, { version: 1, rules, routes: [null] }), config);
    assert.ok(codes(result).has('RULE_SCHEMA'));
    assert.ok(codes(result).has('ROUTE_SCHEMA'));
  }
});
test('fenced example questions are never interpreted as real items', () => {
  const questions = quality.parseQuestions('S1. 正式问题？\n```json\nS99. 示例问题？\n```\nS2. 正式问题？');
  assert.deepEqual(questions.map((q) => q.id), ['S1', 'S2']);
});
test('local fallback records missing eligibility and has no default hard rejection', () => {
  const questions = quality.buildScreener();
  assert.equal(questions.length, 8);
  assert.ok(questions.find((q) => q.code === 'S7').options.some((o) => /停止/.test(o[1])));
  assert.ok(questions.find((q) => q.code === 'S8').options.some((o) => /家人/.test(o[1])));
  assert.ok(questions.every((q) => !q.options.some((o) => /终止|剔除/.test(o[2]))));
  const text = questions.map((q) => `${q.code}. ${q.title}\n题型：${q.type}\n${q.note}`).join('\n') + '\n' + quality.pendingContract();
  assert.ok(codes(quality.audit(text, config)).has('PENDING_ELIGIBILITY'));
});
test('only exact input source fields are accepted; old output is not evidence', () => {
  const contract = structuredClone(fixtures.contract);
  contract.rules[0].source.field = 'currentDraft';
  assert.ok(codes(quality.audit(fixtures.withContract(undefined, contract), { ...config, currentDraft: fixtures.audience })).has('UNSUPPORTED_RULE'));
  contract.rules[0].source.field = 'revisionInstruction';
  assert.ok(!codes(quality.audit(fixtures.withContract(undefined, contract), { ...config, revisionInstruction: fixtures.audience })).has('UNSUPPORTED_RULE'));
});
test('exports contain actual audit evidence and rechecks replace old reports', () => {
  const first = quality.finalize(fixtures.badDraft, config);
  assert.ok(first.output.includes('D2｜时机题与多少量表不匹配'));
  assert.ok(!first.output.includes('✅'));
  const second = quality.finalize(first.output, config);
  assert.equal((second.output.match(/<!-- questionnaire-quality:start -->/g) || []).length, 1);
  assert.deepEqual(second.audit.summary, first.audit.summary);
  assert.ok(!quality.stripReport(second.output).includes('系统规则检查'));
});

test('a branch cannot silently enter another qualification branch', () => {
  const contract = structuredClone(fixtures.contract);
  contract.routes[0].next = 'C1';
  contract.routes.push({ id: 'C', ruleIds: ['R_SALT'], entry: 'C1', exit: 'C2', next: 'E1' });
  const draft = fixtures.baseGood.replace('E1. 您觉得', 'C1. 另一分支入口？\nC2. 另一分支出口？\nE1. 您觉得');
  assert.ok(codes(quality.audit(fixtures.withContract(draft, contract), config)).has('ROUTE_CROSSES_BRANCH'));
});
test('weak health-purpose evidence is not applied to appliance-user research', () => {
  const appliance = quality.audit(fixtures.badDraft, { brief: '研究空气炸锅使用行为', audience: '空气炸锅使用者' });
  assert.ok(!codes(appliance).has('WEAK_SCREENER'));
  assert.ok(codes(quality.audit(fixtures.badDraft, config)).has('WEAK_SCREENER'));
});
test('self-rated confusion and failed revisions remain actionable', () => {
  const result = quality.audit('B11. 您是否会将“控糖”与“无糖”混淆？\n题型：单选题\n# 待修改说明\n当前未调用大模型', config);
  assert.ok(codes(result).has('SELF_RATED_KNOWLEDGE'));
  assert.ok(codes(result).has('REVISION_NOT_APPLIED'));
});
