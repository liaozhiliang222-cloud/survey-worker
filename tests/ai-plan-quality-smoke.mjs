import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../ai-plan-quality.js", import.meta.url), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context);
const quality = context.AiPlanQuality;

assert.ok(quality, "AiPlanQuality should be exposed.");
assert.equal(quality.QUALITY_THRESHOLD, 78);

const config = {
  project: "智能宠物饮水机新品概念测试",
  brief: "验证核心需求、功能偏好、价格接受度和购买渠道，为产品迭代、目标人群定位及上市传播策略提供支持。",
  studyType: "concept",
  audience: "18-50岁城市养宠家庭的购买决策者",
  sampleSize: 600,
  timeline: "2周",
  constraints: "区分现有设备用户与潜在用户"
};
const brief = quality.buildPlanBrief(config, {
  studyTypeName: "概念/新品测试",
  modules: ["概念理解度", "概念吸引力", "购买意愿与使用场景", "价格与上市建议"],
  additionalModuleNames: ["价格接受度", "人群细分与画像"],
  frameworkName: "概念测试与新品机会评估"
});

const strongPlan = `# 智能宠物饮水机新品概念测试
## 1. 业务决策与研究目标
需要支持的业务决策包括：验证核心需求与功能偏好，判断价格接受度和购买渠道，并支持产品迭代、目标人群定位及上市传播策略。
每项决策均明确待验证问题、所需证据、判断依据与后续业务动作。
## 2. 研究方法与选择理由
采用定量问卷验证需求规模、概念理解和购买意愿；先通过小样预测试理解口径，再开展正式定量，两阶段相互验证。该方法适合比较人群差异并量化价格接受度。
## 3. 研究内容与分析框架
| 业务决策 | 研究问题 | 所需证据 | 方法 | 分析输出 |
|---|---|---|---|---|
| 产品迭代 | 概念理解度、概念吸引力和功能偏好如何 | 评价与选择数据 | 定量问卷 | 功能优先级与优化方向 |
| 上市策略 | 购买意愿与使用场景、价格与上市建议如何 | 转化与渠道数据 | 定量问卷 | 购买渠道和传播策略 |
补充人群细分与画像，形成不同养宠家庭的需求差异。
## 4. 样本设计与可行性
目标人群为18-50岁城市养宠家庭购买决策者，建议有效样本量 N=600。依据关键分群最小样本与对比需求设置配额，并评估现有设备用户招募可达性及备用方案。
## 5. 执行流程与质量控制
先做预测试和问卷逻辑校验；回收阶段监控配额、答题时长、直线作答和异常样本；数据清洗后进行独立复核。
## 6. 交付成果与业务使用
交付数据表、研究报告、机会清单和行动建议，供产品、市场与渠道团队确定优化优先级和上市路线图。
## 7. 关键假设与待确认事项
关键假设单列；N=600为AI建议值；地区范围与刺激物版本列为待确认事项。`;

const strongAudit = quality.auditPlan(strongPlan, brief, config);
assert.equal(strongAudit.passed, true);
assert.ok(strongAudit.score >= 90, `Expected strong plan >= 90, got ${strongAudit.score}`);
assert.equal(strongAudit.issues.length, 0);

const weakPlan = `# 调研方案
## 研究内容
- 用户画像
- 产品需求
- 购买意愿
## 研究方法
线上问卷。
## 项目安排
两周完成。`;
const weakAudit = quality.auditPlan(weakPlan, brief, config);
assert.equal(weakAudit.passed, false);
assert.ok(weakAudit.score < quality.QUALITY_THRESHOLD, `Expected weak plan below threshold, got ${weakAudit.score}`);
assert.ok(weakAudit.issues.some((item) => item.code === "decision_alignment"));

const repair = quality.buildRepairInstruction(weakAudit);
assert.match(repair, /只针对以下本地质量审校问题/);
assert.match(repair, /完整 Markdown 方案/);
assert.doesNotMatch(repair, /重新生成研究架构|第二次蓝图/);

console.log(`AI plan quality smoke test passed: strong=${strongAudit.score}, weak=${weakAudit.score}`);
