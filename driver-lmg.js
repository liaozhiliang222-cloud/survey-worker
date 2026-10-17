(function (root) {
  'use strict';
  const C = root.DriverCore || (typeof require === 'function' ? require('./driver-core.js') : null);
  const VERSION = 'driver-weights-20261017-3';
  const RULES = Object.freeze({ minN: 100, casesPerFactor: 20, minRetention: .8, maxVif: 5, minCv: .2, maxOptimism: .15, maxCook: 1, minBootstrap: 200, minBootstrapSuccess: .9, maxWeightWidth: .30 });
  const INDICATORS = [
    ['A1__1', '宣传推广', /店铺宣传|宣传推广/], ['Q16__1', '页面交互体验', /交互体验/],
    ['Q19__1', '产品信息展示', /产品信息展示/], ['Q25__1', '营销促销活动', /营销促销/],
    ['Q30__1', '售前客服服务', /售前客服/], ['Q35__1', '服务保障', /服务保障/],
    ['Q38__1', '产品价格与价保', /价格与价保/], ['Q40__1', '交易便利', /交易便利/],
    ['Q42__1', '物流配送服务', /物流配送/], ['Q45__1', '退换货/退款服务', /售后服务/],
    ['Q49__1', '会员服务', /会员服务/]
  ];
  const EXPERIENCES = [['Q7__1', '浏览产品'], ['Q7__2', '购买产品'], ['Q7__3', '咨询售前客服'], ['Q7__4', '参与优惠活动'], ['Q7__5', '进行售后'], ['Q7__7', '观看直播']];
  const PLATFORMS = ['官方商城', '天猫', '京东', '抖音'];
  function rng(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function stats(rows) {
    const n = rows.length, p = rows[0]?.length || 0, mean = new Float64Array(p), sd = new Float64Array(p), cov = Array.from({ length: p }, () => new Float64Array(p));
    for (const r of rows) for (let j = 0; j < p; j++) mean[j] += r[j] / n;
    for (const r of rows) for (let j = 0; j < p; j++) for (let l = 0; l <= j; l++) cov[j][l] += (r[j] - mean[j]) * (r[l] - mean[l]);
    for (let j = 0; j < p; j++) { sd[j] = Math.sqrt(cov[j][j] / (n - 1)); if (!(sd[j] > 1e-12)) throw Error('完整样本中存在无变化评分'); }
    const corr = cov.map((r, j) => Float64Array.from(r, (v, l) => j >= l ? v / ((n - 1) * sd[j] * sd[l]) : 0));
    for (let j = 0; j < p; j++) for (let l = j + 1; l < p; l++) corr[j][l] = corr[l][j];
    return { n, p, mean, sd, corr };
  }
  function fit(s) {
    const k = s.p - 1, aug = Array.from({ length: k }, (_, j) => [...s.corr[j].slice(0, k), ...Array.from({ length: k }, (_, l) => Number(j === l))]);
    for (let j = 0; j < k; j++) {
      let pivot = j; for (let l = j + 1; l < k; l++) if (Math.abs(aug[l][j]) > Math.abs(aug[pivot][j])) pivot = l;
      [aug[j], aug[pivot]] = [aug[pivot], aug[j]]; const d = aug[j][j]; if (Math.abs(d) < 1e-10) throw Error('因素完全共线或接近完全共线');
      for (let l = 0; l < 2 * k; l++) aug[j][l] /= d;
      for (let i = 0; i < k; i++) if (i !== j) { const f = aug[i][j]; for (let l = 0; l < 2 * k; l++) aug[i][l] -= f * aug[j][l]; }
    }
    const inverse = aug.map(r => r.slice(k)), beta = inverse.map(r => r.reduce((v, a, j) => v + a * s.corr[j][k], 0));
    const r2 = beta.reduce((v, b, j) => v + b * s.corr[j][k], 0);
    if (!Number.isFinite(r2) || r2 < -1e-8 || r2 > 1 + 1e-8) throw Error('模型数值不稳定');
    return { beta, r2: Math.max(0, Math.min(1, r2)), inverse, vif: inverse.map((r, j) => r[j]), rawB: beta.map((b, j) => b * s.sd[k] / s.sd[j]) };
  }
  function subsetR2(s) {
    const k = s.p - 1; if (k < 1 || k > 12) throw Error('精确 LMG 单次支持 1–12 个因素，请减少变量或按问卷层级拆分。');
    const values = new Float64Array(1 << k);
    for (let mask = 1; mask < values.length; mask++) {
      const ids = []; for (let j = 0; j < k; j++) if (mask & 1 << j) ids.push(j);
      const q = ids.length, L = Array.from({ length: q }, () => new Float64Array(q)), z = new Float64Array(q);
      for (let i = 0; i < q; i++) {
        for (let j = 0; j <= i; j++) {
          let v = s.corr[ids[i]][ids[j]]; for (let l = 0; l < j; l++) v -= L[i][l] * L[j][l];
          if (i === j) { if (v < 1e-10) throw Error('因素完全共线，无法稳定分解解释力'); L[i][j] = Math.sqrt(v); }
          else L[i][j] = v / L[j][j];
        }
        let v = s.corr[ids[i]][k]; for (let j = 0; j < i; j++) v -= L[i][j] * z[j];
        z[i] = v / L[i][i];
      }
      values[mask] = Math.min(1, Math.max(0, z.reduce((v, x) => v + x * x, 0)));
    }
    return values;
  }
  function decomposeStats(s) {
    const k = s.p - 1, values = subsetR2(s), full = values.length - 1, r2 = values[full], raw = new Float64Array(k), choose = [1];
    for (let j = 1; j < k; j++) choose[j] = choose[j - 1] * (k - j) / j;
    for (let mask = 0; mask <= full; mask++) {
      let size = 0; for (let v = mask; v; v &= v - 1) size++;
      for (let j = 0; j < k; j++) if (!(mask & 1 << j)) {
        const delta = values[mask | 1 << j] - values[mask];
        if (delta < -1e-8) throw Error('子模型解释力不满足数值单调性');
        raw[j] += Math.max(0, delta) / (k * choose[size]);
      }
    }
    if (Math.abs(raw.reduce((a, b) => a + b, 0) - r2) > 1e-8) throw Error('LMG 分解未通过总和核验');
    return { r2, raw: [...raw], shares: [...raw].map(v => r2 > 1e-10 ? v / r2 : null) };
  }
  function decompose(rows) { return decomposeStats(stats(rows)); }
  function quantile(array, p) { const a = [...array].sort((x, y) => x - y), t = (a.length - 1) * p, i = Math.floor(t); return a[i] + (a[Math.ceil(t)] - a[i]) * (t - i); }
  function cv(rows, random) {
    const n = rows.length, k = rows[0].length - 1, result = [], ymean = rows.reduce((v, r) => v + r[k] / n, 0), tss = rows.reduce((v, r) => v + (r[k] - ymean) ** 2, 0);
    for (let repeat = 0; repeat < 10; repeat++) {
      const ids = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      let sse = 0, good = true;
      for (let fold = 0; fold < 5; fold++) {
        const train = [], test = []; ids.forEach((id, j) => (j % 5 === fold ? test : train).push(rows[id]));
        try { if (train.length <= k + 1) throw Error('验证折样本不足'); const s = stats(train), f = fit(s); for (const row of test) { const pred = s.mean[k] + f.rawB.reduce((v, b, j) => v + b * (row[j] - s.mean[j]), 0); sse += (row[k] - pred) ** 2; } }
        catch (_) { good = false; }
      }
      if (good) result.push(1 - sse / tss);
    }
    return { repeats: result.length, mean: result.length ? result.reduce((a, b) => a + b, 0) / result.length : null, min: result.length ? Math.min(...result) : null, max: result.length ? Math.max(...result) : null };
  }
  function analyze(rows, fields, context = {}, options = {}) {
    const k = fields.length - 1, total = context.total ?? rows.length, B = options.bootstrap ?? 500, reasons = [...(context.issues || [])];
    const complete = rows.filter(r => r.length === k + 1 && r.every(v => C.numeric(v) !== null && !(context.extraMissing || []).includes(Number(v)))).map(r => r.map(Number));
    const n = complete.length, out = { version: VERSION, method: '标准化 β 绝对值占比', weightMethod: 'beta-abs', id: context.id || 'single', label: context.label || '当前变量模型', platform: context.platform || '全部样本', experience: context.experience || '当前变量', kind: context.kind || 'single', filters: context.filters || [], note: context.note || '', total, n, excluded: total - n, k, y: fields[k]?.id, fieldIds: fields.map(f => f.id), hasWeights: false, formalWeights: false, lmgFormalWeights: false, status: '无法估计权重', reasons, lmgReasons: [], r2: null, cv: null, maxVif: null, intercept: null, bootstrap: { requested: B, valid: 0, maxWidth: null, lmgMaxWidth: null, intervalsAvailable: false }, rules: RULES,
      results: fields.slice(0, k).map(f => ({ id: f.id, name: f.label || f.id, rawB: null, rawBLow: null, rawBHigh: null, beta: null, betaLow: null, betaHigh: null, sign: '未估计', direction: '方向未明确', mean: null, weight: null, weightLow: null, weightHigh: null, firstRate: null, lmg: null, lmgWeight: null, lmgWeightLow: null, lmgWeightHigh: null, lmgFirstRate: null })) };
    if (k < 1 || k > 12) reasons.push('本页双方法对照单次支持 1–12 个因素，请按问卷层级拆分。');
    if (n <= k + 1) reasons.push(`完整样本 ${n} 人，不足以估计 ${k} 个因素。`);
    if (n < Math.max(RULES.minN, RULES.casesPerFactor * k)) reasons.push(`完整样本 ${n} 人，低于本页可靠性门槛 ${Math.max(RULES.minN, RULES.casesPerFactor * k)} 人。`);
    if (n / Math.max(1, total) < RULES.minRetention) reasons.push('完整样本保留率不足 80%，不能直接代表全样本，需核对跳题和适用人群。');
    out.results.forEach((r, j) => { r.mean = n ? complete.reduce((v, row) => v + row[j] / n, 0) : null; });
    if (n <= k + 1 || k < 1 || k > 12) { out.lmgReasons = [...reasons]; return out; }
    let s, f;
    try { s = stats(complete); f = fit(s); } catch (error) { reasons.push(error.message); out.lmgReasons = [...reasons]; return out; }
    out.r2 = f.r2; out.maxVif = Math.max(...f.vif); out.df = n - k - 1;
    out.intercept = s.mean[k] - f.rawB.reduce((v, b, j) => v + b * s.mean[j], 0);
    const betaTotal = f.beta.reduce((v, b) => v + Math.abs(b), 0);
    out.results.forEach((r, j) => { r.rawB = f.rawB[j]; r.beta = f.beta[j]; r.sign = f.beta[j] > 0 ? '正向' : f.beta[j] < 0 ? '负向' : '零'; r.mean = s.mean[j]; r.vif = f.vif[j]; });
    if (out.maxVif >= RULES.maxVif) reasons.push(`评分高度相关，最大 VIF=${out.maxVif.toFixed(2)}，超过本页门槛 5。`);
    if (f.r2 <= 1e-8) reasons.push('模型解释力接近 0，无法形成有意义的权重。');
    let maxCook = 0;
    if (1 - f.r2 > 1e-10) for (const row of complete) {
      const z = row.slice(0, k).map((v, j) => (v - s.mean[j]) / s.sd[j]);
      const h = 1 / n + z.reduce((v, a, j) => v + a * f.inverse[j].reduce((v, b, l) => v + b * z[l], 0), 0) / (n - 1);
      const e = (row[k] - s.mean[k]) / s.sd[k] - z.reduce((v, a, j) => v + a * f.beta[j], 0);
      maxCook = Math.max(maxCook, e * e / ((k + 1) * (1 - f.r2) * (n - 1) / out.df) * h / Math.max(1e-12, (1 - h) ** 2));
    }
    out.maxCook = maxCook;
    if (maxCook > RULES.maxCook) reasons.push(`存在强影响样本（最大 Cook 距离 ${maxCook.toFixed(2)}），需先核对敏感性。`);
    if (!(betaTotal > 1e-10) || f.r2 <= 1e-8) { out.lmgReasons = [...reasons]; return out; }
    let decomposition;
    try { decomposition = decomposeStats(s); } catch (error) { reasons.push(error.message); out.lmgReasons = [...reasons]; return out; }
    // Both methods use exactly the same complete rows. A diagnostic warning does
    // not erase an estimable point estimate; it changes its publication status.
    out.hasWeights = true;
    out.results.forEach((r, j) => { r.weight = Math.abs(r.beta) / betaTotal; r.lmgWeight = decomposition.shares[j]; r.lmg = decomposition.raw[j]; });
    const random = rng(options.seed ?? hash(`${out.id}:${n}:${fields.map(f => f.id).join(',')}`));
    options.progress?.({ phase: 'validation', current: 0, total: B });
    out.cv = cv(complete, random);
    if (out.cv.repeats < 10 || out.cv.mean === null || out.cv.mean < RULES.minCv) reasons.push('重复交叉验证解释力不足（要求 10 次成功且平均 R²≥0.20）。');
    if (out.cv.mean !== null && f.r2 - out.cv.mean > RULES.maxOptimism) reasons.push('训练与交叉验证 R² 相差超过 0.15，存在过拟合迹象。');
    const shares = [], lmgShares = [], betas = [], rawBs = [], first = new Array(k).fill(0), lmgFirst = new Array(k).fill(0);
    for (let b = 0; b < B; b++) {
      const sample = Array.from({ length: n }, () => complete[Math.floor(random() * n)]);
      try {
        const bs = stats(sample), bf = fit(bs), bw = decomposeStats(bs), totalBeta = bf.beta.reduce((v, b) => v + Math.abs(b), 0);
        if (bw.r2 > 1e-8 && totalBeta > 1e-10) {
          const weights = bf.beta.map(b => Math.abs(b) / totalBeta);
          shares.push(weights); lmgShares.push(bw.shares); betas.push(bf.beta); rawBs.push(bf.rawB);
          first[weights.indexOf(Math.max(...weights))]++; lmgFirst[bw.shares.indexOf(Math.max(...bw.shares))]++;
        }
      } catch (_) { /* Singular/constant resamples are counted as failures, never imputed. */ }
      if (b % 25 === 0) options.progress?.({ phase: 'bootstrap', current: b + 1, total: B });
    }
    const valid = shares.length;
    out.bootstrap.valid = valid;
    const intervalsAvailable = B >= RULES.minBootstrap && valid >= Math.max(RULES.minBootstrap, RULES.minBootstrapSuccess * B);
    out.bootstrap.intervalsAvailable = intervalsAvailable;
    if (!intervalsAvailable) reasons.push('成功的自助抽样次数不足，仅显示点估计，不报告区间或首位概率。');
    if (intervalsAvailable) {
      out.results.forEach((r, j) => {
        r.weightLow = quantile(shares.map(r => r[j]), .025); r.weightHigh = quantile(shares.map(r => r[j]), .975); r.firstRate = first[j] / valid;
        r.lmgWeightLow = quantile(lmgShares.map(r => r[j]), .025); r.lmgWeightHigh = quantile(lmgShares.map(r => r[j]), .975); r.lmgFirstRate = lmgFirst[j] / valid;
        r.rawBLow = quantile(rawBs.map(r => r[j]), .025); r.rawBHigh = quantile(rawBs.map(r => r[j]), .975);
        r.betaLow = quantile(betas.map(r => r[j]), .025); r.betaHigh = quantile(betas.map(r => r[j]), .975);
        r.direction = r.betaLow > 0 ? '正向关联' : r.betaHigh < 0 ? '负向关联' : '方向未明确';
      });
      out.bootstrap.maxWidth = Math.max(...out.results.map(r => r.weightHigh - r.weightLow));
      out.bootstrap.lmgMaxWidth = Math.max(...out.results.map(r => r.lmgWeightHigh - r.lmgWeightLow));
    }
    out.lmgReasons = [...reasons];
    if (out.bootstrap.maxWidth > RULES.maxWeightWidth) reasons.push('β 绝对值权重的 95% 自助区间过宽（超过 30 个百分点）。');
    if (out.bootstrap.lmgMaxWidth > RULES.maxWeightWidth) out.lmgReasons.push('LMG 权重的 95% 自助区间过宽（超过 30 个百分点）。');
    out.formalWeights = reasons.length === 0; out.lmgFormalWeights = out.lmgReasons.length === 0;
    out.status = out.formalWeights ? '可输出组内权重' : '探索性结果';
    out.results.sort((a, b) => b.weight - a.weight);
    out.rankStable = intervalsAvailable && out.results[0].firstRate >= .7;
    return out;
  }
  function matchQuestionnaire(dataset) {
    const fs = dataset?.fields || [], find = id => fs.find(f => f.id === id);
    if (find('Q12__1')?.scoreKind !== 'nps' || !INDICATORS.every(([id, , re]) => find(id)?.eligible && find(id).scoreKind === 'rating' && re.test(find(id).label))) return false;
    if (!['Q6', 'Q11', ...EXPERIENCES.map(e => e[0])].every(id => find(id))) return false;
    return PLATFORMS.every((name, i) => find('Q6').valueLabels.some(v => Number(v.value) === i + 1 && v.label.includes(name))) && EXPERIENCES.every(([id, label]) => find(id).label.includes(label) && find(id).valueLabels.some(v => Number(v.value) === 1 && v.label === '是') && find(id).valueLabels.some(v => Number(v.value) === 0 && v.label === '否')) && find('Q11').valueLabels.some(v => Number(v.value) === 2 && /不是会员/.test(v.label));
  }
  function questionnaireJobs(dataset) {
    if (!matchQuestionnaire(dataset)) throw Error('当前字段未匹配电商 NPS 0525 问卷，请确认题号、题干及平台/体验值标签。');
    const jobs = [], order = ids => INDICATORS.map(x => x[0]).filter(id => ids.includes(id));
    jobs.push({ id: 'all-secondary', label: '全部样本 · 完整11项二级指标', platform: '全部样本', experience: '完整11项二级指标', kind: 'overall', y: 'Q12__1', xs: INDICATORS.map(x => x[0]), filters: [],
      note: '完整展示问卷11项二级指标，权重在同一批11项均有回答的样本上计算，不拼接其他组权重。各题有跳题，完整样本可能很少；结果仅适用于该完整回答人群，不能代表全部导入样本。' });
    for (let p = 1; p <= 4; p++) {
      const platform = PLATFORMS[p - 1], filters = [{ field: 'Q6', values: [p] }], base = ['A1__1', 'Q19__1', 'Q38__1', ...(p === 1 ? ['Q16__1'] : []), ...(p <= 2 ? ['Q35__1'] : [])];
      const add = (key, experience, xs, extra = [], note = '', issues = []) => jobs.push({ id: `${p}-${key}`, label: `${platform} · ${experience}`, platform, experience, kind: key === 'base' ? 'platform' : key === 'member' ? 'membership' : key === 'joint' ? 'diagnostic' : 'experience', y: 'Q12__1', xs: order(xs), filters: [...filters, ...extra], note, issues: [...new Set([...issues, ...(p > 2 && xs.includes('Q49__1') ? ['问卷 F617 的会员题平台范围与 I617、SAV 不一致，本组口径待核实。'] : [])])] });
      add('base', '平台基础', base, [], '平台基础评分：宣传、展示、价格；商城增加交互与保障，天猫增加保障。');
      for (const [field, label] of EXPERIENCES) {
        const extra = field === 'Q7__2' ? ['Q25__1', 'Q42__1', ...(p === 1 ? ['Q40__1'] : [])] : field === 'Q7__3' ? ['Q30__1'] : field === 'Q7__4' ? ['Q25__1'] : field === 'Q7__5' ? ['Q45__1'] : [];
        add(field, label, [...base, ...extra], [{ field, values: [1] }], field === 'Q7__7' ? '问卷没有独立直播二级评分，本组分析平台基础评分。' : '仅纳入该平台、该实际体验适用的二级评分。');
      }
      add('member', '会员服务知晓者', [...base, 'Q49__1'], [{ field: 'Q11', values: [1, 2] }], '包括当前会员与知晓但未入会者。', p > 2 ? ['问卷 F617 的会员题平台范围与 I617、SAV 不一致，本组口径待核实。'] : []);
      const available = INDICATORS.filter(([id]) => dataset.rows.some(r => Number(r.Q6) === p && C.numeric(r[id]) !== null)).map(x => x[0]);
      add('joint', '全部适用指标联合诊断', available, [], '完整样本诊断：同时要求不同体验均有评分，不能自动代表整个平台。');
    }
    return jobs;
  }
  function runJob(dataset, job, extraMissing = [], options = {}) {
    const rows = dataset.rows.filter(row => (job.filters || []).every(f => f.values.includes(C.numeric(row[f.field]))));
    const ids = [...job.xs, job.y], fields = ids.map(id => dataset.fields.find(f => f.id === id));
    if (fields.some(f => !f?.eligible)) throw Error('模型包含不适用的评分字段，请重新选择。');
    return analyze(rows.map(row => ids.map(id => C.numeric(row[id]))), fields, { ...job, total: rows.length, extraMissing }, options);
  }
  const api = { VERSION, RULES, INDICATORS: INDICATORS.map(([id, name]) => ({ id, name })), decompose, analyze, runJob, matchQuestionnaire, questionnaireJobs };
  root.DriverLMG = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
