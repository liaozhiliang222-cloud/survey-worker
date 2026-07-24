/**
 * PSM 价格敏感度分析模块
 * Van Westendorp Price Sensitivity Meter
 */

// ─── 数据解析 ───────────────────────────────────────────────

/**
 * 解析 PSM 原始数据（每行4个价格：太便宜/便宜/贵/太贵）
 * @param {string} text - 制表符/逗号/空格分隔的价格数据
 * @returns {Array<{tooCheap: number, cheap: number, expensive: number, tooExpensive: number}>}
 */
export function parsePsmRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t,，\s]+/).map((value) => Number(value)))
    .filter((row) => row.length >= 4 && row.slice(0, 4).every((value) => Number.isFinite(value) && value > 0))
    .map((row) => ({
      tooCheap: row[0],
      cheap: row[1],
      expensive: row[2],
      tooExpensive: row[3]
    }));
}

// ─── 曲线构建 ───────────────────────────────────────────────

function percentileAtOrAbove(values, price) {
  return (values.filter((value) => value >= price).length / values.length) * 100;
}

function percentileAtOrBelow(values, price) {
  return (values.filter((value) => value <= price).length / values.length) * 100;
}

/**
 * 构建 PSM 四条曲线
 * @param {Array} rows - parsePsmRows 的返回值
 * @returns {Array<{price: number, tooCheap: number, cheap: number, expensive: number, tooExpensive: number}>}
 */
export function buildPsmCurve(rows) {
  const tooCheap = rows.map((row) => row.tooCheap);
  const cheap = rows.map((row) => row.cheap);
  const expensive = rows.map((row) => row.expensive);
  const tooExpensive = rows.map((row) => row.tooExpensive);
  const prices = [...new Set([...tooCheap, ...cheap, ...expensive, ...tooExpensive])].sort((a, b) => a - b);

  return prices.map((price) => ({
    price,
    tooCheap: percentileAtOrAbove(tooCheap, price),
    cheap: percentileAtOrAbove(cheap, price),
    expensive: percentileAtOrBelow(expensive, price),
    tooExpensive: percentileAtOrBelow(tooExpensive, price)
  }));
}

// ─── 关键点计算 ─────────────────────────────────────────────

/**
 * 查找两条曲线的交点价格
 */
export function findCurveIntersection(points, leftKey, rightKey, options = {}) {
  const minAverage = options.minAverage || 0;

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const prevDiff = prev[leftKey] - prev[rightKey];
    const currentDiff = current[leftKey] - current[rightKey];
    const prevAverage = (prev[leftKey] + prev[rightKey]) / 2;
    const currentAverage = (current[leftKey] + current[rightKey]) / 2;

    if (prevDiff === 0 && prevAverage >= minAverage) return prev.price;
    if (prevDiff * currentDiff <= 0) {
      const span = current.price - prev.price;
      const ratio = Math.abs(prevDiff) / (Math.abs(prevDiff) + Math.abs(currentDiff));
      const price = prev.price + span * ratio;
      const average = prevAverage + (currentAverage - prevAverage) * ratio;
      if (average >= minAverage) return price;
    }
  }
  return null;
}

/**
 * 计算 PSM 四个关键价格点
 * @param {Array} curve - buildPsmCurve 的返回值
 * @returns {{ OPP: number|null, IDP: number|null, PMC: number|null, PME: number|null }}
 */
export function computePsmKeyPoints(curve) {
  // OPP (Optimal Price Point): tooCheap × tooExpensive 交点
  const OPP = findCurveIntersection(curve, "tooCheap", "tooExpensive");
  // IDP (Indifference Price Point): cheap × expensive 交点
  const IDP = findCurveIntersection(curve, "cheap", "expensive");
  // PMC (Point of Marginal Cheapness): tooCheap × expensive 交点
  const PMC = findCurveIntersection(curve, "tooCheap", "expensive");
  // PME (Point of Marginal Expensiveness): cheap × tooExpensive 交点
  const PME = findCurveIntersection(curve, "cheap", "tooExpensive");

  return { OPP, IDP, PMC, PME };
}

/**
 * 完整 PSM 分析流程
 * @param {string} text - 原始数据文本
 * @returns {{ rows: Array, curve: Array, keyPoints: object, sampleSize: number }}
 */
export function analyzePsm(text) {
  const rows = parsePsmRows(text);
  if (!rows.length) throw new Error("未识别到有效的 PSM 价格数据。每行需包含4个正数：太便宜、便宜、贵、太贵。");
  const curve = buildPsmCurve(rows);
  const keyPoints = computePsmKeyPoints(curve);
  return { rows, curve, keyPoints, sampleSize: rows.length };
}

// ─── 格式化 ─────────────────────────────────────────────────

export function formatPrice(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, "") : "未识别";
}
