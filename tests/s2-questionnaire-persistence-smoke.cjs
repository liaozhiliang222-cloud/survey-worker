const {test}=require('node:test');
const assert=require('node:assert/strict');
const workflow=require('../questionnaire-workflow.js');
const f=require('./fixtures/questionnaire-quality-cases.cjs');
const config={brief:f.brief,audience:f.audience};
function memory(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key),map};}
const pilot={version:1,route:'D',minutes:10,outcome:'completed',question:'D2',feedback:'需要解释'};
test('ten immutable snapshots and pilot history reload from serialized storage',()=>{
 const storage=memory(),session=workflow.createSession({storage,projectId:'A'});
 for(let i=0;i<10;i++)session.record(f.goodDraft.replace('通常在哪个时点加盐',`第${i}版：通常在哪个时点加盐`),config,`V${i+1}`);
 session.addPilot(pilot);session.setDraft({aiInput:'尚未提交的需求',aiReviseInput:'修改意见'});
 const restored=workflow.createSession({storage,projectId:'A'});
 assert.equal(restored.versions().length,10);assert.equal(restored.pilots(1).length,1);assert.equal(restored.draft().aiInput,'尚未提交的需求');
 restored.get(1).config.brief='被改写';assert.equal(restored.get(1).config.brief,f.brief);
 const first=restored.get(1);restored.record(first.text,first.config,'恢复V1');assert.equal(restored.current().id,11);assert.equal(restored.pilots(11).length,0);
});
test('project switch isolates drafts, paths and failed unsaved changes',()=>{
 const storage=memory(),session=workflow.createSession({storage,projectId:'A'});
 session.record(f.goodDraft,config,'A');session.setDraft({aiInput:'A需求'});session.setView({route:'D'});session.addPilot(pilot);
 session.switchProject('B');assert.equal(session.current(),null);assert.deepEqual(session.draft(),{});session.record(f.goodDraft,{brief:'B需求'},'B');
 session.switchProject('A');assert.equal(session.current().label,'A');assert.equal(session.pilots(1).length,1);assert.equal(session.view().route,'D');
 storage.setItem=()=>{throw new Error('QuotaExceededError');};session.record(f.goodDraft,config,'未保存稿');assert.equal(session.status().state,'failed');
 session.switchProject('B');session.switchProject('A');assert.equal(session.current().label,'未保存稿');assert.equal(session.status().state,'failed');
});
test('v1 imports append and remap version/pilot ids, invalid inputs are atomic',()=>{
 const source=workflow.createSession();source.record(f.goodDraft,config,'source');source.addPilot(pilot);
 const legacy=source.export();legacy.version=1;delete legacy.projectId;
 const target=workflow.createSession();target.record(f.goodDraft,config,'existing');target.import(legacy);
 assert.equal(target.get(1).label,'existing');assert.equal(target.pilots(2)[0].version,2);
 const before=target.export();
 for(const mutate of [x=>x.version=99,x=>x.versions.push(x.versions[0]),x=>x.pilots[0].version=99,x=>x.pilots[0].route='错误路径',x=>x.pilots[0].question='X99',x=>x.draft=[],x=>x.versions[0].createdAt='invalid']){
  const archive=structuredClone(legacy);mutate(archive);assert.throws(()=>target.import(archive));assert.deepEqual(target.export(),before);
 }
 target.removePilot(1);const added=target.addPilot({...pilot,version:2});assert.equal(added.id,2);
});
test('corrupt storage and cross-tab writes are never overwritten silently',()=>{
 const storage=memory(),key=workflow.STORAGE_PREFIX+'A';storage.setItem(key,'broken');
 const corrupt=workflow.createSession({storage,projectId:'A'});corrupt.record(f.goodDraft,config,'rescue');assert.equal(storage.getItem(key),'broken');assert.equal(corrupt.status().state,'failed');assert.equal(corrupt.export().versions.length,1);
 storage.map.delete(key);const a=workflow.createSession({storage,projectId:'A'}),b=workflow.createSession({storage,projectId:'A'});
 a.record(f.goodDraft,config,'a');const persisted=storage.getItem(key);b.record(f.goodDraft,config,'b');assert.equal(b.status().state,'failed');assert.equal(storage.getItem(key),persisted);assert.equal(b.current().label,'b');
});

test('project deletion removes only the selected archive',()=>{
 const storage=memory(),session=workflow.createSession({storage,projectId:'A'});
 session.record(f.goodDraft,config,'A');session.switchProject('B');session.record(f.goodDraft,config,'B');
 session.forgetProject('A');assert.equal(storage.getItem(workflow.STORAGE_PREFIX+'A'),null);assert.equal(session.current().label,'B');
 assert.throws(()=>session.forgetProject('B'));session.switchProject('A');assert.equal(session.current(),null);
});
