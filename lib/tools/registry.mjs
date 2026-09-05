import { calculateSampleSize } from "./sample-size.mjs";
import { calculateQuota } from "./quota.mjs";
import { checkQuestionnaire } from "./questionnaire-check.mjs";
import { ToolInputError } from "./errors.mjs";

export const TOOL_REGISTRY = Object.freeze({
  "sample-size": Object.freeze({ id: "sample-size", name: "样本量计算", description: "计算调研所需最低有效样本量与建议发放量", endpoint: "/api/tools/sample-size", deterministic: true, uses_ai: false }),
  quota: Object.freeze({ id: "quota", name: "配额设计", description: "根据总样本和一个或多个维度生成整数配额结构", endpoint: "/api/tools/quota", deterministic: true, uses_ai: false }),
  "questionnaire-check": Object.freeze({ id: "questionnaire-check", name: "问卷质检", description: "使用确定性规则检查问卷结构、跳题和常见内容风险", endpoint: "/api/tools/questionnaire-check", deterministic: true, uses_ai: false }),
  "data-profile": Object.freeze({ id: "data-profile", name: "数据结构检查", description: "在 Data Layer 检查项目数据集结构与质量问题", endpoint: "/api/research/projects/:project_id/datasets/:dataset_id/profile", deterministic: true, uses_ai: false, project_scoped: true }),
  "data-clean": Object.freeze({ id: "data-clean", name: "数据清洗", description: "按确认后的结构化规则生成新的 Clean Dataset", endpoint: "/api/research/projects/:project_id/datasets/:dataset_id/clean", deterministic: true, uses_ai: false, project_scoped: true }),
  "data-weight": Object.freeze({ id: "data-weight", name: "数据加权", description: "按用户确认的目标总体分布生成新的 Weighted Dataset", endpoint: "/api/research/projects/:project_id/datasets/:dataset_id/weight", deterministic: true, uses_ai: false, project_scoped: true }),
  crosstab: Object.freeze({ id: "crosstab", name: "交叉表分析", description: "执行项目数据集交叉分析与可用的显著性检验", endpoint: "/api/research/projects/:project_id/datasets/:dataset_id/crosstab", deterministic: true, uses_ai: false, project_scoped: true }),
});

const executors = Object.freeze({ "sample-size": calculateSampleSize, quota: calculateQuota, "questionnaire-check": checkQuestionnaire });

export function listTools() { return Object.values(TOOL_REGISTRY).map((tool) => ({ ...tool })); }
export function getTool(toolId) { return TOOL_REGISTRY[String(toolId || "")] || null; }
export function executeTool(toolId, input) {
  const tool = getTool(toolId);
  if (!tool) throw new ToolInputError("工具不存在。", "TOOL_NOT_FOUND");
  if (!executors[tool.id]) throw new ToolInputError("该数据工具需要项目数据集上下文，请通过项目数据集接口调用。", "TOOL_CONTEXT_REQUIRED");
  return { tool, data: executors[tool.id](input || {}), meta: { deterministic: true, uses_ai: false, executed_at: new Date().toISOString() } };
}
