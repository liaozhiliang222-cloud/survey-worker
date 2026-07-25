/**
 * MaxDiff 最大差异缩放模块 — 题组设计 + 设计校验 + 得分分析
 *
 * 阶段三：实验设计平衡性校验（出现次数、配对覆盖度、位置均衡）
 * 阶段四：分析模型（计数法、多项逻辑斯蒂回归 MNL、层级贝叶斯 HB）
 */

// ─── 题组设计 ───────────────────────────────────────────────

/**
 * 解析项目列表（每行一个项目）
 */
export function parseLineItems(text) {
  return text
    .split(/[\r\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 生成 MaxDiff 题组设计（均衡不完全区组设计）
 * @param {string[]} items - 待测试项目列表
 * @param {number} setCount - 题组数量
 * @param {number} itemsPerSet - 每组展示项目数
 * @returns {{ items: string[], sets: Array<{set: number, items: string[]}>, counts: Map }}
 */
export function generateMaxDiffDesign(items, setCount, itemsPerSet) {
  const uniqueItems = [...new Set(items)];
  if (uniqueItems.length < itemsPerSet) {
    throw new Error("项目数量不足：待测试项目数需要不少于每题展示项目数。");
  }

  const counts = new Map(uniqueItems.map((item) => [item, 0]));
  const sets = [];

  for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
    const ordered = [...uniqueItems].sort((a, b) => {
      const countDiff = counts.get(a) - counts.get(b);
      if (countDiff !== 0) return countDiff;
      return ((uniqueItems.indexOf(a) + setIndex * 2) % uniqueItems.length) -
             ((uniqueItems.indexOf(b) + setIndex * 2) % uniqueItems.length);
    });
    const selected = [];
    let cursor = setIndex % uniqueItems.length;
    while (selected.length < itemsPerSet) {
      const candidate = ordered[cursor % ordered.length];
      if (!selected.includes(candidate)) selected.push(candidate);
      cursor += 1;
    }
    selected.forEach((item) => counts.set(item, counts.get(item) + 1));
    sets.push({ set: setIndex + 1, items: selected });
  }

  return { items: uniqueItems, sets, counts };
}

// ─── 阶段三：实验设计校验 ──────────────────────────────────

/**
 * 计算一组数值的变异系数 CV（标准差 / 均值），用于衡量均衡度
 * CV 越小代表越均衡；完美均衡时 CV = 0
 */
function coefficientOfVariation(values) {
  if (!values.length) return 0;
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean;
}

/**
 * 对 MaxDiff 题组设计进行平衡性校验
 * @param {{items: string[], sets: Array<{set: number, items: string[]}>, counts?: Map}} design
 * @param {{itemsPerSet?: number}} [options]
 * @returns {{
 *   occurrence: { counts: Record<string, number>, mean: number, cv: number, min: number, max: number, balanced: boolean },
 *   pairCoverage: { matrix: Record<string, Record<string, number>>, mean: number, cv: number, missingPairs: Array<[string,string]>, balanced: boolean },
 *   positionBalance: { matrix: Record<string, Record<number, number>>, balanced: boolean },
 *   overallScore: number,      // 0-100，越高越均衡
 *   level: "good" | "acceptable" | "warning",
 *   issues: Array<{ level: "low"|"medium"|"high", code: string, message: string }>
 * }}
 */
export function validateMaxDiffDesign(design, options = {}) {
  if (!design || !Array.isArray(design.items) || !Array.isArray(design.sets)) {
    throw new Error("设计对象无效：缺少 items 或 sets。");
  }
  const items = design.items;
  const sets = design.sets;
  const itemsPerSet = options.itemsPerSet || (sets[0]?.items.length || 0);

  const issues = [];

  // 1. 出现次数（occurrence count）
  const counts = Object.fromEntries(items.map((item) => [item, 0]));
  sets.forEach((set) => {
    (set.items || []).forEach((item) => {
      if (item in counts) counts[item] += 1;
    });
  });
  const countValues = Object.values(counts);
  const occurrenceMean = countValues.reduce((s, v) => s + v, 0) / (countValues.length || 1);
  const occurrenceCv = coefficientOfVariation(countValues);
  const occurrenceBalanced = occurrenceCv <= 0.10;
  if (!occurrenceBalanced) {
    issues.push({
      level: occurrenceCv > 0.25 ? "high" : "medium",
      code: "occurrence_imbalance",
      message: `项目出现次数不均衡（CV=${(occurrenceCv * 100).toFixed(1)}%），建议增加题组数量或调整设计。`
    });
  }

  // 2. 配对覆盖度（pair coverage）
  const pairMatrix = {};
  items.forEach((a) => {
    pairMatrix[a] = {};
    items.forEach((b) => {
      if (a !== b) pairMatrix[a][b] = 0;
    });
  });
  sets.forEach((set) => {
    const setItems = set.items || [];
    for (let i = 0; i < setItems.length; i += 1) {
      for (let j = i + 1; j < setItems.length; j += 1) {
        const a = setItems[i];
        const b = setItems[j];
        if (a in pairMatrix && b in pairMatrix[a]) {
          pairMatrix[a][b] += 1;
          pairMatrix[b][a] += 1;
        }
      }
    }
  });
  const pairValues = [];
  const missingPairs = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      const value = pairMatrix[a]?.[b] || 0;
      pairValues.push(value);
      if (value === 0) missingPairs.push([a, b]);
    }
  }
  const pairMean = pairValues.reduce((s, v) => s + v, 0) / (pairValues.length || 1);
  const pairCv = coefficientOfVariation(pairValues);
  const pairBalanced = pairCv <= 0.25 && missingPairs.length === 0;
  if (missingPairs.length > 0) {
    issues.push({
      level: "high",
      code: "missing_pairs",
      message: `存在 ${missingPairs.length} 对项目从未共同出现，配对覆盖不完整。`
    });
  }
  if (!pairBalanced && missingPairs.length === 0) {
    issues.push({
      level: pairCv > 0.4 ? "medium" : "low",
      code: "pair_imbalance",
      message: `配对共现次数波动较大（CV=${(pairCv * 100).toFixed(1)}%）。`
    });
  }

  // 3. 位置均衡（position balance）
  const positionMatrix = {};
  items.forEach((item) => {
    positionMatrix[item] = {};
    for (let p = 0; p < itemsPerSet; p += 1) positionMatrix[item][p] = 0;
  });
  sets.forEach((set) => {
    (set.items || []).forEach((item, position) => {
      if (item in positionMatrix && position in positionMatrix[item]) {
        positionMatrix[item][position] += 1;
      }
    });
  });
  const positionCvs = items.map((item) =>
    coefficientOfVariation(Object.values(positionMatrix[item]))
  );
  const avgPositionCv = positionCvs.reduce((s, v) => s + v, 0) / (positionCvs.length || 1);
  const positionBalanced = avgPositionCv <= 0.35;
  if (!positionBalanced) {
    issues.push({
      level: "low",
      code: "position_imbalance",
      message: `项目在位置上的分布不均衡（平均 CV=${(avgPositionCv * 100).toFixed(1)}%），可能引入位置偏误。`
    });
  }

  // 综合评分（位置均衡只作软性扣分）
  let score = 100;
  score -= Math.min(40, occurrenceCv * 200);
  score -= Math.min(30, pairCv * 100);
  score -= missingPairs.length * 5;
  score -= Math.min(10, avgPositionCv * 30);
  score = Math.max(0, Math.round(score));

  let level = "good";
  if (score < 60) level = "warning";
  else if (score < 85) level = "acceptable";

  if (!issues.length) {
    issues.push({
      level: "low",
      code: "design_ok",
      message: "设计平衡性良好，可用于正式数据采集。"
    });
  }

  return {
    occurrence: {
      counts,
      mean: Number(occurrenceMean.toFixed(3)),
      cv: Number(occurrenceCv.toFixed(3)),
      min: Math.min(...countValues),
      max: Math.max(...countValues),
      balanced: occurrenceBalanced
    },
    pairCoverage: {
      matrix: pairMatrix,
      mean: Number(pairMean.toFixed(3)),
      cv: Number(pairCv.toFixed(3)),
      missingPairs,
      balanced: pairBalanced
    },
    positionBalance: {
      matrix: positionMatrix,
      avgCv: Number(avgPositionCv.toFixed(3)),
      balanced: positionBalanced
    },
    overallScore: score,
    level,
    issues
  };
}

// ─── 得分分析 ───────────────────────────────────────────────

/**
 * 解析 MaxDiff 得分数据
 * @param {string} text - 每行：项目名, 被选最好次数, 被选最差次数, 展示次数
 * @returns {Array<{item: string, best: number, worst: number, shown: number, score: number}>}
 */
export function parseMaxDiffScores(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t,，]+/).map((value) => value.trim()))
    .filter((row) => row.length >= 4)
    .map((row) => {
      const best = Number(row[1]);
      const worst = Number(row[2]);
      const shown = Number(row[3]);
      if (!row[0] || !Number.isFinite(best) || !Number.isFinite(worst) || !Number.isFinite(shown) || shown <= 0) return null;
      return {
        item: row[0],
        best,
        worst,
        shown,
        score: (best - worst) / shown
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

/**
 * 计算 MaxDiff 偏好份额（Share of Preference）
 * @param {Array} scores - parseMaxDiffScores 的返回值
 * @returns {Array<{item: string, score: number, share: number, rank: number}>}
 */
export function computePreferenceShare(scores) {
  if (!scores.length) return [];
  const minScore = Math.min(...scores.map((s) => s.score));
  const shifted = scores.map((s) => ({ ...s, shifted: s.score - minScore + 0.001 }));
  const total = shifted.reduce((sum, s) => sum + s.shifted, 0);
  return shifted
    .map((s, index) => ({
      item: s.item,
      score: s.score,
      best: s.best,
      worst: s.worst,
      shown: s.shown,
      share: s.shifted / total,
      rank: index + 1
    }))
    .sort((a, b) => b.share - a.share)
    .map((s, index) => ({ ...s, rank: index + 1 }));
}

// ─── 阶段四：响应数据解析 ──────────────────────────────────

/**
 * 解析 MaxDiff 响应数据（个体级原始选择）
 * 输入格式（每行）: 受访者ID, 题组编号, best 项目, worst 项目
 * 也接受 5 列：受访者ID, 题组编号, best 项目, worst 项目, 展示项目（以 | 分隔）
 * @param {string} text
 * @returns {{ respondents: string[], items: string[], responses: Array<{respondent: string, set: number, best: string, worst: string, shown?: string[]}> }}
 */
export function parseMaxDiffResponses(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const responses = [];
  const itemSet = new Set();
  const respondentSet = new Set();

  lines.forEach((line) => {
    const cols = line.split(/[\t,，]+/).map((v) => v.trim());
    if (cols.length < 4) return;
    const respondent = cols[0];
    const setNum = Number(cols[1]);
    const best = cols[2];
    const worst = cols[3];
    if (!respondent || !Number.isFinite(setNum) || !best || !worst) return;
    respondentSet.add(respondent);
    itemSet.add(best);
    itemSet.add(worst);
    const response = { respondent, set: setNum, best, worst };
    if (cols[4]) {
      response.shown = cols[4].split(/[|｜;；]+/).map((s) => s.trim()).filter(Boolean);
      response.shown.forEach((it) => itemSet.add(it));
    }
    responses.push(response);
  });

  return {
    respondents: [...respondentSet],
    items: [...itemSet],
    responses
  };
}

/**
 * 把响应数据聚合成汇总次数（用于计数法）
 * @param {Array<{respondent: string, set: number, best: string, worst: string, shown?: string[]}>} responses
 * @param {string[]} items
 * @returns {Array<{item: string, best: number, worst: number, shown: number, score: number}>}
 */
export function aggregateResponsesToCounts(responses, items) {
  const stats = new Map(items.map((item) => [item, { best: 0, worst: 0, shown: 0 }]));
  responses.forEach((r) => {
    if (stats.has(r.best)) stats.get(r.best).best += 1;
    if (stats.has(r.worst)) stats.get(r.worst).worst += 1;
    const shown = r.shown && r.shown.length ? r.shown : [];
    shown.forEach((it) => {
      if (stats.has(it)) stats.get(it).shown += 1;
    });
  });
  // 如果没有 shown 信息，使用 best+worst 出现次数近似
  return items.map((item) => {
    const s = stats.get(item);
    const shown = s.shown || s.best + s.worst;
    return {
      item,
      best: s.best,
      worst: s.worst,
      shown,
      score: shown > 0 ? (s.best - s.worst) / shown : 0
    };
  }).sort((a, b) => b.score - a.score);
}

// ─── 阶段四：MNL 多项逻辑斯蒂回归 ─────────────────────────

/**
 * Softmax 数值稳定版本
 */
function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
}

/**
 * 多项逻辑斯蒂回归（MNL）估计 MaxDiff 效用值
 * 基于 best 选择建模：在每个题组中，受访者选择 best 的概率 P(best=i) = exp(u_i) / Σ exp(u_j)
 * 采用梯度下降法（带 L2 正则）求解
 *
 * @param {Array<{respondent: string, set: number, best: string, worst: string, shown?: string[]}>} responses
 * @param {string[]} items
 * @param {{ iterations?: number, learningRate?: number, l2?: number, reference?: string }} [options]
 * @returns {{
 *   utilities: Array<{item: string, utility: number, se: number, rank: number, share: number}>,
 *   logLikelihood: number,
 *   iterations: number,
 *   converged: boolean
 * }}
 */
export function estimateMNLUtilities(responses, items, options = {}) {
  const iterations = options.iterations || 400;
  const learningRate = options.learningRate || 0.05;
  const l2 = options.l2 ?? 0.01;
  const reference = options.reference || items[0];

  if (!items.length || !responses.length) {
    return {
      utilities: items.map((item) => ({ item, utility: 0, se: 0, rank: 1, share: 1 / Math.max(1, items.length) })),
      logLikelihood: 0,
      iterations: 0,
      converged: false
    };
  }

  const itemIndex = new Map(items.map((item, i) => [item, i]));
  // 按 set 分组 best 选择，题组内展示项目集合
  const groups = [];
  responses.forEach((r) => {
    if (!itemIndex.has(r.best)) return;
    const shownItems = (r.shown && r.shown.length ? r.shown : [r.best, r.worst]).filter((it) => itemIndex.has(it));
    if (!shownItems.length) return;
    groups.push({ chosen: itemIndex.get(r.best), shown: shownItems.map((it) => itemIndex.get(it)) });
  });

  const n = items.length;
  const refIdx = itemIndex.get(reference) ?? 0;
  // 效用向量（参考项固定为 0）
  const utilities = new Array(n).fill(0);
  const grad = new Array(n).fill(0);

  let prevLL = -Infinity;
  let converged = false;

  for (let iter = 0; iter < iterations; iter += 1) {
    grad.fill(0);
    let logLikelihood = 0;

    for (const group of groups) {
      const logits = group.shown.map((idx) => utilities[idx]);
      const probs = softmax(logits);
      probs.forEach((p, k) => {
        grad[group.shown[k]] -= p;
      });
      grad[group.chosen] += 1;
      // 找到 chosen 在 shown 中的位置
      const chosenPos = group.shown.indexOf(group.chosen);
      if (chosenPos >= 0 && probs[chosenPos] > 0) {
        logLikelihood += Math.log(probs[chosenPos]);
      }
    }

    // L2 正则（除参考项外）
    for (let i = 0; i < n; i += 1) {
      if (i === refIdx) continue;
      grad[i] -= l2 * utilities[i];
    }

    // 梯度下降
    for (let i = 0; i < n; i += 1) {
      if (i === refIdx) continue;
      utilities[i] += learningRate * grad[i];
    }
    // 参考项固定
    utilities[refIdx] = 0;

    // 收敛判断
    if (Math.abs(logLikelihood - prevLL) < 1e-6) {
      converged = true;
      prevLL = logLikelihood;
      break;
    }
    prevLL = logLikelihood;
  }

  // 计算偏好份额（基于 softmax 转换）
  const expU = utilities.map((u) => Math.exp(u - Math.max(...utilities)));
  const sumExp = expU.reduce((s, v) => s + v, 0);
  const shares = expU.map((e) => e / sumExp);

  // 标准误近似（用 Hessian 对角线逆的平方根，简化处理）
  const se = new Array(n).fill(0);
  const hessianDiag = new Array(n).fill(0);
  for (const group of groups) {
    const logits = group.shown.map((idx) => utilities[idx]);
    const probs = softmax(logits);
    probs.forEach((p, k) => {
      hessianDiag[group.shown[k]] += p * (1 - p);
    });
  }
  for (let i = 0; i < n; i += 1) {
    if (i === refIdx) continue;
    const h = hessianDiag[i] + l2;
    se[i] = h > 0 ? 1 / Math.sqrt(h) : 0;
  }

  const result = items.map((item, i) => ({
    item,
    utility: Number(utilities[i].toFixed(4)),
    se: Number(se[i].toFixed(4)),
    share: Number(shares[i].toFixed(4)),
    rank: 0
  })).sort((a, b) => b.utility - a.utility);

  result.forEach((r, i) => { r.rank = i + 1; });

  return {
    utilities: result,
    logLikelihood: Number(prevLL.toFixed(4)),
    iterations,
    converged
  };
}

// ─── 阶段四：HB 层级贝叶斯（简化版本）──────────────────────

/**
 * 简化版 Hierarchical Bayes 估计个体级效用
 * 上层：群体均值 μ ~ Normal(0, σ²)
 * 下层：每个受访者个体效用 θ_i ~ Normal(μ, τ²)
 * 观测层：每个受访者在其题组中的 best 选择服从 MNL(θ_i)
 *
 * 实现：使用经验贝叶斯收缩（Empirical Bayes Shrinkage）
 *  1. 对每个受访者单独跑 MNL，得到个体效用估计 θ_i 与方差 v_i
 *  2. 群体均值 μ = weighted mean(θ_i, 1/v_i)
 *  3. 群体方差 τ² = max(0, var(θ_i) - mean(v_i))
 *  4. 收缩后效用 = (θ_i / v_i + μ / τ²) / (1/v_i + 1/τ²)
 *
 * @param {Array<{respondent: string, set: number, best: string, worst: string, shown?: string[]}>} responses
 * @param {string[]} items
 * @param {{ iterations?: number, learningRate?: number, l2?: number, reference?: string, minResponses?: number }} [options]
 * @returns {{
 *   groupUtilities: Array<{item: string, utility: number, se: number, rank: number, share: number}>,
 *   individualUtilities: Array<{respondent: string, utilities: Record<string, number>}>,
 *   logLikelihood: number,
 *   respondentCount: number,
 *   converged: boolean
 * }}
 */
export function estimateHBUtilities(responses, items, options = {}) {
  const iterations = options.iterations || 200;
  const learningRate = options.learningRate || 0.05;
  const l2 = options.l2 ?? 0.05;
  const reference = options.reference || items[0];
  const minResponses = options.minResponses ?? 3;

  if (!items.length || !responses.length) {
    return {
      groupUtilities: items.map((item) => ({ item, utility: 0, se: 0, rank: 1, share: 1 / Math.max(1, items.length) })),
      individualUtilities: [],
      logLikelihood: 0,
      respondentCount: 0,
      converged: false
    };
  }

  // 按受访者分组
  const byRespondent = new Map();
  responses.forEach((r) => {
    if (!byRespondent.has(r.respondent)) byRespondent.set(r.respondent, []);
    byRespondent.get(r.respondent).push(r);
  });

  const individualUtilities = [];
  const perRespondentEstimates = []; // [{utility: number[], variance: number[]}]

  for (const [respondent, respList] of byRespondent.entries()) {
    if (respList.length < minResponses) {
      // 样本太少，直接用群体均值（在第一次迭代后回填）
      individualUtilities.push({
        respondent,
        utilities: Object.fromEntries(items.map((it) => [it, 0]))
      });
      perRespondentEstimates.push({ respondent, utility: items.map(() => 0), variance: items.map(() => 1) });
      continue;
    }
    // 个体级 MNL，加大 L2 防止过拟合
    const mnl = estimateMNLUtilities(respList, items, { iterations, learningRate, l2: l2 * 4, reference });
    const utilityMap = new Map(mnl.utilities.map((u) => [u.item, u.utility]));
    const seMap = new Map(mnl.utilities.map((u) => [u.item, u.se]));
    individualUtilities.push({
      respondent,
      utilities: Object.fromEntries(items.map((it) => [it, utilityMap.get(it) || 0]))
    });
    perRespondentEstimates.push({
      respondent,
      utility: items.map((it) => utilityMap.get(it) || 0),
      variance: items.map((it) => {
        const se = seMap.get(it) || 1;
        return Math.max(0.01, se * se);
      })
    });
  }

  // 经验贝叶斯收缩
  const n = items.length;
  const refIdx = items.indexOf(reference);
  const groupMean = new Array(n).fill(0);
  const groupVariance = new Array(n).fill(0);

  for (let i = 0; i < n; i += 1) {
    if (i === refIdx) {
      groupMean[i] = 0;
      groupVariance[i] = 0;
      continue;
    }
    const thetas = perRespondentEstimates.map((p) => p.utility[i]);
    const variances = perRespondentEstimates.map((p) => p.variance[i]);
    // 加权均值
    const weights = variances.map((v) => 1 / Math.max(0.001, v));
    const weightSum = weights.reduce((s, w) => s + w, 0);
    const mean = thetas.reduce((s, t, k) => s + t * weights[k], 0) / weightSum;
    // 群体方差 = max(0, 总方差 - 平均个体方差)
    const totalVar = thetas.reduce((s, t) => s + (t - mean) ** 2, 0) / (thetas.length || 1);
    const avgIndivVar = variances.reduce((s, v) => s + v, 0) / (variances.length || 1);
    const tau2 = Math.max(0, totalVar - avgIndivVar);
    groupMean[i] = mean;
    groupVariance[i] = tau2;
  }

  // 个体级收缩
  individualUtilities.forEach((ind, k) => {
    const estimate = perRespondentEstimates[k];
    items.forEach((item, i) => {
      if (i === refIdx) {
        ind.utilities[item] = 0;
        return;
      }
      const theta = estimate.utility[i];
      const v = estimate.variance[i];
      const tau2 = Math.max(0.001, groupVariance[i]);
      // 收缩：(θ/v + μ/τ²) / (1/v + 1/τ²)
      ind.utilities[item] = Number(((theta / v + groupMean[i] / tau2) / (1 / v + 1 / tau2)).toFixed(4));
    });
  });

  // 群体效用（基于收缩后的个体效用平均）
  const groupUtilitiesRaw = new Array(n).fill(0);
  individualUtilities.forEach((ind) => {
    items.forEach((item, i) => {
      groupUtilitiesRaw[i] += ind.utilities[item];
    });
  });
  for (let i = 0; i < n; i += 1) {
    groupUtilitiesRaw[i] /= individualUtilities.length || 1;
  }
  groupUtilitiesRaw[refIdx] = 0;

  // 计算群体偏好份额
  const expU = groupUtilitiesRaw.map((u) => Math.exp(u - Math.max(...groupUtilitiesRaw)));
  const sumExp = expU.reduce((s, v) => s + v, 0);
  const shares = expU.map((e) => e / sumExp);

  // 群体标准误（个体效用的标准差 / √n）
  const groupSe = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    if (i === refIdx) continue;
    const values = individualUtilities.map((ind) => ind.utilities[items[i]]);
    const m = values.reduce((s, v) => s + v, 0) / (values.length || 1);
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length || 1);
    groupSe[i] = Math.sqrt(variance / Math.max(1, values.length));
  }

  const groupResult = items.map((item, i) => ({
    item,
    utility: Number(groupUtilitiesRaw[i].toFixed(4)),
    se: Number(groupSe[i].toFixed(4)),
    share: Number(shares[i].toFixed(4)),
    rank: 0
  })).sort((a, b) => b.utility - a.utility);
  groupResult.forEach((r, i) => { r.rank = i + 1; });

  // 重新计算 log likelihood（基于群体效用）
  let logLikelihood = 0;
  const utilityMap = new Map(groupResult.map((u) => [u.item, u.utility]));
  responses.forEach((r) => {
    const shownItems = (r.shown && r.shown.length ? r.shown : [r.best, r.worst]).filter((it) => utilityMap.has(it));
    if (!shownItems.length || !utilityMap.has(r.best)) return;
    const logits = shownItems.map((it) => utilityMap.get(it));
    const probs = softmax(logits);
    const chosenPos = shownItems.indexOf(r.best);
    if (chosenPos >= 0 && probs[chosenPos] > 0) {
      logLikelihood += Math.log(probs[chosenPos]);
    }
  });

  return {
    groupUtilities: groupResult,
    individualUtilities,
    logLikelihood: Number(logLikelihood.toFixed(4)),
    respondentCount: individualUtilities.length,
    converged: true
  };
}

// ─── 导出辅助 ───────────────────────────────────────────────

export function maxDiffDesignToExportRows(design) {
  const rows = [["任务", "位置", "项目"]];
  design.sets.forEach((set) => {
    set.items.forEach((item, index) => rows.push([String(set.set), String(index + 1), item]));
  });
  rows.push([], ["项目展示次数"], ["项目", "展示次数"]);
  design.items.forEach((item) => rows.push([item, String(design.counts.get(item))]));
  return rows;
}

export function maxDiffScoresToExportRows(scores) {
  const header = ["排名", "项目", "得分", "偏好份额", "被选最好", "被选最差", "展示次数"];
  const dataRows = scores.map((s) => [
    String(s.rank),
    s.item,
    s.score.toFixed(4),
    `${(s.share * 100).toFixed(1)}%`,
    String(s.best),
    String(s.worst),
    String(s.shown)
  ]);
  return [header, ...dataRows];
}

/**
 * 把校验结果转成 Excel 导出行
 */
export function maxDiffValidationToExportRows(validation) {
  const rows = [
    ["MaxDiff 设计平衡性校验"],
    ["整体评分", `${validation.overallScore}/100`, validation.level],
    [],
    ["出现次数（occurrence）"],
    ["项目", "出现次数"],
    ...Object.entries(validation.occurrence.counts).map(([item, count]) => [item, String(count)]),
    ["均值", String(validation.occurrence.mean)],
    ["变异系数 CV", String(validation.occurrence.cv)],
    ["最小/最大", `${validation.occurrence.min}/${validation.occurrence.max}`],
    [],
    ["配对覆盖度（pair coverage）"],
    ["平均共现", String(validation.pairCoverage.mean)],
    ["变异系数 CV", String(validation.pairCoverage.cv)],
    ["未覆盖配对数", String(validation.pairCoverage.missingPairs.length)],
  ];
  if (validation.pairCoverage.missingPairs.length) {
    rows.push([], ["未覆盖项目对"]);
    validation.pairCoverage.missingPairs.forEach(([a, b]) => rows.push([a, b]));
  }
  rows.push([], ["问题清单"]);
  rows.push(["级别", "代码", "说明"]);
  validation.issues.forEach((issue) => rows.push([issue.level, issue.code, issue.message]));
  return rows;
}

/**
 * 把 MNL/HB 效用结果转成 Excel 导出行
 */
export function maxDiffUtilitiesToExportRows(result, modelName = "MNL") {
  const rows = [
    [`${modelName} 效用估计`],
    ["对数似然 LL", String(result.logLikelihood)],
    ...(result.converged !== undefined ? [["收敛", result.converged ? "是" : "否"]] : []),
    ...(result.respondentCount !== undefined ? [["受访者数", String(result.respondentCount)]] : []),
    [],
    ["排名", "项目", "效用值", "标准误", "偏好份额"]
  ];
  result.utilities.forEach((u) => {
    rows.push([String(u.rank), u.item, u.utility.toFixed(4), u.se.toFixed(4), `${(u.share * 100).toFixed(2)}%`]);
  });
  return rows;
}
