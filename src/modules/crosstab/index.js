/**
 * 交叉表分析模块 — 列联表构建 + 卡方检验 + 显著性标注 + 图表生成
 * Phase 2 增强：SVG 图表、事后比较、效应量
 */

import { chiSquarePValue, formatPercent } from "../../shared/stats.js";
import { parseDelimitedTable } from "../../shared/file-parser.js";
import { escapeHtml } from "../../shared/export.js";

// ─── 核心计算 ───────────────────────────────────────────────

/**
 * 构建交叉表（列联表）
 * @param {object[]} rows - 数据行（对象数组）
 * @param {string} rowVar - 行变量字段名
 * @param {string} colVar - 列变量字段名
 * @returns {object} 交叉表分析结果
 */
export function buildCrosstab(rows, rowVar, colVar) {
  const rowLabels = [...new Set(rows.map((row) => row[rowVar]).filter(Boolean))];
  const colLabels = [...new Set(rows.map((row) => row[colVar]).filter(Boolean))];
  const matrix = rowLabels.map((rowLabel) =>
    colLabels.map((colLabel) =>
      rows.filter((row) => row[rowVar] === rowLabel && row[colVar] === colLabel).length
    )
  );
  const rowTotals = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
  const colTotals = colLabels.map((_, colIndex) => matrix.reduce((sum, row) => sum + row[colIndex], 0));
  const total = rowTotals.reduce((sum, value) => sum + value, 0);
  let chiSquare = 0;
  let lowExpectedCells = 0;

  matrix.forEach((row, rowIndex) => {
    row.forEach((observed, colIndex) => {
      const expected = total ? (rowTotals[rowIndex] * colTotals[colIndex]) / total : 0;
      if (expected > 0) chiSquare += ((observed - expected) ** 2) / expected;
      if (expected > 0 && expected < 5) lowExpectedCells += 1;
    });
  });

  const degreesOfFreedom = Math.max(0, (rowLabels.length - 1) * (colLabels.length - 1));
  const pValue = chiSquarePValue(chiSquare, degreesOfFreedom);

  return { rowLabels, colLabels, matrix, rowTotals, colTotals, total, chiSquare, degreesOfFreedom, pValue, lowExpectedCells };
}

/**
 * 计算列百分比矩阵
 * @param {object} analysis - buildCrosstab 的返回值
 * @returns {number[][]} 百分比矩阵（0-1）
 */
export function computeColumnPercents(analysis) {
  return analysis.matrix.map((row) =>
    row.map((count, colIndex) =>
      analysis.colTotals[colIndex] ? count / analysis.colTotals[colIndex] : 0
    )
  );
}

/**
 * 计算行百分比矩阵
 */
export function computeRowPercents(analysis) {
  return analysis.matrix.map((row, rowIndex) =>
    row.map((count) =>
      analysis.rowTotals[rowIndex] ? count / analysis.rowTotals[rowIndex] : 0
    )
  );
}

/**
 * 判断显著性水平
 * @param {number|null} pValue
 * @returns {{ significant: boolean, level: string, label: string }}
 */
export function significanceLevel(pValue) {
  if (pValue === null) return { significant: false, level: "na", label: "不适用" };
  if (pValue < 0.001) return { significant: true, level: "0.001", label: "p<0.001 ***" };
  if (pValue < 0.01) return { significant: true, level: "0.01", label: "p<0.01 **" };
  if (pValue < 0.05) return { significant: true, level: "0.05", label: "p<0.05 *" };
  return { significant: false, level: "ns", label: "不显著" };
}

// ─── 多选题处理 ─────────────────────────────────────────────

/**
 * 判断列是否为二元选项列（多选题子项）
 */
export function isBinaryOptionColumn(header, rows) {
  const values = rows.map((row) => row[header]).filter((v) => v !== undefined && v !== "");
  if (!values.length) return false;
  return values.every((value) => /^(0|1|选中|未选|是|否)$/i.test(String(value).trim()));
}

/**
 * 提取题号前缀（用于分组矩阵题/多选题）
 */
export function questionPrefix(header) {
  const text = String(header || "").trim();
  const matrixMatch = text.match(/^([A-Za-z]+\d+)__\d+(?:[^A-Za-z0-9]|$)/);
  if (matrixMatch) return matrixMatch[1];
  const subQuestionMatch = text.match(/^([A-Za-z]+\d+_\d+)(?:__\d+)?(?:[^A-Za-z0-9]|$)/);
  if (subQuestionMatch) return subQuestionMatch[1];
  const match = text.match(/^([A-Za-z]+\d+)(?:[^A-Za-z0-9]|$)/);
  return match ? match[1] : "";
}

// ─── 导出辅助 ───────────────────────────────────────────────

/**
 * 将交叉表结果转为可导出的行数组
 */
export function crosstabToExportRows(analysis) {
  const headerRow = ["", ...analysis.colLabels, "合计"];
  const dataRows = analysis.rowLabels.map((label, rowIndex) => [
    label,
    ...analysis.colLabels.map((_, colIndex) => {
      const count = analysis.matrix[rowIndex][colIndex];
      const pct = analysis.colTotals[colIndex] ? count / analysis.colTotals[colIndex] : 0;
      return `${count} (${formatPercent(pct)})`;
    }),
    String(analysis.rowTotals[rowIndex])
  ]);
  const totalRow = ["合计", ...analysis.colTotals.map(String), String(analysis.total)];
  return [headerRow, ...dataRows, totalRow];
}

// ─── Phase 2: 效应量 ─────────────────────────────────────────

/**
 * 计算 Cramér's V 效应量
 * @param {object} analysis - buildCrosstab 的返回值
 * @returns {number} 0-1 之间的效应量
 */
export function cramersV(analysis) {
  const { chiSquare, total, rowLabels, colLabels } = analysis;
  const minDim = Math.min(rowLabels.length - 1, colLabels.length - 1);
  if (!total || minDim <= 0) return 0;
  return Math.sqrt(chiSquare / (total * minDim));
}

/**
 * 效应量解读
 */
export function effectSizeLabel(v) {
  if (v < 0.1) return "可忽略";
  if (v < 0.3) return "小效应";
  if (v < 0.5) return "中等效应";
  return "大效应";
}

// ─── Phase 2: 事后比较（列比例 z 检验）───────────────────────

/**
 * 列比例事后比较 — 检测哪些列之间存在显著差异
 * @param {object} analysis - buildCrosstab 的返回值
 * @param {number} rowIndex - 要比较的行索引
 * @param {number} alpha - 显著性水平（默认 0.05）
 * @returns {Array<{col1: number, col2: number, z: number, significant: boolean}>}
 */
export function columnProportionPostHoc(analysis, rowIndex, alpha = 0.05) {
  const { matrix, colTotals, colLabels } = analysis;
  const results = [];
  const row = matrix[rowIndex];
  if (!row || colTotals.length < 2) return results;

  for (let i = 0; i < colLabels.length; i++) {
    for (let j = i + 1; j < colLabels.length; j++) {
      const n1 = colTotals[i];
      const n2 = colTotals[j];
      if (!n1 || !n2) continue;
      const p1 = row[i] / n1;
      const p2 = row[j] / n2;
      const pPooled = (row[i] + row[j]) / (n1 + n2);
      const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
      const z = se > 0 ? (p1 - p2) / se : 0;
      // 双侧检验：|z| > 1.96 对应 alpha=0.05
      const zCrit = alpha <= 0.001 ? 3.291 : alpha <= 0.01 ? 2.576 : 1.96;
      results.push({
        col1: i,
        col2: j,
        col1Label: colLabels[i],
        col2Label: colLabels[j],
        p1: Number(p1.toFixed(4)),
        p2: Number(p2.toFixed(4)),
        diff: Number((p1 - p2).toFixed(4)),
        z: Number(z.toFixed(3)),
        significant: Math.abs(z) > zCrit
      });
    }
  }
  return results;
}

// ─── Phase 2: SVG 图表生成 ───────────────────────────────────

/**
 * 生成交叉表水平柱状图 SVG
 * @param {object} analysis - buildCrosstab 的返回值
 * @param {object} options - { title, colors, width, height }
 * @returns {string} SVG 字符串
 */
export function crosstabToSvgChart(analysis, options = {}) {
  const {
    title = "交叉表分析",
    width = 800,
    height = 400,
    colors = ["#2563eb", "#60a5fa", "#93c5fd", "#1e40af", "#3b82f6"]
  } = options;

  const percents = computeColumnPercents(analysis);
  const margin = { top: 50, right: 120, bottom: 40, left: 160 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const barGroupH = Math.min(40, chartH / Math.max(1, analysis.rowLabels.length));
  const barH = Math.max(8, (barGroupH - 6) / Math.max(1, analysis.colLabels.length));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="Microsoft YaHei, sans-serif">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  svg += `<text x="${width / 2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#102033">${escapeHtml(title)}</text>`;

  // Y 轴标签（行变量）
  analysis.rowLabels.forEach((label, rowIndex) => {
    const y = margin.top + rowIndex * barGroupH + barGroupH / 2;
    const displayLabel = label.length > 12 ? label.slice(0, 11) + "…" : label;
    svg += `<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#475569">${escapeHtml(displayLabel)}</text>`;
  });

  // 柱状图
  analysis.rowLabels.forEach((_, rowIndex) => {
    analysis.colLabels.forEach((_, colIndex) => {
      const pct = percents[rowIndex]?.[colIndex] || 0;
      const barWidth = Math.max(1, pct * chartW);
      const y = margin.top + rowIndex * barGroupH + colIndex * barH + 2;
      const color = colors[colIndex % colors.length];
      svg += `<rect x="${margin.left}" y="${y}" width="${barWidth}" height="${barH - 2}" fill="${color}" rx="2"/>`;
      if (pct > 0.03) {
        svg += `<text x="${margin.left + barWidth + 6}" y="${y + barH / 2 + 3}" font-size="11" fill="#475569">${(pct * 100).toFixed(1)}%</text>`;
      }
    });
  });

  // 图例
  analysis.colLabels.forEach((label, colIndex) => {
    const x = margin.left + colIndex * 130;
    const y = height - 16;
    const color = colors[colIndex % colors.length];
    svg += `<rect x="${x}" y="${y - 9}" width="12" height="12" fill="${color}" rx="2"/>`;
    const displayLabel = label.length > 10 ? label.slice(0, 9) + "…" : label;
    svg += `<text x="${x + 16}" y="${y + 1}" font-size="11" fill="#475569">${escapeHtml(displayLabel)}</text>`;
  });

  svg += `</svg>`;
  return svg;
}

/**
 * 生成显著性标注矩阵（用于表格渲染）
 * @param {object} analysis - buildCrosstab 的返回值
 * @returns {string[][]} 每个单元格带显著性标记
 */
export function significanceAnnotationMatrix(analysis) {
  const percents = computeColumnPercents(analysis);
  return analysis.rowLabels.map((_, rowIndex) => {
    const postHoc = columnProportionPostHoc(analysis, rowIndex);
    const sigCols = new Set();
    postHoc.filter((r) => r.significant).forEach((r) => {
      sigCols.add(r.col1);
      sigCols.add(r.col2);
    });
    return analysis.colLabels.map((_, colIndex) => {
      const pct = percents[rowIndex]?.[colIndex] || 0;
      const mark = sigCols.has(colIndex) ? " *" : "";
      return `${(pct * 100).toFixed(1)}%${mark}`;
    });
  });
}
