/* Shared, deterministic indicator-weighting engine. No DOM or respondent mutation. */
(function (root) {
  'use strict';
  const text = v => String(v ?? '').normalize('NFKC').trim();
  const key = v => text(v).toUpperCase();
  const sum = xs => xs.reduce((a, b) => a + b, 0);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const copy = v => JSON.parse(JSON.stringify(v));
  function number(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = text(v);
    return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
  }
  function coefficient(v) {
    const s = text(v), percent = s.endsWith('%'), n = number(percent ? s.slice(0, -1) : v);
    return { value: n === null ? null : n / (percent ? 100 : 1), percent };
  }
  function parseCsv(input) {
    const s = String(input).replace(/^\uFEFF/, ''), first = s.split(/\r?\n/)[0];
    const sep = first.includes('\t') ? '\t' : ',', rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { if (quoted && s[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
      else if (!quoted && (c === sep || c === '\n' || c === '\r')) {
        row.push(cell); cell = '';
        if (c !== sep) { rows.push(row); row = []; if (c === '\r' && s[i + 1] === '\n') i++; }
      } else cell += c;
    }
    if (quoted) throw Error('CSV 引号未闭合，请检查文件。');
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function suggestField(value, label, fields) {
    const exact = fields.filter(f => key(f.id) === key(value));
    if (exact.length === 1) return { field: exact[0].id, confirmed: true };
    const labels = [value, label].map(key).filter(Boolean);
    const named = fields.filter(f => labels.includes(key(f.label)) || labels.includes(key(f.label?.split(/[:：]/).pop())));
    if (named.length === 1) return { field: named[0].id, confirmed: false };
    const suffix = fields.filter(f => key(value).replace(/N$/, '') === key(f.id));
    if (suffix.length === 1) return { field: suffix[0].id, confirmed: false };
    // SPSS labels may be truncated. Only offer a unique long-prefix match for human confirmation.
    const compact = s => key(s).replace(/[\s\p{P}\p{S}]/gu, '');
    const candidates = [value,label].map(compact).filter(s=>s.length>=8);
    const partial = fields.filter(f=>{const s=compact(f.label?.split(/[:：]/).pop());return s.length>=8&&candidates.some(c=>s.startsWith(c)||c.startsWith(s));});
    return partial.length === 1 ? { field: partial[0].id, confirmed: false } : { field: '', confirmed: false };
  }
  function importRows(rows, config, fields) {
    const start = Number(config.start), end = Number(config.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > rows.length) throw Error('数据起止行无效。');
    if (config.valueCol < 0 || config.variableCol < 0) throw Error('请选择变量和权重列。');
    const items = [];
    for (let i = start - 1; i < end; i++) {
      const row = rows[i] || [];
      if (row.every(v => !text(v))) continue;
      const dimension = config.dimensionCol >= 0 ? text(row[config.dimensionCol]) : text(config.dimensionName);
      const variable = text(row[config.variableCol]), label = config.labelCol >= 0 ? text(row[config.labelCol]) : variable;
      const parsed = coefficient(row[config.valueCol]), match = suggestField(variable, label, fields);
      items.push({ dimension, variable, label, field: match.field, confirmed: match.confirmed,
        input: row[config.valueCol] ?? '', value: parsed.value, percent: parsed.percent, sourceRow: i + 1 });
    }
    if (!items.length) throw Error('所选区域没有权重明细。');
    return items;
  }
  function validateScale(scale = {}) {
    const s = { min: 0, max: 10, low: 6, high: 9, metric: 'net', missing: [], ...scale };
    for (const k of ['min', 'max', 'low', 'high']) { s[k] = number(s[k]); if (s[k] === null) throw Error('量表范围及阈值必须是有限数值。'); }
    if (s.min >= s.max) throw Error('量表最小值必须小于最大值。');
    if (!['net', 'mean'].includes(s.metric)) throw Error('请选择净满意度或原始均值。');
    if (s.metric === 'net' && !(s.min <= s.low && s.low < s.high && s.high <= s.max)) throw Error('阈值需满足：最小值 ≤ 不满意上限 < 满意下限 ≤ 最大值。');
    if (!Array.isArray(s.missing)) s.missing = text(s.missing).split(/[,，;；\s]+/).filter(Boolean);
    return s;
  }
  function scoreValue(value, item, scale) {
    const codes = [...(scale.missing || []), ...(item.missing || [])];
    if (codes.some(c => text(c) === text(value))) return null;
    const n = number(value), lo = item.min ?? scale.min, hi = item.max ?? scale.max;
    if (n === null || n < lo || n > hi) return null;
    return item.reverse ? lo + hi - n : n;
  }
  function normalizeDimension(dim, headers) {
    if (!text(dim.name)) throw Error('二级指标名称不能为空。');
    if (!dim.items?.length) throw Error(`「${dim.name}」没有三级题项。`);
    const seen = new Set(), allowed = new Set(headers), items = dim.items.map(item => {
      if (!allowed.has(item.field)) throw Error(`「${dim.name}」找不到变量：${item.field || item.variable || item.label}`);
      if (seen.has(item.field)) throw Error(`「${dim.name}」变量重复：${item.field}`);
      seen.add(item.field);
      const v = number(item.value);
      if (v === null || v < 0) throw Error(`「${dim.name}」${item.label || item.field} 的权重为空、非数值或为负；请先核对。`);
      return { ...item, value: v };
    });
    const total = sum(items.map(i => i.value));
    if (!(total > 0) || !Number.isFinite(total)) throw Error(`「${dim.name}」权重合计须为有限正数。`);
    return { ...dim, items: items.map(i => ({ ...i, weight: i.value / total })), inputTotal: total, scale: validateScale(dim.scale) };
  }
  function normalizeScheme(scheme, headers) {
    if (!scheme?.dimensions?.length) throw Error('请至少选择一个完整的二级指标。');
    if (new Set(scheme.dimensions.map(d => d.name)).size !== scheme.dimensions.length) throw Error('二级指标名称重复，请先合并或重命名。');
    if (scheme.sampleWeight && !headers.includes(scheme.sampleWeight)) throw Error('找不到样本权重变量。');
    return { ...copy(scheme), dimensions: scheme.dimensions.map(d => normalizeDimension(d, headers)) };
  }
  function sampleWeight(row, field) {
    if (!field) return 1;
    const n = number(row[field]);
    if (n === null || n < 0) throw Error(`样本权重「${field}」含缺失、非数值或负值，请先处理。`);
    return n;
  }
  function calculate(rows, dimension, weightField = '') {
    const scale = validateScale(dimension.scale), items = dimension.items;
    const stats = items.map(i => ({ field: i.field, label: i.label || i.field, weight: i.weight, n: 0, base: 0, total: 0,
      positive: 0, negative: 0, neutral: 0, positiveN: 0, negativeN: 0, neutralN: 0 }));
    let nAny = 0, nAll = 0;
    for (const row of rows) {
      const a = sampleWeight(row, weightField); let valid = 0, required = 0;
      items.forEach((item, j) => {
        if (item.weight > 0) required++;
        const v = scoreValue(row[item.field], item, scale);
        if (v === null || a === 0) return;
        if (item.weight > 0) valid++;
        const s = stats[j]; s.n++; s.base += a; s.total += a * v;
        if (v >= scale.high) { s.positive += a; s.positiveN++; }
        else if (v <= scale.low) { s.negative += a; s.negativeN++; }
        else { s.neutral += a; s.neutralN++; }
      });
      if (valid) nAny++;
      if (required && valid === required) nAll++;
    }
    for (const s of stats) s.value = s.base > 0 ? (scale.metric === 'net' ? 100 * (s.positive - s.negative) / s.base : s.total / s.base) : null;
    const present = stats.filter(s => s.value !== null && s.weight > 0), coverage = sum(present.map(s => s.weight));
    return { name: dimension.name, metric: scale.metric, value: coverage > 0 ? sum(present.map(s => s.weight * s.value)) / coverage : null,
      nAny, nAll, nMin: Math.min(...stats.filter(s => s.weight > 0).map(s => s.n)), nMax: Math.max(...stats.filter(s => s.weight > 0).map(s => s.n)),
      coverage, items: stats, weightField };
  }
  // Lanczos log-gamma and continued-fraction incomplete beta for two-sided Student t p-values.
  function logGamma(z) {
    const p = [676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    z--; let x = 0.99999999999980993; for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
    const t = z + 7.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function betaFraction(a, b, x) {
    const tiny = 1e-300; let c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d; let h = d;
    for (let m = 1; m <= 300; m++) {
      for (const aa of [m * (b - m) * x / ((a + 2*m - 1) * (a + 2*m)), -(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1))]) {
        d = 1 + aa*d; if (Math.abs(d)<tiny) d=tiny;
        c = 1 + aa/c; if (Math.abs(c)<tiny) c=tiny;
        d=1/d; const delta=d*c; h*=delta;
        if (aa < 0 && Math.abs(delta-1)<1e-13) return h;
      }
    }
    return h;
  }
  function tProbability(t, df) {
    if (!Number.isFinite(t)) return 0;
    const x = df / (df + t*t), a=df/2, b=0.5;
    if (x === 1) return 1;
    const factor=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
    const p=x<(a+1)/(a+b+2) ? factor*betaFraction(a,b,x)/a : 1-factor*betaFraction(b,a,1-x)/b;
    return Math.max(0,Math.min(1,p));
  }
  function regress(rows, dimension, weightField = '') {
    const scale = validateScale(dimension.scale), items = dimension.items, p = items.length;
    if (!dimension.y || !p || items.some(i => i.field === dimension.y) || new Set(items.map(i => i.field)).size !== p) throw Error('请选择独立的Y和互不重复的X。');
    if (p > 80) throw Error('单个维度最多支持80个自变量，请拆分指标体系。');
    const cases=[];
    for (const row of rows) {
      const a=sampleWeight(row,weightField), y=scoreValue(row[dimension.y],dimension.yOptions || {},scale), x=items.map(i=>scoreValue(row[i.field],i,scale));
      if (a>0 && y!==null && x.every(v=>v!==null)) cases.push({a,y,x});
    }
    const n=cases.length, df=n-p-1;
    if (df<=0) throw Error(`「${dimension.name}」完整样本${n}，自变量${p}，残差自由度不足。`);
    const sw=sum(cases.map(c=>c.a)), mx=items.map((_,j)=>sum(cases.map(c=>c.a*c.x[j]))/sw), my=sum(cases.map(c=>c.a*c.y))/sw;
    const sx=items.map((_,j)=>Math.sqrt(sum(cases.map(c=>c.a*(c.x[j]-mx[j])**2))/sw)), sy=Math.sqrt(sum(cases.map(c=>c.a*(c.y-my)**2))/sw);
    if (!sy || sx.some(s=>!s)) throw Error(`「${dimension.name}」Y或X存在零方差，不能估计权重。`);
    const X=items.map((_,j)=>cases.map(c=>Math.sqrt(c.a)*(c.x[j]-mx[j])/sx[j]));
    const Y=cases.map(c=>Math.sqrt(c.a)*(c.y-my));
    const Q=[], R=items.map(()=>Array(p).fill(0));
    // Modified Gram-Schmidt with a second orthogonalization pass. Detect dependent columns instead of padding pivots.
    for (let j=0;j<p;j++) {
      const v=X[j].slice();
      for (let pass=0;pass<2;pass++) for(let k=0;k<j;k++) {
        const r=dot(Q[k],v);R[k][j]+=r;for(let i=0;i<n;i++) v[i]-=r*Q[k][i];
      }
      R[j][j]=Math.sqrt(dot(v,v));
      if (R[j][j]<1e-10*Math.sqrt(sw)) throw Error(`「${dimension.name}」自变量线性相关，矩阵秩不足。`);
      Q.push(v.map(x=>x/R[j][j]));
    }
    function solve(v) { const b=Array(p).fill(0);for(let i=p-1;i>=0;i--)b[i]=(v[i]-sum(R[i].slice(i+1).map((r,k)=>r*b[i+1+k])))/R[i][i];return b; }
    const scaled=solve(Q.map(q=>dot(q,Y))), B=scaled.map((b,j)=>b/sx[j]), intercept=my-dot(B,mx);
    const residual=sum(cases.map(c=>c.a*(c.y-intercept-dot(B,c.x))**2)), s2=residual/df, r2=1-residual/(sw*sy*sy);
    const invCols=items.map((_,j)=>solve(items.map((_,i)=>i===j?1:0))), variances=items.map((_,i)=>sum(invCols.map(c=>c[i]**2)));
    const coefficients=items.map((item,j)=>{
      const se=Math.sqrt(s2*variances[j])/sx[j], t=se>0?B[j]/se:null;
      return {field:item.field,label:item.label||item.field,B:B[j],beta:B[j]*sx[j]/sy,se,t,p:t===null?(B[j]===0?null:0):tProbability(t,df),vif:sw*variances[j],mean:mx[j]};
    });
    const negative=coefficients.filter(c=>c.B<0), warnings=[];
    if (n<Math.max(30,10*p)) warnings.push(`完整样本${n}偏少（${p}个自变量），请复核模型稳定性。`);
    if (negative.length) warnings.push(`${negative.length}项B为负，不能直接归一化为计分权重。`);
    if (coefficients.some(c=>c.vif>10)) warnings.push('存在VIF>10的高度共线项，请复核。');
    const total=sum(B), usable=!negative.length&&total>0;
    return {n,p,df,excluded:rows.length-n,r2,adjustedR2:1-(1-r2)*(n-1)/df,intercept,coefficients,warnings,usable,
      dimension:{...copy(dimension),source:{kind:'regression',method:weightField?'WLS-B':'OLS-B',weightField},items:items.map((item,j)=>({...item,value:B[j],weight:usable?B[j]/total:null}))}};
  }
  root.IndicatorWeighting={number,coefficient,parseCsv,suggestField,importRows,validateScale,scoreValue,normalizeDimension,normalizeScheme,calculate,regress,tProbability};
  if (typeof module!=='undefined') module.exports=root.IndicatorWeighting;
})(typeof window!=='undefined'?window:globalThis);
