const { test } = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../questionnaire-quality.js');
const f = require('./fixtures/questionnaire-quality-cases.cjs');
const config = { brief: '研究人群细分、烹饪场景、标签理解和价格敏感度。', audience: f.audience };
function run(rows, draft = f.baseGood) {
  return quality.audit(f.withContract(draft, { ...f.contract, measurements: rows }), config);
}
const row = { id: 'M1', source: { field: 'brief', quote: '研究人群细分' }, metric: '行为强度', population: '全部合格受访者', role: 'segmentation', questionIds: ['S3'], analysis: '作为分群输入，标准化后分析' };
test('independent requirements checks expose omitted dimensions', () => {
  const result = run([]);
  assert.ok(result.coverage.some(x => x.metric === '价格敏感度' && x.status === '缺失'));
  assert.ok(result.issues.some(x => x.code === 'MEASUREMENT_MAP_MISSING'));
});
test('valid references never certify semantic coverage', () => {
  const result = run([row]);
  assert.equal(result.coverage.find(x => x.id === 'M1').status, '待语义复核');
  assert.ok(!result.coverage.some(x => x.status === '完整覆盖'));
});
test('fabricated quote, missing questions and blank mappings are distinct', () => {
  for (const [change, status] of [[{source:{field:'brief',quote:'不存在的需求原文'}},'依据待确认'], [{questionIds:['X999']},'部分覆盖'], [{questionIds:[]},'缺失']]) {
    assert.equal(run([{...row,...change}]).coverage.find(x=>x.id==='M1').status, status);
  }
});
test('malformed measurement objects are safe and visible', () => {
  for (const value of [null, {}, { ...row, questionIds:[null] }, {...row,role:'invented'}]) {
    assert.ok(run([value]).issues.some(x=>x.code==='MEASUREMENT_SCHEMA'));
  }
});
test('frequency, capped behavior, pricing unit and time baseline have evidence', () => {
  const result = run([row], '**Q1. 您使用的频率？**\n经常/偶尔\n**Q2. 您采取过哪些行为？**\n最多选3项\n**Q3. 接受的价格？**\n100-200元\n**Q4. 可接受时间增加多少？**\n30%');
  for (const code of ['FREQUENCY_RECALL','BEHAVIOR_CAPPED','PRICE_UNIT','TIME_BASELINE']) assert.ok(result.issues.some(x=>x.code===code && x.evidence),code);
});
test('operationalized frequency and pricing avoid basic warnings', () => {
  const result=run([row], '**Q1. 过去4周使用多少天？**\n0-28天\n**Q2. 每台2升设备接受的价格是多少元？**\n数值\n**Q3. 目前通常烹饪时间是多少分钟？**\n数值\n**Q4. 接受时间增加多少？**\n30%');
  assert.ok(!result.issues.some(x=>['FREQUENCY_RECALL','PRICE_UNIT','TIME_BASELINE'].includes(x.code)));
});
test('concept comparison catches missing dimensions', () => {
  const result=run([row], '**F1. 产品A**\n概念描述：假设产品\n**F1a. 吸引力、相关性、独特性、可信度、购买意向**\n**F2. 产品B**\n概念描述：假设产品\n**F2a. 吸引力**');
  assert.ok(result.issues.some(x=>x.code==='CONCEPT_COMPARABILITY' && x.question==='F2'));
  assert.ok(!result.issues.some(x=>x.code==='CONCEPT_COMPARABILITY' && x.question==='F1'));
});
test('export report refreshes coverage without accumulating obsolete entries', () => {
  const source=f.withContract(f.baseGood,{...f.contract,measurements:[row]});
  const first=quality.finalize(source,config);
  const second=quality.finalize(first.output,config);
  assert.equal(second.output,first.output);
  assert.match(second.output,/需求覆盖核对/);
  assert.match(second.output,/行为强度｜待语义复核/);
  assert.match(quality.designRules(),/measurements数组/);
});
test('generic motivation and concept prose cannot fill abandonment and sensory gaps', () => {
  const result = quality.audit('**Q1. 您进行管理的原因？**\n健康\n**Q2. 您听说过哪些方法？**\n使用后放弃\n**F1. 请阅读高鲜方案**\n概念描述：鲜香假设产品', { brief: '研究放弃阶段与高鲜标准' });
  assert.ok(result.coverage.find(x => x.metric === '阶段与放弃').gaps.includes('放弃或重启原因'));
  assert.ok(result.coverage.find(x => x.metric === '高鲜感官标准').gaps.includes('受访者描述或标准'));
});
