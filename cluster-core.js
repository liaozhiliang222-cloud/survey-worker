/**
 * 用户分群分析 — 本地聚类算法核心（纯函数，无 DOM 依赖）
 *
 * 三种分群方法（参考主流统计软件的聚类方法与公开算法原理实现）：
 *   - K-Means 聚类（批量 / 运行均值 / 仅分类）
 *   - 两步聚类（CF Tree 预聚类 + 凝聚聚合，BIC/AIC 自动选群数）
 *   - 系统聚类／层次聚类（七种联接方法，区间 / 计数 / 二元距离）
 *
 * 由于初始化、数据顺序和软件内部优化机制不同，结果可能与其他统计软件存在差异。
 *
 * 加载方式：
 *   - 浏览器主线程：<script src="./cluster-core.js">
 *   - Web Worker：importScripts("./cluster-core.js")
 *   - 测试：runInThisContext(readFileSync(...))
 * 统一挂载到 globalThis.ClusterCore。
 */
(function initClusterCore(root) {
  "use strict";

  // ─── 工具函数 ─────────────────────────────────────────────

  /** 固定种子伪随机数生成器（mulberry32），保证结果可复现 */
  function mulberry32(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === "";
  }

  /** 尝试解析数值；解析失败返回 null（不区分数字字符串与数字） */
  function toNumber(value) {
    if (isBlank(value)) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function uniqueValues(rows, header) {
    const set = new Set();
    for (let i = 0; i < rows.length; i += 1) {
      const value = String(rows[i][header] ?? "").trim();
      if (value !== "") set.add(value);
    }
    return Array.from(set);
  }

  function countMissing(rows, header, userMissingCodes) {
    let count = 0;
    const codes = new Set((userMissingCodes || []).map((code) => String(code).trim()));
    for (let i = 0; i < rows.length; i += 1) {
      const value = rows[i][header];
      if (isBlank(value) || codes.has(String(value).trim())) count += 1;
    }
    return count;
  }

  /** 判断某值是否属于缺失（系统缺失 + 用户定义缺失码） */
  function isMissingValue(value, userMissingCodes) {
    if (isBlank(value)) return true;
    const codes = userMissingCodes || [];
    const text = String(value).trim();
    for (let i = 0; i < codes.length; i += 1) {
      if (String(codes[i]).trim() === text) return true;
    }
    return false;
  }

  function safeMean(values) {
    const nums = values.filter((value) => Number.isFinite(value));
    if (!nums.length) return null;
    return nums.reduce((sum, value) => sum + value, 0) / nums.length;
  }

  function safeStd(values, mean) {
    const nums = values.filter((value) => Number.isFinite(value));
    if (nums.length < 2) return null;
    const m = mean === undefined ? safeMean(nums) : mean;
    const variance = nums.reduce((sum, value) => sum + (value - m) * (value - m), 0) / (nums.length - 1);
    return Math.sqrt(variance);
  }

  /** 规范化文本（用于类别比较） */
  function normText(value) {
    return String(value ?? "").trim();
  }

  // ─── 变量类型识别 ─────────────────────────────────────────

  const MEASUREMENT_TYPES = ["scale", "ordinal", "nominal", "binary", "count"];
  const ROLES = ["id", "cluster", "profile", "weight", "excluded"];

  /** 识别多选变量组（Q5_1 / Q5_2 / Q5_3 或 Q5_R1 / Q5_R2） */
  function detectMultiSelectGroups(headers) {
    const groups = new Map();
    const pattern = /^(.+?)(?:_+R?)(\d+)$/i;
    headers.forEach((header) => {
      const match = header.match(pattern);
      if (!match) return;
      const base = match[1];
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base).push(header);
    });
    return Array.from(groups.entries())
      .filter(([, items]) => items.length >= 2)
      .map(([name, variables]) => ({ name, variables }));
  }

  /** 根据数据自动判断单个变量的测量类型 */
  function detectMeasurement(rows, header) {
    const values = uniqueValues(rows, header);
    if (!values.length) return "nominal";
    const numericValues = values.map(Number).filter(Number.isFinite);
    const allNumeric = numericValues.length === values.length;
    if (allNumeric) {
      const set = new Set(numericValues);
      if (set.size === 2) {
        const sorted = numericValues.slice().sort((a, b) => a - b);
        if (sorted[0] === 0 && sorted[1] === 1) return "binary";
      }
      const allInteger = numericValues.every((value) => Number.isInteger(value));
      if (set.size <= 12 && allInteger) return "ordinal";
      if (allInteger) {
        const nonNegative = numericValues.every((value) => value >= 0);
        if (nonNegative) return "count";
      }
      return "scale";
    }
    const lower = values.map((value) => value.toLowerCase());
    if (values.length === 2) {
      const binaryText = ["0", "1", "y", "n", "yes", "no", "是", "否", "有", "无", "true", "false"];
      if (lower.every((value) => binaryText.includes(value))) return "binary";
    }
    return "nominal";
  }

  /**
   * 生成变量定义（未指定角色前的初始状态）
   * @returns {Array<{name, role, measurement, detectedMeasurement, userConfirmed, missingCodes, positiveValue, negativeValue, ordinalOrder, reverseScoring, multiGroup, uniqueCount, missingCount}>}
   */
  function detectVariableTypes(rows, headers, options = {}) {
    const groups = detectMultiSelectGroups(headers);
    const groupVariables = new Set(groups.flatMap((group) => group.variables));
    const definitions = headers.map((header) => {
      const measurement = detectMeasurement(rows, header);
      const missingCount = countMissing(rows, header, []);
      const uniqueCount = uniqueValues(rows, header).length;
      const group = groups.find((item) => item.variables.includes(header));
      let role = "excluded";
      if (group) role = "cluster"; // 多选组默认整组参与聚类（二元）
      else if (measurement === "binary") role = "cluster";
      else if (measurement === "scale" || measurement === "count") role = "cluster";
      else if (measurement === "ordinal") role = "cluster";
      else if (measurement === "nominal" && uniqueCount <= 20 && missingCount < rows.length * 0.5) role = "profile"; // 短分类变量默认作为描述变量候选
      const ordinalOrder = measurement === "ordinal" || measurement === "nominal" || measurement === "binary"
        ? uniqueValues(rows, header)
        : [];
      return {
        name: header,
        role,
        measurement,
        detectedMeasurement: measurement,
        userConfirmed: false,
        missingCodes: [],
        positiveValue: measurement === "binary" ? "1" : "",
        negativeValue: measurement === "binary" ? "0" : "",
        ordinalOrder,
        reverseScoring: null,
        multiGroup: group ? group.name : "",
        uniqueCount,
        missingCount
      };
    });
    // 文本开放题 / 全缺失列自动排除
    definitions.forEach((definition) => {
      if (definition.uniqueCount > 200 && definition.measurement === "nominal") {
        definition.role = "excluded";
        definition.measurement = "nominal";
      }
      if (definition.missingCount >= rows.length) definition.role = "excluded";
    });
    if (options.idCandidates) {
      const candidates = options.idCandidates;
      definitions.forEach((definition) => {
        if (candidates.includes(definition.name)) definition.role = "id";
      });
    }
    void groupVariables;
    return definitions;
  }

  // ─── 缺失值 / 标准化 / 反向计分 ───────────────────────────

  const STANDARDIZATION_METHODS = [
    "zscore",
    "range01",
    "range-1-1",
    "maxabs1",
    "mean1",
    "std1",
    "none"
  ];

  /**
   * 数值标准化（连续变量）
   * @param {number[]} values - 已剔除缺失的数值
   * @param {string} method
   * @returns {{values: number[], params: object}}
   */
  function standardizeValues(values, method = "zscore") {
    const params = { method };
    if (method === "none") return { values: values.slice(), params };
    const mean = safeMean(values);
    const std = safeStd(values, mean);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const maxAbs = Math.max(...values.map((value) => Math.abs(value)));
    params.mean = mean;
    params.std = std;
    params.min = min;
    params.max = max;
    if (method === "zscore") {
      const sd = std && std > 0 ? std : 1;
      return { values: values.map((value) => (value - mean) / sd), params };
    }
    if (method === "range01") {
      const range = max - min;
      if (!range) return { values: values.map(() => 0), params };
      return { values: values.map((value) => (value - min) / range), params };
    }
    if (method === "range-1-1") {
      const range = max - min;
      if (!range) return { values: values.map(() => 0), params };
      return { values: values.map((value) => ((value - min) / range) * 2 - 1), params };
    }
    if (method === "maxabs1") {
      if (!maxAbs) return { values: values.map(() => 0), params };
      return { values: values.map((value) => value / maxAbs), params };
    }
    if (method === "mean1") {
      return { values: values.map((value) => value / mean), params };
    }
    if (method === "std1") {
      const sd = std && std > 0 ? std : 1;
      return { values: values.map((value) => value / sd), params };
    }
    return { values: values.slice(), params };
  }

  /** Likert 反向计分：反向分数 = 最大值 + 最小值 - 原始值 */
  function reverseScoreValue(value, min, max) {
    return min + max - value;
  }

  /** 用保存的参数对单个值做标准化（与 standardizeValues 一致） */
  function applyStandardization(value, params) {
    if (!params || params.method === "none") return value;
    const { method, mean, std, min, max, maxAbs } = params;
    if (method === "zscore") return (value - mean) / (std || 1);
    if (method === "range01") {
      const range = max - min;
      return range ? (value - min) / range : 0;
    }
    if (method === "range-1-1") {
      const range = max - min;
      return range ? ((value - min) / range) * 2 - 1 : 0;
    }
    if (method === "maxabs1") return maxAbs ? value / maxAbs : 0;
    if (method === "mean1") return value / (mean || 1);
    if (method === "std1") return value / (std || 1);
    return value;
  }

  /** 反标准化（恢复到原始尺度） */
  function undoStandardization(value, params) {
    if (!params || params.method === "none") return value;
    const { method, mean, std, min, max, maxAbs } = params;
    if (method === "zscore") return value * (std || 1) + mean;
    if (method === "range01") return value * (max - min) + min;
    if (method === "range-1-1") return ((value + 1) / 2) * (max - min) + min;
    if (method === "maxabs1") return value * maxAbs;
    if (method === "mean1") return value * mean;
    if (method === "std1") return value * (std || 1);
    return value;
  }

  // ─── 数据质量检查 ─────────────────────────────────────────

  const QUALITY_LEVELS = { BLOCK: "block", HIGH: "high", INFO: "info" };

  /**
   * 聚类数据质量检查
   * @param {object} input - { rows, definitions, clusterVariables: string[], weightVariable }
   * @returns {Array<{level: "block"|"high"|"info", code, title, detail}>}
   */
  function runQualityChecks(input) {
    const issues = [];
    const { rows, definitions, clusterVariables, weightVariable } = input;
    const n = rows.length;
    const defMap = new Map((definitions || []).map((definition) => [definition.name, definition]));

    // 阻断错误：样本量不足
    if (n < 10) {
      issues.push({ level: QUALITY_LEVELS.BLOCK, code: "sample_too_small", title: "样本量不足", detail: `当前有效样本 ${n}，聚类至少需要 10 个以上样本。` });
    }
    // 阻断错误：聚类变量过少
    if (!clusterVariables || clusterVariables.length < 2) {
      issues.push({ level: QUALITY_LEVELS.BLOCK, code: "too_few_variables", title: "聚类变量不足", detail: "至少需要选择 2 个聚类变量。", variables: [] });
    }
    if (n < 10 || !clusterVariables || clusterVariables.length < 2) return issues;

    // 变量级检查
    clusterVariables.forEach((name) => {
      const definition = defMap.get(name) || { name, missingCodes: [] };
      const header = definition.name || name;
      const values = [];
      const missingCodes = definition.missingCodes || [];
      for (let i = 0; i < n; i += 1) {
        const value = rows[i][header];
        if (isMissingValue(value, missingCodes)) continue;
        const num = toNumber(value);
        if (num !== null) values.push(num);
      }
      const nonMissing = values.length;
      const missingRate = (n - nonMissing) / n;

      // 常量 / 近似常量变量
      if (values.length >= 2) {
        const unique = new Set(values);
        if (unique.size === 1) {
          issues.push({ level: QUALITY_LEVELS.BLOCK, code: "constant_variable", title: "常量变量", detail: `“${header}”所有有效值完全相同，对分群没有区分能力，请排除或改用其他变量。`, variables: [header] });
        } else if (unique.size <= 2) {
          const top = values.filter((value) => value === values[0]).length / values.length;
          if (top > 0.95) {
            issues.push({ level: QUALITY_LEVELS.HIGH, code: "near_constant_variable", title: "近似常量变量", detail: `“${header}”超过 95% 的样本取同一数值，区分能力很弱。`, variables: [header] });
          }
        }
      }

      // 缺失率过高
      if (missingRate > 0.5) {
        issues.push({ level: QUALITY_LEVELS.HIGH, code: "high_missing_rate", title: "缺失率过高", detail: `“${header}”缺失率 ${(missingRate * 100).toFixed(1)}%，超过 50%，建议排除或结合业务判断是否保留。`, variables: [header] });
      } else if (missingRate > 0.2) {
        issues.push({ level: QUALITY_LEVELS.INFO, code: "medium_missing_rate", title: "缺失率偏高", detail: `“${header}”缺失率 ${(missingRate * 100).toFixed(1)}%，可关注缺失处理方式。`, variables: [header] });
      }

      // 极端偏态 / 严重离群
      if (values.length >= 10) {
        const sorted = values.slice().sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const outliers = sorted.filter((value) => iqr > 0 && (value < q1 - 3 * iqr || value > q3 + 3 * iqr)).length;
        if (outliers / values.length > 0.05) {
          issues.push({ level: QUALITY_LEVELS.INFO, code: "extreme_outliers", title: "存在离群值", detail: `“${header}”存在超过 5% 的极端离群值（3×IQR 之外），可能拉偏聚类中心。`, variables: [header] });
        }
        const mean = safeMean(values);
        const std = safeStd(values, mean);
        if (std > 0) {
          const skewness = values.reduce((sum, value) => sum + Math.pow((value - mean) / std, 3), 0) / values.length;
          if (Math.abs(skewness) > 2) {
            issues.push({ level: QUALITY_LEVELS.INFO, code: "extreme_skewness", title: "分布极端偏态", detail: `“${header}”偏度 ${skewness.toFixed(2)}，分布极端偏态，建议考虑对数变换或改用两步聚类。`, variables: [header] });
          }
        }
      }

      // 分类变量：水平过多
      if (definition.measurement === "nominal" || definition.measurement === "ordinal") {
        const categoryCount = new Set(values.map(String)).size;
        if (categoryCount > 20) {
          issues.push({ level: QUALITY_LEVELS.HIGH, code: "too_many_categories", title: "分类水平过多", detail: `“${header}”有 ${categoryCount} 个类别水平，两步聚类中会显著增加参数数量，建议合并类别。`, variables: [header] });
        }
      }

      // 二元变量极度不平衡
      if (definition.measurement === "binary" || (values.length && new Set(values.map(String)).size === 2)) {
        const valueCounts = new Map();
        values.forEach((value) => valueCounts.set(String(value), (valueCounts.get(String(value)) || 0) + 1));
        const counts = Array.from(valueCounts.values()).sort((a, b) => b - a);
        if (counts[1] && counts[0] / counts[1] > 20) {
          issues.push({ level: QUALITY_LEVELS.INFO, code: "unbalanced_binary", title: "二元变量极度不平衡", detail: `“${header}”两个类别的样本比超过 20:1，区分能力有限。`, variables: [header] });
        }
      }
    });

    // 完全重复变量（两两比较，最多检查前 50 个变量避免性能问题）
    const checkedVariables = clusterVariables.slice(0, 50);
    for (let a = 0; a < checkedVariables.length; a += 1) {
      for (let b = a + 1; b < checkedVariables.length; b += 1) {
        const va = checkedVariables[a];
        const vb = checkedVariables[b];
        let same = true;
        let compared = 0;
        for (let i = 0; i < n && same; i += 1) {
          const av = normText(rows[i][va.name]);
          const bv = normText(rows[i][vb.name]);
          if (isBlank(av) && isBlank(bv)) continue;
          compared += 1;
          if (av !== bv) same = false;
        }
        if (same && compared >= Math.max(20, n * 0.5)) {
          issues.push({ level: QUALITY_LEVELS.HIGH, code: "duplicate_variable", title: "完全重复变量", detail: `“${va.name}”与“${vb.name}”取值完全相同，同时参与聚类会重复计权。`, variables: [va.name, vb.name] });
        }
      }
    }

    // 高度相关变量（连续变量两两 Pearson 近似）
    const numericDefs = clusterVariables.filter((definition) => ["scale", "count", "ordinal"].includes(definition.measurement));
    for (let a = 0; a < Math.min(numericDefs.length, 30); a += 1) {
      for (let b = a + 1; b < Math.min(numericDefs.length, 30); b += 1) {
        const va = numericDefs[a];
        const vb = numericDefs[b];
        const pairs = [];
        for (let i = 0; i < n; i += 1) {
          const x = toNumber(rows[i][va.name]);
          const y = toNumber(rows[i][vb.name]);
          if (x !== null && y !== null) pairs.push([x, y]);
        }
        if (pairs.length < Math.max(20, n * 0.3)) continue;
        const meanX = safeMean(pairs.map((pair) => pair[0]));
        const meanY = safeMean(pairs.map((pair) => pair[1]));
        const sdX = safeStd(pairs.map((pair) => pair[0]), meanX);
        const sdY = safeStd(pairs.map((pair) => pair[1]), meanY);
        if (!sdX || !sdY) continue;
        let corr = 0;
        pairs.forEach((pair) => { corr += (pair[0] - meanX) * (pair[1] - meanY); });
        corr = corr / ((pairs.length - 1) * sdX * sdY);
        if (Math.abs(corr) > 0.95) {
          issues.push({ level: QUALITY_LEVELS.HIGH, code: "highly_correlated", title: "高度相关变量", detail: `“${va.name}”与“${vb.name}”相关系数 ${corr.toFixed(2)}，高度相关（|r|>0.95），建议只保留其一。`, variables: [va.name, vb.name] });
        }
      }
    }

    // 完全相同样本
    const seen = new Map();
    let duplicateSamples = 0;
    for (let i = 0; i < n; i += 1) {
      const key = clusterVariables.map((name) => normText(rows[i][name])).join("\u0001");
      const previous = seen.get(key) || 0;
      seen.set(key, previous + 1);
    }
    seen.forEach((count) => { if (count > 1) duplicateSamples += count - 1; });
    if (duplicateSamples / n > 0.1) {
      issues.push({ level: QUALITY_LEVELS.INFO, code: "duplicate_samples", title: "存在完全相同样本", detail: `约 ${duplicateSamples} 条样本在所有聚类变量上取值完全相同，可能来自重复答题或数据复制。` });
    }

    // 变量数量相对样本量过多
    if (n < clusterVariables.length * 5) {
      issues.push({ level: QUALITY_LEVELS.HIGH, code: "many_variables", title: "变量数量相对样本量过多", detail: `样本量 ${n}，聚类变量 ${clusterVariables.length} 个，样本/变量比不足 5:1，聚类结果可能不稳定。` });
    }

    // 权重变量检查
    if (weightVariable) {
      const weightValues = [];
      for (let i = 0; i < n; i += 1) {
        const value = toNumber(rows[i][weightVariable]);
        if (value !== null) weightValues.push(value);
      }
      if (weightValues.length && weightValues.some((value) => value <= 0)) {
        issues.push({ level: QUALITY_LEVELS.HIGH, code: "invalid_weight", title: "权重包含非正值", detail: "权重变量中存在 0 或负值，相关样本将按规则被排除。", variables: [weightVariable] });
      }
    }

    return issues;
  }

  // ─── 统计分布辅助（ANOVA F 检验 p 值）────────────────────

  function logGamma(z) {
    // Lanczos 近似
    const g = 7;
    const c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i += 1) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  /** 正则化不完全 Beta 函数（连分数法） */
  function regularizedBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betaContinuedFraction(x, a, b) / a;
    return 1 - bt * betaContinuedFraction(1 - x, b, a) / b;
  }

  function betaContinuedFraction(x, a, b) {
    const maxIter = 200;
    const epsilon = 1e-10;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= maxIter; m += 1) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < epsilon) break;
    }
    return h;
  }

  /** F 分布生存概率 P(F > x) */
  function fSurvival(fValue, df1, df2) {
    return 1 - fPValue(fValue, df1, df2);
  }

  function fPValue(fValue, df1, df2) {
    if (!(fValue > 0) || !(df1 > 0) || !(df2 > 0)) return 1;
    const x = (df1 * fValue) / (df1 * fValue + df2);
    return 1 - regularizedBeta(x, df1 / 2, df2 / 2);
  }

  // ─── K-Means 聚类 ─────────────────────────────────────────

  /**
   * K-Means 聚类（参考 SPSS K-Means 的参数结构与公开算法机制）
   * @param {object} input
   *  rows: object[]（原始数据行）
   *  definitions: Array<{name, measurement, missingCodes, reverseScoring, positiveValue, negativeValue}>
   *  clusterVariables: string[]（参与聚类的变量名）
   *  options: {
   *    k, initMode: "scattered"|"manual"|"imported", initialCenters?: number[][],
   *    runMode: "batch"|"sequential"|"classify",
   *    maxIterations, convergence, missing: "listwise"|"pairwise",
   *    standardization: "zscore"|"none"|..., weightColumn, useWeight, seed
   *  }
   * @returns 结构化结果对象
   */
  function kmeansCluster(input) {
    const { rows, definitions, clusterVariables, options } = input;
    const {
      k = 3,
      initMode = "scattered",
      initialCenters = null,
      runMode = "batch",
      maxIterations = 10,
      convergence = 0,
      missing = "listwise",
      standardization = "zscore",
      weightColumn = "",
      useWeight = false,
      seed = 20240101
    } = options || {};

    const defMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const numericNames = clusterVariables.filter((name) => {
      const definition = defMap.get(name);
      return definition && ["scale", "ordinal", "count"].includes(definition.measurement);
    });
    if (!numericNames.length) throw new Error("K-Means 需要连续数值型聚类变量（Scale/视为尺度的有序变量/计数变量）。");

    // 1. 提取数值矩阵 + 反向计分 + 用户缺失码（缺失值处理在标准化之前）
    //    originalMatrix：反向计分后、未标准化的数值（供 ANOVA 与中心反标准化使用）
    const originalMatrix = rows.map((row) => numericNames.map((name) => {
      const definition = defMap.get(name);
      const raw = row[name];
      if (isBlank(raw)) return { missing: true, value: null };
      if (isMissingValue(raw, definition.missingCodes)) return { missing: true, value: null };
      const parsed = toNumber(raw);
      if (parsed === null) return { missing: true, value: null };
      let value = parsed;
      if (definition.reverseScoring && definition.reverseScoring.enabled) {
        value = reverseScoreValue(value, definition.reverseScoring.min, definition.reverseScoring.max);
      }
      return { missing: false, value };
    }));
    const rawMatrix = originalMatrix.map((cells) => cells.map((cell) => ({ ...cell })));

    // 2. 缺失处理：Listwise（默认）排除；Pairwise 保留行并在距离计算时按有效维度归一化
    const validIndices = [];
    rawMatrix.forEach((cells, index) => {
      const anyMissing = cells.some((cell) => cell.missing);
      if (missing === "pairwise") {
        const allMissing = cells.every((cell) => cell.missing);
        if (!allMissing) validIndices.push(index);
      } else if (!anyMissing) {
        validIndices.push(index);
      }
    });
    if (validIndices.length < k + 1) {
      throw new Error(`有效样本不足：当前有效样本 ${validIndices.length}，需要大于分群数 K=${k}。`);
    }
    if (validIndices.length < 2) throw new Error("有效样本不足，无法聚类。");

    // 3. 标准化（Pairwise 模式下先对全部有效值标准化，再按行使用）
    const standardizer = {};
    numericNames.forEach((name, variableIndex) => {
      const values = validIndices.map((rowIndex) => rawMatrix[rowIndex][variableIndex].value);
      const result = standardizeValues(values, standardization);
      standardizer[name] = result.params;
      validIndices.forEach((rowIndex, position) => {
        rawMatrix[rowIndex][variableIndex].value = result.values[position];
      });
    });

    const n = validIndices.length;
    const d = numericNames.length;

    // 4. 权重
    const weights = new Float64Array(n).fill(1);
    if (useWeight && weightColumn) {
      validIndices.forEach((rowIndex, position) => {
        const weight = toNumber(rows[rowIndex][weightColumn]);
        weights[position] = weight !== null && weight > 0 ? weight : 0;
      });
      const weightedValid = validIndices.filter((_, position) => weights[position] > 0);
      if (!weightedValid.length) throw new Error("权重变量无有效正值，请检查权重列。");
    }

    const rowValues = (position) => numericNames.map((name, variableIndex) => rawMatrix[validIndices[position]][variableIndex].value);

    // 5. 初始中心（手动/导入中心在原始尺度输入，内部转换到标准化空间）
    const random = mulberry32(seed);
    let centers;
    if (initMode === "manual" || initMode === "imported") {
      if (!initialCenters || initialCenters.length !== k) {
        throw new Error("手动/导入初始中心数量必须等于 K。");
      }
      centers = initialCenters.map((center) => {
        if (center.length !== d) throw new Error("初始中心维度与聚类变量数量不一致。");
        return center.map((value, variableIndex) => {
          const num = toNumber(value);
          if (num === null) throw new Error("初始中心必须全部为数值。");
          return applyStandardization(num, standardizer[numericNames[variableIndex]]);
        });
      });
    } else {
      // 分散样本初始化（确定性）：按固定种子挑选相互距离较远的样本
      const candidateOrder = Array.from({ length: n }, (_, index) => index).sort(() => random() - 0.5);
      centers = [];
      const chosen = [];
      const squaredDistance = (a, b) => {
        let sum = 0;
        for (let variableIndex = 0; variableIndex < d; variableIndex += 1) {
          const diff = a[variableIndex] - b[variableIndex];
          sum += diff * diff;
        }
        return sum;
      };
      // 首个中心取整体质心，后续取离已选中心最远的候选（带随机扰动）
      const centroid = numericNames.map((_, variableIndex) => {
        let sum = 0;
        for (let position = 0; position < n; position += 1) sum += rowValues(position)[variableIndex];
        return sum / n;
      });
      centers.push(centroid);
      chosen.push(null);
      while (centers.length < k) {
        let best = -1;
        let bestScore = -Infinity;
        for (let position = 0; position < n; position += 1) {
          if (chosen.includes(position)) continue;
          let minDist = Infinity;
          for (const center of centers) {
            const dist = squaredDistance(rowValues(position), center);
            if (dist < minDist) minDist = dist;
          }
          const score = minDist + random() * 1e-9;
          if (score > bestScore) {
            bestScore = score;
            best = position;
          }
        }
        if (best < 0) break;
        centers.push(rowValues(best));
        chosen.push(best);
      }
      // 若 k 大于可分离样本数，补充扰动中心
      while (centers.length < k) {
        centers.push(centers[centers.length - 1].map((value) => value + (random() - 0.5) * 0.01));
      }
    }

    // 收敛阈值 = 收敛参数 × 初始中心之间的最小距离
    let minInitialDistance = Infinity;
    for (let a = 0; a < centers.length; a += 1) {
      for (let b = a + 1; b < centers.length; b += 1) {
        let sum = 0;
        for (let variableIndex = 0; variableIndex < d; variableIndex += 1) {
          const diff = centers[a][variableIndex] - centers[b][variableIndex];
          sum += diff * diff;
        }
        const distance = Math.sqrt(sum);
        if (distance < minInitialDistance) minInitialDistance = distance;
      }
    }
    const tolerance = minInitialDistance === Infinity ? 1e-6 : convergence * minInitialDistance;

    // 6. 距离函数（Pairwise 按有效维度归一化）
    const distanceBetween = (values, center, position) => {
      let sum = 0;
      let validCount = 0;
      for (let variableIndex = 0; variableIndex < d; variableIndex += 1) {
        const cell = rawMatrix[validIndices[position]][variableIndex];
        if (missing === "pairwise" && cell.missing) continue;
        const diff = values[variableIndex] - center[variableIndex];
        sum += diff * diff;
        validCount += 1;
      }
      if (validCount === 0) return Infinity;
      // Pairwise 距离按有效维度数量归一化
      return missing === "pairwise" ? sum / validCount : sum;
    };

    const assignAll = (currentCenters) => {
      const assignment = new Int32Array(n).fill(-1);
      const squaredDistances = new Float64Array(n);
      for (let position = 0; position < n; position += 1) {
        const values = rowValues(position);
        let bestCluster = -1;
        let bestDistance = Infinity;
        for (let clusterIndex = 0; clusterIndex < currentCenters.length; clusterIndex += 1) {
          const dist = distanceBetween(values, currentCenters[clusterIndex], position);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestCluster = clusterIndex;
          }
        }
        assignment[position] = bestCluster;
        squaredDistances[position] = bestDistance;
      }
      return { assignment, squaredDistances };
    };

    const updateCenters = (assignment) => {
      const sums = Array.from({ length: k }, () => new Float64Array(d));
      const counts = new Float64Array(k);
      for (let position = 0; position < n; position += 1) {
        const clusterIndex = assignment[position];
        if (clusterIndex < 0) continue;
        const weight = weights[position];
        const values = rowValues(position);
        for (let variableIndex = 0; variableIndex < d; variableIndex += 1) {
          sums[clusterIndex][variableIndex] += values[variableIndex] * weight;
        }
        counts[clusterIndex] += weight;
      }
      const nextCenters = Array.from({ length: k }, (_, clusterIndex) => {
        if (counts[clusterIndex] <= 0) return centers[clusterIndex].slice();
        return Array.from(sums[clusterIndex], (sum) => sum / counts[clusterIndex]);
      });
      return { nextCenters, counts };
    };

    // 7. 迭代
    const iterationHistory = [];
    let currentCenters = centers.map((center) => center.slice());
    let finalAssignment = null;
    let finalSquaredDistances = null;
    let converged = false;
    let iterations = 0;

    if (runMode === "classify") {
      const result = assignAll(currentCenters);
      finalAssignment = result.assignment;
      finalSquaredDistances = result.squaredDistances;
      iterationHistory.push({ iteration: 0, maxChange: 0, converged: true, note: "仅分类：使用提供的初始中心直接分配样本" });
    } else if (runMode === "sequential") {
      // 运行均值更新：每分配一个样本后立即更新对应聚类中心（学习率 = 1/该簇已见样本数）
      const seenCounts = new Float64Array(k).fill(1);
      for (let iter = 1; iter <= maxIterations; iter += 1) {
        iterations = iter;
        const shuffled = Array.from({ length: n }, (_, index) => index);
        for (let i = n - 1; i > 0; i -= 1) {
          const j = Math.floor(random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        let maxChange = 0;
        for (const position of shuffled) {
          const values = rowValues(position);
          let bestCluster = -1;
          let bestDistance = Infinity;
          for (let clusterIndex = 0; clusterIndex < k; clusterIndex += 1) {
            const dist = distanceBetween(values, currentCenters[clusterIndex], position);
            if (dist < bestDistance) {
              bestDistance = dist;
              bestCluster = clusterIndex;
            }
          }
          const weight = weights[position];
          const oldCenter = currentCenters[bestCluster].slice();
          const learningRate = weight / (seenCounts[bestCluster] + weight);
          currentCenters[bestCluster] = currentCenters[bestCluster].map((value, variableIndex) =>
            value + (values[variableIndex] - value) * learningRate
          );
          seenCounts[bestCluster] += weight;
          const change = Math.sqrt(currentCenters[bestCluster].reduce((sum, value, index) => sum + (value - oldCenter[index]) * (value - oldCenter[index]), 0));
          if (change > maxChange) maxChange = change;
        }
        iterationHistory.push({ iteration: iter, maxChange, converged: maxChange <= tolerance && iter > 1 });
        if (maxChange <= tolerance && iter > 1) {
          converged = true;
          break;
        }
      }
      const result = assignAll(currentCenters);
      finalAssignment = result.assignment;
      finalSquaredDistances = result.squaredDistances;
    } else {
      // 迭代并分类（默认）：批量分配后统一更新中心
      for (let iter = 1; iter <= maxIterations; iter += 1) {
        iterations = iter;
        const result = assignAll(currentCenters);
        const { nextCenters, counts } = updateCenters(result.assignment);
        let maxChange = 0;
        for (let clusterIndex = 0; clusterIndex < k; clusterIndex += 1) {
          const change = Math.sqrt(nextCenters[clusterIndex].reduce((sum, value, index) => sum + (value - currentCenters[clusterIndex][index]) * (value - currentCenters[clusterIndex][index]), 0));
          if (change > maxChange) maxChange = change;
        }
        currentCenters = nextCenters;
        iterationHistory.push({ iteration: iter, maxChange, converged: maxChange <= tolerance });
        if (maxChange <= tolerance || counts.some((count) => count <= 0)) {
          converged = true;
          finalAssignment = result.assignment;
          finalSquaredDistances = result.squaredDistances;
          break;
        }
        if (iter === maxIterations) {
          finalAssignment = result.assignment;
          finalSquaredDistances = result.squaredDistances;
        }
      }
    }
    if (!finalAssignment) {
      const result = assignAll(currentCenters);
      finalAssignment = result.assignment;
      finalSquaredDistances = result.squaredDistances;
    }

    // 8. 汇总统计
    const clusterCounts = new Float64Array(k);
    const weightedCounts = new Float64Array(k);
    for (let position = 0; position < n; position += 1) {
      const clusterIndex = finalAssignment[position];
      clusterCounts[clusterIndex] += 1;
      weightedCounts[clusterIndex] += weights[position];
    }
    const totalWeight = Array.from(weightedCounts).reduce((sum, value) => sum + value, 0);

    let sse = 0;
    for (let position = 0; position < n; position += 1) {
      sse += finalSquaredDistances[position] * weights[position];
    }

    // Silhouette（中心式）：a=到所属中心距离，b=到最近其他中心距离
    let silhouetteSum = 0;
    const silhouetteValues = new Float64Array(n);
    for (let position = 0; position < n; position += 1) {
      const clusterIndex = finalAssignment[position];
      const values = rowValues(position);
      let a = 0;
      for (let variableIndex = 0; variableIndex < d; variableIndex += 1) {
        const diff = values[variableIndex] - currentCenters[clusterIndex][variableIndex];
        a += diff * diff;
      }
      a = Math.sqrt(a);
      let b = Infinity;
      for (let otherCluster = 0; otherCluster < k; otherCluster += 1) {
        if (otherCluster === clusterIndex) continue;
        let dist = 0;
        for (let variableIndex = 0; variableIndex < d; variableIndex += 1) {
          const diff = values[variableIndex] - currentCenters[otherCluster][variableIndex];
          dist += diff * diff;
        }
        dist = Math.sqrt(dist);
        if (dist < b) b = dist;
      }
      const s = b === Infinity ? 0 : (b - a) / Math.max(a, b);
      silhouetteValues[position] = s;
      silhouetteSum += s * weights[position];
    }
    const silhouette = n ? silhouetteSum / totalWeight : 0;

    // 中心间距离
    const centerDistances = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => {
      let sum = 0;
      for (let variableIndex = 0; variableIndex < d; variableIndex += 1) {
        const diff = currentCenters[a][variableIndex] - currentCenters[b][variableIndex];
        sum += diff * diff;
      }
      return Math.sqrt(sum);
    }));

    // ANOVA 描述表（F 与显著性仅用于描述变量对群体区分的相对贡献；均值基于原始尺度）
    const anova = numericNames.map((name, variableIndex) => {
      const clusterMeans = Array.from({ length: k }, (_, clusterIndex) => {
        let sum = 0;
        let count = 0;
        for (let position = 0; position < n; position += 1) {
          if (finalAssignment[position] !== clusterIndex) continue;
          const cell = originalMatrix[validIndices[position]][variableIndex];
          if (cell.missing) continue;
          sum += cell.value * weights[position];
          count += weights[position];
        }
        return count ? sum / count : null;
      });
      const grandMean = safeMean(clusterMeans.filter((value) => value !== null)) || 0;
      let betweenSum = 0;
      let withinSum = 0;
      let dfBetween = k - 1;
      for (let position = 0; position < n; position += 1) {
        const clusterIndex = finalAssignment[position];
        const cell = originalMatrix[validIndices[position]][variableIndex];
        if (cell.missing) continue;
        const mean = clusterMeans[clusterIndex] ?? 0;
        betweenSum += weights[position] * (mean - grandMean) * (mean - grandMean);
        withinSum += weights[position] * (cell.value - mean) * (cell.value - mean);
      }
      const dfWithin = Math.max(1, n - k);
      const f = withinSum > 0 ? (betweenSum / dfBetween) / (withinSum / dfWithin) : 0;
      return {
        variable: name,
        clusterMeans,
        grandMean,
        f,
        p: fPValue(f, dfBetween, dfWithin),
        withinSum,
        betweenSum
      };
    });

    const clusterSizes = Array.from({ length: k }, (_, clusterIndex) => ({
      id: clusterIndex + 1,
      name: `群体${clusterIndex + 1}`,
      count: clusterCounts[clusterIndex],
      pct: n ? (clusterCounts[clusterIndex] / n) * 100 : 0,
      weightedCount: weightedCounts[clusterIndex],
      weightedPct: totalWeight ? (weightedCounts[clusterIndex] / totalWeight) * 100 : null
    }));

    const assignments = validIndices.map((rowIndex, position) => ({
      rowIndex,
      clusterId: finalAssignment[position] + 1,
      distance: Math.sqrt(finalSquaredDistances[position]),
      weight: weights[position]
    }));

    return {
      method: "kmeans",
      methodName: "K-Means 聚类",
      selectedK: k,
      validN: n,
      excludedN: rows.length - n,
      sampleCount: rows.length,
      variables: numericNames,
      variableCount: numericNames.length,
      preprocessing: {
        standardization,
        missingMode: missing,
        reverseScored: numericNames.filter((name) => defMap.get(name)?.reverseScoring?.enabled),
        weightUsed: useWeight && Boolean(weightColumn),
        weightColumn: useWeight ? weightColumn : ""
      },
      initMode,
      runMode,
      maxIterations: runMode === "classify" ? 0 : iterations,
      convergence,
      tolerance,
      seed,
      initialCenters: centers.map((center) => center.slice()),
      finalCenters: currentCenters.map((center) => center.slice()),
      centersOriginal: centers.map((center) => center.map((value, variableIndex) => undoStandardization(value, standardizer[numericNames[variableIndex]]))),
      finalCentersOriginal: currentCenters.map((center) => center.map((value, variableIndex) => undoStandardization(value, standardizer[numericNames[variableIndex]]))),
      iterationHistory,
      converged: converged || runMode === "classify",
      clusterSizes,
      centerDistances,
      assignments,
      sse,
      silhouette,
      anova,
      standardizer,
      warnings: []
    };
  }

  // ─── 两步聚类（TwoStep Cluster）───────────────────────────

  const EPSILON = 1e-10;

  /** 对数似然距离所需的簇特征（ξ 的组成部分） */
  function computeClusterStats(leaf, globalVariance) {
    const n = leaf.n;
    const xiParts = [];
    let xi = 0;
    for (let c = 0; c < globalVariance.length; c += 1) {
      const mean = leaf.ls[c] / n;
      const variance = Math.max(0, leaf.ss[c] / n - mean * mean);
      xiParts.push(0.5 * Math.log(Math.max(EPSILON, globalVariance[c]) + variance));
      xi += xiParts[xiParts.length - 1];
    }
    for (let d = 0; d < leaf.counts.length; d += 1) {
      let entropy = 0;
      leaf.counts[d].forEach((count) => {
        const p = count / n;
        if (p > 0) entropy -= p * Math.log(p);
      });
      xi += entropy;
    }
    leaf.xi = -n * xi;
    return leaf.xi;
  }

  /** 对数似然距离 d(i,j) = ξi + ξj - ξ<i,j> */
  function logLikelihoodDistance(leafA, leafB, globalVariance) {
    const merged = {
      n: leafA.n + leafB.n,
      ls: new Float64Array(leafA.ls.length),
      ss: new Float64Array(leafA.ss.length),
      counts: leafA.counts.map((countMap, index) => {
        const combined = new Map(countMap);
        leafB.counts[index].forEach((count, key) => {
          combined.set(key, (combined.get(key) || 0) + count);
        });
        return combined;
      })
    };
    for (let c = 0; c < leafA.ls.length; c += 1) {
      merged.ls[c] = leafA.ls[c] + leafB.ls[c];
      merged.ss[c] = leafA.ss[c] + leafB.ss[c];
    }
    const xiMerged = computeClusterStats(merged, globalVariance);
    return leafA.xi + leafB.xi - xiMerged;
  }

  /** 欧氏距离（用于全连续变量模式） */
  function euclideanDistance(leafA, leafB) {
    let sum = 0;
    for (let c = 0; c < leafA.ls.length; c += 1) {
      const diff = leafA.ls[c] / leafA.n - leafB.ls[c] / leafB.n;
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /** 参数数量估计（BIC/AIC 用） */
  function estimateParameterCount(clusters, contCount, catLevels) {
    let m = 0;
    clusters.forEach(() => {
      m += 2 * contCount;
      catLevels.forEach((levels) => { m += Math.max(0, levels - 1); });
    });
    return m;
  }

  /**
   * 两步聚类（参考 SPSS TwoStep 的两阶段机制与公开公式）
   * @param {object} input - { rows, definitions, clusterVariables, options }
   *  options: {
   *    distance: "loglikelihood"|"euclidean",
   *    criterion: "BIC"|"AIC",
   *    autoSelect: boolean, maxClusters: 2-30, fixedK: number,
   *    standardization: "zscore"|"none", perVariableStandardization: {name: boolean},
   *    missing: "exclude"|"include_user_codes",
   *    noiseThreshold: number（稀疏叶节点阈值，0 关闭）,
   *    initialDistanceThreshold: number|null, maxBranch: number, maxTreeLevel: number,
   *    seed, stabilityRuns: 0|3|5, stabilityAutoK: boolean
   *  }
   */
  function twostepCluster(input) {
    const { rows, definitions, clusterVariables, options } = input;
    const {
      distance = "loglikelihood",
      criterion = "BIC",
      autoSelect = true,
      maxClusters = 15,
      fixedK = 3,
      standardization = "zscore",
      perVariableStandardization = null,
      missing = "exclude",
      noiseThreshold = 0,
      initialDistanceThreshold = null,
      maxBranch = 8,
      maxTreeLevel = 3,
      seed = 20240101,
      stabilityRuns = 0
    } = options || {};

    const defMap = new Map(definitions.map((definition) => [definition.name, definition]));
    // 连续变量：scale / count；分类变量：nominal / binary / ordinal（默认按分类处理）
    const continuousNames = clusterVariables.filter((name) => {
      const definition = defMap.get(name);
      return definition && ["scale", "count"].includes(definition.measurement);
    });
    const categoricalNames = clusterVariables.filter((name) => {
      const definition = defMap.get(name);
      return definition && ["nominal", "binary"].includes(definition.measurement);
    });
    if (distance === "euclidean" && categoricalNames.length) {
      throw new Error("欧氏距离仅在所有聚类变量均为连续变量时可用；当前包含分类变量，请改用对数似然距离或移除分类变量。");
    }
    if (!continuousNames.length && !categoricalNames.length) {
      throw new Error("未选择有效的聚类变量。");
    }
    if (distance === "euclidean" && !continuousNames.length) {
      throw new Error("欧氏距离需要至少一个连续变量。");
    }

    const clusterVariableDefs = clusterVariables.map((name) => defMap.get(name));
    const includeUserMissing = missing === "include_user_codes";

    // 1. 逐样本构建 CF 特征（缺失处理：系统缺失排除；用户缺失码可选作为有效类别）
    const validIndices = [];
    const featureVectors = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      let valid = true;
      const continuous = new Float64Array(continuousNames.length);
      const categorical = categoricalNames.map((name) => {
        const definition = defMap.get(name);
        const value = normText(row[name]);
        if (isBlank(value)) {
          valid = false;
          return "";
        }
        if (isMissingValue(value, definition.missingCodes) && !includeUserMissing) {
          valid = false;
          return "";
        }
        return value;
      });
      for (let c = 0; c < continuousNames.length; c += 1) {
        const name = continuousNames[c];
        const definition = defMap.get(name);
        const value = toNumber(row[name]);
        if (value === null) { valid = false; break; }
        if (isMissingValue(String(value), definition.missingCodes) && !includeUserMissing) {
          valid = false;
          break;
        }
        continuous[c] = value;
      }
      if (!valid) continue;
      validIndices.push(rowIndex);
      featureVectors.push({ continuous, categorical });
    }
    const n = validIndices.length;
    if (n < 2) throw new Error("有效样本不足，无法执行两步聚类。");

    // 2. 连续变量标准化（默认自动，可对部分变量关闭）
    const standardizationApplied = {};
    if (continuousNames.length) {
      continuousNames.forEach((name, c) => {
        const values = featureVectors.map((feature) => feature.continuous[c]);
        const enabled = perVariableStandardization ? perVariableStandardization[name] !== false : standardization !== "none";
        const result = enabled ? standardizeValues(values, "zscore") : standardizeValues(values, "none");
        standardizationApplied[name] = enabled;
        featureVectors.forEach((feature, index) => { feature.continuous[c] = result.values[index]; });
      });
    }
    const globalVariance = continuousNames.map((name, c) => {
      const values = featureVectors.map((feature) => feature.continuous[c]);
      return safeStd(values) ** 2;
    });

    // 3. CF Tree 预聚类（顺序扫描 + 叶距离阈值；叶样本数超限时分裂，叶总数超限时提高阈值重扫）
    const rawThreshold = initialDistanceThreshold !== null && initialDistanceThreshold > 0
      ? initialDistanceThreshold
      : Math.sqrt(Math.max(1, continuousNames.length + categoricalNames.length));
    const maxLeaves = Math.max(maxClusters * 4, 40);
    const maxLeafEntries = Math.max(4, maxBranch);

    /** 样本特征间的近似距离（连续欧氏 + 分类不匹配计数） */
    const featureDistance = (featureA, featureB) => {
      let sum = 0;
      for (let c = 0; c < featureA.continuous.length; c += 1) {
        const diff = featureA.continuous[c] - featureB.continuous[c];
        sum += diff * diff;
      }
      let mismatch = 0;
      for (let d = 0; d < featureA.categorical.length; d += 1) {
        if (featureA.categorical[d] !== featureB.categorical[d]) mismatch += 1;
      }
      return Math.sqrt(sum) + mismatch;
    };

    /** 分裂叶节点：在叶内找最远样本对，按最近种子重新分成两个叶 */
    const splitLeaf = (leaf, sampleIndexes) => {
      let farthest = { a: 0, b: 1, dist: -1 };
      for (let a = 0; a < sampleIndexes.length; a += 1) {
        for (let b = a + 1; b < sampleIndexes.length; b += 1) {
          const dist = featureDistance(featureVectors[sampleIndexes[a]], featureVectors[sampleIndexes[b]]);
          if (dist > farthest.dist) {
            farthest = { a, b, dist };
          }
        }
      }
      const seedA = sampleIndexes[farthest.a];
      const seedB = sampleIndexes[farthest.b];
      const groupA = [];
      const groupB = [];
      sampleIndexes.forEach((sampleIndex) => {
        const distA = featureDistance(featureVectors[sampleIndex], featureVectors[seedA]);
        const distB = featureDistance(featureVectors[sampleIndex], featureVectors[seedB]);
        if (distA <= distB) groupA.push(sampleIndex);
        else groupB.push(sampleIndex);
      });
      if (!groupA.length || !groupB.length) {
        const half = Math.ceil(sampleIndexes.length / 2);
        groupA.splice(0, 0, ...sampleIndexes.slice(0, half));
        groupB.splice(0, 0, ...sampleIndexes.slice(half));
      }
      const buildLeafFrom = (indexes) => {
        const ls = new Float64Array(continuousNames.length);
        const ss = new Float64Array(continuousNames.length);
        const counts = categoricalNames.map(() => new Map());
        indexes.forEach((sampleIndex) => {
          const feature = featureVectors[sampleIndex];
          for (let c = 0; c < ls.length; c += 1) {
            ls[c] += feature.continuous[c];
            ss[c] += feature.continuous[c] * feature.continuous[c];
          }
          feature.categorical.forEach((value, d) => {
            counts[d].set(value, (counts[d].get(value) || 0) + 1);
          });
        });
        const built = {
          n: indexes.length,
          ls,
          ss,
          counts,
          xi: 0,
          samples: indexes
        };
        built.xi = computeClusterStats(built, globalVariance);
        return built;
      };
      return [buildLeafFrom(groupA), buildLeafFrom(groupB)];
    };

    const preCluster = (threshold) => {
      const leaves = [];
      const leafOf = new Int32Array(n).fill(-1);
      for (let position = 0; position < n; position += 1) {
        const feature = featureVectors[position];
        let bestLeaf = -1;
        let bestDistance = Infinity;
        for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
          const leaf = leaves[leafIndex];
          const dist = distance === "euclidean"
            ? euclideanDistanceForFeature(feature, leaf)
            : logLikelihoodDistanceForFeature(feature, leaf, globalVariance);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestLeaf = leafIndex;
          }
        }
        if (bestLeaf >= 0 && bestDistance <= threshold) {
          addFeatureToLeaf(leaves[bestLeaf], feature);
          leaves[bestLeaf].samples.push(position);
          leafOf[position] = bestLeaf;
          if (leaves[bestLeaf].samples.length > maxLeafEntries) {
            const [left, right] = splitLeaf(leaves[bestLeaf], leaves[bestLeaf].samples);
            leaves.splice(bestLeaf, 1, left, right);
            leaves.forEach((leaf, leafIndex) => {
              leaf.samples.forEach((sampleIndex) => { leafOf[sampleIndex] = leafIndex; });
            });
          }
        } else {
          const leaf = newLeaf(feature);
          leaf.samples = [position];
          leaves.push(leaf);
          leafOf[position] = leaves.length - 1;
        }
      }
      return { leaves, leafOf };
    };

    let pre = preCluster(rawThreshold);
    if (pre.leaves.length > maxLeaves) {
      pre = preCluster(rawThreshold * 2);
    }
    if (pre.leaves.length > maxLeaves) {
      pre = preCluster(rawThreshold * 4);
    }
    let { leaves, leafOf } = pre;
    leaves.forEach((leaf) => { delete leaf.samples; });
    const leafCountBeforeNoise = leaves.length;
    void leafCountBeforeNoise;

    // 4. 噪声处理：稀疏叶节点（样本数 < 阈值）标记为噪声，不参与聚合
    const noiseMarks = new Set();
    if (noiseThreshold > 0) {
      leaves.forEach((leaf, index) => {
        if (leaf.n < noiseThreshold) noiseMarks.add(index);
      });
    }

    // 5. 聚合阶段：从叶开始凝聚合并到 2 个簇，记录各簇数信息准则
    // 每个活动簇由一组叶组成；用最近簇对贪心合并
    const activeClusters = [];
    leaves.forEach((leaf, index) => {
      if (noiseMarks.has(index)) return;
      activeClusters.push({
        id: activeClusters.length,
        leafIndexes: [index],
        n: leaf.n,
        ls: leaf.ls.slice(),
        ss: leaf.ss.slice(),
        counts: leaf.counts.map((countMap) => new Map(countMap)),
        xi: leaf.xi
      });
    });
    if (!activeClusters.length) throw new Error("全部叶节点均被判定为噪声，无法形成群体。");
    if (activeClusters.length < 2) {
      // 只有一个非噪声簇：全部归入群体 1
    }

    const clusterDistance = (clusterA, clusterB) => {
      if (distance === "euclidean") {
        const mergedLs = new Float64Array(clusterA.ls.length);
        for (let c = 0; c < mergedLs.length; c += 1) {
          mergedLs[c] = (clusterA.ls[c] + clusterB.ls[c]) / (clusterA.n + clusterB.n);
        }
        let sum = 0;
        for (let c = 0; c < mergedLs.length; c += 1) {
          const diff = clusterA.ls[c] / clusterA.n - clusterB.ls[c] / clusterB.n;
          sum += diff * diff;
        }
        return Math.sqrt(sum);
      }
      const merged = {
        n: clusterA.n + clusterB.n,
        ls: new Float64Array(clusterA.ls.length),
        ss: new Float64Array(clusterA.ss.length),
        counts: clusterA.counts.map((countMap, index) => {
          const combined = new Map(countMap);
          clusterB.counts[index].forEach((count, key) => {
            combined.set(key, (combined.get(key) || 0) + count);
          });
          return combined;
        })
      };
      for (let c = 0; c < merged.ls.length; c += 1) {
        merged.ls[c] = clusterA.ls[c] + clusterB.ls[c];
        merged.ss[c] = clusterA.ss[c] + clusterB.ss[c];
      }
      return logLikelihoodDistance(
        { n: clusterA.n, ls: clusterA.ls, ss: clusterA.ss, counts: clusterA.counts, xi: clusterA.xi },
        { n: clusterB.n, ls: clusterB.ls, ss: clusterB.ss, counts: clusterB.counts, xi: clusterB.xi },
        globalVariance
      );
    };

    const mergeClusters = (clusterA, clusterB) => {
      const mergedLs = new Float64Array(clusterA.ls.length);
      const mergedSs = new Float64Array(clusterA.ss.length);
      for (let c = 0; c < mergedLs.length; c += 1) {
        mergedLs[c] = clusterA.ls[c] + clusterB.ls[c];
        mergedSs[c] = clusterA.ss[c] + clusterB.ss[c];
      }
      const mergedCounts = clusterA.counts.map((countMap, index) => {
        const combined = new Map(countMap);
        clusterB.counts[index].forEach((count, key) => {
          combined.set(key, (combined.get(key) || 0) + count);
        });
        return combined;
      });
      const mergedCluster = {
        id: activeClusters.length,
        leafIndexes: [...clusterA.leafIndexes, ...clusterB.leafIndexes],
        n: clusterA.n + clusterB.n,
        ls: mergedLs,
        ss: mergedSs,
        counts: mergedCounts,
        xi: 0
      };
      mergedCluster.xi = computeClusterStats({ n: mergedCluster.n, ls: mergedLs, ss: mergedSs, counts: mergedCounts }, globalVariance);
      return mergedCluster;
    };

    const catLevels = categoricalNames.map((name) => {
      const values = uniqueValues(rows, name).length;
      return Math.max(2, values);
    });

    // 记录每个簇数量的信息准则
    const criterionTable = [];
    const recordCriterion = () => {
      const k = activeClusters.length;
      let logLikelihood = 0;
      activeClusters.forEach((cluster) => { logLikelihood += cluster.xi; });
      const m = estimateParameterCount(activeClusters, continuousNames.length, catLevels);
      const bic = -2 * logLikelihood + m * Math.log(n);
      const aic = -2 * logLikelihood + 2 * m;
      const sizes = activeClusters.map((cluster) => cluster.n).sort((a, b) => b - a);
      criterionTable.push({
        clusters: k,
        logLikelihood,
        bic,
        aic,
        bicChange: 0,
        aicChange: 0,
        minClusterPct: sizes.length ? (sizes[sizes.length - 1] / n) * 100 : 0,
        minClusterCount: sizes.length ? sizes[sizes.length - 1] : 0
      });
    };

    if (activeClusters.length === 1) {
      recordCriterion();
    } else {
      recordCriterion();
      while (activeClusters.length > 2) {
        let bestA = -1;
        let bestB = -1;
        let bestDist = Infinity;
        for (let a = 0; a < activeClusters.length; a += 1) {
          for (let b = a + 1; b < activeClusters.length; b += 1) {
            const dist = clusterDistance(activeClusters[a], activeClusters[b]);
            if (dist < bestDist) {
              bestDist = dist;
              bestA = a;
              bestB = b;
            }
          }
        }
        const merged = mergeClusters(activeClusters[bestA], activeClusters[bestB]);
        const clusterB = activeClusters[bestB];
        activeClusters.splice(bestB, 1);
        activeClusters.splice(bestA, 1, merged);
        recordCriterion();
        void clusterB;
      }
    }

    // 选择最终群数
    const usable = criterionTable.filter((entry) => entry.clusters <= maxClusters);
    let selectedK = fixedK;
    if (autoSelect) {
      const metric = criterion === "AIC" ? "aic" : "bic";
      let bestEntry = usable[0];
      usable.forEach((entry) => {
        if (entry[metric] < bestEntry[metric]) bestEntry = entry;
      });
      selectedK = bestEntry.clusters;
    }
    if (selectedK > maxClusters) selectedK = maxClusters;
    const selectedEntry = usable.find((entry) => entry.clusters === selectedK) || usable[usable.length - 1];

    // 计算变化量
    usable.forEach((entry, index) => {
      const previous = usable[index - 1];
      if (previous) {
        entry.bicChange = entry.bic - previous.bic;
        entry.aicChange = entry.aic - previous.aic;
      }
    });

    // 6. 重建最终 K 个群体的叶归属（从聚合历史重建）
    // 简化：重新执行合并并在达到 selectedK 时停止
    const finalClusters = [];
    {
      const working = [];
      leaves.forEach((leaf, index) => {
        if (noiseMarks.has(index)) return;
        working.push({
          id: working.length,
          leafIndexes: [index],
          n: leaf.n,
          ls: leaf.ls.slice(),
          ss: leaf.ss.slice(),
          counts: leaf.counts.map((countMap) => new Map(countMap)),
          xi: leaf.xi
        });
      });
      while (working.length > Math.min(selectedK, Math.max(1, working.length))) {
        let bestA = -1;
        let bestB = -1;
        let bestDist = Infinity;
        for (let a = 0; a < working.length; a += 1) {
          for (let b = a + 1; b < working.length; b += 1) {
            const dist = clusterDistance(working[a], working[b]);
            if (dist < bestDist) {
              bestDist = dist;
              bestA = a;
              bestB = b;
            }
          }
        }
        const merged = mergeClusters(working[bestA], working[bestB]);
        working.splice(bestB, 1);
        working.splice(bestA, 1, merged);
      }
      finalClusters.push(...working);
    }

    // 7. 样本归属
    const clusterOfLeaf = new Map();
    finalClusters.forEach((cluster, clusterIndex) => {
      cluster.leafIndexes.forEach((leafIndex) => clusterOfLeaf.set(leafIndex, clusterIndex + 1));
    });
    const assignments = validIndices.map((rowIndex, position) => {
      const leafIndex = leafOf[position];
      if (noiseMarks.has(leafIndex)) {
        return { rowIndex, clusterId: -1, clusterName: "噪声/离群样本", noise: true };
      }
      const clusterId = clusterOfLeaf.get(leafIndex) ?? 1;
      return { rowIndex, clusterId, noise: false };
    });
    const noiseCount = assignments.filter((assignment) => assignment.noise).length;
    const clusterSizes = finalClusters.map((cluster, index) => ({
      id: index + 1,
      name: `群体${index + 1}`,
      count: cluster.n,
      pct: (cluster.n / n) * 100
    }));
    if (noiseCount > 0) {
      clusterSizes.push({
        id: -1,
        name: "噪声/离群样本",
        count: noiseCount,
        pct: (noiseCount / n) * 100
      });
    }

    // 8. 连续变量群体均值/标准差 + 分类变量群体频数/占比
    const continuousSummary = continuousNames.map((name, c) => {
      const overall = featureVectors.map((feature) => feature.continuous[c]);
      const overallMean = safeMean(overall);
      const overallStd = safeStd(overall, overallMean);
      const perCluster = finalClusters.map((cluster) => {
        const values = [];
        for (let position = 0; position < n; position += 1) {
          if (clusterOfLeaf.get(leafOf[position]) === cluster.id + 1) {
            values.push(featureVectors[position].continuous[c]);
          }
        }
        const mean = safeMean(values);
        return { mean, std: safeStd(values, mean), count: values.length };
      });
      return { variable: name, overallMean, overallStd, perCluster };
    });
    const categoricalSummary = categoricalNames.map((name, d) => {
      const overallCounts = new Map();
      const perClusterCounts = finalClusters.map(() => new Map());
      featureVectors.forEach((feature, position) => {
        const value = feature.categorical[d];
        overallCounts.set(value, (overallCounts.get(value) || 0) + 1);
        const leafIndex = leafOf[position];
        if (noiseMarks.has(leafIndex)) return;
        const clusterId = clusterOfLeaf.get(leafIndex);
        if (clusterId === undefined) return;
        const counts = perClusterCounts[clusterId - 1];
        counts.set(value, (counts.get(value) || 0) + 1);
      });
      const categories = Array.from(overallCounts.keys()).sort();
      return {
        variable: name,
        categories: categories.map((category) => ({
          category,
          overallCount: overallCounts.get(category) || 0,
          overallPct: ((overallCounts.get(category) || 0) / n) * 100,
          perCluster: finalClusters.map((cluster, index) => {
            const count = perClusterCounts[index].get(category) || 0;
            return { count, pct: cluster.n ? (count / cluster.n) * 100 : 0 };
          })
        }))
      };
    });

    // 9. 变量区分度（确定性方法：连续变量用 F 统计量，分类变量用卡方贡献，归一化到 0-100）
    const discrimination = [];
    continuousSummary.forEach((summary) => {
      const between = summary.perCluster.reduce((sum, cluster) => sum + cluster.count * ((cluster.mean ?? 0) - summary.overallMean) ** 2, 0);
      const within = summary.perCluster.reduce((sum, cluster) => sum + (cluster.count - 1) * ((cluster.std ?? 0) ** 2 || EPSILON), 0);
      const dfBetween = Math.max(1, finalClusters.length - 1);
      const dfWithin = Math.max(1, n - finalClusters.length);
      const f = within > 0 ? (between / dfBetween) / (within / dfWithin) : 0;
      discrimination.push({ variable: summary.variable, type: "continuous", f, score: Math.min(100, 100 * (1 - 1 / (1 + f))) });
    });
    categoricalSummary.forEach((summary) => {
      let chiSquare = 0;
      summary.categories.forEach((category) => {
        const expected = (category.overallCount / n) * n;
        finalClusters.forEach((cluster, index) => {
          const observed = category.perCluster[index].count;
          const exp = (category.overallCount / n) * cluster.n;
          if (exp > 0) chiSquare += ((observed - exp) ** 2) / exp;
        });
        void expected;
      });
      const df = Math.max(1, (summary.categories.length - 1) * Math.max(1, finalClusters.length - 1));
      const normalized = chiSquare / Math.max(1, df);
      discrimination.push({ variable: summary.variable, type: "categorical", chiSquare, df, score: Math.min(100, 100 * (1 - 1 / (1 + normalized))) });
    });

    // 10. 案例顺序稳定性（可选）
    let stability = null;
    if (stabilityRuns > 1) {
      stability = twostepStability({
        rows, definitions, clusterVariables, options,
        validIndices, featureVectors, continuousNames, categoricalNames,
        maxClusters, criterion, distance, noiseThreshold, seed
      });
    }

    return {
      method: "twostep",
      methodName: "两步聚类",
      selectedK,
      autoSelect,
      criterion: autoSelect ? criterion : "fixed",
      maxClusters,
      validN: n,
      excludedN: rows.length - n,
      sampleCount: rows.length,
      continuousVariables: continuousNames,
      categoricalVariables: categoricalNames,
      variables: clusterVariables,
      distance,
      standardizationApplied,
      missingMode: missing,
      noiseThreshold,
      noiseCount,
      clusterSizes,
      criterionTable: usable,
      selectedEntry,
      continuousSummary,
      categoricalSummary,
      discrimination,
      assignments,
      stability,
      seed,
      warnings: []
    };
  }

  /** 单样本与叶的欧氏距离 */
  function euclideanDistanceForFeature(feature, leaf) {
    let sum = 0;
    for (let c = 0; c < feature.continuous.length; c += 1) {
      const diff = feature.continuous[c] - leaf.ls[c] / leaf.n;
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /** 单样本与叶的对数似然距离 */
  function logLikelihoodDistanceForFeature(feature, leaf, globalVariance) {
    const merged = {
      n: leaf.n + 1,
      ls: new Float64Array(leaf.ls.length),
      ss: new Float64Array(leaf.ss.length),
      counts: leaf.counts.map((countMap, index) => {
        const combined = new Map(countMap);
        const value = feature.categorical[index];
        combined.set(value, (combined.get(value) || 0) + 1);
        return combined;
      })
    };
    for (let c = 0; c < merged.ls.length; c += 1) {
      merged.ls[c] = leaf.ls[c] + feature.continuous[c];
      merged.ss[c] = leaf.ss[c] + feature.continuous[c] * feature.continuous[c];
    }
    const sampleLeaf = {
      n: 1,
      ls: feature.continuous.slice(),
      ss: feature.continuous.map((value) => value * value),
      counts: feature.categorical.map((value) => new Map([[value, 1]]))
    };
    const xiSample = computeClusterStats(sampleLeaf, globalVariance);
    const xiMerged = computeClusterStats(merged, globalVariance);
    return leaf.xi + xiSample - xiMerged;
  }

  function newLeaf(feature) {
    return {
      id: 0,
      n: 1,
      ls: feature.continuous.slice(),
      ss: feature.continuous.map((value) => value * value),
      counts: feature.categorical.map((value) => new Map([[value, 1]])),
      xi: 0
    };
  }

  function addFeatureToLeaf(leaf, feature) {
    for (let c = 0; c < feature.continuous.length; c += 1) {
      leaf.ls[c] += feature.continuous[c];
      leaf.ss[c] += feature.continuous[c] * feature.continuous[c];
    }
    feature.categorical.forEach((value, d) => {
      leaf.counts[d].set(value, (leaf.counts[d].get(value) || 0) + 1);
    });
    leaf.n += 1;
  }

  /** 两步聚类案例顺序稳定性检查（多次随机顺序重跑） */
  function twostepStability(input) {
    const { options, validIndices, featureVectors, continuousNames, categoricalNames, maxClusters, criterion, distance, noiseThreshold, seed } = input;
    const runs = Math.max(2, Math.min(5, options.stabilityRuns || 3));
    const results = [];
    const allK = [];
    for (let run = 0; run < runs; run += 1) {
      const runSeed = (seed + run * 7919 + 13) >>> 0;
      const random = mulberry32(runSeed);
      const order = validIndices.map((_, index) => index);
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const rawThreshold = Math.sqrt(Math.max(1, continuousNames.length + categoricalNames.length));
      const globalVar = globalVarianceOf(input, featureVectors);
      const maxLeafEntries = Math.max(4, options.maxBranch || 8);
      const featureDistanceStab = (featureA, featureB) => {
        let sum = 0;
        for (let c = 0; c < featureA.continuous.length; c += 1) {
          const diff = featureA.continuous[c] - featureB.continuous[c];
          sum += diff * diff;
        }
        let mismatch = 0;
        for (let d = 0; d < featureA.categorical.length; d += 1) {
          if (featureA.categorical[d] !== featureB.categorical[d]) mismatch += 1;
        }
        return Math.sqrt(sum) + mismatch;
      };
      const splitLeafStab = (leaf, sampleIndexes) => {
        let farthest = { a: 0, b: 1, dist: -1 };
        for (let a = 0; a < sampleIndexes.length; a += 1) {
          for (let b = a + 1; b < sampleIndexes.length; b += 1) {
            const dist = featureDistanceStab(featureVectors[sampleIndexes[a]], featureVectors[sampleIndexes[b]]);
            if (dist > farthest.dist) farthest = { a, b, dist };
          }
        }
        const groupA = [];
        const groupB = [];
        sampleIndexes.forEach((sampleIndex) => {
          const distA = featureDistanceStab(featureVectors[sampleIndex], featureVectors[sampleIndexes[farthest.a]]);
          const distB = featureDistanceStab(featureVectors[sampleIndex], featureVectors[sampleIndexes[farthest.b]]);
          if (distA <= distB) groupA.push(sampleIndex);
          else groupB.push(sampleIndex);
        });
        if (!groupA.length || !groupB.length) {
          const half = Math.ceil(sampleIndexes.length / 2);
          groupA.splice(0, 0, ...sampleIndexes.slice(0, half));
          groupB.splice(0, 0, ...sampleIndexes.slice(half));
        }
        const build = (indexes) => {
          const ls = new Float64Array(continuousNames.length);
          const ss = new Float64Array(continuousNames.length);
          const counts = categoricalNames.map(() => new Map());
          indexes.forEach((sampleIndex) => {
            const feature = featureVectors[sampleIndex];
            for (let c = 0; c < ls.length; c += 1) {
              ls[c] += feature.continuous[c];
              ss[c] += feature.continuous[c] * feature.continuous[c];
            }
            feature.categorical.forEach((value, d) => {
              counts[d].set(value, (counts[d].get(value) || 0) + 1);
            });
          });
          const built = { n: indexes.length, ls, ss, counts, xi: 0, samples: indexes };
          built.xi = computeClusterStats(built, globalVar);
          return built;
        };
        return [build(groupA), build(groupB)];
      };
      const leaves = [];
      const leafOf = new Int32Array(order.length).fill(-1);
      order.forEach((position, positionInOrder) => {
        const feature = featureVectors[position];
        let bestLeaf = -1;
        let bestDistance = Infinity;
        for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
          const leaf = leaves[leafIndex];
          const dist = distance === "euclidean"
            ? euclideanDistanceForFeature(feature, leaf)
            : logLikelihoodDistanceForFeature(feature, leaf, globalVar);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestLeaf = leafIndex;
          }
        }
        if (bestLeaf >= 0 && bestDistance <= rawThreshold) {
          addFeatureToLeaf(leaves[bestLeaf], feature);
          leaves[bestLeaf].samples.push(position);
          leafOf[positionInOrder] = bestLeaf;
          if (leaves[bestLeaf].samples.length > maxLeafEntries) {
            const [left, right] = splitLeafStab(leaves[bestLeaf], leaves[bestLeaf].samples);
            leaves.splice(bestLeaf, 1, left, right);
            leaves.forEach((leaf, leafIndex) => {
              leaf.samples.forEach((sampleIndex) => { leafOf[sampleIndex] = leafIndex; });
            });
          }
        } else {
          const leaf = newLeaf(feature);
          leaf.samples = [position];
          leaves.push(leaf);
          leafOf[positionInOrder] = leaves.length - 1;
        }
      });
      leaves.forEach((leaf) => { delete leaf.samples; });
      // 聚合 + BIC 选群数
      const active = [];
      const noiseMarks = new Set();
      leaves.forEach((leaf, index) => {
        if (noiseThreshold > 0 && leaf.n < noiseThreshold) noiseMarks.add(index);
        else active.push({ id: active.length, leafIndexes: [index], n: leaf.n, ls: leaf.ls.slice(), ss: leaf.ss.slice(), counts: leaf.counts.map((m) => new Map(m)), xi: leaf.xi });
      });
      const catLevels = categoricalNames.map(() => 5);
      let bestBic = Infinity;
      let bestK = Math.min(active.length, maxClusters);
      let bestLogLikelihood = 0;
      const working = active.map((cluster) => ({
        id: cluster.id, n: cluster.n, ls: cluster.ls, ss: cluster.ss, counts: cluster.counts, xi: cluster.xi
      }));
      const distFn = (a, b) => {
        if (distance === "euclidean") {
          let sum = 0;
          for (let c = 0; c < a.ls.length; c += 1) {
            const diff = a.ls[c] / a.n - b.ls[c] / b.n;
            sum += diff * diff;
          }
          return Math.sqrt(sum);
        }
        const merged = { n: a.n + b.n, ls: new Float64Array(a.ls.length), ss: new Float64Array(a.ss.length), counts: a.counts.map((m, i) => { const c = new Map(m); b.counts[i].forEach((cnt, key) => c.set(key, (c.get(key) || 0) + cnt)); return c; }) };
        for (let c = 0; c < merged.ls.length; c += 1) { merged.ls[c] = a.ls[c] + b.ls[c]; merged.ss[c] = a.ss[c] + b.ss[c]; }
        return logLikelihoodDistance({ n: a.n, ls: a.ls, ss: a.ss, counts: a.counts, xi: a.xi }, { n: b.n, ls: b.ls, ss: b.ss, counts: b.counts, xi: b.xi }, globalVar);
      };
      const record = () => {
        let ll = 0;
        working.forEach((cluster) => { ll += cluster.xi; });
        const m = estimateParameterCount(working, continuousNames.length, catLevels);
        const bic = -2 * ll + m * Math.log(validIndices.length);
        if (bic < bestBic) {
          bestBic = bic;
          bestK = working.length;
          bestLogLikelihood = ll;
        }
      };
      record();
      // 保存每个簇数的簇特征快照（用于按 bestK 分配样本）
      const snapshots = [];
      const snapshotClusters = () => working.map((cluster) => ({
        id: cluster.id,
        n: cluster.n,
        ls: cluster.ls.slice(),
        ss: cluster.ss.slice(),
        counts: cluster.counts.map((m) => new Map(m)),
        xi: cluster.xi
      }));
      snapshots.push(snapshotClusters());
      while (working.length > 2) {
        let bestA = -1; let bestB = -1; let bestDist = Infinity;
        for (let a = 0; a < working.length; a += 1) {
          for (let b = a + 1; b < working.length; b += 1) {
            const dist = distFn(working[a], working[b]);
            if (dist < bestDist) { bestDist = dist; bestA = a; bestB = b; }
          }
        }
        const a = working[bestA]; const b = working[bestB];
        const mergedLs = new Float64Array(a.ls.length);
        const mergedSs = new Float64Array(a.ss.length);
        for (let c = 0; c < mergedLs.length; c += 1) { mergedLs[c] = a.ls[c] + b.ls[c]; mergedSs[c] = a.ss[c] + b.ss[c]; }
        const mergedCounts = a.counts.map((m, i) => { const c = new Map(m); b.counts[i].forEach((cnt, key) => c.set(key, (c.get(key) || 0) + cnt)); return c; });
        const mergedCluster = { n: a.n + b.n, ls: mergedLs, ss: mergedSs, counts: mergedCounts, xi: 0 };
        mergedCluster.xi = computeClusterStats(mergedCluster, globalVar);
        working.splice(bestB, 1);
        working.splice(bestA, 1, mergedCluster);
        snapshots.push(snapshotClusters());
        record();
      }
      allK.push(bestK);
      const assignment = new Int32Array(validIndices.length).fill(-1);
      // 用聚合到 bestK 时的簇特征作为代表，将每个叶分配到最近代表簇
      const finalLeaves = leaves;
      const finalClusters = snapshots[Math.max(0, snapshots.length - bestK)] || snapshots[snapshots.length - 1];
      finalLeaves.forEach((leaf, leafIndex) => {
        let bestCluster = -1;
        let bestDist = Infinity;
        finalClusters.forEach((rep, repIndex) => {
          const dist = distFn({ n: leaf.n, ls: leaf.ls, ss: leaf.ss, counts: leaf.counts, xi: leaf.xi }, rep);
          if (dist < bestDist) { bestDist = dist; bestCluster = repIndex; }
        });
        for (let position = 0; position < validIndices.length; position += 1) {
          if (leafOf[position] === leafIndex && bestCluster >= 0) assignment[position] = bestCluster;
        }
      });
      results.push({ run: run + 1, k: bestK, assignment: Array.from(assignment) });
    }
    // 与第一次运行的归属一致性（贪心标签匹配后的相同比例）
    const consistency = results.slice(1).map((result) => {
      const base = results[0].assignment;
      const kMax = Math.max(0, ...base, ...result.assignment) + 1;
      const agreementCounts = Array.from({ length: kMax }, () => new Float64Array(kMax));
      for (let i = 0; i < base.length; i += 1) {
        if (base[i] >= 0 && result.assignment[i] >= 0) {
          agreementCounts[base[i]][result.assignment[i]] += 1;
        }
      }
      const matched = new Set();
      let agreed = 0;
      let total = 0;
      const pairs = [];
      for (let a = 0; a < kMax; a += 1) {
        for (let b = 0; b < kMax; b += 1) pairs.push([a, b, agreementCounts[a][b]]);
      }
      pairs.sort((x, y) => y[2] - x[2]);
      pairs.forEach(([a, b, count]) => {
        if (matched.has(a) || matched.has(b)) return;
        matched.add(a);
        matched.add(b);
        agreed += count;
      });
      for (let i = 0; i < base.length; i += 1) {
        if (base[i] >= 0 && result.assignment[i] >= 0) total += 1;
      }
      return total ? agreed / total : 0;
    });
    const meanConsistency = consistency.length ? consistency.reduce((sum, value) => sum + value, 0) / consistency.length : 1;
    const kSet = new Set(allK);
    const level = meanConsistency >= 0.9 ? "高" : meanConsistency >= 0.7 ? "中" : "低";
    return {
      runs,
      recommendedK: allK,
      consistency,
      meanConsistency,
      kUnique: kSet.size,
      level,
      note: "使用不同随机数据顺序重复运行，样本归属一致性用于评估案例顺序敏感性。"
    };
  }

  function globalVarianceOf(input, featureVectors) {
    const continuousNames = input.continuousNames;
    return continuousNames.map((name, c) => {
      const values = featureVectors.map((feature) => feature.continuous[c]);
      return safeStd(values) ** 2;
    });
  }

  // ─── 系统聚类／层次聚类 ───────────────────────────────────

  const LINKAGE_METHODS = {
    between: "组间联接法（UPGMA）",
    within: "组内联接法",
    nearest: "最近邻法／单联接法",
    furthest: "最远邻法／完全联接法",
    centroid: "重心法",
    median: "中位数法",
    ward: "Ward 法"
  };

  const INTERVAL_DISTANCES = ["euclidean", "squared-euclidean", "cosine", "pearson", "chebyshev", "cityblock", "minkowski"];
  const COUNT_DISTANCES = ["chi-square", "phi-square"];
  const BINARY_DISTANCES = ["simple-matching", "jaccard", "dice", "russell-rao", "phi", "yule-q", "rogers-tanimoto", "sokal-sneath"];

  const DISTANCE_TRANSFORMS = ["none", "abs", "sign", "rescale01"];

  /** 计算两个数值向量的距离 */
  function vectorDistance(vectorA, vectorB, distance, options = {}) {
    const p = options.p || 2;
    const n = Math.min(vectorA.length, vectorB.length);
    if (distance === "euclidean") {
      let sum = 0;
      for (let i = 0; i < n; i += 1) {
        const diff = vectorA[i] - vectorB[i];
        sum += diff * diff;
      }
      return Math.sqrt(sum);
    }
    if (distance === "squared-euclidean") {
      let sum = 0;
      for (let i = 0; i < n; i += 1) {
        const diff = vectorA[i] - vectorB[i];
        sum += diff * diff;
      }
      return sum;
    }
    if (distance === "cityblock") {
      let sum = 0;
      for (let i = 0; i < n; i += 1) sum += Math.abs(vectorA[i] - vectorB[i]);
      return sum;
    }
    if (distance === "chebyshev") {
      let max = 0;
      for (let i = 0; i < n; i += 1) {
        const diff = Math.abs(vectorA[i] - vectorB[i]);
        if (diff > max) max = diff;
      }
      return max;
    }
    if (distance === "minkowski") {
      let sum = 0;
      for (let i = 0; i < n; i += 1) sum += Math.pow(Math.abs(vectorA[i] - vectorB[i]), p);
      return Math.pow(sum, 1 / Math.max(0.0001, p));
    }
    if (distance === "cosine") {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < n; i += 1) {
        dot += vectorA[i] * vectorB[i];
        normA += vectorA[i] * vectorA[i];
        normB += vectorB[i] * vectorB[i];
      }
      const denominator = Math.sqrt(normA) * Math.sqrt(normB);
      if (!denominator) return 0;
      return 1 - dot / denominator;
    }
    if (distance === "pearson") {
      const meanA = safeMean(vectorA);
      const meanB = safeMean(vectorB);
      const sdA = safeStd(vectorA, meanA);
      const sdB = safeStd(vectorB, meanB);
      if (!sdA || !sdB) return 0;
      let sum = 0;
      for (let i = 0; i < n; i += 1) sum += (vectorA[i] - meanA) * (vectorB[i] - meanB);
      const r = sum / ((n - 1) * sdA * sdB);
      return 1 - r;
    }
    if (distance === "chi-square" || distance === "phi-square") {
      // 计数数据卡方距离（按行比例加权的 2×K 卡方分解）
      let sum = 0;
      for (let i = 0; i < n; i += 1) {
        const total = vectorA[i] + vectorB[i];
        if (total > 0) sum += (vectorA[i] - vectorB[i]) ** 2 / total;
      }
      return distance === "phi-square" ? sum : Math.sqrt(Math.max(0, sum));
    }
    throw new Error(`不支持的距离方式：${distance}`);
  }

  /** 二元数据距离（a=都取正值, b=仅A正, c=仅B正, d=都取负值） */
  function binaryVectorDistance(vectorA, vectorB, distance, positiveValue) {
    const n = Math.min(vectorA.length, vectorB.length);
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    const pos = (value) => {
      if (positiveValue !== undefined && positiveValue !== null && String(positiveValue).trim() !== "") {
        return String(value).trim() === String(positiveValue).trim();
      }
      const text = String(value).trim().toLowerCase();
      return ["1", "y", "yes", "是", "true", "有"].includes(text);
    };
    for (let i = 0; i < n; i += 1) {
      const x = pos(vectorA[i]);
      const y = pos(vectorB[i]);
      if (x && y) a += 1;
      else if (x && !y) b += 1;
      else if (!x && y) c += 1;
      else d += 1;
    }
    const total = a + b + c + d;
    if (distance === "simple-matching") return (b + c) / Math.max(1, total);
    if (distance === "jaccard") return (b + c) / Math.max(1, a + b + c);
    if (distance === "dice") return (b + c) / Math.max(1, 2 * a + b + c);
    if (distance === "russell-rao") return (b + c) / Math.max(1, total);
    if (distance === "rogers-tanimoto") return (b + c) / Math.max(1, a + 2 * (b + c) + d);
    if (distance === "sokal-sneath") return 2 * (b + c) / Math.max(1, a + 2 * (b + c) + d);
    if (distance === "phi") {
      const denominator = Math.sqrt(Math.max(1, (a + b) * (a + c) * (b + d) * (c + d)));
      const phi = (a * d - b * c) / denominator;
      return Math.max(0, 1 - phi);
    }
    if (distance === "yule-q") {
      const denominator = a * d + b * c;
      if (!denominator) return 1;
      const q = (a * d - b * c) / denominator;
      return Math.max(0, 1 - q);
    }
    throw new Error(`不支持的二元距离：${distance}`);
  }

  /** Lance-Williams 系数 */
  function lanceWilliamsCoefficients(linkage, nI, nJ, nK) {
    const total = nI + nJ;
    if (linkage === "nearest") return { alphaI: 0.5, alphaJ: 0.5, beta: 0, gamma: -0.5 };
    if (linkage === "furthest") return { alphaI: 0.5, alphaJ: 0.5, beta: 0, gamma: 0.5 };
    if (linkage === "between") return { alphaI: nI / total, alphaJ: nJ / total, beta: 0, gamma: 0 };
    if (linkage === "within") return { alphaI: 0.5, alphaJ: 0.5, beta: 0, gamma: 0 };
    if (linkage === "centroid") {
      const beta = -((nI * nJ) / (total * total));
      return { alphaI: nI / total, alphaJ: nJ / total, beta, gamma: 0 };
    }
    if (linkage === "median") return { alphaI: 0.5, alphaJ: 0.5, beta: -0.25, gamma: 0 };
    if (linkage === "ward") {
      const totalW = nI + nJ + nK;
      return { alphaI: (nI + nK) / totalW, alphaJ: (nJ + nK) / totalW, beta: -nK / totalW, gamma: 0 };
    }
    throw new Error(`不支持的聚类方法：${linkage}`);
  }

  /**
   * 系统聚类／层次聚类
   * @param {object} input - { rows, headers, definitions, clusterVariables, options }
   *  options: {
   *    object: "cases"|"variables",
   *    dataType: "interval"|"count"|"binary",
   *    linkage, distance, minkowskiP, standardization, distanceTransform,
   *    positiveValue, negativeValue, missingCodes,
   *    selectedK（固定群数）| kRange（如 2-10，默认给 2-10 归属）
   *  }
   */
  function hierarchicalCluster(input) {
    const { rows, headers, definitions, clusterVariables, options } = input;
    const {
      object = "cases",
      dataType = "interval",
      linkage = "ward",
      distance = "squared-euclidean",
      minkowskiP = 2,
      standardization = "zscore",
      distanceTransform = "none",
      positiveValue = "1",
      negativeValue = "0",
      selectedK = 0,
      kRange = { min: 2, max: 10 }
    } = options || {};

    // 缺失处理：Listwise（任一聚类变量缺失则整行排除）
    const nRows = rows.length;
    const rowValid = new Array(nRows).fill(true);
    for (let i = 0; i < nRows; i += 1) {
      for (const name of clusterVariables) {
        const definition = definitions.find((item) => item.name === name);
        const value = rows[i][name];
        const missingCodes = definition?.missingCodes || [];
        if (isBlank(value)) { rowValid[i] = false; break; }
        if (isMissingValue(value, missingCodes)) { rowValid[i] = false; break; }
      }
    }
    const validRowIndexes = [];
    rowValid.forEach((valid, index) => { if (valid) validRowIndexes.push(index); });
    const validN = validRowIndexes.length;
    if (validN < 3) throw new Error("Listwise 删除后有效样本不足，无法执行系统聚类。");

    // 数据准备：案例聚类 = 样本行；变量聚类 = 变量（转置，样本为维度）
    let objectNames;
    let objectRows;
    if (object === "cases") {
      objectNames = validRowIndexes.map((_, index) => `案例${index + 1}`);
      objectRows = validRowIndexes.map((rowIndex) => clusterVariables.map((name) => rows[rowIndex][name]));
    } else {
      objectNames = clusterVariables.slice();
      objectRows = clusterVariables.map((name) => validRowIndexes.map((rowIndex) => rows[rowIndex][name]));
    }
    const m = objectNames.length;
    if (m < 2) throw new Error("至少需要 2 个对象才能执行系统聚类。");
    if (object === "variables" && m < 3) {
      throw new Error("对变量聚类时至少需要选择 3 个数值变量。");
    }

    // 矩阵（对象 × 维度；行 = 对象，列 = 变量/样本维度）
    let matrix = objectRows.map((row) => row.slice());

    // 标准化（按变量列标准化；二元与计数数据不做数值标准化——计数距离基于原始频数）
    const standardizer = {};
    if (dataType !== "binary" && dataType !== "count" && standardization !== "none") {
      const dimCount = matrix[0].length;
      for (let dim = 0; dim < dimCount; dim += 1) {
        const finiteIndexes = [];
        const values = [];
        matrix.forEach((row, position) => {
          const num = Number(row[dim]);
          if (Number.isFinite(num)) {
            finiteIndexes.push(position);
            values.push(num);
          }
        });
        if (!values.length) continue;
        const result = standardizeValues(values, standardization);
        standardizer[`维度${dim + 1}`] = result.params;
        finiteIndexes.forEach((position, valuePosition) => {
          matrix[position][dim] = result.values[valuePosition];
        });
      }
    }

    // 距离矩阵（对象间）
    const distanceMatrix = new Float64Array(m * m);
    const binaryMode = dataType === "binary";
    const countMode = dataType === "count";
    const validDistances = [];
    for (let a = 0; a < m; a += 1) {
      for (let b = a + 1; b < m; b += 1) {
        let dist;
        if (binaryMode) {
          dist = binaryVectorDistance(matrix[a], matrix[b], distance, positiveValue);
        } else if (countMode) {
          const vectorA = matrix[a].map(Number);
          const vectorB = matrix[b].map(Number);
          if (vectorA.some((value) => !Number.isFinite(value) || value < 0) || vectorB.some((value) => !Number.isFinite(value) || value < 0)) {
            throw new Error("计数数据必须为非负数值，请检查数据后重试。");
          }
          dist = vectorDistance(vectorA, vectorB, distance, {});
        } else {
          const vectorA = matrix[a].map(Number);
          const vectorB = matrix[b].map(Number);
          dist = vectorDistance(vectorA, vectorB, distance, { p: minkowskiP });
        }
        // 距离变换（rescale01 在矩阵构建完成后统一缩放）
        if (distanceTransform === "abs") dist = Math.abs(dist);
        else if (distanceTransform === "sign") dist = -dist;
        distanceMatrix[a * m + b] = dist;
        distanceMatrix[b * m + a] = dist;
        if (dist > 0 && dist !== Infinity) validDistances.push(dist);
      }
    }
    // rescale01：按有效距离范围重缩放
    if (distanceTransform === "rescale01" && validDistances.length) {
      const minD = Math.min(...validDistances);
      const maxD = Math.max(...validDistances);
      const range = maxD - minD || 1;
      for (let a = 0; a < m; a += 1) {
        for (let b = a + 1; b < m; b += 1) {
          distanceMatrix[a * m + b] = (distanceMatrix[a * m + b] - minD) / range;
          distanceMatrix[b * m + a] = distanceMatrix[a * m + b];
        }
      }
    }

    // Ward 法要求平方欧氏距离
    if (linkage === "ward" && distance !== "squared-euclidean" && distance !== "euclidean") {
      throw new Error("Ward 法要求使用欧氏距离或平方欧氏距离。");
    }
    if ((linkage === "centroid" || linkage === "median") && !["euclidean", "squared-euclidean", "cityblock", "chebyshev", "minkowski"].includes(distance)) {
      throw new Error("重心法与中位数法要求使用欧氏类距离。");
    }

    // 聚合：最小堆优先队列 + Lance-Williams
    const active = Array.from({ length: m }, (_, index) => ({
      id: index,
      n: 1,
      members: [index],
      deleted: false
    }));
    const merges = []; // 聚合过程
    let clusterCount = m;

    // 堆实现（dist, a, b）
    const heap = [];
    const heapPush = (item) => {
      heap.push(item);
      let index = heap.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent].dist <= heap[index].dist) break;
        [heap[parent], heap[index]] = [heap[index], heap[parent]];
        index = parent;
      }
    };
    const heapPop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let index = 0;
        for (;;) {
          const left = index * 2 + 1;
          const right = left + 1;
          let smallest = index;
          if (left < heap.length && heap[left].dist < heap[smallest].dist) smallest = left;
          if (right < heap.length && heap[right].dist < heap[smallest].dist) smallest = right;
          if (smallest === index) break;
          [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
          index = smallest;
        }
      }
      return top;
    };

    for (let a = 0; a < m; a += 1) {
      for (let b = a + 1; b < m; b += 1) {
        heapPush({ dist: distanceMatrix[a * m + b], a, b });
      }
    }

    const distBetween = (clusterA, clusterB) => {
      // 簇间距离取成员间距离最小值？不对——LW 更新已经维护了簇间距离。这里仅用于初始化后的查询。
      return distanceMatrix[clusterA.id * m + clusterB.id];
    };
    void distBetween;

    while (clusterCount > 1 && heap.length) {
      let pair = heapPop();
      while (pair && (active[pair.a].deleted || active[pair.b].deleted)) pair = heapPop();
      if (!pair) break;
      const clusterA = active[pair.a];
      const clusterB = active[pair.b];
      const mergedId = clusterA.id;
      const mergedMembers = [...clusterA.members, ...clusterB.members];
      merges.push({
        step: m - clusterCount + 1,
        clusterA: clusterA.id,
        clusterB: clusterB.id,
        membersA: clusterA.members.slice(),
        membersB: clusterB.members.slice(),
        distance: pair.dist,
        n: clusterA.n + clusterB.n
      });
      clusterB.deleted = true;
      active[clusterA.id] = {
        id: mergedId,
        n: clusterA.n + clusterB.n,
        members: mergedMembers,
        deleted: false
      };
      // 更新与其余簇的距离（Lance-Williams）
      for (let k = 0; k < m; k += 1) {
        if (k === clusterA.id || k === clusterB.id || active[k].deleted) continue;
        const di = distanceMatrix[clusterA.id * m + k];
        const dj = distanceMatrix[clusterB.id * m + k];
        const dij = pair.dist;
        const { alphaI, alphaJ, beta, gamma } = lanceWilliamsCoefficients(linkage, clusterA.n, clusterB.n, active[k].n);
        let newDist = alphaI * di + alphaJ * dj + beta * dij + gamma * Math.abs(di - dj);
        if (newDist < 0 && (linkage === "centroid" || linkage === "median")) newDist = Math.max(0, newDist);
        distanceMatrix[mergedId * m + k] = newDist;
        distanceMatrix[k * m + mergedId] = newDist;
        heapPush({ dist: newDist, a: mergedId, b: k });
      }
      clusterCount -= 1;
    }
    // 若堆提前为空但仍有多个簇（数值问题兜底），直接合并剩余簇
    while (clusterCount > 1) {
      const remaining = active.filter((cluster) => !cluster.deleted);
      let bestA = remaining[0];
      let bestB = remaining[1];
      let bestDist = Infinity;
      for (let a = 0; a < remaining.length; a += 1) {
        for (let b = a + 1; b < remaining.length; b += 1) {
          const dist = distanceMatrix[remaining[a].id * m + remaining[b].id];
          if (dist < bestDist) { bestDist = dist; bestA = remaining[a]; bestB = remaining[b]; }
        }
      }
      merges.push({
        step: m - clusterCount + 1,
        clusterA: bestA.id,
        clusterB: bestB.id,
        membersA: bestA.members.slice(),
        membersB: bestB.members.slice(),
        distance: bestDist,
        n: bestA.n + bestB.n
      });
      bestB.deleted = true;
      clusterCount -= 1;
    }

    // 树状图节点（scipy 风格 merge 数组）
    const tree = merges.map((merge) => ({
      left: merge.clusterA,
      right: merge.clusterB,
      distance: merge.distance,
      size: merge.n
    }));

    // 指定群数的归属：从聚合过程回溯
    const assignmentForK = (k) => {
      if (k >= m) return Array.from({ length: m }, (_, index) => index + 1);
      if (k < 1) k = 1;
      const stopStep = m - k;
      const assignments = Array.from({ length: m }, (_, index) => index);
      for (let step = 0; step < stopStep && step < merges.length; step += 1) {
        const merge = merges[step];
        assignments.forEach((value, index) => {
          if (value === merge.clusterB) assignments[index] = merge.clusterA;
        });
      }
      // 重新编号 1..k
      const labelMap = new Map();
      let nextLabel = 1;
      return assignments.map((value) => {
        if (!labelMap.has(value)) labelMap.set(value, nextLabel++);
        return labelMap.get(value);
      });
    };

    // 2-10 群归属（或用户指定范围）
    const kMin = Math.max(1, kRange.min || 2);
    const kMax = Math.min(m, Math.max(kMin, kRange.max || 10));
    const kAssignments = [];
    for (let k = kMin; k <= kMax; k += 1) {
      kAssignments.push({ k, assignment: assignmentForK(k) });
    }

    // 聚合系数跳升建议（帮助判断切割位置）
    const coefficientSuggestions = [];
    for (let k = kMin; k < kMax; k += 1) {
      const step = m - k;
      const merge = merges[step - 1];
      const previous = merges[step - 2];
      if (merge && previous) {
        const jump = previous.distance > 0 ? merge.distance / previous.distance : 1;
        coefficientSuggestions.push({ k, coefficient: merge.distance, previousCoefficient: previous.distance, ratio: jump });
      } else if (merge) {
        coefficientSuggestions.push({ k, coefficient: merge.distance, previousCoefficient: null, ratio: null });
      }
    }
    const suggestedK = coefficientSuggestions
      .filter((item) => item.ratio && item.ratio >= 1.5)
      .sort((a, b) => b.ratio - a.ratio)[0]?.k || null;

    // 群体规模
    const finalK = selectedK > 0 ? Math.min(selectedK, m) : kMax;
    const finalAssignment = assignmentForK(finalK);
    const clusterSizes = [];
    const sizeMap = new Map();
    finalAssignment.forEach((label) => sizeMap.set(label, (sizeMap.get(label) || 0) + 1));
    Array.from(sizeMap.entries()).sort((a, b) => a[0] - b[0]).forEach(([label, count]) => {
      clusterSizes.push({ id: label, name: `群体${label}`, count, pct: (count / m) * 100 });
    });

    // 样本归属（对案例聚类时 rowIndex 为有效样本行索引；对变量聚类无样本归属）
    const assignments = object === "cases"
      ? finalAssignment.map((label, index) => ({ rowIndex: validRowIndexes[index], clusterId: label }))
      : [];

    return {
      method: "hierarchical",
      methodName: "系统聚类（层次聚类）",
      object,
      dataType,
      linkage,
      distance,
      minkowskiP,
      standardization: dataType === "binary" ? "none" : standardization,
      distanceTransform,
      validN,
      excludedN: nRows - validN,
      sampleCount: nRows,
      variables: clusterVariables,
      objectNames,
      objectCount: m,
      selectedK: finalK,
      merges,
      tree,
      distanceMatrix: Array.from(distanceMatrix),
      kAssignments,
      coefficientSuggestions,
      suggestedK,
      clusterSizes,
      assignments,
      validRowIndexes: object === "cases" ? validRowIndexes.slice() : [],
      warnings: []
    };
  }

  // ─── 群体画像 ─────────────────────────────────────────────

  /**
   * 群体画像（聚类变量 + 描述变量统一处理）
   * @param {object} input - { rows, definitions, clusterVariables, profileVariables, assignments, clusterSizes, clusterNames }
   * assignments: Array<{rowIndex, clusterId}>
   */
  function profileClusters(input) {
    const { rows, definitions, clusterVariables, profileVariables, assignments, clusterSizes, clusterNames } = input;
    const defMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const n = assignments.length;
    const clusters = new Set(assignments.map((assignment) => assignment.clusterId).filter((id) => id > 0));
    const clusterIds = Array.from(clusters).sort((a, b) => a - b);
    const nameOf = (id) => {
      const found = clusterNames && clusterNames[id];
      return found || (clusterSizes?.find((size) => size.id === id)?.name) || `群体${id}`;
    };
    const totalWeighted = n;

    const variables = [];
    const allNames = [...new Set([...clusterVariables, ...(profileVariables || [])])];
    const counts = new Map();
    clusterIds.forEach((id) => { counts.set(id, 0); });
    assignments.forEach((assignment) => {
      if (counts.has(assignment.clusterId)) counts.set(assignment.clusterId, counts.get(assignment.clusterId) + 1);
    });
    allNames.forEach((name) => {
      const definition = defMap.get(name);
      const measurement = definition?.measurement || "nominal";
      const numericLike = ["scale", "count"].includes(measurement) || (measurement === "ordinal" && definition?.userConfirmed);
      const perCluster = {};
      const overallNumeric = [];
      const overallCategorical = new Map();
      assignments.forEach((assignment) => {
        const rowIndex = assignment.rowIndex;
        const clusterId = assignment.clusterId;
        if (!counts.has(clusterId)) return;
        const value = rows[rowIndex][name];
        if (isMissingValue(value, definition?.missingCodes)) return;
        if (numericLike) {
          const num = toNumber(value);
          if (num === null) return;
          overallNumeric.push(num);
          if (!perCluster[clusterId]) perCluster[clusterId] = [];
          perCluster[clusterId].push(num);
        } else {
          const key = normText(value);
          overallCategorical.set(key, (overallCategorical.get(key) || 0) + 1);
          if (!perCluster[clusterId]) perCluster[clusterId] = [];
          perCluster[clusterId].push(key);
        }
      });
      if (numericLike) {
        const overallMean = safeMean(overallNumeric);
        const overallStd = safeStd(overallNumeric, overallMean);
        variables.push({
          name,
          type: "continuous",
          measurement,
          overall: { mean: overallMean, std: overallStd, count: overallNumeric.length },
          perCluster: clusterIds.map((id) => {
            const values = perCluster[id] || [];
            const mean = safeMean(values);
            return {
              clusterId: id,
              clusterName: nameOf(id),
              count: values.length,
              mean,
              std: safeStd(values, mean),
              standardizedDiff: overallStd ? (mean - overallMean) / overallStd : 0,
              diff: mean - overallMean
            };
          })
        });
      } else {
        const totalCategorical = Array.from(overallCategorical.values()).reduce((sum, count) => sum + count, 0) || 1;
        const categories = Array.from(overallCategorical.keys()).sort();
        variables.push({
          name,
          type: "categorical",
          measurement,
          categories: categories.map((category) => {
            const overallCount = overallCategorical.get(category) || 0;
            return {
              category,
              overallCount,
              overallPct: (overallCount / totalCategorical) * 100,
              perCluster: clusterIds.map((id) => {
                const values = perCluster[id] || [];
                const count = values.filter((value) => value === category).length;
                const clusterTotal = counts.get(id) || 0;
                return {
                  clusterId: id,
                  clusterName: nameOf(id),
                  count,
                  pct: clusterTotal ? (count / clusterTotal) * 100 : 0,
                  ppDiff: clusterTotal ? (count / clusterTotal) * 100 - (overallCount / totalCategorical) * 100 : 0
                };
              })
            };
          })
        });
      }
    });

    // 每个群体的核心特征（高于总体 / 低于总体 / 主要分类特征）
    const groupProfiles = clusterIds.map((id) => {
      const above = [];
      const below = [];
      const categoricalTop = [];
      variables.forEach((variable) => {
        if (variable.type === "continuous") {
          const item = variable.perCluster.find((entry) => entry.clusterId === id);
          if (!item || item.mean === null) return;
          if (item.standardizedDiff > 0.3) above.push({ variable: variable.name, value: item.mean, overall: variable.overall.mean, diff: item.standardizedDiff });
          if (item.standardizedDiff < -0.3) below.push({ variable: variable.name, value: item.mean, overall: variable.overall.mean, diff: item.standardizedDiff });
        } else {
          variable.categories.forEach((category) => {
            const item = category.perCluster.find((entry) => entry.clusterId === id);
            if (!item) return;
            if (item.ppDiff >= 8) {
              categoricalTop.push({ variable: variable.name, category: category.category, pct: item.pct, ppDiff: item.ppDiff });
            }
          });
        }
      });
      above.sort((a, b) => b.diff - a.diff);
      below.sort((a, b) => a.diff - b.diff);
      categoricalTop.sort((a, b) => b.ppDiff - a.ppDiff);
      const size = counts.get(id) || 0;
      return {
        clusterId: id,
        clusterName: nameOf(id),
        count: size,
        pct: totalWeighted ? (size / totalWeighted) * 100 : 0,
        above: above.slice(0, 8),
        below: below.slice(0, 8),
        categoricalTop: categoricalTop.slice(0, 8)
      };
    });

    return { variables, groupProfiles, clusterIds };
  }

  // ─── 算法建议助手（本地规则，不调用 AI）──────────────────

  /**
   * 根据变量与样本结构给出分群方法建议
   * @returns {{recommendedMethod: "kmeans"|"twostep"|"hierarchical", reasons: string[], warnings: string[]}}
   */
  function recommendMethod(definitions, sampleCount) {
    const clusterDefs = definitions.filter((definition) => definition.role === "cluster");
    const reasons = [];
    const warnings = [];
    const hasCategorical = clusterDefs.some((definition) => ["nominal", "binary"].includes(definition.measurement));
    const continuousCount = clusterDefs.filter((definition) => ["scale", "count"].includes(definition.measurement)).length;
    const ordinalCount = clusterDefs.filter((definition) => definition.measurement === "ordinal").length;
    const n = sampleCount || 0;
    if (!clusterDefs.length) {
      return { recommendedMethod: "twostep", reasons: ["尚未选择聚类变量，请先在变量定义中选择参与分群的变量。"], warnings: [] };
    }
    let recommendedMethod = "twostep";
    if (!hasCategorical) {
      recommendedMethod = n >= 100 ? "kmeans" : n > 0 && n <= 300 ? "hierarchical" : "kmeans";
      reasons.push(`当前包含 ${continuousCount} 个连续变量${ordinalCount ? `和 ${ordinalCount} 个有序变量` : ""}，全部为数值型变量。`);
      if (recommendedMethod === "kmeans") {
        reasons.push(`有效样本量 ${n}，且需求或态度变量可视为尺度变量，适合使用 K-Means（需预先指定分群数量）。`);
        warnings.push("K-Means 只接受连续/尺度变量；名义分类变量需要先转码或改用两步聚类。");
      } else {
        reasons.push(`有效样本量 ${n} 较小，适合使用系统聚类探索群体合并过程与树状图。`);
      }
    } else {
      reasons.push(`当前包含 ${continuousCount} 个连续变量和 ${clusterDefs.length - continuousCount} 个分类/二元变量，混合类型适合使用两步聚类。`);
      reasons.push("两步聚类可同时处理连续与分类变量，并可通过 BIC/AIC 自动判断群数。");
      if (n > 300) warnings.push("样本量较大时建议使用两步聚类（系统聚类需计算距离矩阵，开销随样本量快速增长）。");
      if (n <= 300 && n > 0) {
        warnings.push("样本量较小时也可考虑系统聚类观察合并过程，但混合变量类型下两步聚类更稳妥。");
      }
    }
    if (n === 0) warnings.push("尚未导入数据。");
    return { recommendedMethod, reasons, warnings };
  }

  // ─── Excel / CSV 导出行构建（纯数据，由 UI 层下载）──────

  function formatNumber(value, digits = 2) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "";
    return Number(value.toFixed(digits));
  }

  /** 构建多 Sheet 导出结构 */
  function buildExportSheets(result, extra = {}) {
    const sheets = [];
    const names = extra.clusterNames || {};
    const nameOf = (id) => names[id] || `群体${id}`;

    // 1. 模型摘要
    sheets.push({
      name: "模型摘要",
      rows: [
        ["用户分群分析 — 模型摘要"],
        ["导出时间", new Date().toLocaleString("zh-CN")],
        ["算法", result.methodName],
        ["有效样本量", result.validN],
        ["排除样本量", result.excludedN || 0],
        ["最终群数", result.selectedK],
        ["聚类变量", (result.variables || []).join("、")],
        ["描述变量", (extra.profileVariables || []).join("、")],
        ["最小群体占比", result.clusterSizes?.length ? `${formatNumber(Math.min(...result.clusterSizes.filter((s) => s.id > 0).map((s) => s.pct)), 1)}%` : ""],
        ...(result.method === "kmeans"
          ? [
              ["标准化方式", result.preprocessing?.standardization],
              ["缺失处理", result.preprocessing?.missingMode === "pairwise" ? "Pairwise（按有效维度归一化）" : "Listwise"],
              ["计算方法", result.runMode === "batch" ? "迭代并分类（批量更新）" : result.runMode === "sequential" ? "运行均值更新" : "仅分类"],
              ["最大迭代次数", result.maxIterations],
              ["收敛标准", result.convergence],
              ["是否收敛", result.converged ? "是" : "否"],
              ["SSE", formatNumber(result.sse)],
              ["Silhouette", formatNumber(result.silhouette, 4)]
            ]
          : result.method === "twostep"
            ? [
                ["距离方式", result.distance === "loglikelihood" ? "对数似然距离" : "欧氏距离"],
                ["群数选择", result.autoSelect ? `自动选择（${result.criterion}）` : "固定群数"],
                ["连续变量数", result.continuousVariables?.length || 0],
                ["分类变量数", result.categoricalVariables?.length || 0],
                ["噪声样本数", result.noiseCount || 0],
                ...(extra.stability ? [["稳定性等级", extra.stability.level], ["稳定性一致率", formatNumber(extra.stability.meanConsistency, 3)]] : [])
              ]
            : [
                ["聚类对象", result.object === "cases" ? "案例（受访者）" : "变量"],
                ["数据类型", result.dataType === "interval" ? "区间/连续" : result.dataType === "count" ? "计数" : "二元"],
                ["聚类方法", LINKAGE_METHODS[result.linkage] || result.linkage],
                ["距离方式", result.distance],
                ["标准化方式", result.standardization],
                ["距离变换", result.distanceTransform]
              ]),
        ["质量提示", ...(result.warnings || []).map((warning) => [warning])],
        [],
        ["说明", "本工具参考主流统计软件的聚类方法与公开算法原理实现。由于初始化、数据顺序和软件内部优化机制不同，结果可能与其他统计软件存在差异。"]
      ]
    });

    // 2. 群体规模
    const sizeRows = [["群体编号", "群体名称", "样本量", "占比(%)", "加权样本量", "加权占比(%)"]];
    (result.clusterSizes || []).forEach((size) => {
      sizeRows.push([
        size.id,
        nameOf(size.id),
        size.count,
        formatNumber(size.pct, 1),
        size.weightedCount ?? "",
        size.weightedPct !== null && size.weightedPct !== undefined ? formatNumber(size.weightedPct, 1) : ""
      ]);
    });
    sheets.push({ name: "群体规模", rows: sizeRows });

    // 3. 群体画像_连续变量 / 分类变量
    if (extra.profile) {
      const continuousRows = [["变量", "总体均值", "群体", "群体均值", "标准化差异", "差值"]];
      const categoricalRows = [["变量", "类别", "总体占比(%)", "群体", "群体占比(%)", "百分点差异"]];
      extra.profile.variables.forEach((variable) => {
        if (variable.type === "continuous") {
          variable.perCluster.forEach((entry) => {
            continuousRows.push([
              variable.name,
              formatNumber(variable.overall.mean),
              entry.clusterName,
              formatNumber(entry.mean),
              formatNumber(entry.standardizedDiff, 3),
              formatNumber(entry.diff, 3)
            ]);
          });
        } else {
          variable.categories.forEach((category) => {
            category.perCluster.forEach((entry) => {
              categoricalRows.push([
                variable.name,
                category.category,
                formatNumber(category.overallPct, 1),
                entry.clusterName,
                formatNumber(entry.pct, 1),
                formatNumber(entry.ppDiff, 1)
              ]);
            });
          });
        }
      });
      sheets.push({ name: "群体画像_连续变量", rows: continuousRows });
      sheets.push({ name: "群体画像_分类变量", rows: categoricalRows });
    }

    // 4. 样本归属（保留全部原始字段，追加分群列）
    if (extra.fullRows) {
      const { headers, fullRows, assignments } = extra;
      const assignmentMap = new Map(assignments.map((assignment) => [assignment.rowIndex, assignment]));
      const rows = [[...headers, "cluster_method", "cluster_id", "cluster_name", "cluster_distance"]];
      fullRows.forEach((row, index) => {
        const assignment = assignmentMap.get(index);
        rows.push([
          ...headers.map((header) => row[header] ?? ""),
          result.method,
          assignment?.clusterId ?? "",
          assignment?.clusterId ? nameOf(assignment.clusterId) : "",
          assignment?.distance ?? ""
        ]);
      });
      sheets.push({ name: "样本归属", rows });
    }

    // 5. 算法专属 Sheet
    if (result.method === "kmeans") {
      sheets.push({
        name: "初始中心",
        rows: [["聚类", ...result.variables], ...(result.centersOriginal || result.initialCenters).map((center, index) => [`聚类${index + 1}`, ...center.map((value) => formatNumber(value, 4))])]
      });
      sheets.push({
        name: "最终中心",
        rows: [["聚类", ...result.variables], ...(result.finalCentersOriginal || result.finalCenters).map((center, index) => [`聚类${index + 1}`, ...center.map((value) => formatNumber(value, 4))])]
      });
      sheets.push({
        name: "迭代历史",
        rows: [["迭代次数", "中心最大变化", "是否收敛"], ...result.iterationHistory.map((entry) => [entry.iteration, formatNumber(entry.maxChange, 6), entry.converged ? "是" : "否"])]
      });
      sheets.push({
        name: "ANOVA",
        rows: [["变量", "群体均值", "总体均值", "F", "显著性 p", "备注"]],
        ...result.anova.map((item) => [
          item.variable,
          item.clusterMeans.map((value) => formatNumber(value)).join(" / "),
          formatNumber(item.grandMean),
          formatNumber(item.f, 3),
          formatNumber(item.p, 4),
          "F 值和显著性仅用于描述变量对群体区分的相对贡献，不作为独立假设检验结论"
        ])
      });
      sheets.push({
        name: "中心间距离",
        rows: [["", ...result.clusterSizes.map((size) => size.name)], ...result.centerDistances.map((row, index) => [result.clusterSizes[index].name, ...row.map((value) => formatNumber(value, 3))])]
      });
    } else if (result.method === "twostep") {
      sheets.push({
        name: "信息准则比较",
        rows: [["群数", "对数似然", "BIC", "AIC", "BIC变化", "AIC变化", "最小群体占比(%)"], ...result.criterionTable.map((entry) => [
          entry.clusters,
          formatNumber(entry.logLikelihood, 2),
          formatNumber(entry.bic, 2),
          formatNumber(entry.aic, 2),
          formatNumber(entry.bicChange, 2),
          formatNumber(entry.aicChange, 2),
          formatNumber(entry.minClusterPct, 1)
        ])]
      });
      sheets.push({
        name: "变量区分度",
        rows: [["变量", "类型", "统计量", "区分度得分(0-100)"], ...result.discrimination.map((item) => [
          item.variable,
          item.type === "continuous" ? "连续" : "分类",
          item.type === "continuous" ? formatNumber(item.f, 3) : formatNumber(item.chiSquare, 3),
          formatNumber(item.score, 1)
        ])]
      });
      sheets.push({
        name: "连续变量摘要",
        rows: [["变量", "总体均值", "总体标准差", "群体", "均值", "标准差", "样本量"], ...result.continuousSummary.flatMap((summary) =>
          summary.perCluster.map((cluster, index) => [
            summary.variable,
            formatNumber(summary.overallMean),
            formatNumber(summary.overallStd),
            `群体${index + 1}`,
            formatNumber(cluster.mean),
            formatNumber(cluster.std),
            cluster.count
          ])
        )]
      });
      sheets.push({
        name: "分类变量摘要",
        rows: [["变量", "类别", "总体占比(%)", "群体", "群体占比(%)", "群体样本量"], ...result.categoricalSummary.flatMap((summary) =>
          summary.categories.flatMap((category) =>
            category.perCluster.map((cluster, index) => [
              summary.variable,
              category.category,
              formatNumber(category.overallPct, 1),
              `群体${index + 1}`,
              formatNumber(cluster.pct, 1),
              cluster.count
            ])
          )
        )]
      });
      if (result.noiseCount > 0) {
        sheets.push({
          name: "噪声样本",
          rows: [["行号", "说明"], ...result.assignments.filter((assignment) => assignment.noise).map((assignment) => [assignment.rowIndex + 1, "稀疏叶节点，无法稳定归入任何群体"])]
        });
      }
    } else if (result.method === "hierarchical") {
      sheets.push({
        name: "聚合过程",
        rows: [["步骤", "对象A", "对象B", "聚合系数", "合并后对象数"], ...result.merges.map((merge, index) => [
          merge.step,
          result.object === "cases" ? `案例${merge.clusterA + 1}` : result.objectNames[merge.clusterA],
          result.object === "cases" ? `案例${merge.clusterB + 1}` : result.objectNames[merge.clusterB],
          formatNumber(merge.distance, 4),
          result.objectCount - index - 1
        ])]
      });
      if (result.objectCount <= 200) {
        const matrixSize = result.objectCount;
        const headerRow = ["对象", ...Array.from({ length: matrixSize }, (_, index) => index + 1)];
        const matrixRows = [headerRow];
        for (let a = 0; a < matrixSize; a += 1) {
          matrixRows.push([a + 1, ...Array.from({ length: matrixSize }, (_, b) => formatNumber(result.distanceMatrix[a * matrixSize + b], 3))]);
        }
        sheets.push({ name: "距离矩阵", rows: matrixRows });
      }
      const multiRows = [["案例/对象", ...result.kAssignments.map((entry) => `K=${entry.k}`)]];
      result.kAssignments.forEach((entry, kIndex) => {
        entry.assignment.forEach((label, objectIndex) => {
          if (!multiRows[objectIndex + 1]) multiRows[objectIndex + 1] = [result.objectNames[objectIndex] || `对象${objectIndex + 1}`];
          multiRows[objectIndex + 1][kIndex + 1] = label;
        });
      });
      sheets.push({ name: "多群数归属", rows: multiRows });
    }

    return sheets;
  }

  /** 构建分群归属 CSV 行 */
  function buildAssignmentCsvRows(result, extra = {}) {
    const names = extra.clusterNames || {};
    const rows = [["row_index", "cluster_method", "cluster_id", "cluster_name", "cluster_distance"]];
    result.assignments.forEach((assignment) => {
      rows.push([
        assignment.rowIndex + 1,
        result.method,
        assignment.clusterId ?? "",
        assignment.clusterId ? names[assignment.clusterId] || `群体${assignment.clusterId}` : "",
        assignment.distance ?? ""
      ]);
    });
    return rows;
  }

  /** 构建带标签完整数据 CSV 行 */
  function buildFullDataCsvRows(result, extra = {}) {
    const { headers, fullRows } = extra;
    const names = extra.clusterNames || {};
    const assignmentMap = new Map(result.assignments.map((assignment) => [assignment.rowIndex, assignment]));
    const rows = [[...headers, "cluster_method", "cluster_id", "cluster_name"]];
    fullRows.forEach((row, index) => {
      const assignment = assignmentMap.get(index);
      rows.push([
        ...headers.map((header) => row[header] ?? ""),
        result.method,
        assignment?.clusterId ?? "",
        assignment?.clusterId ? names[assignment.clusterId] || `群体${assignment.clusterId}` : ""
      ]);
    });
    return rows;
  }

  // ─── 导出 ─────────────────────────────────────────────────

  root.ClusterCore = {
    mulberry32,
    isBlank,
    toNumber,
    uniqueValues,
    isMissingValue,
    safeMean,
    safeStd,
    EPSILON,
    MEASUREMENT_TYPES,
    ROLES,
    STANDARDIZATION_METHODS,
    LINKAGE_METHODS,
    INTERVAL_DISTANCES,
    COUNT_DISTANCES,
    BINARY_DISTANCES,
    DISTANCE_TRANSFORMS,
    detectMultiSelectGroups,
    detectMeasurement,
    detectVariableTypes,
    standardizeValues,
    applyStandardization,
    undoStandardization,
    reverseScoreValue,
    runQualityChecks,
    fPValue,
    fSurvival,
    kmeansCluster,
    twostepCluster,
    hierarchicalCluster,
    profileClusters,
    recommendMethod,
    buildExportSheets,
    buildAssignmentCsvRows,
    buildFullDataCsvRows,
    vectorDistance,
    binaryVectorDistance
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
