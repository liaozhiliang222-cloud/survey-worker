// Shared deterministic brief contract. No raw respondent rows or model arithmetic.
const object = value => { if (value && typeof value === 'object') return value; try { return JSON.parse(value || '{}'); } catch { return {}; } };
const cell = value => String(value ?? '未提供').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/</g, '&lt;');
const value = number => number == null || number === '' ? '未提供' : cell(number);
export const TOTAL_BANNER = '__surveykit_total__';

export function analysisSource(dataset) {
  const metadata = object(dataset.metadata);
  return { dataset_id: dataset.id, dataset_type: dataset.type, dataset_name: dataset.name,
    parent_dataset_id: dataset.parent_dataset_id || null, source_version: metadata.source_version || null,
    sample_count: dataset.row_count, weighted: dataset.type === 'weighted',
    weight_field: dataset.type === 'weighted' ? '__weight' : null,
    missing_policy: metadata.schema_version === 1 ? '按题剔除空白及已声明的用户缺失值，保留真实 0；分组统计同时要求分组有效。多选按编码子题分别统计，不合并为受访者净值。' : '旧版数据缺失规则未记录，请复核或重新导入分析。',
    significance_note: dataset.type === 'weighted' ? '仅加权描述统计，未执行复杂抽样设计校正检验。' : '检验仅以确定性结果中的显著性标识为准；小样本需复核。' };
}

export function analysisCoverage(fields, selected, results, exclusions = []) {
  return fields.map(field => {
    const excluded = exclusions.find(item => item.variable === field);
    const items = results.filter(item => item.variable === field);
    return { variable: field, selected: selected.includes(field), status: excluded ? 'excluded' : items.length ? 'included' : selected.includes(field) ? 'missing' : 'excluded',
      reason: excluded?.reason || (items.length ? '' : selected.includes(field) ? '尚无计算结果' : field === '__weight' ? '权重字段，不作为题目' : '本次未选择（分群/背景或人工排除）') };
  });
}

function coverageText(coverage) {
  const selected = coverage.filter(item => item.selected);
  return [`已选 ${selected.length} 题，已计算 ${selected.filter(item => item.status === 'included').length} 题。排除或未完成项不计为已覆盖。`,
    '| 字段 | 状态 | 原因 |', '| --- | --- | --- |',
    ...coverage.map(item => `| ${cell(item.variable)} | ${{included:'已纳入',excluded:'已排除',missing:'未完成'}[item.status]} | ${cell(item.reason || '—')} |`)];
}

export function buildAnalysisBrief({ dataset, analyses, project = {}, resultId = '' }) {
  const records = analyses.filter(item => item.dataset_id === dataset.id && item.type === 'crosstab' && (!resultId || item.id === resultId));
  if (!records.length) throw new Error('当前版本没有可用分析结果，请先计算所选题目。');
  const seen = new Set(), results = [], usedIds = [], exclusions = [];
  for (const record of records) {
    const full = object(record.result);
    if (Boolean(full.weighted) !== (dataset.type === 'weighted')) throw new Error('结果加权口径与当前版本不一致，请重新计算。');
    for (const item of full.results || []) {
      const key = JSON.stringify([item.variable, item.banner]);
      if (seen.has(key)) continue;
      seen.add(key); results.push({ ...item, result_id: record.id });
      if (!usedIds.includes(record.id)) usedIds.push(record.id);
    }
    exclusions.push(...(full.coverage || []).filter(item => item.status === 'excluded' && item.selected));
  }
  if (!results.length) throw new Error('尚无可写入简报的有效结果。');
  const fields = object(dataset.metadata).fields || [];
  const selected = [...new Set(records.flatMap(item => object(item.input).variables || object(item.result).variables || []))];
  const coverage = analysisCoverage(fields, selected, results, exclusions.filter(item => !results.some(row => row.variable === item.variable)));
  const source = analysisSource(dataset);
  const title = `${project.title || dataset.name || '研究项目'} · 分析简报`;
  const lines = [`# ${cell(title)}`, '', `研究目标：${cell(project.research_goal || project.brief || '未填写')}`, '', '## 来源与统计口径',
    `数据版本：${cell(dataset.name)} / ${cell(dataset.type)} / ${cell(dataset.id)}；总样本 ${value(dataset.row_count)}。`,
    `来源版本：${cell(dataset.parent_dataset_id || '原始版本')}；文件指纹：${cell(source.source_version?.sha256 || '未记录')}。`,
    source.weighted ? '口径：已加权。人数、原始 base 和加权 base 分列。' : '口径：未加权。', source.missing_policy, source.significance_note,
    '', '## 题目覆盖清单', ...coverageText(coverage), '', '## 数据事实'];
  for (const item of results) {
    lines.push('', `### ${cell(item.variable)} × ${item.banner === TOTAL_BANNER ? '总体' : cell(item.banner)}`,
      `Evidence: ${item.result_id} | 数据集 ${cell(dataset.id)}；指标 ${cell(item.metric)}；有效 base ${value(item.base)}${source.weighted ? `；加权 base ${value(item.weighted_base)}` : ''}。`);
    if (item.metric === 'distribution') {
      const ranked = (item.categories || []).flatMap(category => (category.groups || []).map(group => ({...group,category:category.category}))).filter(group => Number.isFinite(group.percent)).sort((a,b)=>b.percent-a.percent);
      if (ranked[0]) { const top=ranked[0];lines.push(`描述性发现：${cell(top.segment)}中，${cell(top.category)}的列百分比为 ${value(top.percent)}%，有效原始 base 为 ${value(top.raw_base ?? top.base)}。此句仅描述本次统计，不推断原因。`); }
      lines.push('| 选项 | 分群条件 | 原始人数 | 原始 base | 加权人数 | 加权 base | 列百分比 |', '| --- | --- | --- | --- | --- | --- | --- |');
      for (const category of item.categories || []) for (const group of category.groups || []) lines.push(`| ${cell(category.category)} | ${cell(group.segment)} | ${value(group.raw_count ?? group.count)} | ${value(group.raw_base ?? group.base)} | ${source.weighted ? value(group.weighted_count) : '不适用'} | ${source.weighted ? value(group.weighted_base) : '不适用'} | ${value(group.percent)}% |`);
    } else {
      lines.push(`总体 ${cell(item.metric)}：${value(item.overall)}。`, '| 分群条件 | 数值 | 有效 base | 加权 base | 与总体差值 |', '| --- | --- | --- | --- | --- |');
      for (const group of item.groups || []) lines.push(`| ${cell(group.segment)} | ${value(group.value)} | ${value(group.base)} | ${source.weighted ? value(group.weighted_base) : '不适用'} | ${value(group.delta_vs_total)} |`);
    }
  }
  lines.push('', '## 解读与待验证事项', '以上为确定性统计事实简报。原因、因果和行动效果尚未验证；可基于此成果请 AI 研究员进一步解读。',
    `<!-- surveykit-analysis-source: ${JSON.stringify({ dataset_id: dataset.id, result_ids: usedIds })} -->`);
  return { title, content: lines.join('\n'), source, coverage, result_ids: usedIds };
}

export function buildCrosstabBrief(context, { title = '交叉表分析简报', source = '', totalQuestions = null, questionCatalog = [], sourceVersion = '' } = {}) {
  const questions = new Map();
  for (const page of context.pages || []) for (const question of page.questions || []) {
    const key = question.code || question.question_id || question.title;
    if (!key) continue;
    if (!questions.has(key)) questions.set(key, { ...question, rows: [], facts: [] });
    const merged = questions.get(key);
    merged.base = {...merged.base,...question.base};
    // A question can occur on multiple pages with different segments. Keep all distinct evidence.
    for (const row of question.rows || []) if (!merged.rows.some(old => JSON.stringify(old) === JSON.stringify(row))) merged.rows.push(row);
    for (const fact of question.facts || []) if (!merged.facts.some(old => JSON.stringify(old) === JSON.stringify(fact))) merged.facts.push(fact);
  }
  if (!questions.size) throw new Error('当前报告结构没有可用题目证据，请先预览报告结构。');
  const lines = [`# ${cell(title)}`, '', '## 来源与覆盖', `来源：${cell(source || context.source || '外部交叉表')}；报告 ${cell(context.report_id || '未记录')}。`,
    `当前报告结构包含 ${questions.size} 题；其中 ${(Array.from(questions.values()).filter(q => q.rows.length || q.facts.length)).length} 题有数值证据；导入识别题量：${value(totalQuestions)}。未在当前结构中的题目未纳入本简报。`,
    `文件版本 SHA-256：${cell(sourceVersion || '未记录')}。`,
    '这是外部汇总交叉表，保留来源数值与 base；原始人数、加权状态及缺失规则未提供时不推算，不执行样本级检验。', '', '## 数据事实'];
  const excluded = questionCatalog.filter(q => !questions.has(q.code || q.question_id || q.title));
  if (excluded.length) lines.push('当前结构排除题目：', ...excluded.map(q=>`- ${cell(q.code || q.question_id)} ${cell(q.title || '')}：当前报告结构未包含该题，请在题目清单中复核。`));
  for (const [id, question] of questions) {
    lines.push('', `### ${cell(id)} ${cell(question.title || '')}`, `题目证据：${cell(id)}；指标类型：${cell(question.data_kind || '源表未标注')}；base：${cell(JSON.stringify(question.base || {}))}`,
      '| 选项 | 人群列 | 来源数值 |', '| --- | --- | --- |');
    for (const row of question.rows) for (const [segment, number] of Object.entries(row.values || {})) lines.push(`| ${cell(row.option)} | ${cell(segment)} | ${value(number)} |`);
    for (const fact of question.facts) lines.push(`- DataFact ${cell(fact.fact_id || '未提供 ID')}：${cell(fact.metric_name || fact.fact_type || '')}；${cell(fact.segment || '')} ${cell(fact.category || '')}；数值 ${value(fact.value)}；单位 ${cell(fact.unit || fact.value_type || '以源表为准')}；base ${value(fact.base)}。`);
    for (const warning of question.data_quality_warnings || []) lines.push(`数据质量提示：${cell(typeof warning === 'string' ? warning : JSON.stringify(warning))}`);
    if (!question.rows.length && !question.facts.length) lines.push('该题缺少可用数值，仅列入覆盖清单，尚未形成分析事实。');
  }
  lines.push('', '## 待验证事项', '本简报不将差异解释为因果；来源未提供的样本级数据和检验不可据此推断。');
  return { title, content: lines.join('\n'), question_count: questions.size };
}
