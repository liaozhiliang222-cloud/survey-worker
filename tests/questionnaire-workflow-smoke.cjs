const { test } = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../questionnaire-workflow.js');
const quality = require('../questionnaire-quality.js');
const f = require('./fixtures/questionnaire-quality-cases.cjs');
const config = { brief:f.brief, audience:f.audience };
const replacement = text => JSON.stringify({version:1,replacements:[{id:'D2',text}]});
const original = workflow.blocks(f.goodDraft).find(q=>q.id==='D2').text;
const updated = original.replace('通常在哪个时点加盐', '最近一次做饭时，在哪个时点加盐');

test('target IDs and explicit module prefixes resolve without substring collisions',()=>{
  assert.deepEqual(workflow.targets(f.goodDraft,'D*').map(q=>q.id),['D1','D2']);
  assert.deepEqual(workflow.targets(f.goodDraft,'d2，D2').map(q=>q.id),['D2']);
  assert.throws(()=>workflow.targets(f.goodDraft,'X1'),/未找到/);
  assert.throws(()=>workflow.targets(f.goodDraft,''),/请输入/);
});
test('local patch preserves every unselected question and contract',()=>{
  const result=workflow.applyPatch(f.goodDraft,'D2',replacement(updated));
  assert.deepEqual(quality.readContract(result),quality.readContract(f.goodDraft));
  for (const q of workflow.blocks(f.goodDraft)) if(q.id!=='D2') assert.equal(workflow.blocks(result).find(x=>x.id===q.id).text,q.text);
  assert.deepEqual(workflow.diff(f.goodDraft,result).map(x=>[x.id,x.kind]),[['D2','修改']]);
});
test('out of scope, incomplete, duplicate and injected patches are rejected atomically',()=>{
  for(const payload of ['not json', JSON.stringify({version:1,replacements:[]}), JSON.stringify({version:1,replacements:[{id:'D1',text:'D1. 改题'}]}), JSON.stringify({version:1,replacements:[{id:'D2',text:updated},{id:'D2',text:updated}]}), replacement(updated+'\nQ99. 注入题目'), replacement(updated+'\n## 偷改模块'), replacement(updated+'\n```questionnaire-rules\n{}\n```')]) assert.throws(()=>workflow.applyPatch(f.goodDraft,'D2',payload));
  assert.throws(()=>workflow.targets('S1. a\nS1. b','S1'),/重复/);
});
test('question boundaries retain surrounding section headers and whitespace',()=>{
  const draft='# 项目\n\n## 模块A\nS1. 原题\n题型：开放题\n\n## 模块B\nB1. 不变\n\n### 编程规则\n```questionnaire-rules\n{}\n```';
  const result=workflow.applyPatch(draft,'S1',JSON.stringify({version:1,replacements:[{id:'S1',text:'S1. 新题\n题型：开放题'}]}));
  assert.equal(result,draft.replace('S1. 原题','S1. 新题'));
});
test('version differences include removed/added questions, ordering and metadata',()=>{
  const result=workflow.diff('S1. 一\nS2. 二\n## 说明\n旧','S2. 二\nS3. 三\n## 说明\n新');
  assert.ok(result.some(c=>c.id==='S1'&&c.kind==='删除'));
  assert.ok(result.some(c=>c.id==='S3'&&c.kind==='新增'));
  assert.ok(result.some(c=>c.id==='题目顺序'));
  assert.ok(result.some(c=>c.id==='说明与编程规则'));
});
test('path preview excludes other branches and keeps common entry and return',()=>{
  const contract=structuredClone(f.contract);contract.routes=[{id:'B',ruleIds:['R_SALT'],entry:'B1',exit:'B2',next:'E1'},{id:'D',ruleIds:['R_SALT'],entry:'D1',exit:'D2',next:'E1'}];
  const text=f.withContract('S1. 公共\nS2. 公共\nS3. 公共\nB1. 分支B\nB2. 分支B结束\nD1. 分支D\nD2. 分支D结束\nE1. 公共返回\nH1. 背景',contract);
  const result=workflow.preview(text,config,'B');
  assert.deepEqual(result.questions.map(q=>q.id),['S1','S2','S3','B1','B2','E1','H1']);
  assert.equal(result.state,'资格含义待复核');
  assert.ok(result.notes.some(n=>n.includes('不执行答案级')));
  contract.routes[0].next='D1';
  assert.equal(workflow.preview(f.withContract(text.split('###')[0],contract),config,'B').state,'路径结构错误');
});
test('pending qualification and absent routes never appear certified',()=>{
  const c=structuredClone(f.contract);c.rules[0].status='pending';
  assert.equal(workflow.preview(f.withContract(f.baseGood,c),config,'D').state,'资格依据待确认');
  assert.equal(workflow.preview(f.baseGood,config).state,'未验证的顺序预览');
});
test('history snapshots survive restore and caller mutations',()=>{
  const session=workflow.createSession();const first=session.record(f.goodDraft,config,'初稿');
  first.config.audience='mutated';
  session.record(workflow.applyPatch(f.goodDraft,'D2',replacement(updated)),config,'局部修订');
  const old=session.get(1);session.record(old.text,old.config,'恢复V1');
  assert.equal(session.versions().length,3);assert.equal(session.current().text,f.goodDraft);
  assert.equal(session.current().config.audience,f.audience);
  assert.notEqual(session.get(2).text,f.goodDraft);
});
test('pilot data validates version/path/question and excludes interrupted observations',()=>{
  const session=workflow.createSession();session.record(f.goodDraft,config,'初稿');
  const base={version:1,route:'D',minutes:10,outcome:'completed',question:'D2',feedback:'不理解'};
  session.addPilot(base);session.addPilot({...base,minutes:20});session.addPilot({...base,minutes:100,outcome:'interrupted'});
  const stats=workflow.pilotSummary(session.pilots(1))[0];
  assert.deepEqual([stats.n,stats.excluded,stats.median,stats.p75],[2,1,15,17.5]);
  session.record(f.goodDraft,config,'新版');assert.deepEqual(session.pilots(2),[]);
  for(const change of [{minutes:0},{minutes:Infinity},{minutes:-1},{route:'X'},{version:99},{question:'X99'},{outcome:'unknown'}]) assert.throws(()=>session.addPilot({...base,...change}));
  session.removePilot(2);const added=session.addPilot(base);assert.equal(added.id,4);
  assert.equal(session.export().pilots.length,3);
});
test('pilot summaries keep routes separate and report no completed data honestly',()=>{
  const result=workflow.pilotSummary([{route:'B',minutes:8,outcome:'completed'},{route:'D',minutes:60,outcome:'terminated'}]);
  assert.equal(result[0].median,8);assert.equal(result[1].median,null);assert.equal(result[1].n,0);
});
