/* Supplemental respondent-level models for crosstabs. No network or source-data writes. */
(function(root) {
  "use strict";
  const categories = {A:"魅力属性", O:"期望属性", M:"必备属性", I:"无差异属性", R:"反向属性", Q:"可疑回答"};
  const matrix = [["Q","A","A","A","O"],["R","I","I","I","M"],["R","I","I","I","M"],["R","I","I","I","M"],["R","R","R","R","Q"]];
  const priceKeys = ["tooCheap","cheap","expensive","tooExpensive"];
  const priceLabels = ["太便宜","比较便宜","比较贵","太贵"];
  const text = value => String(value ?? "").normalize("NFKC").trim();
  function responseIndex(value, scale = "labels") {
    const s = text(value).toLowerCase();
    if (!s) return -1;
    // Decode meanings first. A reversed numeric scale cannot override an explicit label.
    if (/不喜欢|不喜歡|讨厌|討厭|厌恶|厭惡|dislike/.test(s)) return 4;
    if (/理所当然|理所當然|理应|理應|本应|应该如此|must.be|expect.it/.test(s)) return 1;
    if (/无所谓|無所謂|不在意|neutral|indifferent/.test(s)) return 2;
    if (/能忍受|可忍受|可以忍受|能接受|可接受|可以接受|勉强|勉強|live.with|tolerate/.test(s)) return 3;
    if (/喜欢|喜歡|like/.test(s)) return 0;
    if (scale === "labels") return -1;
    if (!/^[1-5](?:\.0+)?$/.test(s)) return -1;
    return scale === "reverse" ? 5 - Number(s) : Number(s) - 1;
  }
  function calculateKano(rows, spec) {
    const counts = Object.fromEntries(Object.keys(categories).map(k => [k,0]));
    let validN = 0;
    for (const row of rows) {
      const f=responseIndex(row[spec.functional],spec.scale), d=responseIndex(row[spec.dysfunctional],spec.scale);
      if(f<0 || d<0) continue;
      counts[matrix[f][d]]++; validN++;
    }
    const effectiveN=counts.A+counts.O+counts.M+counts.I;
    const max=Math.max(...Object.values(counts));
    const winners=max ? Object.keys(counts).filter(k=>counts[k]===max) : [];
    return {counts,validN,effectiveN,excludedN:rows.length-validN,
      better:effectiveN?(counts.A+counts.O)/effectiveN:null,
      worse:effectiveN?-(counts.O+counts.M)/effectiveN:null,
      classification:winners.length?winners.map(k=>k+" "+categories[k]).join(" / ")+(winners.length>1?"（并列）":""):"无有效样本"};
  }
  function parsePrice(value) {
    const s=text(value).replace(/^(?:RMB|CNY|[¥￥$])\s*/i,"").replace(/\s*(?:元|人民币)$/i,"");
    if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) return null;
    const n=Number(s.replace(/,/g,"")); return Number.isFinite(n)&&n>0?n:null;
  }
  function preparePsm(rows,spec) {
    const values=[];let missingN=0,inconsistentN=0;
    for(const row of rows) {
      const prices=priceKeys.map(k=>parsePrice(row[spec[k]]));
      if(prices.some(p=>p===null)){missingN++;continue;}
      const inconsistent=prices.some((p,i)=>i>0&&p<prices[i-1]);
      if(inconsistent) {inconsistentN++;if(spec.validation!=="complete") continue;}
      values.push(prices);
    }
    return {values,validN:values.length,missingN,inconsistentN,excludedN:rows.length-values.length};
  }
  function calculatePsm(rows,spec,priceGrid) {
    const prepared=preparePsm(rows,spec), n=prepared.validN;
    const prices=priceGrid || [...new Set(prepared.values.flat())].sort((a,b)=>a-b);
    const sorted=priceKeys.map((_,i)=>prepared.values.map(r=>r[i]).sort((a,b)=>a-b));
    const lower=(arr,x,inclusive)=>{let l=0,r=arr.length;while(l<r){const m=(l+r)>>1;if(arr[m]<x||(inclusive&&arr[m]===x))l=m+1;else r=m;}return l;};
    const curve=prices.map(price=>({price,...Object.fromEntries(priceKeys.map((key,i)=>[key,n?(i<2?n-lower(sorted[i],price,false):lower(sorted[i],price,true))/n:null]))}));
    return {...prepared,curve};
  }
  function detectModels(headers,rows,infos=[]) {
    const infoFor=h=>infos.find(i=>i.title===h||i.sourceHeader===h)||{};
    const fields=headers.map(h=>{const info=infoFor(h);return {header:h,id:text(info.sourceHeader||h).split(/\s/)[0],label:text(info.variableLabel||h),info};});
    const kano=[],psm=[],warnings=[],paired=new Set();
    const evidence=field=>{
      const labels=Object.values(field.info.options||{});
      const examples=labels.length?labels:rows.slice(0,300).map(r=>r[field.header]);
      const meanings=new Set(examples.map(v=>responseIndex(v)).filter(i=>i>=0));
      return meanings.size>=2 && (meanings.has(1)||meanings.has(3));
    };
    const groups=new Map();
    for(const field of fields) {
      const match=field.id.match(/^(.+?)(?:__?)(1|2|F|D|functional|dysfunctional)$/i);
      if(!match)continue;
      const key=match[1].toUpperCase(),side=/^(1|F|functional)$/i.test(match[2])?"functional":"dysfunctional";
      const group=groups.get(key)||{}; (group[side] ||= []).push(field);groups.set(key,group);
    }
    const add=(f,d,name)=>{
      if(paired.has(f.header)||paired.has(d.header))return;
      if(!(evidence(f)&&evidence(d)))return;
      // Explicit labels can reveal a reversed order in a platform export.
      if(/反向问题|反向題|dysfunctional/i.test(f.label)&&!/反向问题|反向題|dysfunctional/i.test(d.label))[f,d]=[d,f];
      kano.push({name,functional:f.header,dysfunctional:d.header,scale:"labels"});paired.add(f.header);paired.add(d.header);
    };
    for(const [name,g] of groups) if(g.functional?.length===1&&g.dysfunctional?.length===1) add(g.functional[0],g.dysfunctional[0],name);
    // Pair named functional/dysfunctional questions even when question IDs differ.
    const features=new Map();
    for(const field of fields) {
      if(paired.has(field.header)||!evidence(field))continue;
      const feature=field.label.match(/[【\[]([^】\]]+)[】\]]/)?.[1];
      if(!feature)continue;
      const side=/不具备|不具有|没有|不提供|反向|dysfunctional/i.test(field.label)?"dysfunctional":"functional";
      const g=features.get(feature)||{};(g[side]||=[]).push(field);features.set(feature,g);
    }
    for(const [name,g] of features) if(g.functional?.length===1&&g.dysfunctional?.length===1)add(g.functional[0],g.dysfunctional[0],name);
    const candidates=Object.fromEntries(priceKeys.map(k=>[k,[]]));
    for(const f of fields) {
      const s=(f.id+" "+f.label).toLowerCase();let key;
      if(/too[ _-]?cheap|太便宜|过于便宜|低到.*(?:质量|品质)|便宜.*(?:质量|品質|不敢)/.test(s))key="tooCheap";
      else if(/too[ _-]?expensive|太贵|过于昂贵|贵到.*(?:不|放弃)|高到.*(?:不|放弃)/.test(s))key="tooExpensive";
      else if(/比较便宜|较便宜|便宜.*(?:划算|购买)|bargain|(?:^|[_\s])cheap(?:$|[_\s])/.test(s))key="cheap";
      else if(/比较贵|较贵|偏贵|贵.*(?:仍|可以|可接受)|(?:^|[_\s])expensive(?:$|[_\s])/.test(s))key="expensive";
      if(key) {
        const nonempty=rows.slice(0,300).map(r=>r[f.header]).filter(v=>text(v));
        if(nonempty.length&&nonempty.filter(v=>parsePrice(v)!==null).length/nonempty.length>=0.8)candidates[key].push(f.header);
      }
    }
    if(priceKeys.every(k=>candidates[k].length===1))psm.push({name:"PSM 价格敏感度",...Object.fromEntries(priceKeys.map(k=>[k,candidates[k][0]])),validation:"ordered"});
    else if(priceKeys.some(k=>candidates[k].length))warnings.push("发现价格题候选，但四问未唯一配齐，请在配置中指定 PSM 四个字段。");
    const orphan=fields.filter(f=>!paired.has(f.header)&&evidence(f));
    if(orphan.length)warnings.push(`${orphan.length} 个字段含 KANO 回答标签但未唯一配对，可手动添加。`);
    return {kano,psm,warnings};
  }
  function validateModels(config,headers) {
    for(const spec of config.kano) {
      if(!spec.name.trim())throw Error("请填写 KANO 功能名称。");
      if(!headers.includes(spec.functional)||!headers.includes(spec.dysfunctional)||spec.functional===spec.dysfunctional)throw Error(`KANO「${spec.name}」请选择两个不同的正向/反向字段。`);
    }
    for(const spec of config.psm) {
      if(!spec.name.trim()||priceKeys.some(k=>!headers.includes(spec[k]))||new Set(priceKeys.map(k=>spec[k])).size!==4)throw Error(`PSM「${spec.name}」请选择四个不同的价格字段。`);
    }
  }
  root.CrosstabModels={categories,priceKeys,priceLabels,responseIndex,calculateKano,parsePrice,preparePsm,calculatePsm,detectModels,validateModels};
  if(typeof module!=="undefined")module.exports=root.CrosstabModels;
})(typeof window!=="undefined"?window:globalThis);
