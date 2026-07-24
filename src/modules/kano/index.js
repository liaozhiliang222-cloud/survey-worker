/**
 * KANO 模型分析模块 — 需求属性分类 + Better-Worse 系数
 */

// ─── 数据解析 ───────────────────────────────────────────────

/**
 * 解析 KANO 汇总表（每行：属性名 + 6个分类频数）
 * @param {string} text - 制表符/逗号分隔数据
 * @returns {Array<{name: string, attractive: number, oneDimensional: number, mustBe: number, indifferent: number, reverse: number, questionable: number}>}
 */
export function parseKanoRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t,，]+/).map((value) => value.trim()))
    .filter((row) => row.length >= 7)
    .map((row) => {
      const counts = row.slice(1, 7).map((value) => Number(value));
      if (!row[0] || counts.some((value) => !Number.isFinite(value) || value < 0)) return null;
      return {
        name: row[0],
        attractive: counts[0],
        oneDimensional: counts[1],
        mustBe: counts[2],
        indifferent: counts[3],
        reverse: counts[4],
        questionable: counts[5]
      };
    })
    .filter(Boolean);
}

// ─── 分析计算 ───────────────────────────────────────────────

/**
 * 分析单个 KANO 属性行
 * @param {object} row - 含6个分类频数的对象
 * @returns {object} 含分类、Better/Worse系数、优先级的分析结果
 */
export function analyzeKanoRow(row) {
  const effective = row.attractive + row.oneDimensional + row.mustBe + row.indifferent;
  const classificationEntries = [
    ["魅力属性", row.attractive],
    ["期望属性", row.oneDimensional],
    ["必备属性", row.mustBe],
    ["无差异属性", row.indifferent]
  ];
  const classification = classificationEntries.sort((a, b) => b[1] - a[1])[0][0];
  const better = effective ? (row.attractive + row.oneDimensional) / effective : 0;
  const worse = effective ? -((row.mustBe + row.oneDimensional) / effective) : 0;
  const riskShare = effective ? (row.reverse + row.questionable) / (effective + row.reverse + row.questionable) : 0;
  const priority =
    classification === "必备属性"
      ? "优先保障"
      : classification === "期望属性"
        ? "重点优化"
        : classification === "魅力属性"
          ? "差异化加分"
          : "低优先级";

  return { ...row, effective, classification, better, worse, riskShare, priority };
}

/**
 * 完整 KANO 分析
 * @param {string} text - 原始数据文本
 * @returns {Array<object>} 各属性的分析结果
 */
export function analyzeKano(text) {
  const rows = parseKanoRows(text);
  if (!rows.length) throw new Error("未识别到有效的 KANO 数据。每行需包含：属性名 + 魅力/期望/必备/无差异/反向/可疑 6个频数。");
  return rows.map(analyzeKanoRow);
}

// ─── 导出辅助 ───────────────────────────────────────────────

export function kanoToExportRows(items) {
  const header = ["属性", "分类", "Better系数", "Worse系数", "有效样本", "优先级", "魅力", "期望", "必备", "无差异", "反向", "可疑"];
  const dataRows = items.map((item) => [
    item.name,
    item.classification,
    item.better.toFixed(3),
    item.worse.toFixed(3),
    String(item.effective),
    item.priority,
    String(item.attractive),
    String(item.oneDimensional),
    String(item.mustBe),
    String(item.indifferent),
    String(item.reverse),
    String(item.questionable)
  ]);
  return [header, ...dataRows];
}
