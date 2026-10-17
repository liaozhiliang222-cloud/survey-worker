(function (root) {
  'use strict';
  const LIMIT_CELLS = 5_000_000;
  function numeric(value) {
    if (value === null || value === undefined || value instanceof Date || typeof value === 'boolean' || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function isMissing(value, spec = {}) {
    if (value === null || value === undefined || String(value).trim() === '') return true;
    const n = numeric(value);
    if (spec.kind === 'strings') return (spec.values || []).includes(String(value).trim());
    if (spec.kind === 'discrete') return n !== null && (spec.values || []).includes(n);
    return n !== null && ((['range', 'range+discrete'].includes(spec.kind) && n >= spec.lo && n <= spec.hi) || (spec.kind === 'range+discrete' && n === spec.value));
  }
  function parseDelimited(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const first = source.split(/\r?\n/, 1)[0];
    const delimiter = first.includes('\t') ? '\t' : ',';
    const matrix = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i <= source.length; i++) {
      const ch = source[i];
      if (ch === '"' && quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (!quoted && (ch === delimiter || ch === '\n' || ch === undefined)) {
        row.push(cell.trim()); cell = '';
        if (ch !== delimiter) { if (row.some(v => v !== '')) matrix.push(row); row = []; }
      } else if (ch !== '\r' || quoted) cell += ch;
    }
    if (quoted) throw Error('表格引号不完整，请检查 CSV 文件。');
    if (matrix.length < 2) throw Error('请提供字段名和样本明细，每行一位受访者。');
    if (matrix[0].every(v => numeric(v) !== null)) throw Error('第一行应为字段名，请上传每行一位受访者的明细数据。');
    return { name: 'Data', headers: matrix[0], rows: matrix.slice(1) };
  }
  function npsQuestion(text) {
    return /(?:^|[^a-z])nps(?:$|[^a-z])|意愿.{0,12}推荐|推荐.{0,12}意愿|多大.{0,20}推荐|推荐.{0,8}可能性|可能性.{0,12}推荐|likely.{0,20}recommend|likelihood.{0,20}recommend/i.test(text);
  }
  function scoreEvidence({ id, label, type, min, max, unique, valueLabels }) {
    if (type !== 'numeric' || unique < 2) return null;
    const title = `${id} ${label}`.normalize('NFKC');
    if (/nps[_ -]?(?:group|segment|type|category)|NPS.{0,4}(?:分组|分类|类型)|推荐意愿.{0,4}(?:分组|分类|类型)/i.test(title)) return null;
    const categoryLabels = /批评者|贬损者|被动者|中立者|推荐者|promoter|detractor|passive/i;
    if (valueLabels.some(v => categoryLabels.test(v.label)) && unique <= 3) return null;
    const range = title.match(/(\d+(?:\.\d+)?)\s*(?:分|点)?\s*(?:到|至|[-~～—–])\s*(\d+(?:\.\d+)?)\s*(?:分|点)/);
    const scoreWords = /打分|评分|分制|点量表|point.{0,10}scale|rating|score/i.test(title);
    const bounded = range && Number(range[2]) - Number(range[1]) >= 2 && min >= Number(range[1]) && max <= Number(range[2]);
    const binaryYesNo = unique <= 2 && valueLabels.length > 0 && valueLabels.every(v => /^(?:是|否|愿意|不愿意|yes|no)(?:$|[，,。.!！])/i.test(v.label));
    if (npsQuestion(title) && !binaryYesNo && (!(min === 0 && max === 1) || bounded) && min >= 0 && max <= 10 && (!range || (Number(range[1]) === 0 && Number(range[2]) === 10))) {
      return { kind: 'nps', basis: '题干为推荐意愿且原始分值在 0–10 分内' };
    }
    if (bounded && scoreWords) return { kind: 'rating', basis: '题干明确标注评分范围，原始取值与该范围一致' };
    if (scoreWords && /满意|评价|体验|rating|score/i.test(title) && min >= 0 && max <= 10 && unique >= 3 && !valueLabels.length) {
      return { kind: 'rating', basis: '题名明确为评分，原始数据为数值评分' };
    }
    const ordered = valueLabels.filter(v => numeric(v.value) !== null).sort((a, b) => Number(a.value) - Number(b.value));
    if (ordered.length >= 3 && ordered.length <= 11 && ordered.every((v, i) => !i || Number(v.value) === Number(ordered[i - 1].value) + 1) && ordered.every(v => /满意|同意|一般|中立|satisf|agree|neutral/i.test(v.label)) && min >= Number(ordered[0].value) && max <= Number(ordered.at(-1).value)) {
      return { kind: 'rating', basis: '值标签为按顺序编码的满意度或认同量表' };
    }
    return null;
  }
  function normalizeTable(table, fileName = '') {
    const variables = table.variables || table.fields || [];
    const sourceHeaders = table.headers || variables.map(v => v.name || v.id);
    if (!sourceHeaders.length || !table.rows?.length) throw Error('未识别到字段或样本，请选择包含样本明细的数据表。');
    if (sourceHeaders.length * table.rows.length > LIMIT_CELLS) throw Error('数据超过本页 500 万单元格上限，请减少字段或拆分样本后重试。');
    const seen = new Set(); const renamed = [];
    const headers = sourceHeaders.map((h, i) => {
      const base = String(h || `字段${i + 1}`).trim(); let name = base, suffix = 2;
      while (seen.has(name)) name = `${base}_${suffix++}`;
      seen.add(name); if (name !== base) renamed.push(`${base} → ${name}`); return name;
    });
    const rows = table.rows.map((r, index) => {
      if (Array.isArray(r) && r.slice(headers.length).some(v => v !== null && String(v ?? '').trim() !== '')) throw Error(`第 ${index + 2} 行的列数多于字段名，请检查分隔符或表头。`);
      return Object.fromEntries(headers.map((h, i) => {
        const v = Array.isArray(r) ? r[i] : r[sourceHeaders[i]];
        return [h, isMissing(v, variables[i]?.missing) ? null : v];
      }));
    });
    const fields = headers.map((id, i) => {
      const meta = variables[i] || {}; const values = new Set(); const examples = [];
      let valid = 0, numbers = 0, phoneValues = 0, min = Infinity, max = -Infinity;
      for (const row of rows) {
        const value = row[id]; if (isMissing(value)) continue;
        valid++; const n = numeric(value); if (n !== null) { numbers++; min = Math.min(min, n); max = Math.max(max, n); }
        if (/^(?:\+?86[- ]?)?1[3-9]\d{9}$/.test(String(value).trim())) phoneValues++;
        if (values.size < 10000) values.add(String(value));
        if (examples.length < 4 && !examples.some(v => String(v) === String(value))) examples.push(value);
      }
      const label = String(meta.label || meta.variableLabel || '').trim();
      const title = `${id} ${label}`;
      const contact = /手机号|手机号码|电话号码|联系电话|联系方式|\bphone\b|\bmobile\b|\bemail\b/i.test(title) || valid > 0 && phoneValues === valid;
      const identifier = contact || /^(id|rid|uuid|respondent_?id|resp_?id|sample_?id)$/i.test(id) || /受访者编号|样本编号|流水号|订单号|身份证|银行卡号|邮编/.test(title);
      const administrative = /^(weight|wgt|timestamp|duration|qc)$/i.test(id) || /样本权重|质控题|答题时长|提交时间|本行打\s*\d+\s*分|本题请选|注意力检测/.test(title);
      const date = meta.format?.isDate || examples.some(v => v instanceof Date);
      const type = date ? 'date' : meta.type !== 'string' && valid > 0 && numbers === valid ? 'numeric' : 'string';
      const valueLabels = meta.valueLabels || meta.value_labels || [];
      const score = scoreEvidence({ id, label, type, min, max, unique: values.size, valueLabels });
      const category = !score && (meta.measure === 'nominal' || /性别|所在城市|常住城市|居住城市|\bgender\b|\bcity\b/i.test(title));
      const reason = !valid ? '无有效回答' : date ? '日期字段' : type !== 'numeric' ? '文本字段' : contact ? '联系方式字段，不用于评分回归' : identifier ? '样本标识' : administrative ? '管理、质控或权重字段' : values.size < 2 ? '有效回答无变化' : category ? '类别字段，需先编码为适合模型的变量' : '';
      const candidateY = !reason && (score?.kind === 'nps' || /总体|整体|总满意|意愿|overall|satisfaction|\bnps\b|^y$/i.test(title));
      const measureNotice = score && meta.measure === 'nominal' && !reason ? '文件标记为类别，结合题干和原始分值识别为评分题' : '';
      return { id, label, type, measure: meta.measure || 'unknown', format: meta.format, scoreKind: score?.kind || '', scoreBasis: score?.basis || '', measureNotice, missing: meta.missing || { kind: 'none' }, valueLabels, valid, missingCount: rows.length - valid, unique: values.size, min: numbers ? min : null, max: numbers ? max : null, examples, eligible: !reason, reason, candidateY };
    });
    return { name: table.name || 'Data', fileName, headers, rows, fields, notices: renamed.length ? [`重复字段已自动区分：${renamed.join('；')}`] : [] };
  }
  function fieldTitle(field) { return field?.label && field.label !== field.id ? `${field.id} · ${field.label}` : field?.id || ''; }
  function variableGroup(field) {
    return field.id.match(/^(.+?)(?:_+|[.-])\d+$/)?.[1].replace(/_+$/, '') || '';
  }
  function candidateFields(dataset, role, selection = {}) {
    const fields = dataset?.fields || [], total = dataset?.rows.length || 1;
    const overall = f => /总体|整体|总评|总满意|overall|global|^y$/i.test(`${f.id} ${f.label}`.trim()) || /^y$/i.test(f.id);
    const intention = f => f.scoreKind === 'nps' || npsQuestion(`${f.id} ${f.label}`) || /购买意愿|购买可能性|购买倾向|purchase.{0,12}intention/i.test(`${f.id} ${f.label}`);
    const scores = f => Boolean(f.scoreKind) || /满意|评分|评价|体验|质量|服务|价格|便利|可靠|信任|satisf|rating|score|quality|value/i.test(`${f.id} ${f.label}`);
    const available = fields.filter(f => f.eligible && (role !== 'x' || f.id !== selection.y));
    const excluded = fields.filter(f => !f.eligible || (role === 'x' && f.id === selection.y));
    const coverage = f => f.missingCount / total <= .5;
    const binary = f => f.unique === 2 && f.min === 0 && f.max === 1;
    const namedTargets = available.filter(f => overall(f) || intention(f));
    let recommended, factorLevel = 'detail';
    if (role === 'y') {
      recommended = namedTargets.filter(coverage).map(f => ({ ...f, recommendationReason: f.scoreKind === 'nps' ? '推荐意愿评分（0–10 分），可作为 NPS 驱动分析目标' : overall(f) ? '题名包含总体或整体评价' : '题名包含推荐或意愿评分', rank: f.scoreKind === 'nps' ? 4 : overall(f) ? 3 : 2 }));
      if (!recommended.length) recommended = available.filter(f => coverage(f) && !binary(f)).map(f => ({ ...f, recommendationReason: '可用数值字段，请确认它是否为总体评价', rank: 1 }));
    } else {
      const plausible = available.filter(f => coverage(f) && !binary(f) && !overall(f) && !intention(f));
      const namedScores = plausible.filter(f => scores(f) || ['scale', 'ordinal'].includes(f.measure));
      recommended = (namedScores.length ? namedScores : plausible).map(f => ({ ...f, recommendationReason: scores(f) ? '题名包含体验或评分信息' : ['scale', 'ordinal'].includes(f.measure) ? '文件声明为量表或有序评分' : '可用数值字段，请确认其业务含义', rank: scores(f) ? 2 : 1 }));
      const target = fields.find(f => f.id === selection.y);
      if (target?.scoreKind === 'nps') {
        const groupCounts = new Map();
        available.filter(f => f.scoreKind === 'rating').forEach(f => {
          const group = variableGroup(f) || f.id;
          groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
        });
        // NPS is explained by module ratings first. Matrix items remain available
        // for a separate analysis within a module; low coverage can be routing.
        const dimensions = available.filter(f => f.scoreKind === 'rating' && !intention(f) && !binary(f) &&
          !/具体而言|以下方面|矩阵|\bmatrix\b/i.test(f.label) &&
          (overall(f) || groupCounts.get(variableGroup(f) || f.id) === 1));
        if (dimensions.length) {
          factorLevel = 'dimension';
          recommended = dimensions.map(f => ({ ...f, rank: 3, recommendationReason: '模块总体评分候选，请按问卷核对二级指标' + (!coverage(f) ? '；有效回答不足一半，请核对跳题和适用样本' : '') }));
        }
      }
    }
    recommended.sort((a, b) => b.rank - a.rank || a.missingCount - b.missingCount);
    return { recommended, available, excluded, factorLevel };
  }
  function missingCodes(text) {
    if (!String(text || '').trim()) return [];
    return String(text).split(/[,，\s]+/).filter(Boolean).map(v => {
      const n = numeric(v); if (n === null) throw Error(`缺失码“${v}”不是有效数字。`); return n;
    });
  }
  function prepare(dataset, selection, extraMissing = []) {
    const errors = [], warnings = []; const xs = [...new Set(selection.xs || [])], y = selection.y;
    if (!y) errors.push('请选择一个分析目标（因变量 Y）。');
    if (!xs.length) errors.push('请至少选择一个影响因素（自变量 X）。');
    if (xs.includes(y)) errors.push('同一字段不能同时作为因变量和自变量。');
    if (xs.length > 100) errors.push('单次最多选择 100 个自变量，请减少变量后分析。');
    const ids = [...xs, y].filter(Boolean), fields = ids.map(id => dataset?.fields.find(f => f.id === id));
    fields.forEach((f, i) => { if (!f || !f.eligible) errors.push(`${f ? fieldTitle(f) : ids[i]}：${f?.reason || '当前数据中不存在此字段'}。`); });
    if (errors.length) return { errors, warnings, n: 0, excluded: 0, total: dataset?.rows.length || 0 };
    const rows = [];
    for (const row of dataset.rows) {
      const values = ids.map(id => numeric(row[id]));
      if (values.every(v => v !== null && !extraMissing.includes(v))) rows.push(values);
    }
    const n = rows.length, k = xs.length;
    if (n <= k + 1) errors.push(`完整样本仅 ${n} 个，无法估计 ${k} 个因素；请减少变量或补充有效样本。`);
    fields.forEach((f, j) => {
      if (n && rows.every(r => r[j] === rows[0][j])) errors.push(`${fieldTitle(f)} 在本次有效样本中没有变化，请移除或更换。`);
      if (f.missingCount / dataset.rows.length > .2) warnings.push(`${f.id} 的缺失比例超过 20%，请核对问卷跳题和适用样本。`);
    });
    if (n > k + 1 && n < Math.max(30, 10 * k)) warnings.unshift(`完整样本 ${n} 个，相对 ${k} 个因素偏少，请核对结果稳定性。`);
    if (n > k + 1 && n / dataset.rows.length < .2) warnings.unshift(`所选变量同时有效的样本仅占导入样本的 ${(100 * n / dataset.rows.length).toFixed(1)}%，结果仅适用于这部分样本，不能直接代表全样本。请核对问卷跳题，未经历的服务不应按 0 分补齐。`);
    if (!errors.length) {
      try {
        const fit = analyze({ headers: fields.map(fieldTitle), rows, dvIndex: k });
        if (fit.maxVif > 10) warnings.push('存在高度相关的自变量（VIF > 10），请核对是否保留重复题项。');
      } catch (error) { errors.push(error.message); }
    }
    return { errors, warnings, n, excluded: dataset.rows.length - n, total: dataset.rows.length, data: { headers: fields.map(fieldTitle), rows, dvIndex: k, fieldIds: ids } };
  }
  function analyze(data) {
    const { headers, rows, dvIndex } = data; const n = rows.length;
    const indexes = headers.map((_, i) => i).filter(i => i !== dvIndex), k = indexes.length;
    if (!k || n <= k + 1) throw Error('有效样本不足，无法估计当前模型。');
    if (rows.some(r => r.length !== headers.length || r.some(v => numeric(v) === null))) throw Error('模型中存在无效数值，请检查所选字段。');
    const means = headers.map((_, j) => rows.reduce((s, r) => s + r[j], 0) / n);
    const sd = headers.map((_, j) => Math.sqrt(rows.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / (n - 1)));
    if (sd.some(v => !v || !Number.isFinite(v))) throw Error('所选变量无变化或取值超出可计算范围，请检查并更换。');
    const x = rows.map(r => indexes.map(j => (r[j] - means[j]) / sd[j])), y = rows.map(r => (r[dvIndex] - means[dvIndex]) / sd[dvIndex]);
    const xtx = indexes.map((_, j) => indexes.map((_, l) => x.reduce((s, r) => s + r[j] * r[l], 0)));
    const xty = indexes.map((_, j) => x.reduce((s, r, i) => s + r[j] * y[i], 0));
    const aug = xtx.map((r, i) => [...r, ...indexes.map((_, j) => i === j ? 1 : 0)]);
    for (let col = 0; col < k; col++) {
      let pivotRow = col;
      for (let row = col + 1; row < k; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[pivotRow][col])) pivotRow = row;
      [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
      const pivot = aug[col][col];
      if (Math.abs(pivot) < 1e-9 * (n - 1)) throw Error('所选因素完全共线，无法估计独立影响，请移除重复或线性组合字段。');
      for (let j = 0; j < 2 * k; j++) aug[col][j] /= pivot;
      for (let row = 0; row < k; row++) {
        if (row === col) continue; const factor = aug[row][col];
        for (let j = 0; j < 2 * k; j++) aug[row][j] -= factor * aug[col][j];
      }
    }
    const inverse = aug.map(r => r.slice(k));
    const beta = inverse.map(r => r.reduce((s, v, j) => s + v * xty[j], 0));
    const ssRes = y.reduce((s, v, i) => s + (v - x[i].reduce((sum, a, j) => sum + a * beta[j], 0)) ** 2, 0);
    const r2 = 1 - ssRes / (n - 1); const total = beta.reduce((s, v) => s + Math.abs(v), 0);
    const results = indexes.map((j, i) => ({ name: headers[j], beta: beta[i], importance: total > 1e-12 ? Math.abs(beta[i]) / total : 0, mean: means[j] })).sort((a, b) => b.importance - a.importance);
    if (![r2, ...beta].every(Number.isFinite)) throw Error('模型无法稳定估计，请检查字段取值与相关性。');
    return { results, r2, n, k, dvName: headers[dvIndex], ivMeans: indexes.map(j => means[j]), maxVif: Math.max(...inverse.map((r, i) => r[i] * (n - 1))) };
  }
  const api = { numeric, isMissing, parseDelimited, normalizeTable, fieldTitle, variableGroup, candidateFields, missingCodes, prepare, analyze };
  root.DriverCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
