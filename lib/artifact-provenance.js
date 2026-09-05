"use strict";
const { createHash } = require('node:crypto');
const parse = (value) => { if (value && typeof value === 'object') return value; try { return JSON.parse(value || '{}'); } catch { return {}; } };
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k,item[k]])) : item);
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const excluded = (e) => e?.excluded === true || e?.excluded === 1 || e?.excluded === '1';
const evidenceHash = (e) => hash({claim:e.claim,value:parse(e.value),source_type:e.source_type,source_id:e.source_id,strength:e.strength,theme:e.theme,excluded:excluded(e)});
const artifactHash = (a) => hash({content:a.content,version:a.version});

function references(artifact,evidence=[]) {
  const ids=new Set(), sources=new Set();
  function visit(value) {
    if(Array.isArray(value))return value.forEach(visit);
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)) {
      if(key==='evidence_id'&&typeof item==='string')ids.add(item);
      else if(key==='evidence_ids'&&Array.isArray(item))item.forEach(id=>ids.add(id));
      else if(['source_report_outline_id','source_report_outline','source_ppt_script','source_ppt_script_id','source_artifact_id'].includes(key)&&typeof item==='string'&&item)sources.add(item);
      else if(key==='source_analysis_artifacts'&&Array.isArray(item))item.forEach(id=>sources.add(id));
      else visit(item);
    }
  }
  visit(parse(artifact.content));
  for(const e of evidence)if(parse(e.value).artifact_id===artifact.id)ids.add(e.id);
  sources.delete(artifact.id);
  return {ids:[...ids],sources:[...sources]};
}
function snapshotArtifact(artifact,{evidence=[],artifacts=[]}={}) {
  const refs=references(artifact,evidence);
  return {schema_version:1,evidence:Object.fromEntries(refs.ids.map(id=>[id,evidence.find(e=>e.id===id)]).map(([id,e])=>[id,e?evidenceHash(e):null])),sources:Object.fromEntries(refs.sources.map(id=>[id,artifacts.find(a=>a.id===id)]).map(([id,a])=>[id,a?artifactHash(a):null]))};
}
function analysisKey(result) { const input={...parse(result.input)};delete input.result_id; return canonical({dataset_id:result.dataset_id,type:result.type,input}); }
function annotateArtifacts(artifacts,{evidence=[],analysisResults=[]}={}) {
  // Callers supply analysisResults in insertion order (D1: rowid).
  const latest=new Map();for(const a of analysisResults)latest.set(analysisKey(a),a.id);
  const cache=new Map();
  function state(artifact,seen=new Set()) {
    if(cache.has(artifact.id))return cache.get(artifact.id);
    if(seen.has(artifact.id))return {status:'needs_review',reasons:[{type:'source_cycle'}]};
    seen=new Set([...seen,artifact.id]);
    const refs=references(artifact,evidence),snapshot=parse(artifact.provenance),reasons=[];
    for(const id of refs.ids) {
      const e=evidence.find(e=>e.id===id);
      if(!e)reasons.push({type:'evidence_missing',evidence_id:id});
      else if(excluded(e))reasons.push({type:'evidence_excluded',evidence_id:id});
      else {
        if(snapshot.evidence?.[id] && snapshot.evidence[id]!==evidenceHash(e))reasons.push({type:'evidence_changed',evidence_id:id});
        const a=analysisResults.find(a=>a.id===e.source_id);
        if(a && latest.get(analysisKey(a))!==a.id)reasons.push({type:'analysis_recomputed',evidence_id:id,replacement_result_id:latest.get(analysisKey(a))});
      }
    }
    for(const id of refs.sources) {
      const source=artifacts.find(a=>a.id===id);
      if(!source)reasons.push({type:'source_missing',artifact_id:id});
      else if(state(source,seen).status!=='current' || (snapshot.sources?.[id] && snapshot.sources[id]!==artifactHash(source)))reasons.push({type:'source_changed',artifact_id:id});
    }
    const untracked=(refs.ids.length||refs.sources.length)&&snapshot.schema_version!==1;
    const value={status:reasons.length?'stale':untracked?'needs_review':'current',label:reasons.length?'待更新':untracked?'来源待复核':'当前版本',reasons};cache.set(artifact.id,value);return value;
  }
  return artifacts.map(a=>({...a,freshness:state(a)}));
}
module.exports={snapshotArtifact,annotateArtifacts};
