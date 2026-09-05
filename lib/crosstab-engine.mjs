function gammaLog(value) {
  const coefficients = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let x = value; let y = value; let temporary = x + 5.5; temporary -= (x + 0.5) * Math.log(temporary); let series = 1.000000000190015;
  for (const coefficient of coefficients) { y += 1; series += coefficient / y; }
  return Math.log(2.5066282746310005 * series / x) - temporary;
}
function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) { let ap = a; let sum = 1 / a; let delta = sum; for (let index = 1; index <= 100; index += 1) { ap += 1; delta *= x / ap; sum += delta; if (Math.abs(delta) < Math.abs(sum) * 1e-8) break; } return sum * Math.exp(-x + a * Math.log(x) - gammaLog(a)); }
  let b = x + 1 - a; let c = 1 / 1e-30; let d = 1 / b; let h = d;
  for (let index = 1; index <= 100; index += 1) { const an = -index * (index - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30; c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const delta = d * c; h *= delta; if (Math.abs(delta - 1) < 1e-8) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - gammaLog(a)) * h;
}
function chiSquarePValue(chiSquare, degreesOfFreedom) { return !Number.isFinite(chiSquare) || degreesOfFreedom <= 0 ? null : Math.max(0, Math.min(1, 1 - gammaP(degreesOfFreedom / 2, chiSquare / 2))); }

export function buildCrosstab(rows, rowVariable, columnVariable) {
  const rowLabels = [...new Set(rows.map((row) => row[rowVariable]).filter(Boolean))]; const colLabels = [...new Set(rows.map((row) => row[columnVariable]).filter(Boolean))];
  const rowMap = new Map(rowLabels.map((label, index) => [label, index])); const colMap = new Map(colLabels.map((label, index) => [label, index])); const matrix = rowLabels.map(() => colLabels.map(() => 0));
  for (const row of rows) { const rowIndex = rowMap.get(row[rowVariable]); const colIndex = colMap.get(row[columnVariable]); if (rowIndex != null && colIndex != null) matrix[rowIndex][colIndex] += 1; }
  const rowTotals = matrix.map((row) => row.reduce((sum, value) => sum + value, 0)); const colTotals = colLabels.map((_, colIndex) => matrix.reduce((sum, row) => sum + row[colIndex], 0)); const total = rowTotals.reduce((sum, value) => sum + value, 0);
  let chiSquare = 0; let lowExpectedCells = 0;
  matrix.forEach((row, rowIndex) => row.forEach((observed, colIndex) => { const expected = total ? rowTotals[rowIndex] * colTotals[colIndex] / total : 0; if (expected > 0) chiSquare += (observed - expected) ** 2 / expected; if (expected > 0 && expected < 5) lowExpectedCells += 1; }));
  const degreesOfFreedom = Math.max(0, (rowLabels.length - 1) * (colLabels.length - 1)); return { rowLabels, colLabels, matrix, rowTotals, colTotals, total, chiSquare, degreesOfFreedom, pValue: chiSquarePValue(chiSquare, degreesOfFreedom), lowExpectedCells };
}
export function computeColumnPercents(analysis) { return analysis.matrix.map((row) => row.map((count, columnIndex) => analysis.colTotals[columnIndex] ? count / analysis.colTotals[columnIndex] : 0)); }
export function significanceLevel(pValue) { if (pValue == null) return { significant: false, level: "na", label: "不适用" }; if (pValue < 0.001) return { significant: true, level: "0.001", label: "p<0.001 ***" }; if (pValue < 0.01) return { significant: true, level: "0.01", label: "p<0.01 **" }; if (pValue < 0.05) return { significant: true, level: "0.05", label: "p<0.05 *" }; return { significant: false, level: "ns", label: "不显著" }; }
export function cramersV(analysis) { const minimum = Math.min(analysis.rowLabels.length - 1, analysis.colLabels.length - 1); return !analysis.total || minimum <= 0 ? 0 : Math.sqrt(analysis.chiSquare / (analysis.total * minimum)); }
export function effectSizeLabel(value) { return value < 0.1 ? "可忽略" : value < 0.3 ? "小效应" : value < 0.5 ? "中等效应" : "大效应"; }
export function columnProportionPostHoc(analysis, rowIndex, alpha = 0.05) { const output = []; const row = analysis.matrix[rowIndex]; if (!row) return output; for (let left = 0; left < analysis.colLabels.length; left += 1) for (let right = left + 1; right < analysis.colLabels.length; right += 1) { const n1 = analysis.colTotals[left]; const n2 = analysis.colTotals[right]; if (!n1 || !n2) continue; const p1 = row[left] / n1; const p2 = row[right] / n2; const pooled = (row[left] + row[right]) / (n1 + n2); const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2)); const z = standardError ? (p1 - p2) / standardError : 0; const critical = alpha <= 0.001 ? 3.291 : alpha <= 0.01 ? 2.576 : 1.96; output.push({ col1: left, col2: right, col1Label: analysis.colLabels[left], col2Label: analysis.colLabels[right], p1: Number(p1.toFixed(4)), p2: Number(p2.toFixed(4)), diff: Number((p1 - p2).toFixed(4)), z: Number(z.toFixed(3)), significant: Math.abs(z) > critical }); } return output; }
