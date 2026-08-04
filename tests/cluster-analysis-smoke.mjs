/**
 * 用户分群分析 — 冒烟测试
 *
 * 覆盖：
 *   - K-Means：固定K / 自动初始中心 / 手动中心 / 批量 / 运行均值 / 仅分类 /
 *     最大迭代 / 收敛 / Listwise / Pairwise / 权重 / 归属 / 中心距离 / ANOVA / 可复现
 *   - 两步聚类：纯连续 / 混合变量 / 对数似然 / 欧氏 / 欧氏拒绝分类 / 固定群数 /
 *     BIC / AIC / 标准化 / 用户缺失码 / 系统缺失 / 噪声 / 预聚类 / 种子 / 归属
 *   - 系统聚类：案例 / 变量 / 七种联接 / 区间距离 / 计数距离 / 二元距离 /
 *     标准化 / 距离变换 / 聚合过程 / 树状图 / 2-10 群归属 / 距离矩阵
 *   - UI 静态检查：模型卡片 / 深链接 / 算法切换 / 变量编辑 / 导出 / 项目保存
 *   - 隐私与接口：不调用 /api/ai、/pptx-api、不发送原始数据
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

const coreSource = readFileSync(new URL("../cluster-core.js", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../cluster-analysis.js", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../cluster-worker.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

runInThisContext(coreSource, { filename: "cluster-core.js" });
const core = globalThis.ClusterCore;
assert.ok(core, "ClusterCore should be exposed");
assert.equal(typeof core.kmeansCluster, "function");
assert.equal(typeof core.twostepCluster, "function");
assert.equal(typeof core.hierarchicalCluster, "function");
assert.equal(typeof core.detectVariableTypes, "function");
assert.equal(typeof core.runQualityChecks, "function");
assert.equal(typeof core.profileClusters, "function");
assert.equal(typeof core.recommendMethod, "function");
assert.equal(typeof core.buildExportSheets, "function");

// ─── 测试数据：3 个分离良好的群体（各 40 条）────────────────

function buildRows() {
  const rows = [];
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let g = 0; g < 3; g += 1) {
    for (let i = 0; i < 40; i += 1) {
      rows.push({
        rid: `R${String(g * 40 + i + 1).padStart(4, "0")}`,
        gender: random() < 0.5 ? "男" : "女",
        x: g * 5 + (random() - 0.5) * 0.5,
        y: g * 5 + (random() - 0.5) * 0.5
      });
    }
  }
  return rows;
}

const rows = buildRows();
const baseDefinitions = [
  { name: "rid", role: "id", measurement: "nominal", missingCodes: [], userConfirmed: true },
  { name: "gender", role: "profile", measurement: "nominal", missingCodes: [], userConfirmed: true },
  { name: "x", role: "cluster", measurement: "scale", missingCodes: [], userConfirmed: true },
  { name: "y", role: "cluster", measurement: "scale", missingCodes: [], userConfirmed: true }
];

const clusterVariables = ["x", "y"];

function clusterPurity(assignments, k) {
  // 每个簇的样本是否主要来自同一真实组
  const groups = new Map();
  assignments.forEach((assignment) => {
    groups.set(assignment.rowIndex, Math.floor(assignment.rowIndex / 40));
  });
  let pure = 0;
  assignments.forEach((assignment) => {
    const members = assignments.filter((item) => item.clusterId === assignment.clusterId);
    const counts = {};
    members.forEach((member) => {
      const g = Math.floor(member.rowIndex / 40);
      counts[g] = (counts[g] || 0) + 1;
    });
    const best = Math.max(...Object.values(counts));
    if (best / members.length > 0.9) pure += 1;
  });
  return pure / assignments.length;
}

// ─── K-Means 测试 ───────────────────────────────────────────

console.log("K-Means tests…");

// 固定 K + 自动初始中心（确定性）
const km = core.kmeansCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { k: 3, seed: 42 } });
assert.equal(km.method, "kmeans");
assert.equal(km.selectedK, 3);
assert.equal(km.validN, 120);
assert.equal(km.clusterSizes.length, 3);
km.clusterSizes.forEach((size) => assert.equal(size.count, 40));
assert.ok(km.silhouette > 0.9, `silhouette ${km.silhouette} should be high`);
assert.ok(km.sse > 0);
assert.equal(km.assignments.length, 120);
assert.ok(clusterPurity(km.assignments, 3) >= 0.99, "clusters should match real groups");
assert.equal(km.initialCenters.length, 3);
assert.equal(km.finalCenters.length, 3);
assert.equal(km.centerDistances.length, 3);
assert.ok(km.centerDistances[0][1] > 1.5, "centers should be far apart in standardized space");
assert.ok(km.centerDistances[0][1] < km.centerDistances[0][2] + 0.01 || km.centerDistances[0][2] > 1.5, "all center pairs far apart");
assert.ok(km.iterationHistory.length >= 1);
assert.equal(km.anova.length, 2);
km.anova.forEach((item) => {
  assert.ok(item.f > 100, `ANOVA F=${item.f} should be large for separated groups`);
  assert.ok(item.p < 0.001);
  assert.equal(item.clusterMeans.length, 3);
});

// 固定设置结果可复现
const kmAgain = core.kmeansCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { k: 3, seed: 42 } });
assert.deepEqual(kmAgain.assignments, km.assignments);
assert.deepEqual(kmAgain.finalCenters, km.finalCenters);

// 手动初始中心（原始尺度输入）
const kmManual = core.kmeansCluster({
  rows, definitions: baseDefinitions, clusterVariables,
  options: { k: 3, initMode: "manual", initialCenters: [[0, 0], [5, 5], [10, 10]], seed: 42 }
});
assert.equal(kmManual.assignments.length, 120);
assert.ok(clusterPurity(kmManual.assignments, 3) >= 0.99);
// 原始尺度中心恢复
kmManual.finalCentersOriginal.forEach((center) => {
  assert.ok(Math.abs(center[0] - center[1]) < 0.5, `center ${center} should be near diagonal`);
});

// 无效手动中心：数量不等于 K
assert.throws(() => core.kmeansCluster({
  rows, definitions: baseDefinitions, clusterVariables,
  options: { k: 3, initMode: "manual", initialCenters: [[0, 0], [5, 5]], seed: 42 }
}), /数量必须等于 K/);

// 三种计算方法
const kmBatch = core.kmeansCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { k: 3, runMode: "batch", seed: 1 } });
const kmSeq = core.kmeansCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { k: 3, runMode: "sequential", seed: 1 } });
const kmClassify = core.kmeansCluster({
  rows, definitions: baseDefinitions, clusterVariables,
  options: { k: 3, runMode: "classify", initialCenters: [[0, 0], [5, 5], [10, 10]], seed: 1 }
});
assert.equal(kmBatch.assignments.length, 120);
assert.equal(kmSeq.assignments.length, 120);
assert.equal(kmClassify.maxIterations, 0, "classify mode should not iterate");
assert.equal(kmClassify.iterationHistory.length, 1);
assert.ok(kmClassify.assignments.length === 120);
assert.ok(clusterPurity(kmClassify.assignments, 3) >= 0.9);

// 最大迭代次数限制
const kmIter = core.kmeansCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { k: 3, maxIterations: 1, seed: 42 } });
assert.equal(kmIter.iterationHistory.length, 1);

// Listwise / Pairwise 缺失
const rowsWithMissing = rows.map((row, index) => (index === 5 || index === 55 ? { ...row, x: "" } : row));
const kmListwise = core.kmeansCluster({ rows: rowsWithMissing, definitions: baseDefinitions, clusterVariables, options: { k: 3, missing: "listwise", seed: 42 } });
assert.equal(kmListwise.validN, 118);
assert.equal(kmListwise.excludedN, 2);
const kmPairwise = core.kmeansCluster({ rows: rowsWithMissing, definitions: baseDefinitions, clusterVariables, options: { k: 3, missing: "pairwise", seed: 42 } });
assert.equal(kmPairwise.validN, 120);
assert.equal(kmPairwise.preprocessing.missingMode, "pairwise");

// 权重（频数权重）
const rowsWeighted = rows.map((row, index) => ({ ...row, w: index < 40 ? 2 : 1 }));
const defsWeighted = baseDefinitions.map((definition) => (definition.name === "x" ? { ...definition } : definition));
const kmWeighted = core.kmeansCluster({
  rows: rowsWeighted, definitions: defsWeighted, clusterVariables,
  options: { k: 3, useWeight: true, weightColumn: "w", seed: 42 }
});
const weightedTotal = kmWeighted.clusterSizes.reduce((sum, size) => sum + size.weightedCount, 0);
assert.equal(weightedTotal, 160, "weighted total should be 40*2 + 80*1");
assert.ok(kmWeighted.preprocessing.weightUsed);
const unweightedTotal = kmWeighted.clusterSizes.reduce((sum, size) => sum + size.count, 0);
assert.equal(unweightedTotal, 120);

// 无效权重列
assert.throws(() => core.kmeansCluster({
  rows: rowsWeighted, definitions: defsWeighted, clusterVariables,
  options: { k: 3, useWeight: true, weightColumn: "nonexistent", seed: 42 }
}), /权重/);

// 用户缺失码
const rowsUserMissing = rows.map((row, index) => (index % 10 === 0 ? { ...row, x: 99 } : row));
const defsUserMissing = baseDefinitions.map((definition) => (definition.name === "x" ? { ...definition, missingCodes: [99] } : definition));
const kmUserMissing = core.kmeansCluster({ rows: rowsUserMissing, definitions: defsUserMissing, clusterVariables, options: { k: 3, seed: 42 } });
assert.equal(kmUserMissing.validN, 108);

// 反向计分
const rowsAttitude = rows.map((row, index) => ({ ...row, att: index % 2 ? 5 : 1 }));
const defsAttitude = [...baseDefinitions, { name: "att", role: "cluster", measurement: "ordinal", missingCodes: [], reverseScoring: { enabled: true, min: 1, max: 5 } }];
const kmReverse = core.kmeansCluster({ rows: rowsAttitude, definitions: defsAttitude, clusterVariables: ["x", "y", "att"], options: { k: 3, seed: 42 } });
assert.ok(kmReverse.preprocessing.reverseScored.includes("att"));

// 标准化方式
const kmRange = core.kmeansCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { k: 3, standardization: "range01", seed: 42 } });
assert.equal(kmRange.preprocessing.standardization, "range01");
assert.ok(kmRange.assignments.length === 120);

// K < 有效样本量校验
assert.throws(() => core.kmeansCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { k: 120, seed: 42 } }), /有效样本不足/);

// 非数值聚类变量被拒绝
const kmReject = core.kmeansCluster({
  rows, definitions: baseDefinitions, clusterVariables: ["x", "gender"],
  options: { k: 3, seed: 42 }
});
assert.equal(kmReject.variables.length, 1, "only numeric variables participate");

console.log("K-Means OK");

// ─── 两步聚类测试 ───────────────────────────────────────────

console.log("TwoStep tests…");

// 纯连续变量 + 对数似然 + BIC 自动
const ts = core.twostepCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { autoSelect: true, maxClusters: 8, seed: 42 } });
assert.equal(ts.method, "twostep");
assert.equal(ts.selectedK, 3, `auto BIC should select 3, got ${ts.selectedK}`);
assert.equal(ts.continuousVariables.length, 2);
assert.equal(ts.categoricalVariables.length, 0);
assert.equal(ts.assignments.length, 120);
assert.ok(ts.criterionTable.length >= 5, "criterion table should cover multiple K values");
assert.ok(clusterPurity(ts.assignments, 3) >= 0.9, "twostep should separate groups");
assert.equal(ts.continuousSummary.length, 2);
assert.equal(ts.discrimination.length, 2);
assert.ok(ts.discrimination.every((item) => item.score > 50));
// 每个样本都有归属
ts.assignments.forEach((assignment) => assert.ok(assignment.clusterId >= 1));

// 连续 + 分类变量（对数似然）
const rowsMixed = rows.map((row, index) => ({ ...row, seg: ["A", "B", "C"][Math.floor(index / 40)] }));
const defsMixed = [...baseDefinitions, { name: "seg", role: "cluster", measurement: "nominal", missingCodes: [] }];
const tsMixed = core.twostepCluster({
  rows: rowsMixed, definitions: defsMixed, clusterVariables: ["x", "y", "seg"],
  options: { autoSelect: true, maxClusters: 8, seed: 7 }
});
assert.equal(tsMixed.selectedK, 3);
assert.equal(tsMixed.categoricalVariables.length, 1);
assert.equal(tsMixed.categoricalSummary.length, 1);
assert.equal(tsMixed.categoricalSummary[0].categories.length, 3);
assert.ok(clusterPurity(tsMixed.assignments, 3) >= 0.9);

// AIC 自动选择
const tsAic = core.twostepCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { autoSelect: true, criterion: "AIC", maxClusters: 8, seed: 42 } });
assert.equal(tsAic.criterion, "AIC");
assert.ok(tsAic.criterionTable.length >= 2);

// 欧氏距离（纯连续可用）
const tsEuclid = core.twostepCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { distance: "euclidean", fixedK: 3, autoSelect: false, seed: 42 } });
assert.equal(tsEuclid.distance, "euclidean");
assert.equal(tsEuclid.selectedK, 3);

// 欧氏距离拒绝分类变量
assert.throws(() => core.twostepCluster({
  rows: rowsMixed, definitions: defsMixed, clusterVariables: ["x", "y", "seg"],
  options: { distance: "euclidean", fixedK: 3, autoSelect: false, seed: 42 }
}), /欧氏距离仅在所有聚类变量均为连续变量时可用/);

// 固定群数
const tsFixed = core.twostepCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { autoSelect: false, fixedK: 4, seed: 42 } });
assert.equal(tsFixed.selectedK, 4);
assert.equal(tsFixed.autoSelect, false);

// 用户缺失码：作为有效类别参与分类变量
const rowsUserCodes = rowsMixed.map((row, index) => (index % 15 === 0 ? { ...row, seg: "拒答" } : row));
const defsUserCodes = defsMixed.map((definition) => (definition.name === "seg" ? { ...definition, missingCodes: ["拒答"] } : definition));
const tsExclude = core.twostepCluster({
  rows: rowsUserCodes, definitions: defsUserCodes, clusterVariables: ["x", "y", "seg"],
  options: { autoSelect: false, fixedK: 3, missing: "exclude", seed: 7 }
});
const tsInclude = core.twostepCluster({
  rows: rowsUserCodes, definitions: defsUserCodes, clusterVariables: ["x", "y", "seg"],
  options: { autoSelect: false, fixedK: 3, missing: "include_user_codes", seed: 7 }
});
assert.equal(tsExclude.validN, 112, "8 rows with 拒答 excluded");
assert.equal(tsInclude.validN, 120, "user codes included as valid category");
assert.equal(tsInclude.missingMode, "include_user_codes");

// 噪声处理
const tsNoise = core.twostepCluster({
  rows: rowsMixed, definitions: defsMixed, clusterVariables: ["x", "y", "seg"],
  options: { autoSelect: false, fixedK: 3, noiseThreshold: 3, seed: 7 }
});
assert.ok(tsNoise.noiseCount >= 0);
assert.ok(tsNoise.clusterSizes.some((size) => size.id === -1) || tsNoise.noiseCount === 0);

// 预聚类产生多个叶（CF Tree）
// 稳定性检查
const tsStable = core.twostepCluster({
  rows: rowsMixed, definitions: defsMixed, clusterVariables: ["x", "y", "seg"],
  options: { autoSelect: true, maxClusters: 8, seed: 11, stabilityRuns: 3 }
});
assert.ok(tsStable.stability, "stability result should exist");
assert.equal(tsStable.stability.runs, 3);
assert.equal(tsStable.stability.recommendedK.length, 3);
assert.ok(tsStable.stability.meanConsistency >= 0 && tsStable.stability.meanConsistency <= 1);
assert.ok(["高", "中", "低"].includes(tsStable.stability.level));

// 固定种子可复现
const tsAgain = core.twostepCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { autoSelect: true, maxClusters: 8, seed: 42 } });
assert.deepEqual(tsAgain.assignments, ts.assignments);

// 连续变量标准化可关闭
const tsNoStd = core.twostepCluster({ rows, definitions: baseDefinitions, clusterVariables, options: { standardization: "none", autoSelect: false, fixedK: 3, seed: 42 } });
assert.equal(tsNoStd.standardizationApplied.x, false);

console.log("TwoStep OK");

// ─── 系统聚类测试 ───────────────────────────────────────────

console.log("Hierarchical tests…");

// 对案例聚类（Ward + 平方欧氏，默认）
const hi = core.hierarchicalCluster({
  rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
  options: { linkage: "ward", distance: "squared-euclidean", object: "cases", dataType: "interval" }
});
assert.equal(hi.method, "hierarchical");
assert.equal(hi.objectCount, 120);
assert.equal(hi.merges.length, 119, "120 objects -> 119 merges");
assert.equal(hi.tree.length, 119);
assert.equal(hi.distanceMatrix.length, 120 * 120);
assert.equal(hi.kAssignments.length, 9, "K=2..10 assignments");
hi.kAssignments.forEach((entry) => {
  assert.equal(entry.assignment.length, 120);
  const labels = new Set(entry.assignment);
  assert.equal(labels.size, entry.k);
});
// K=3 时各群体规模应为 40
const k3 = hi.kAssignments.find((entry) => entry.k === 3).assignment;
const sizeMap = {};
k3.forEach((label) => { sizeMap[label] = (sizeMap[label] || 0) + 1; });
assert.deepEqual(Object.values(sizeMap).sort((a, b) => a - b), [40, 40, 40]);
// 距离矩阵对称且对角为 0
assert.equal(hi.distanceMatrix[0], 0);
assert.ok(Math.abs(hi.distanceMatrix[0 * 120 + 1] - hi.distanceMatrix[1 * 120 + 0]) < 1e-9);

// 全部七种联接方法
["between", "within", "nearest", "furthest", "centroid", "median", "ward"].forEach((linkage) => {
  const result = core.hierarchicalCluster({
    rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
    options: { linkage, distance: linkage === "ward" ? "squared-euclidean" : "euclidean", object: "cases", dataType: "interval" }
  });
  assert.equal(result.merges.length, 119, `${linkage} merges`);
  assert.ok(result.merges.every((merge) => Number.isFinite(merge.distance)), `${linkage} distances finite`);
});

// 不兼容组合：Ward + 余弦距离
assert.throws(() => core.hierarchicalCluster({
  rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
  options: { linkage: "ward", distance: "cosine", object: "cases", dataType: "interval" }
}), /Ward 法要求/);

// 主要区间距离
["euclidean", "squared-euclidean", "cosine", "pearson", "chebyshev", "cityblock", "minkowski"].forEach((distance) => {
  const result = core.hierarchicalCluster({
    rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
    options: { linkage: "between", distance, minkowskiP: 3, object: "cases", dataType: "interval" }
  });
  assert.equal(result.distance, distance);
  assert.equal(result.merges.length, 119);
});

// 对变量聚类（≥3 数值变量）
const rows3 = rows.map((row, index) => ({ ...row, z: Math.floor(index / 3) % 7 }));
const defs3 = [...baseDefinitions, { name: "z", role: "cluster", measurement: "scale", missingCodes: [] }];
const hiVars = core.hierarchicalCluster({
  rows: rows3, headers: ["rid", "gender", "x", "y", "z"], definitions: defs3,
  clusterVariables: ["x", "y", "z"],
  options: { linkage: "between", distance: "euclidean", object: "variables", dataType: "interval" }
});
assert.equal(hiVars.objectCount, 3);
assert.equal(hiVars.merges.length, 2);
assert.deepEqual(hiVars.objectNames, ["x", "y", "z"]);

// 对变量聚类少于 3 个变量被拒绝
assert.throws(() => core.hierarchicalCluster({
  rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
  options: { linkage: "between", distance: "euclidean", object: "variables", dataType: "interval" }
}), /至少需要选择 3 个数值变量/);

// 计数数据距离
const rowsCount = rows.map((row, index) => ({ c1: index % 5, c2: (index * 3) % 7 }));
const defsCount = [
  { name: "c1", role: "cluster", measurement: "count", missingCodes: [] },
  { name: "c2", role: "cluster", measurement: "count", missingCodes: [] }
];
["chi-square", "phi-square"].forEach((distance) => {
  const result = core.hierarchicalCluster({
    rows: rowsCount, headers: ["c1", "c2"], definitions: defsCount, clusterVariables: ["c1", "c2"],
    options: { linkage: "between", distance, object: "cases", dataType: "count" }
  });
  assert.equal(result.merges.length, 119);
});
// 计数数据负值被拒绝
const rowsNegativeCount = rows.map((row, index) => ({ c1: index - 50, c2: 1 }));
assert.throws(() => core.hierarchicalCluster({
  rows: rowsNegativeCount, headers: ["c1", "c2"], definitions: defsCount, clusterVariables: ["c1", "c2"],
  options: { linkage: "between", distance: "chi-square", object: "cases", dataType: "count" }
}), /计数数据必须为非负数值/);

// 二元数据距离（八种）
const rowsBinary = rows.map((row, index) => ({ b1: index % 2, b2: Math.floor(index / 3) % 2 }));
const defsBinary = [
  { name: "b1", role: "cluster", measurement: "binary", missingCodes: [] },
  { name: "b2", role: "cluster", measurement: "binary", missingCodes: [] }
];
["simple-matching", "jaccard", "dice", "russell-rao", "phi", "yule-q", "rogers-tanimoto", "sokal-sneath"].forEach((distance) => {
  const result = core.hierarchicalCluster({
    rows: rowsBinary, headers: ["b1", "b2"], definitions: defsBinary, clusterVariables: ["b1", "b2"],
    options: { linkage: "between", distance, object: "cases", dataType: "binary", positiveValue: "1", negativeValue: "0" }
  });
  assert.equal(result.merges.length, 119, `binary distance ${distance}`);
  assert.equal(result.standardization, "none", "binary data not standardized");
});

// 标准化方法
["zscore", "range-1-1", "range01", "maxabs1", "mean1", "std1", "none"].forEach((standardization) => {
  const result = core.hierarchicalCluster({
    rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
    options: { linkage: "between", distance: "euclidean", standardization, object: "cases", dataType: "interval" }
  });
  assert.equal(result.standardization, standardization);
});

// 距离变换
const hiAbs = core.hierarchicalCluster({
  rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
  options: { linkage: "between", distance: "pearson", distanceTransform: "abs", object: "cases", dataType: "interval" }
});
assert.equal(hiAbs.distanceTransform, "abs");
const hiRescale = core.hierarchicalCluster({
  rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
  options: { linkage: "between", distance: "euclidean", distanceTransform: "rescale01", object: "cases", dataType: "interval" }
});
const finiteDistances = Array.from(hiRescale.distanceMatrix).filter((value) => value > 0);
assert.ok(Math.max(...finiteDistances) <= 1.0001, "rescaled distances within 0..1");
assert.ok(Math.min(...finiteDistances) >= 0);

// Listwise 缺失
const rowsHiMissing = rows.map((row, index) => (index % 10 === 0 ? { ...row, y: "" } : row));
const hiMissing = core.hierarchicalCluster({
  rows: rowsHiMissing, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
  options: { linkage: "between", distance: "euclidean", object: "cases", dataType: "interval" }
});
assert.equal(hiMissing.validN, 108);
assert.equal(hiMissing.excludedN, 12);

// 聚合系数跳升建议
assert.ok(hi.coefficientSuggestions.length > 0);
assert.ok(hi.suggestedK === null || (hi.suggestedK >= 2 && hi.suggestedK <= 10));

// 固定群数 selectedK
const hiFixed = core.hierarchicalCluster({
  rows, headers: ["rid", "gender", "x", "y"], definitions: baseDefinitions, clusterVariables,
  options: { linkage: "ward", distance: "squared-euclidean", selectedK: 4, object: "cases", dataType: "interval" }
});
assert.equal(hiFixed.selectedK, 4);

console.log("Hierarchical OK");

// ─── 变量类型 / 预处理 / 画像 / 建议 / 导出 ─────────────────

console.log("Variable system tests…");

// 变量类型检测
const typeRows = [
  { q1: 1, q2: "男", q3: 3.5, q4: "0", q5: "非常满意" },
  { q1: 2, q2: "女", q3: 4.2, q4: "1", q5: "比较满意" },
  { q1: 3, q2: "男", q3: 2.1, q4: "0", q5: "一般" }
];
const types = core.detectVariableTypes(typeRows, ["q1", "q2", "q3", "q4", "q5"]);
const typeMap = Object.fromEntries(types.map((type) => [type.name, type]));
assert.equal(typeMap.q1.detectedMeasurement, "ordinal");
assert.equal(typeMap.q2.detectedMeasurement, "nominal");
assert.equal(typeMap.q2.role, "profile", "short categorical defaults to profile");
assert.equal(typeMap.q3.detectedMeasurement, "scale", "decimal values are scale");
assert.equal(typeMap.q4.detectedMeasurement, "binary");
assert.equal(typeMap.q4.role, "cluster");
assert.ok(typeMap.q1.userConfirmed === false);

// 多选组识别
const groups = core.detectMultiSelectGroups(["Q5_1", "Q5_2", "Q5_3", "Q5_R1", "gender"]);
assert.equal(groups.length, 1);
assert.deepEqual(groups[0].name, "Q5");
assert.ok(groups[0].variables.includes("Q5_1"));

// 标准化方法
const stdValues = [1, 2, 3, 4, 5];
assert.ok(Math.abs(core.standardizeValues(stdValues, "zscore").values[0] - (-1.2649)) < 0.001);
assert.deepEqual(core.standardizeValues(stdValues, "range01").values[0], 0);
assert.ok(Math.abs(core.standardizeValues(stdValues, "range-1-1").values[0] + 1) < 1e-9);
assert.deepEqual(core.standardizeValues(stdValues, "none").values, stdValues);
// 反向计分
assert.equal(core.reverseScoreValue(1, 1, 5), 5);
assert.equal(core.reverseScoreValue(5, 1, 5), 1);
assert.equal(core.reverseScoreValue(3, 1, 5), 3);

// 质量检查
const issues = core.runQualityChecks({ rows, definitions: baseDefinitions, clusterVariables, weightVariable: "" });
assert.equal(issues.length, 0);
const rowsConst = rows.map((row) => ({ ...row, c: 5 }));
const defsConst = [...baseDefinitions, { name: "c", role: "cluster", measurement: "scale", missingCodes: [] }];
const constIssues = core.runQualityChecks({ rows: rowsConst, definitions: defsConst, clusterVariables: ["x", "y", "c"], weightVariable: "" });
assert.ok(constIssues.some((issue) => issue.code === "constant_variable" && issue.level === "block"));
const tinyRows = rows.slice(0, 5);
const tinyIssues = core.runQualityChecks({ rows: tinyRows, definitions: baseDefinitions, clusterVariables, weightVariable: "" });
assert.ok(tinyIssues.some((issue) => issue.code === "sample_too_small" && issue.level === "block"));
const fewVars = core.runQualityChecks({ rows, definitions: baseDefinitions, clusterVariables: ["x"], weightVariable: "" });
assert.ok(fewVars.some((issue) => issue.code === "too_few_variables" && issue.level === "block"));

// 群体画像
const profile = core.profileClusters({
  rows, definitions: baseDefinitions, clusterVariables, profileVariables: ["gender"],
  assignments: km.assignments, clusterSizes: km.clusterSizes
});
assert.equal(profile.groupProfiles.length, 3);
assert.equal(profile.variables.length, 3, "2 cluster vars + 1 profile var");
const continuousVars = profile.variables.filter((variable) => variable.type === "continuous");
const categoricalVars = profile.variables.filter((variable) => variable.type === "categorical");
assert.equal(continuousVars.length, 2);
assert.equal(categoricalVars.length, 1);
assert.equal(categoricalVars[0].name, "gender");
assert.equal(categoricalVars[0].categories.length, 2);
profile.groupProfiles.forEach((group) => {
  assert.ok(group.count === 40);
  assert.ok(Math.abs(group.pct - 33.333) < 0.1);
});

// 方法建议助手
const adviceMixed = core.recommendMethod(defsMixed.filter((definition) => definition.role === "cluster"), 120);
assert.equal(adviceMixed.recommendedMethod, "twostep");
assert.ok(adviceMixed.reasons.length >= 1);
const adviceAllNumeric = core.recommendMethod(baseDefinitions.filter((definition) => definition.role === "cluster"), 120);
assert.equal(adviceAllNumeric.recommendedMethod, "kmeans");
const adviceSmall = core.recommendMethod(baseDefinitions.filter((definition) => definition.role === "cluster"), 180);
assert.equal(adviceSmall.recommendedMethod, "kmeans");

// 导出
const sheets = core.buildExportSheets(km, {
  clusterNames: {},
  profileVariables: ["gender"],
  fullRows: rows,
  headers: ["rid", "gender", "x", "y"],
  assignments: km.assignments,
  profile
});
const sheetNames = sheets.map((sheet) => sheet.name);
["模型摘要", "群体规模", "群体画像_连续变量", "群体画像_分类变量", "样本归属", "初始中心", "最终中心", "迭代历史", "ANOVA", "中心间距离"].forEach((name) => {
  assert.ok(sheetNames.includes(name), `sheet ${name} should exist`);
});
const assignmentSheet = sheets.find((sheet) => sheet.name === "样本归属");
assert.ok(assignmentSheet.rows[0].includes("cluster_method"));
assert.ok(assignmentSheet.rows[0].includes("cluster_id"));
assert.ok(assignmentSheet.rows[0].includes("cluster_name"));
assert.ok(assignmentSheet.rows[0].includes("cluster_distance"));

const tsSheets = core.buildExportSheets(tsMixed, {
  clusterNames: {}, fullRows: rowsMixed, headers: ["rid", "gender", "x", "y", "seg"],
  assignments: tsMixed.assignments, profile: core.profileClusters({
    rows: rowsMixed, definitions: defsMixed, clusterVariables: ["x", "y", "seg"],
    assignments: tsMixed.assignments, clusterSizes: tsMixed.clusterSizes
  })
});
const tsSheetNames = tsSheets.map((sheet) => sheet.name);
["信息准则比较", "变量区分度", "连续变量摘要", "分类变量摘要"].forEach((name) => {
  assert.ok(tsSheetNames.includes(name), `twostep sheet ${name} should exist`);
});

const hiSheets = core.buildExportSheets(hi, { fullRows: rows, headers: ["rid", "gender", "x", "y"], assignments: [] });
const hiSheetNames = hiSheets.map((sheet) => sheet.name);
["聚合过程", "距离矩阵", "多群数归属"].forEach((name) => {
  assert.ok(hiSheetNames.includes(name), `hierarchical sheet ${name} should exist`);
});

// CSV 行构建
const csvRows = core.buildAssignmentCsvRows(km, { clusterNames: {} });
assert.equal(csvRows.length, 121);
assert.equal(csvRows[0].join(","), "row_index,cluster_method,cluster_id,cluster_name,cluster_distance");
const fullCsvRows = core.buildFullDataCsvRows(km, { clusterNames: {}, headers: ["rid", "gender", "x", "y"], fullRows: rows });
assert.equal(fullCsvRows.length, 121);
assert.ok(fullCsvRows[1].slice(-4).every((cell) => cell !== undefined));

console.log("Variable system / profile / export OK");

// ─── UI 静态检查（index.html + cluster-analysis.js）────────

console.log("UI static tests…");

// 研究模型卡片
assert.match(html, /data-jump="cluster-analysis"/);
assert.match(html, /用户分群分析/);
assert.match(html, /K-Means聚类/);
assert.match(html, /两步聚类/);
assert.match(html, /系统聚类/);
// 导航项
assert.match(html, /data-view="cluster-analysis"/);
// 深链接（UI 模块处理 view + method 参数）
assert.match(uiSource, /URLSearchParams/);
assert.match(uiSource, /params\.get\("view"\)/);
assert.match(uiSource, /params\.get\("method"\)/);
assert.match(uiSource, /cluster-analysis/);
assert.match(uiSource, /"kmeans", "twostep", "hierarchical"/);
// 三种算法可切换且保留数据
assert.match(uiSource, /data-cluster-method/);
assert.match(uiSource, /switchMethod/);
// 变量类型可编辑
assert.match(html, /id="clusterVariableTable"/);
assert.match(uiSource, /data-role="role"/);
assert.match(uiSource, /data-role="measurement"/);
// 多选组
assert.match(uiSource, /detectMultiSelectGroups/);
// 算法适配提示
assert.match(uiSource, /recommendMethod/);
// 运行与取消
assert.match(html, /id="clusterRunButton"/);
assert.match(html, /id="clusterCancelButton"/);
assert.match(uiSource, /cluster_cancel/);
// 群体名称编辑
assert.match(uiSource, /data-cluster-name-input/);
// Excel 与 CSV 导出
assert.match(html, /id="clusterExportExcel"/);
assert.match(html, /id="clusterExportCsv"/);
assert.match(html, /id="clusterExportFullCsv"/);
// 结果保存到项目（数据总线）
assert.match(uiSource, /projectDataBus\.set/);
assert.match(uiSource, /modelResults\.cluster\./);
assert.match(uiSource, /modelResults\.cluster\.active/);
// Web Worker 协议
assert.match(workerSource, /cluster_run/);
assert.match(workerSource, /cluster_progress/);
assert.match(workerSource, /cluster_done/);
assert.match(workerSource, /cluster_error/);
assert.match(workerSource, /cluster_cancel/);
assert.match(workerSource, /importScripts\("\.\/cluster-core\.js"\)/);
// 帮助页 SPSS 差异声明
assert.match(html, /结果可能与其他统计软件存在差异/);
// 权重说明（两步/系统聚类不使用权重）
assert.match(html, /权重/);
// 变量区分度命名（不叫预测变量重要性）
assert.match(uiSource, /变量区分度/);
assert.doesNotMatch(uiSource, /预测变量重要性/);
// 系统聚类样本量保护
assert.match(html, /样本量保护/);
assert.match(html, /N &gt; 1000/);

console.log("UI static OK");

// ─── 隐私与接口测试 ─────────────────────────────────────────

console.log("Privacy & interface tests…");

const allSources = [coreSource, uiSource, workerSource];
allSources.forEach((source, index) => {
  assert.doesNotMatch(source, /\/api\/ai/, `source ${index} must not call /api/ai`);
  assert.doesNotMatch(source, /\/pptx-api/, `source ${index} must not call /pptx-api`);
  assert.doesNotMatch(source, /fetch\s*\(/, `source ${index} must not use fetch`);
  assert.doesNotMatch(source, /XMLHttpRequest/, `source ${index} must not use XHR`);
  assert.doesNotMatch(source, /pyodide/i, `source ${index} must not use Pyodide`);
  assert.doesNotMatch(source, /tensorflow/i, `source ${index} must not use TensorFlow`);
});
assert.doesNotMatch(uiSource, /new Worker\("\.\/data-worker\.js"\)/, "cluster must use its own worker");
assert.match(uiSource, /cluster-worker\.js/, "cluster must use cluster-worker.js");
// 原始数据不发送后端：无网络请求代码
assert.doesNotMatch(workerSource, /postMessage\(.*http/, "worker must not post to network");

console.log("Privacy OK");

// ─── 构建 / 语法回归（由 npm run check:syntax 覆盖）────────

console.log("\nAll cluster-analysis smoke tests passed.");
