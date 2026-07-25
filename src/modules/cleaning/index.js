/**
 * 数据清洗模块 — 规则生成 + 清洗执行 + 字段检测
 */

import { parseDelimitedTable } from "../../shared/file-parser.js";

// ─── 问卷解析辅助 ───────────────────────────────────────────

function isScaleQuestion(text) {
  return /量表|评分|打分|满意|重要|同意|Likert|分值|得分|评价/.test(text);
}

function isOpenQuestion(text) {
  return /开放|填空|请说明|请注明|其他.*说明|其它.*说明|文字|描述/.test(text);
}

function isTrapQuestion(text) {
  return /陷阱|注意力|质控|请选择.*选项|本题选|测试题/.test(text);
}

// ─── 规则生成 ───────────────────────────────────────────────

/**
 * 根据问卷文本生成清洗规则建议
 * @param {string} text - 问卷文本
 * @param {object} config - { minDuration, straightThreshold, openMinChars }
 * @returns {Array<{level: string, title: string, detail: string, evidence?: string}>}
 */
export function generateCleaningRules(text, config = {}) {
  const { minDuration = 120, straightThreshold = 80, openMinChars = 5 } = config;

  if (!text.trim()) {
    return [{ level: "high", title: "缺少问卷稿", detail: "请先粘贴问卷稿，再生成清洗规则。" }];
  }

  const rules = [];
  const lines = text.split("\n").filter(Boolean);
  const questionLines = lines.filter((line) => /^[A-Za-z]*\d+[.．、]/.test(line.trim()));
  const questionCount = questionLines.length || Math.ceil(lines.length / 3);

  const scaleQuestions = questionLines.filter((line) => isScaleQuestion(line));
  const openQuestions = questionLines.filter((line) => isOpenQuestion(line));
  const trapQuestions = questionLines.filter((line) => isTrapQuestion(line));
  const exclusiveQuestions = questionLines.filter((line) => /(以上都没有|以上均无|都没有|不知道|无|没有|拒答)/.test(line));
  const screenerQuestions = questionLines.filter((line) => /是否|购买过|使用过|年龄|城市|地区|行业|职业|本人|决策/.test(line));

  rules.push({
    level: "high",
    title: "超短时长规则",
    detail: `建议将答题时长低于 ${minDuration} 秒的样本标记为疑似无效，并结合题量、开放题内容和设备行为复核。`,
    evidence: questionCount ? `识别题量：${questionCount} 道；当前阈值：${minDuration} 秒` : `未识别到明确题号；当前阈值：${minDuration} 秒`
  });

  if (screenerQuestions.length) {
    rules.push({
      level: "high",
      title: "甄别/准入规则",
      detail: "对购买/使用/年龄/城市等准入题设置不符合条件样本剔除或配额满终止规则。",
      evidence: screenerQuestions.slice(0, 10).join("\n")
    });
  }

  if (trapQuestions.length) {
    rules.push({
      level: "high",
      title: "陷阱题失败规则",
      detail: "陷阱题未按指定选项作答的样本建议直接剔除或进入人工复核。",
      evidence: trapQuestions.join("\n")
    });
  }

  if (scaleQuestions.length) {
    rules.push({
      level: "medium",
      title: "直线作答规则",
      detail: `对量表/评分题检查全选同一分值、标准差过低或极端一致作答；建议将一致率达到 ${straightThreshold}% 以上的样本纳入复核。`,
      evidence: `${scaleQuestions.slice(0, 10).join("\n")}\n当前阈值：${straightThreshold}%`
    });
  }

  if (openQuestions.length) {
    rules.push({
      level: "medium",
      title: "开放题质量规则",
      detail: `开放题建议检查少于 ${openMinChars} 字、重复文本、无意义回答和明显复制粘贴。`,
      evidence: `${openQuestions.slice(0, 10).join("\n")}\n当前阈值：${openMinChars} 字`
    });
  }

  if (exclusiveQuestions.length) {
    rules.push({
      level: "medium",
      title: "排他项冲突规则",
      detail: "多选题中『以上都没有/不知道/拒答』等选项不应与其他实质选项同时选择。",
      evidence: exclusiveQuestions.slice(0, 10).join("\n")
    });
  }

  rules.push({
    level: "low",
    title: "逻辑一致性复核",
    detail: "建议检查前后题一致性，例如未购买者不应出现购买渠道、购买频次等后续行为答案。",
    evidence: "后续接入数据后可自动执行；当前阶段生成规则模板。"
  });

  return rules;
}

// ─── 字段检测 ───────────────────────────────────────────────

export function detectCleaningFields(parsed) {
  const durationFields = parsed.headers.filter((h) => /时长|duration|耗时|用时|time/i.test(h));
  const idFields = parsed.headers.filter((h) => /respondent|样本|用户|会员|手机号|手机|邮箱|email|openid|ip|设备|device|id$/i.test(h));
  const openFields = parsed.headers.filter((h) => /开放|填空|文本|文字|备注|请说明|请注明|其他.*说明|其它.*说明|open/i.test(h));
  const numericFields = parsed.headers.filter((h) => parsed.rows.some((row) => row[h] !== "" && Number.isFinite(Number(row[h]))));
  return { durationFields, idFields, openFields, numericFields };
}

// ─── 清洗执行 ───────────────────────────────────────────────

/**
 * 执行清洗规则
 * @param {object} parsed - { headers, rows }
 * @param {Array} rules - 清洗规则列表，每条含 { type, field, fields, threshold, operator, min, max, allowedValues, level, title, enabled }
 * @param {object} config - { minDuration, straightThreshold, openMinChars, durationField }
 * @returns {{ kept: object[], removed: object[], report: object }}
 */
export function executeCleaning(parsed, rules, config = {}) {
  const { minDuration = 120, durationField = "", straightThreshold = 90, openMinChars = 5 } = config;
  const kept = [];
  const removed = [];
  const reasons = {};
  const enabledRules = (rules || []).filter((rule) => rule.enabled !== false);

  for (const [rowIndex, row] of parsed.rows.entries()) {
    const hits = [];

    for (const rule of enabledRules) {
      const reason = applyRule(row, rowIndex, parsed.rows, rule, { minDuration, durationField, straightThreshold, openMinChars });
      if (reason) hits.push(reason);
    }

    if (hits.length) {
      const reason = hits.join("；");
      removed.push({ ...row, _removeReason: reason });
      hits.forEach((hit) => { reasons[hit] = (reasons[hit] || 0) + 1; });
    } else {
      kept.push(row);
    }
  }

  return {
    kept,
    removed,
    report: {
      total: parsed.rows.length,
      keptCount: kept.length,
      removedCount: removed.length,
      removalRate: parsed.rows.length ? removed.length / parsed.rows.length : 0,
      reasons
    }
  };
}

function applyRule(row, rowIndex, allRows, rule, config) {
  const type = rule.type;
  if (type === "duration") {
    const field = rule.field || config.durationField;
    if (!field) return "";
    const value = Number(row[field]);
    const threshold = Number.isFinite(Number(rule.threshold)) ? Number(rule.threshold) : config.minDuration;
    if (Number.isFinite(value) && value < threshold) return `${rule.title || "超短时长"}：${field}=${value} < ${threshold}秒`;
  }
  if (type === "duplicate") {
    const field = rule.field;
    if (!field) return "";
    const value = String(row[field] ?? "").trim();
    if (value && allRows.findIndex((item) => String(item[field] ?? "").trim() === value) !== rowIndex) {
      return `${rule.title || "重复样本"}：${field}=${value}`;
    }
  }
  if (type === "straight") {
    const fields = rule.fields?.length ? rule.fields : String(rule.field || "").split(",").map((item) => item.trim()).filter(Boolean);
    const values = fields.map((field) => String(row[field] ?? "").trim()).filter(Boolean);
    const threshold = Number.isFinite(Number(rule.threshold)) ? Number(rule.threshold) : config.straightThreshold;
    if (values.length >= 5) {
      const counts = values.reduce((acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }), {});
      const ratio = (Math.max(...Object.values(counts)) / values.length) * 100;
      if (ratio >= threshold) return `${rule.title || "直线作答"}：一致率 ${ratio.toFixed(1)}% ≥ ${threshold}%`;
    }
  }
  if (type === "open_text") {
    const field = rule.field;
    if (!field) return "";
    const value = String(row[field] ?? "").trim();
    const threshold = Number.isFinite(Number(rule.threshold)) ? Number(rule.threshold) : config.openMinChars;
    if (value && value.length < threshold) return `${rule.title || "开放题过短"}：${field} 少于 ${threshold}字`;
  }
  if (type === "range") {
    const field = rule.field;
    if (!field) return "";
    const value = String(row[field] ?? "").trim();
    if (!value) return `${rule.title || "选项范围检查"}：${field} 为空`;
    if (rule.operator === "in_allowed" && Array.isArray(rule.allowedValues) && rule.allowedValues.length) {
      const allowed = rule.allowedValues.map((item) => String(item).trim());
      if (!allowed.includes(value)) return `${rule.title || "选项范围检查"}：${field}=${value} 不在允许范围内`;
    }
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      if (Number.isFinite(Number(rule.min)) && numericValue < Number(rule.min)) {
        return `${rule.title || "选项范围检查"}：${field}=${value} < ${rule.min}`;
      }
      if (Number.isFinite(Number(rule.max)) && numericValue > Number(rule.max)) {
        return `${rule.title || "选项范围检查"}：${field}=${value} > ${rule.max}`;
      }
    }
  }
  if (type === "exclusive") {
    const exclusivePattern = /^(以上都没有|以上均无|都没有|不知道|无|没有|拒答|不适用|none of the above|dont know|refused|na)$/i;
    const fields = rule.fields?.length ? rule.fields : String(rule.field || "").split(",").map((item) => item.trim()).filter(Boolean);
    for (const field of fields) {
      const cell = String(row[field] ?? "").trim();
      if (!cell) continue;
      const tokens = cell.split(/[;；,，]/).map((token) => token.trim()).filter(Boolean);
      const hasExclusive = tokens.some((token) => exclusivePattern.test(token));
      const hasSubstantive = tokens.some((token) => !exclusivePattern.test(token));
      if (hasExclusive && hasSubstantive) {
        return `${rule.title || "排他项冲突"}：${field} 同时选中排他项与实质选项（${cell}）`;
      }
    }
  }
  return "";
}
