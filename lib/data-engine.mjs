import { datasetExplanation } from "./research-readiness.mjs";
import { datasetMetadata, derivedPayload } from "./dataset-metadata.mjs";
import { ToolInputError } from "./tools/errors.mjs";
import { parseDatasetFile } from "./project-file-parser.mjs";
import { buildCrosstab, columnProportionPostHoc, computeColumnPercents, cramersV, effectSizeLabel, significanceLevel } from "./crosstab-engine.mjs";
import { buildCrosstabWorkbook } from "./data-excel.mjs";
import { calculateRimWeights as calculateTypedRimWeights, normalizeWeightTargets as normalizeTypedWeightTargets, weightedMean as typedWeightedMean, weightedNps as typedWeightedNps } from "./data-weighting.mjs";
import { finiteDataNumber as finite } from "./data-values.mjs";

const LOW_RISK_RULES = new Set(["blank_row", "exact_duplicate"]);
const DATASET_TYPES = new Set(["raw", "cleaned", "weighted"]);
const DETAILED_PROFILE_CELL_LIMIT = 500_000;
const WIDE_PROFILE_FREQUENCY_CARDINALITY_LIMIT = 128;

function parsed(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}
function text(value) { return String(value ?? "").trim(); }
function rounded(value, digits = 4) { return Number(Number(value || 0).toFixed(digits)); }
function unique(values) { return [...new Set(values)]; }
function fieldValues(rows, field) { return rows.map((row) => text(row[field])); }
function percentile(sorted, proportion) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * proportion; const lower = Math.floor(index); const fraction = index - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}
function frequency(values, limit = 10) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit).map(([value, count]) => ({ value, count }));
}
function datasetStorageKey(dataset) { return text(dataset.storage_key || dataset.storage_path); }
function fileStorageKey(file) { return text(file.storage_key || file.storage_path); }
function asArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  throw Object.assign(new Error("DATASET_BYTES_INVALID"), { code: "DATASET_BYTES_INVALID" });
}

export function publicDataset(dataset) {
  if (!dataset) return null;
  const { user_id, storage_key, storage_path, ...safe } = dataset;
  return { ...safe, metadata: parsed(safe.metadata, {}), explanation: datasetExplanation(dataset) };
}

export async function loadDatasetTable({ store, fileStorage, projectId, dataset }) {
  if (!dataset || dataset.project_id !== projectId) throw new ToolInputError("数据集不存在。", "DATASET_NOT_FOUND");
  if (dataset.status !== "ready") throw new ToolInputError("数据集尚未准备完成。", "DATASET_NOT_READY");
  if (dataset.type === "raw") {
    const file = await store.getFile(projectId, dataset.source_file_id);
    if (!file || !["xlsx", "csv", "sav"].includes(file.file_type)) throw new ToolInputError("原始数据文件不存在或格式不受支持。", "DATASET_SOURCE_UNAVAILABLE");
    const bytes = await fileStorage.get(fileStorageKey(file));
    const expectedHash = parsed(dataset.metadata).source_version?.sha256;
    if (expectedHash) {
      const digest = await crypto.subtle.digest('SHA-256', asArrayBuffer(bytes));
      const actualHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      if (actualHash !== expectedHash) throw new ToolInputError('原始文件内容与登记版本不一致，请上传为新的数据版本。', 'DATASET_SOURCE_CHANGED');
    }
    const workbook = await parseDatasetFile(asArrayBuffer(bytes), { extension: file.file_type, sheetName: parsed(dataset.metadata).sheet_name });
    return { ...workbook.selected, sheets: workbook.sheets.map((sheet) => ({ name: sheet.name, row_count: sheet.rows.length, column_count: sheet.headers.length })) };
  }
  const key = datasetStorageKey(dataset);
  if (!key) throw new ToolInputError("派生数据集存储记录缺失。", "DATASET_STORAGE_UNAVAILABLE");
  const bytes = await fileStorage.get(key);
  const payload = parsed(new TextDecoder("utf-8").decode(bytes), null);
  if (!payload?.headers?.length || !Array.isArray(payload.rows)) throw new ToolInputError("派生数据集内容无效。", "DATASET_STORAGE_INVALID");
  const metadata = payload.metadata || parsed(dataset.metadata);
  return { name: payload.sheet_name || "Data", headers: payload.headers, rows: payload.rows, variables: metadata.variables || [], encoding: metadata.encoding || "", source_format: metadata.source_format || "", sheets: metadata.sheets || [{ name: payload.sheet_name || "Data", row_count: payload.rows.length, column_count: payload.headers.length }] };
}

export async function registerRawDataset({ store, fileStorage, userId, projectId, file, name = "", sheetName = "" }) {
  if (!file || file.project_id !== projectId || !["xlsx", "csv", "sav"].includes(file.file_type)) throw new ToolInputError("仅 XLSX、CSV 或 SAV 数据文件可以登记为数据集。", "DATASET_FILE_UNSUPPORTED");
  const requestedSheet = String(sheetName ?? "");
  const checkSheet = (dataset, expectedSheet) => {
    if (expectedSheet && parsed(dataset.metadata).sheet_name !== expectedSheet) throw new ToolInputError("同一文件当前只能登记一个工作表。请将所需工作表另存为独立文件后上传。", "DATASET_SHEET_CONFLICT");
    return dataset;
  };
  const existing = (await store.listDatasets(projectId)).find((item) => item.type === "raw" && item.source_file_id === file.id);
  if (existing) return checkSheet(existing, requestedSheet);
  const bytes = await fileStorage.get(fileStorageKey(file));
  const workbook = await parseDatasetFile(asArrayBuffer(bytes), { extension: file.file_type, sheetName });
  const table = workbook.selected;
  const sourceDigest = await crypto.subtle.digest("SHA-256", asArrayBuffer(bytes));
  const sourceHash = Array.from(new Uint8Array(sourceDigest), (b) => b.toString(16).padStart(2, "0")).join("");
  const created = await store.createDataset(userId, projectId, {
    name: text(name) || file.file_name.replace(/\.(xlsx|csv|sav)$/i, ""), source_file_id: file.id, type: "raw", parent_dataset_id: null,
    status: "ready", row_count: table.rows.length, column_count: table.headers.length, storage_key: "",
    metadata: datasetMetadata({ ...table, source_format: file.file_type, encoding: workbook.encoding || table.encoding, sheets: workbook.sheets.map((item) => ({ name: item.name, row_count: item.rows.length, column_count: item.headers.length })) }, { source_version: { file_id: file.id, sha256: sourceHash, created_at: file.created_at || null } }),
  });
  // Store-level deduplication may return a concurrently registered Dataset.
  return checkSheet(created, table.name);
}

function variableProfile(rows, field) {
  const values = fieldValues(rows, field); const nonEmpty = values.filter(Boolean); const numeric = nonEmpty.map(finite).filter((value) => value != null);
  const numericRatio = nonEmpty.length ? numeric.length / nonEmpty.length : 0; const uniques = unique(nonEmpty);
  const summary = {
    field, type: numericRatio >= 0.9 ? "numeric" : uniques.length <= Math.max(30, rows.length * 0.1) ? "categorical" : "text",
    missing_count: rows.length - nonEmpty.length, missing_rate: rows.length ? rounded((rows.length - nonEmpty.length) / rows.length) : 0,
    unique_count: uniques.length, top_values: frequency(nonEmpty),
  };
  if (numericRatio >= 0.9 && numeric.length) {
    const sorted = numeric.sort((a, b) => a - b); const q1 = percentile(sorted, 0.25); const q3 = percentile(sorted, 0.75); const iqr = q3 - q1;
    summary.numeric = { min: sorted[0], max: sorted.at(-1), mean: rounded(sorted.reduce((sum, value) => sum + value, 0) / sorted.length), q1: rounded(q1), median: rounded(percentile(sorted, 0.5)), q3: rounded(q3), outlier_count: iqr ? sorted.filter((value) => value < q1 - 1.5 * iqr || value > q3 + 1.5 * iqr).length : 0 };
  }
  return summary;
}

function wideVariableProfiles(rows, headers) {
  const states = headers.map(() => ({ nonEmpty: 0, numericCount: 0, sum: 0, min: Infinity, max: -Infinity, unique: new Set(), counts: new Map() }));
  for (const row of rows) {
    for (let index = 0; index < headers.length; index += 1) {
      const value = text(row[headers[index]]);
      if (!value) continue;
      const state = states[index];
      state.nonEmpty += 1;
      state.unique.add(value);
      if (state.counts) {
        if (state.counts.has(value)) state.counts.set(value, state.counts.get(value) + 1);
        else if (state.counts.size < WIDE_PROFILE_FREQUENCY_CARDINALITY_LIMIT) state.counts.set(value, 1);
        else state.counts = null;
      }
      const number = finite(value);
      if (number != null) {
        state.numericCount += 1;
        state.sum += number;
        if (number < state.min) state.min = number;
        if (number > state.max) state.max = number;
      }
    }
  }
  return headers.map((field, index) => {
    const state = states[index];
    const numericRatio = state.nonEmpty ? state.numericCount / state.nonEmpty : 0;
    const uniqueCount = state.unique.size;
    const summary = {
      field,
      type: numericRatio >= 0.9 ? "numeric" : uniqueCount <= Math.max(30, rows.length * 0.1) ? "categorical" : "text",
      missing_count: rows.length - state.nonEmpty,
      missing_rate: rows.length ? rounded((rows.length - state.nonEmpty) / rows.length) : 0,
      unique_count: uniqueCount,
      top_values: state.counts ? [...state.counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 10).map(([value, count]) => ({ value, count })) : [],
    };
    if (numericRatio >= 0.9 && state.numericCount) summary.numeric = { min: state.min, max: state.max, mean: rounded(state.sum / state.numericCount), q1: null, median: null, q3: null, outlier_count: 0, detail_bounded: true };
    state.unique.clear();
    state.counts?.clear();
    return summary;
  });
}

export function profileTable(table, datasetId) {
  const { rows, headers } = table;
  const sourceVariables = new Map((table.variables || []).map((item) => [item.name, item]));
  const wideProfile = rows.length * headers.length > DETAILED_PROFILE_CELL_LIMIT;
  const baseProfiles = wideProfile ? wideVariableProfiles(rows, headers) : headers.map((field) => variableProfile(rows, field));
  const variables = baseProfiles.map((profile) => {
    const source = sourceVariables.get(profile.field);
    return source ? { ...profile, label: source.label || "", measure: source.measure || "unknown", value_labels: source.value_labels || [], missing: source.missing || { kind: "none" } } : profile;
  });
  const idCandidates = variables.filter((item) => /(^|_|\b)(id|respondent|record|样本|答卷|编号)(_|\b|$)/i.test(item.field) || (item.unique_count === rows.length && item.missing_count === 0)).slice(0, 8);
  const primaryId = idCandidates[0]?.field || ""; const idValues = primaryId ? fieldValues(rows, primaryId).filter(Boolean) : [];
  const duplicateIds = idValues.length - new Set(idValues).size;
  const exactDuplicates = wideProfile ? null : (() => { const signatures = rows.map((row) => headers.map((field) => text(row[field])).join("\u001f")); return signatures.length - new Set(signatures).size; })();
  const issues = [];
  variables.filter((item) => item.missing_rate >= 0.05).sort((a, b) => b.missing_rate - a.missing_rate).slice(0, 12).forEach((item) => issues.push({ code: "HIGH_MISSING", field: item.field, severity: item.missing_rate >= 0.2 ? "high" : "medium", message: `${item.field} 缺失率 ${(item.missing_rate * 100).toFixed(1)}%` }));
  if (duplicateIds) issues.push({ code: "DUPLICATE_ID", field: primaryId, severity: "high", count: duplicateIds, message: `发现 ${duplicateIds} 条重复 ${primaryId}` });
  if (exactDuplicates) issues.push({ code: "EXACT_DUPLICATE", severity: "medium", count: exactDuplicates, message: `发现 ${exactDuplicates} 条完全重复记录` });
  if (!wideProfile) variables.filter((item) => item.numeric?.outlier_count).slice(0, 10).forEach((item) => issues.push({ code: "NUMERIC_OUTLIER", field: item.field, severity: "medium", count: item.numeric.outlier_count, message: `${item.field} 存在 ${item.numeric.outlier_count} 个统计离群值，需结合问卷编码判断` }));
  const result = {
    dataset_id: datasetId, sample_size: rows.length, variables: headers.length, profile_mode: wideProfile ? "wide_single_pass" : "detailed", sheets: table.sheets || [{ name: table.name, row_count: rows.length, column_count: headers.length }],
    field_index: headers, possible_id_fields: idCandidates.map((item) => item.field),
    possible_single_choice_fields: variables.filter((item) => item.type === "categorical").map((item) => item.field),
    possible_multiple_choice_fields: headers.filter((field) => /__\d+|_\d+$/.test(field)), duplicate_rows: exactDuplicates, duplicate_ids: duplicateIds,
    quality_issues: issues, variable_summary: variables,
  };
  return result;
}

function profileFromDatasetMetadata(dataset) {
  const metadata = parsed(dataset.metadata, {});
  const fields = Array.isArray(metadata.fields) ? metadata.fields.map(text).filter(Boolean) : [];
  const sourceVariables = new Map((metadata.variables || []).map((item) => [text(item.name), item]));
  const variableSummary = fields.map((field) => {
    const source = sourceVariables.get(field) || {};
    return {
      field,
      label: text(source.label),
      type: source.type || "unknown",
      measure: source.measure || "unknown",
      value_labels: Array.isArray(source.value_labels) ? source.value_labels : [],
      missing: source.missing || { kind: "none" },
      missing_count: null,
      missing_rate: null,
      unique_count: null,
      top_values: [],
    };
  });
  return {
    dataset_id: dataset.id,
    sample_size: Number(dataset.row_count || 0),
    variables: Number(dataset.column_count || fields.length),
    profile_mode: "structure_only",
    sheets: Array.isArray(metadata.sheets) ? metadata.sheets : [{ name: metadata.sheet_name || "Data", row_count: Number(dataset.row_count || 0), column_count: Number(dataset.column_count || fields.length) }],
    field_index: fields,
    possible_id_fields: fields.filter((field) => /(^|_|\b)(id|respondent|record|样本|答卷|编号)(_|\b|$)/i.test(field)).slice(0, 8),
    possible_single_choice_fields: variableSummary.filter((item) => item.value_labels.length || ["nominal", "ordinal"].includes(item.measure)).map((item) => item.field),
    possible_multiple_choice_fields: fields.filter((field) => /__\d+|_\d+$/.test(field)),
    duplicate_rows: null,
    duplicate_ids: null,
    quality_issues: [{ code: "WIDE_PROFILE_BOUNDED", severity: "info", message: "宽表已完成全量字段结构检查；缺失率、重复与离群值请仅对目标字段按需检查。" }],
    variable_summary: variableSummary,
  };
}

async function reusableProfile({ store, projectId, dataset }) {
  const analyses = typeof store.listAnalysisResults === "function" ? await store.listAnalysisResults(projectId) : [];
  for (const item of analyses) {
    if (item.dataset_id !== dataset.id || item.type !== "data_profile") continue;
    const result = parsed(item.result, null);
    if (result?.field_index?.length === Number(dataset.column_count || 0) && result?.variable_summary?.length === Number(dataset.column_count || 0)) return result;
  }
  const metadata = parsed(dataset.metadata, {});
  const cells = Number(dataset.row_count || 0) * Number(dataset.column_count || 0);
  if (cells > DETAILED_PROFILE_CELL_LIMIT && metadata.source_format === "sav" && metadata.profile_structure_complete && Array.isArray(metadata.fields) && metadata.fields.length === Number(dataset.column_count || 0)) return profileFromDatasetMetadata(dataset);
  return null;
}

const PROFILE_DEFAULT_METADATA_LIMIT = 120;
const PROFILE_FIELD_INDEX_LIMIT = 1_000;
const PROFILE_RELEVANCE_PATTERN = /nps|推荐|满意|忠诚|流失|价格|渠道|品牌|年龄|性别|区域|地区|城市|收入|职业|画像/i;

function normalizedFieldQuery(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return unique(values.map((item) => text(item).toLocaleLowerCase()).filter(Boolean)).slice(0, 8);
}

function compactVariableMetadata(item) {
  return { field: item.field, label: item.label || "", type: item.type, measure: item.measure || "unknown", value_labels: (item.value_labels || []).slice(0, 30) };
}

function variableSearchText(item) {
  return [item.field, item.label, ...(item.value_labels || []).flatMap((entry) => [entry?.value, entry?.label])].map(text).join("\n").toLocaleLowerCase();
}

function selectedProfileMetadata(result, args = {}) {
  const query = normalizedFieldQuery(args.field_query);
  const configuredLimit = Number(args.field_limit);
  const limit = Number.isFinite(configuredLimit) ? Math.min(160, Math.max(1, Math.round(configuredLimit))) : PROFILE_DEFAULT_METADATA_LIMIT;
  const all = result.variable_summary || [];
  if (query.length) {
    const matches = all.filter((item) => {
      const haystack = variableSearchText(item);
      return query.some((term) => haystack.includes(term));
    });
    return { query, matches, selected: matches.slice(0, limit), limit };
  }
  const selected = [];
  const seen = new Set();
  const append = (item) => { if (item && !seen.has(item.field) && selected.length < limit) { selected.push(item); seen.add(item.field); } };
  all.slice(0, Math.min(60, limit)).forEach(append);
  all.filter((item) => PROFILE_RELEVANCE_PATTERN.test(variableSearchText(item))).forEach(append);
  all.forEach(append);
  return { query, matches: all, selected, limit };
}

function compactProfile(result, resultId, args = {}) {
  const metadata = selectedProfileMetadata(result, args);
  const fieldIndex = result.field_index.slice(0, PROFILE_FIELD_INDEX_LIMIT);
  return {
    result_id: resultId,
    dataset_id: result.dataset_id,
    sample_size: result.sample_size,
    variables: result.variables,
    sheets: result.sheets,
    issues: result.quality_issues.slice(0, 20).map((item) => item.message),
    field_count_total: result.field_index.length,
    field_index: fieldIndex,
    field_index_returned: fieldIndex.length,
    fields_truncated: result.field_index.length > fieldIndex.length,
    field_metadata: metadata.selected.map(compactVariableMetadata),
    field_metadata_total: result.variable_summary.length,
    field_metadata_matches: metadata.matches.length,
    field_metadata_returned: metadata.selected.length,
    metadata_query: metadata.query,
    metadata_truncated: metadata.matches.length > metadata.selected.length,
  };
}

function normalizedRules(rules, headers) {
  if (!Array.isArray(rules) || !rules.length) throw new ToolInputError("至少需要一条结构化清洗规则。", "CLEANING_RULES_REQUIRED");
  return rules.slice(0, 30).map((rule, index) => {
    const type = text(rule?.type); const field = text(rule?.field);
    if (!["blank_row", "exact_duplicate", "duplicate_id", "duration", "range", "exclude_value"].includes(type)) throw new ToolInputError(`第 ${index + 1} 条清洗规则类型不受支持。`, "CLEANING_RULE_UNSUPPORTED");
    if (!["blank_row", "exact_duplicate"].includes(type) && (!field || !headers.includes(field))) throw new ToolInputError(`清洗字段 ${field || "(空)"} 不存在。`, "FIELD_NOT_FOUND", { field });
    return { type, field, threshold: finite(rule.threshold), min: finite(rule.min), max: finite(rule.max), values: Array.isArray(rule.values) ? rule.values.map(text).filter(Boolean).slice(0, 100) : [], label: text(rule.label) || type };
  });
}

function applyCleaning(rows, headers, rules) {
  const seenRows = new Set(); const seenByField = new Map(); const removed = []; const kept = []; const counts = Object.fromEntries(rules.map((rule, index) => [`${index}:${rule.label}`, 0]));
  for (const row of rows) {
    const hits = [];
    for (const [index, rule] of rules.entries()) {
      let hit = false;
      if (rule.type === "blank_row") hit = headers.every((field) => !text(row[field]));
      else if (rule.type === "exact_duplicate") { const signature = headers.map((field) => text(row[field])).join("\u001f"); hit = seenRows.has(signature); seenRows.add(signature); }
      else if (rule.type === "duplicate_id") { const value = text(row[rule.field]); const seen = seenByField.get(rule.field) || new Set(); hit = Boolean(value && seen.has(value)); if (value) seen.add(value); seenByField.set(rule.field, seen); }
      else if (rule.type === "duration") { const value = finite(row[rule.field]); hit = value != null && rule.threshold != null && value < rule.threshold; }
      else if (rule.type === "range") { const value = finite(row[rule.field]); hit = Boolean(text(row[rule.field])) && value != null && ((rule.min != null && value < rule.min) || (rule.max != null && value > rule.max)); }
      else if (rule.type === "exclude_value") hit = rule.values.includes(text(row[rule.field]));
      if (hit) { hits.push(rule.label); counts[`${index}:${rule.label}`] += 1; }
    }
    if (hits.length) removed.push({ row, reasons: hits }); else kept.push(row);
  }
  return { kept, removed, rule_summary: rules.map((rule, index) => ({ ...rule, affected_rows: counts[`${index}:${rule.label}`] })) };
}

function npsScore(values) {
  const scores = values.map(finite).filter((value) => value != null && value >= 0 && value <= 10);
  if (!scores.length) return null;
  const coded = scores.map((value) => value >= 9 ? 1 : value <= 6 ? -1 : 0);
  const mean = coded.reduce((sum, value) => sum + value, 0) / coded.length;
  const variance = coded.length > 1 ? coded.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (coded.length - 1) : 0;
  return { value: rounded(mean * 100, 1), base: coded.length, mean, variance };
}
function groupSignificance(group, rest) {
  if (!group || !rest || group.base < 20 || rest.base < 20) return { significant: false, z: null };
  const standardError = Math.sqrt(group.variance / group.base + rest.variance / rest.base);
  if (!standardError) return { significant: group.mean !== rest.mean, z: null, degenerate_variance: true };
  const z = (group.mean - rest.mean) / standardError;
  return { significant: Math.abs(z) >= 1.96, z: rounded(z, 3) };
}
function numericMean(values) { const valid = values.map(finite).filter((value) => value != null); return valid.length ? { value: rounded(valid.reduce((sum, value) => sum + value, 0) / valid.length), base: valid.length } : null; }

function analyzeVariable(rows, variable, banner, options = {}) {
  const values = fieldValues(rows, variable).filter(Boolean); const numericRatio = values.length ? values.map(finite).filter((value) => value != null).length / values.length : 0;
  const groups = unique(fieldValues(rows, banner).filter(Boolean));
  const variableLabel = text(options.variableLabels?.get(variable));
  const isNpsVariable = /nps|净推荐|推荐.*(?:可能|意愿|程度)|多大.*可能.*推荐/i.test(`${variable}\n${variableLabel}`);
  if (isNpsVariable && (!values.length || numericRatio >= 0.9) && values.every((value) => { const number = finite(value); return number == null || (number >= 0 && number <= 10); })) {
    if (options.weighted) { const overall = typedWeightedNps(rows, variable); return { variable, banner, metric: "nps", weighted: true, overall: overall?.value ?? null, base: overall?.base || 0, weighted_base: overall?.weighted_base || 0, groups: groups.map((segment) => { const item = typedWeightedNps(rows.filter((row) => text(row[banner]) === segment), variable); return { segment, value: item?.value ?? null, base: item?.base || 0, weighted_base: item?.weighted_base || 0, delta_vs_total: item && overall ? rounded(item.value - overall.value, 1) : null, significant: false, significance_note: "加权描述值；未执行复杂抽样设计校正显著性检验" }; }) }; }
    const overall = npsScore(values); const outputGroups = groups.map((segment) => {
      const groupRows = rows.filter((row) => text(row[banner]) === segment); const restRows = rows.filter((row) => text(row[banner]) !== segment);
      const group = npsScore(fieldValues(groupRows, variable)); const rest = npsScore(fieldValues(restRows, variable)); const test = groupSignificance(group, rest);
      return { segment, value: group?.value ?? null, base: group?.base || 0, delta_vs_total: group && overall ? rounded(group.value - overall.value, 1) : null, ...test };
    });
    return { variable, banner, metric: "nps", overall: overall?.value ?? null, base: overall?.base || 0, groups: outputGroups };
  }
  if (numericRatio >= 0.9 && unique(values).length > 12) {
    if (options.weighted) { const overall = typedWeightedMean(rows, variable); return { variable, banner, metric: "mean", weighted: true, overall: overall?.value ?? null, base: overall?.base || 0, weighted_base: overall?.weighted_base || 0, groups: groups.map((segment) => { const item = typedWeightedMean(rows.filter((row) => text(row[banner]) === segment), variable); return { segment, value: item?.value ?? null, base: item?.base || 0, weighted_base: item?.weighted_base || 0, delta_vs_total: item && overall ? rounded(item.value - overall.value) : null, significant: false, significance_note: "加权描述值；未执行复杂抽样设计校正显著性检验" }; }) }; }
    const overall = numericMean(values); return { variable, banner, metric: "mean", overall: overall?.value ?? null, base: overall?.base || 0, groups: groups.map((segment) => { const item = numericMean(fieldValues(rows.filter((row) => text(row[banner]) === segment), variable)); return { segment, value: item?.value ?? null, base: item?.base || 0, delta_vs_total: item && overall ? rounded(item.value - overall.value) : null, significant: false }; }) };
  }
  if (unique(values).length > 100) throw new ToolInputError(`字段 ${variable} 类别过多，不适合作为第一版交叉表分析变量。`, "CROSSTAB_CARDINALITY_HIGH", { field: variable });
  if (options.weighted) {
    const validRows = rows.filter((row) => text(row[variable]) && text(row[banner]) && (finite(row.__weight) ?? 0) > 0);
    const totalWeight = validRows.reduce((sum, row) => sum + finite(row.__weight), 0); const categories = unique(fieldValues(validRows, variable));
    const validGroups = unique(fieldValues(validRows, banner));
    return { variable, banner, metric: "distribution", weighted: true, base: validRows.length, weighted_base: rounded(totalWeight, 2), significant: false, significance: { significant: false, level: "na", label: "加权描述值，未执行设计校正显著性检验" }, categories: categories.map((category) => ({ category, comparisons: [], groups: validGroups.map((segment) => { const groupRows = validRows.filter((row) => text(row[banner]) === segment); const groupWeight = groupRows.reduce((sum, row) => sum + finite(row.__weight), 0); const categoryRows = groupRows.filter((row) => text(row[variable]) === category); const categoryWeight = categoryRows.reduce((sum, row) => sum + finite(row.__weight), 0); return { segment, raw_count: categoryRows.length, raw_base: groupRows.length, weighted_count: rounded(categoryWeight, 2), weighted_base: rounded(groupWeight, 2), percent: rounded(groupWeight ? categoryWeight / groupWeight * 100 : 0, 1) }; }) })) };
  }
  const categoricalRows = rows.map((row) => ({ [variable]: text(row[variable]), [banner]: text(row[banner]) }));
  const analysis = buildCrosstab(categoricalRows, variable, banner); const percents = computeColumnPercents(analysis); const significance = significanceLevel(analysis.pValue);
  const categories = analysis.rowLabels.map((category, rowIndex) => ({ category, groups: analysis.colLabels.map((segment, colIndex) => ({ segment, count: analysis.matrix[rowIndex][colIndex], base: analysis.colTotals[colIndex], percent: rounded(percents[rowIndex][colIndex] * 100, 1) })), comparisons: columnProportionPostHoc(analysis, rowIndex).filter((item) => item.significant) }));
  return { variable, banner, metric: "distribution", base: analysis.total, significant: significance.significant, significance, chi_square: rounded(analysis.chiSquare), degrees_of_freedom: analysis.degreesOfFreedom, p_value: analysis.pValue == null ? null : rounded(analysis.pValue, 6), cramers_v: rounded(cramersV(analysis)), effect_size: effectSizeLabel(cramersV(analysis)), low_expected_cells: analysis.lowExpectedCells, categories };
}

function compactCrosstab(full, resultId) {
  const findings = [];
  for (const item of full.results) {
    if (["nps", "mean"].includes(item.metric)) {
      const ranked = item.groups.filter((group) => group.value != null).sort((left, right) => right.value - left.value);
      if (ranked[0]) findings.push({ variable: item.variable, banner: item.banner, finding: `${ranked[0].segment} ${item.metric === "nps" ? "NPS" : "均值"}最高`, segment: ranked[0].segment, metric: item.metric, base: ranked[0].base, total: item.overall, total_base: item.base, dataset_id: full.dataset_id, value: ranked[0].value, delta_vs_total: ranked[0].delta_vs_total, significant: ranked[0].significant });
      if (ranked.at(-1) && ranked.at(-1) !== ranked[0]) findings.push({ variable: item.variable, banner: item.banner, finding: `${ranked.at(-1).segment} ${item.metric === "nps" ? "NPS" : "均值"}最低`, segment: ranked.at(-1).segment, metric: item.metric, base: ranked.at(-1).base, total: item.overall, total_base: item.base, dataset_id: full.dataset_id, value: ranked.at(-1).value, delta_vs_total: ranked.at(-1).delta_vs_total, significant: ranked.at(-1).significant });
    } else if (item.significant) {
      const comparisons = item.categories.flatMap((category) => category.comparisons.slice(0, 3).map((comparison) => ({ variable: item.variable, banner: item.banner, finding: `${category.category}：${comparison.col1Label} 与 ${comparison.col2Label} 差异显著`, category: category.category, significant: true })));
      findings.push(...comparisons.slice(0, 8));
    }
  }
  return { result_id: resultId, dataset_id: full.dataset_id, weighted: Boolean(full.weighted), analyses: full.results.length, key_findings: findings.slice(0, 20), truncated: findings.length > 20 };
}

export async function exportCrosstabResults({ store, fileStorage, userId, projectId, dataset }) {
  if (!store || !fileStorage || !userId || !projectId || !dataset || dataset.project_id !== projectId) throw new ToolInputError("数据集不存在。", "DATASET_NOT_FOUND");
  const analyses = await store.listAnalysisResults(projectId);
  const resultIds = [];
  const seen = new Set();
  const results = [];
  for (const analysis of analyses) {
    if (analysis.dataset_id !== dataset.id || analysis.type !== "crosstab") continue;
    const full = parsed(analysis.result, null);
    if (!Array.isArray(full?.results)) continue;
    resultIds.push(analysis.id);
    for (const item of full.results) {
      if (!item?.variable || !item?.banner) continue;
      const key = `${item.variable}\u0000${item.banner}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
    }
  }
  if (!results.length) throw new ToolInputError("当前数据集还没有可导出的交叉表。请先点击“用 AI 分析”，完成至少一次交叉表分析。", "CROSSTAB_EXPORT_EMPTY");

  const banners = unique(results.map((item) => item.banner));
  const variables = unique(results.map((item) => item.variable));
  const full = { dataset_id: dataset.id, weighted: dataset.type === "weighted", banners, variables, results };
  const bytes = buildCrosstabWorkbook(full);
  const fileId = crypto.randomUUID();
  const storageKey = fileStorage.key(projectId, fileId, "xlsx");
  await fileStorage.put(storageKey, bytes);
  let file;
  try {
    file = await store.createFile(userId, projectId, {
      id: fileId,
      file_name: `${dataset.name} 全部交叉表 ${new Date().toISOString().slice(0, 10)}.xlsx`,
      file_type: "xlsx",
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      file_size: bytes.byteLength,
      category: "other",
      storage_key: storageKey,
      storage_path: storageKey,
    });
    file = await store.updateFile(projectId, fileId, {
      parse_status: "completed",
      parsed_text: "",
      summary: `已合并 ${variables.length} 个题目、${banners.length} 个 Banner，共 ${results.length} 张交叉表。`,
      structured_data: JSON.stringify({ kind: "crosstab_excel_export", dataset_id: dataset.id, result_ids: resultIds, variable_count: variables.length, banner_count: banners.length, analysis_count: results.length }),
      parse_note: "由 SurveyKit 合并当前数据集已有的确定性交叉表分析结果生成；同一题目与 Banner 的重复结果保留最新版本。",
    });
  } catch (error) {
    await fileStorage.delete?.(storageKey);
    throw error;
  }
  return { file, variable_count: variables.length, banner_count: banners.length, analysis_count: results.length };
}

export function createDataToolExecutor({ store, fileStorage }) {
  if (!store || !fileStorage) throw new Error("DATA_RUNTIME_REQUIRED");
  return async function executeDataTool({ agentToolId, args = {}, scope }) {
    const projectId = scope?.project?.id; const userId = scope?.user_id;
    if (!projectId || !userId) throw new ToolInputError("数据工具缺少项目上下文。", "INVALID_AGENT_CONTEXT");
    const datasetId = text(args.dataset_id); const dataset = datasetId ? await store.getDataset(projectId, datasetId) : null;
    if (!dataset) throw new ToolInputError("数据集不存在或不属于当前项目。", "DATASET_NOT_FOUND");
    if (agentToolId === "data_clean" && dataset.type === "weighted") throw new ToolInputError("加权数据不能直接清洗。请返回原始或清洗版本完成修改，再按目标分布重新加权。", "DATASET_WEIGHTED_CLEAN_FORBIDDEN");
    if (agentToolId === "data_profile") {
      const profileInput = { dataset_id: dataset.id, ...(normalizedFieldQuery(args.field_query).length ? { field_query: normalizedFieldQuery(args.field_query) } : {}), ...(args.field_limit != null ? { field_limit: Number(args.field_limit) } : {}) };
      const full = await reusableProfile({ store, projectId, dataset }) || profileTable(await loadDatasetTable({ store, fileStorage, projectId, dataset }), dataset.id); const provisional = compactProfile(full, "", args);
      const saved = await store.createAnalysisResult(projectId, { dataset_id: dataset.id, type: "data_profile", input: profileInput, result: full, compact_result: provisional });
      const compact = compactProfile(full, saved.id, args); return { gatewayId: "data-profile", input: profileInput, result: { ...full, result_id: saved.id }, compact };
    }
    const table = await loadDatasetTable({ store, fileStorage, projectId, dataset });
    if (agentToolId === "data_clean") {
      const rules = normalizedRules(args.rules, table.headers); const outcome = applyCleaning(table.rows, table.headers, rules);
      const removalRate = table.rows.length ? outcome.removed.length / table.rows.length : 0;
      const requiresConfirmation = rules.some((rule) => !LOW_RISK_RULES.has(rule.type)) || outcome.removed.length >= 100 || removalRate >= 0.05;
      const plan = { source_dataset_id: dataset.id, before_rows: table.rows.length, after_rows: outcome.kept.length, removed_rows: outcome.removed.length, removal_rate: rounded(removalRate), rule_summary: outcome.rule_summary, requires_confirmation: requiresConfirmation };
      if (requiresConfirmation && args.confirmed !== true) return { gatewayId: "data-clean", input: { dataset_id: dataset.id, rules, confirmed: false }, result: plan, compact: plan };
      const derivedId = crypto.randomUUID(); const storageKey = fileStorage.key(projectId, derivedId, "json");
      const metadata = datasetMetadata({ ...table, rows: outcome.kept }, parsed(dataset.metadata), { datasetId: dataset.id });
      const bytes = new TextEncoder().encode(JSON.stringify(derivedPayload(table, outcome.kept, metadata))); await fileStorage.put(storageKey, bytes);
      let created;
      try { created = await store.createDataset(userId, projectId, { id: derivedId, name: text(args.name) || `${dataset.name} Clean`, source_file_id: null, type: "cleaned", parent_dataset_id: dataset.id, status: "ready", row_count: outcome.kept.length, column_count: table.headers.length, storage_key: storageKey, metadata }); }
      catch (error) { await fileStorage.delete?.(storageKey); throw error; }
      const log = await store.createCleaningLog(projectId, { source_dataset_id: dataset.id, created_dataset_id: created.id, rules, affected_rows: outcome.removed.length, summary: plan });
      const result = { ...plan, clean_dataset_id: created.id, cleaning_log_id: log.id, requires_confirmation: false };
      return { gatewayId: "data-clean", input: { dataset_id: dataset.id, rules, confirmed: true }, result, compact: result };
    }
    if (agentToolId === "data_weight") {
      if (dataset.type === "weighted") throw new ToolInputError("请从 Raw 或 Clean Dataset 创建新的加权版本，避免重复叠加权重。", "DATASET_ALREADY_WEIGHTED");
      const method = text(args.method || "rim").toLowerCase(); if (method !== "rim") throw new ToolInputError("服务端当前仅支持经过审计的 RIM 加权。", "WEIGHT_METHOD_UNSUPPORTED");
      const targets = normalizeTypedWeightTargets(args.targets, table.headers, table.rows); const calculated = calculateTypedRimWeights(table.rows, targets, { max_iterations: args.max_iterations, tolerance: args.tolerance, trim: args.trim });
      const plan = { source_dataset_id: dataset.id, method, before_rows: table.rows.length, target_summary: calculated.diagnostics.margins, diagnostics: { ...calculated.diagnostics, margins: undefined }, requires_confirmation: true };
      if (args.confirmed !== true) return { gatewayId: "data-weight", input: { dataset_id: dataset.id, method, targets, confirmed: false, trim: args.trim || null }, result: plan, compact: plan };
      const derivedId = crypto.randomUUID(); const storageKey = fileStorage.key(projectId, derivedId, "json"); const headers = [...table.headers.filter((field) => field !== "__weight"), "__weight"];
      const metadata = datasetMetadata({ ...table, rows: calculated.rows, headers, variables: [...(table.variables || []), { name: "__weight", label: "RIM 权重", type: "numeric", measure: "scale" }] }, parsed(dataset.metadata), { datasetId: dataset.id, weighted: true, weighting: { method, targets, diagnostics: calculated.diagnostics } });
      await fileStorage.put(storageKey, new TextEncoder().encode(JSON.stringify(derivedPayload(table, calculated.rows, metadata))));
      let created;
      try { created = await store.createDataset(userId, projectId, { id: derivedId, name: text(args.name) || `${dataset.name} Weighted`, source_file_id: null, type: "weighted", parent_dataset_id: dataset.id, status: "ready", row_count: calculated.rows.length, column_count: headers.length, storage_key: storageKey, metadata }); }
      catch (error) { await fileStorage.delete?.(storageKey); throw error; }
      const resultId = crypto.randomUUID(); const result = { ...plan, weighted_dataset_id: created.id, result_id: resultId, diagnostics: calculated.diagnostics, requires_confirmation: false };
      await store.createAnalysisResult(projectId, { id: resultId, dataset_id: created.id, type: "data_weight", input: { source_dataset_id: dataset.id, method, targets, trim: args.trim || null }, result, compact_result: result });
      return { gatewayId: "data-weight", input: { dataset_id: dataset.id, method, targets, confirmed: true, trim: args.trim || null }, result, compact: result };
    }
    if (agentToolId === "crosstab") {
      const banners = unique((Array.isArray(args.banner) ? args.banner : [args.banner]).map(text).filter(Boolean)).slice(0, 3);
      const variables = unique((Array.isArray(args.variables) ? args.variables : [args.variables]).map(text).filter(Boolean)).slice(0, 12);
      if (!banners.length || !variables.length) throw new ToolInputError("交叉表需要 banner 和 variables。", "CROSSTAB_INPUT_REQUIRED");
      for (const field of [...banners, ...variables]) if (!table.headers.includes(field)) throw new ToolInputError(`字段 ${field} 不存在。`, "FIELD_NOT_FOUND", { field, available_fields: table.headers.slice(0, 80) });
      const weighted = dataset.type === "weighted"; if (weighted && !table.headers.includes("__weight")) throw new ToolInputError("Weighted Dataset 缺少权重字段。", "WEIGHT_FIELD_MISSING");
      const variableLabels = new Map((table.variables || []).map((item) => [item.name, item.label || ""]));
      const resultId = crypto.randomUUID(); const full = { dataset_id: dataset.id, weighted, banners, variables, results: banners.flatMap((banner) => variables.filter((variable) => variable !== banner && variable !== "__weight").map((variable) => analyzeVariable(table.rows, variable, banner, { weighted, variableLabels }))) };
      const excelFileId = crypto.randomUUID(); const excelStorageKey = fileStorage.key(projectId, excelFileId, "xlsx"); const excelBytes = buildCrosstabWorkbook(full); await fileStorage.put(excelStorageKey, excelBytes);
      try { await store.createFile(userId, projectId, { id: excelFileId, file_name: `${dataset.name} Crosstab ${new Date().toISOString().slice(0, 10)}.xlsx`, file_type: "xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file_size: excelBytes.byteLength, category: "other", storage_key: excelStorageKey, storage_path: excelStorageKey }); await store.updateFile(projectId, excelFileId, { parse_status: "completed", parsed_text: "", summary: `Crosstab Analysis Result：${full.results.length} 项分析。`, structured_data: JSON.stringify({ kind: "crosstab_excel_artifact", result_id: resultId, dataset_id: dataset.id }), parse_note: "由 SurveyKit 确定性 Crosstab Tool 生成。" }); }
      catch (error) { await fileStorage.delete?.(excelStorageKey); throw error; }
      full.excel_file_id = excelFileId; const provisional = compactCrosstab(full, resultId);
      let saved; try { saved = await store.createAnalysisResult(projectId, { id: resultId, dataset_id: dataset.id, type: "crosstab", input: { dataset_id: dataset.id, banner: banners, variables }, result: full, compact_result: { ...provisional, excel_file_id: excelFileId } }); } catch (error) { await store.deleteFile?.(projectId, excelFileId); await fileStorage.delete?.(excelStorageKey); throw error; }
      const compact = { ...compactCrosstab(full, saved.id), excel_file_id: excelFileId }; const evidence = [];
      for (const finding of compact.key_findings.slice(0, 20)) evidence.push(await store.createEvidence(projectId, { type: "quantitative", claim: finding.finding, value: finding, source_type: "crosstab", source_id: saved.id, strength: finding.significant === false ? "medium" : "strong", theme: finding.variable || finding.dimension || finding.metric || "" }));
      return { gatewayId: "crosstab", input: { dataset_id: dataset.id, banner: banners, variables }, result: { ...full, result_id: saved.id, evidence_ids: evidence.map((item) => item.id) }, compact: { ...compact, evidence_ids: evidence.map((item) => item.id) } };
    }
    throw new ToolInputError("该数据工具未开放。", "AGENT_TOOL_NOT_ALLOWED");
  };
}

export const dataToolIds = Object.freeze(["data_profile", "data_clean", "data_weight", "crosstab"]);
export const datasetTypes = DATASET_TYPES;
