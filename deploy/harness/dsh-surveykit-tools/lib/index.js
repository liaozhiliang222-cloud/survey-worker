import { randomUUID } from "node:crypto";

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const DATA_TOOL_TIMEOUT_MS = Object.freeze({ data_profile: 45_000, data_clean: 90_000, data_weight: 90_000, crosstab: 90_000, transcript_search: 30_000, transcript_read: 30_000 });

function requestPolicy(toolId) {
  return DATA_TOOL_TIMEOUT_MS[toolId]
    ? { timeoutMs: DATA_TOOL_TIMEOUT_MS[toolId], attempts: 1 }
    : { timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS, attempts: 2 };
}
const TEXT_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

function objectSchema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function failure(toolId, message) {
  return JSON.stringify({
    success: false,
    tool: toolId,
    error: { code: "TOOL_UNAVAILABLE", message },
    meta: { do_not_estimate: true },
  });
}

function requestSignal(exec, controller) {
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([exec.signal, controller.signal])
    : controller.signal;
}

async function callSurveyKit(toolId, args, exec) {
  const root = String(process.env.SURVEYKIT_AGENT_TOOL_URL || "").replace(/\/+$/, "");
  const apiKey = String(process.env.SURVEYKIT_TOOL_API_KEY || "");
  if (!root || !apiKey) {
    return failure(toolId, "SurveyKit 专业工具尚未配置；请明确告知用户无法给出确定性结果，不要自行估算。");
  }

  const sessionId = String(exec.agent?.id || "");
  const callId = String(exec.callId || randomUUID());
  if (!sessionId) return failure(toolId, "缺少 Harness Session 标识；不要自行补算或猜测结果。");

  const policy = requestPolicy(toolId);
  for (let attempt = 0; attempt < policy.attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const response = await fetch(`${root}/${encodeURIComponent(toolId)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Request-ID": callId,
        },
        body: JSON.stringify({
          harness_session_id: sessionId,
          call_id: callId,
          arguments: args,
        }),
        signal: requestSignal(exec, controller),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success) return JSON.stringify(payload);
      if (attempt + 1 < policy.attempts && response.status >= 500) continue;
      return failure(toolId, payload?.error?.message || "SurveyKit 专业工具暂时不可用；不要自行补算或猜测结果。");
    } catch (error) {
      if (exec.signal.aborted) throw error;
      if (attempt + 1 < policy.attempts) continue;
      return failure(toolId, "SurveyKit 专业工具连接失败；不要自行补算或猜测结果。");
    } finally {
      clearTimeout(timer);
    }
  }

  return failure(toolId, "SurveyKit 专业工具暂时不可用；不要自行补算或猜测结果。");
}

function registerTool(ctx, definition) {
  const policy = requestPolicy(definition.name);
  ctx.tools.register({
    ...definition,
    output: TEXT_OUTPUT,
    timeoutMs: policy.timeoutMs * policy.attempts + 5_000,
    execute: (args, exec) => callSurveyKit(definition.name, args, exec),
  });
}

export default {
  name: "dsh-surveykit-tools",
  inject: ["tools"],
  apply(ctx) {
    registerTool(ctx, {
      name: "sample_size",
      description: "根据置信水平、误差范围、总体规模计算确定性调研样本量。确需样本量计算时必须调用；失败时不得自行估算。",
      parameters: objectSchema({
        confidence_level: { type: "number", description: "置信水平，小数或百分数形式；默认 0.95" },
        margin_of_error: { type: "number", description: "允许误差，小数或百分数形式；默认 0.05" },
        population: { type: "integer", minimum: 0, description: "总体规模；0 或省略表示无限总体" },
        response_rate: { type: "number", description: "预计有效回收率，小数或百分数形式；默认 0.8" },
        segments: { type: "integer", minimum: 1, description: "需要均分的研究分群数；默认 1" },
      }),
    });

    registerTool(ctx, {
      name: "quota_design",
      description: "按总样本及明确的人群、地区或品牌比例生成确定性整数配额。只有比例已知时使用。",
      parameters: objectSchema({
        mode: { type: "string", enum: ["single", "cross"], description: "单维度分别配额或多维交叉配额" },
        total_sample: { type: "integer", minimum: 1, description: "目标有效样本量" },
        dimensions: {
          type: "array",
          minItems: 1,
          description: "配额维度及比例",
          items: objectSchema({
            name: { type: "string", minLength: 1, description: "维度名称" },
            groups: {
              type: "array",
              minItems: 1,
              items: objectSchema({
                label: { type: "string", minLength: 1, description: "组选项" },
                share: { type: "number", exclusiveMinimum: 0, description: "比例数值，如 20 表示 20%" },
              }, ["label", "share"]),
            },
          }, ["name", "groups"]),
        },
      }, ["total_sample", "dimensions"]),
    });

    registerTool(ctx, {
      name: "questionnaire_check",
      description: "检查问卷结构、跳转逻辑、选项规则和其他可确定性识别的问题；不负责重写整份问卷。",
      parameters: objectSchema({
        questionnaire_text: { type: "string", minLength: 1, maxLength: 500_000, description: "需要检查的完整问卷文本" },
        scenario: {
          type: "string",
          enum: ["general", "concept", "ua", "satisfaction", "psm", "kanoMaxdiff"],
          description: "研究场景；默认 general",
        },
      }, ["questionnaire_text"]),
    });

    registerTool(ctx, {
      name: "data_profile",
      description: "读取当前项目内指定数据集的精简结构、完整字段名索引和质量问题；可用 field_query 跨全部变量检索字段名、题目标签和值标签。分析数据前优先调用；不得要求原始行数据进入模型上下文。",
      parameters: objectSchema({
        dataset_id: { type: "string", minLength: 1, description: "SurveyKit 项目数据集标识" },
        field_query: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1 }, description: "按业务关键词检索全部变量的字段名、题目标签和值标签，例如 NPS、推荐、满意" },
        field_limit: { type: "integer", minimum: 1, maximum: 160, description: "最多返回多少条匹配变量元数据；默认 120" },
      }, ["dataset_id"]),
    });

    registerTool(ctx, {
      name: "data_clean",
      description: "按结构化规则预估或执行确定性数据清洗，并生成新的 Clean Dataset。duplicate_id、时长、范围、排除值或高影响清洗必须先以 confirmed=false 获取计划，用户明确确认后才可用 confirmed=true 执行；永不覆盖原始数据。",
      parameters: objectSchema({
        dataset_id: { type: "string", minLength: 1 },
        confirmed: { type: "boolean", description: "仅在用户明确确认当前规则和预计删除量后设为 true" },
        name: { type: "string", description: "派生 Clean Dataset 名称" },
        rules: {
          type: "array", minItems: 1, maxItems: 30,
          items: objectSchema({
            type: { type: "string", enum: ["blank_row", "exact_duplicate", "duplicate_id", "duration", "range", "exclude_value"] },
            field: { type: "string" }, label: { type: "string" }, threshold: { type: "number" }, min: { type: "number" }, max: { type: "number" },
            values: { type: "array", items: { type: "string" }, maxItems: 100 },
          }, ["type"]),
        },
      }, ["dataset_id", "rules", "confirmed"]),
    });

    registerTool(ctx, {
      name: "crosstab",
      description: "对当前项目内指定数据集执行确定性交叉分析、NPS/均值分组汇总和可用的显著性检验。只返回精简发现与 result_id；不得自行计算百分比或显著性。",
      parameters: objectSchema({
        dataset_id: { type: "string", minLength: 1 },
        banner: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", minLength: 1 } },
        variables: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1 } },
      }, ["dataset_id", "banner", "variables"]),
    });

    registerTool(ctx, {
      name: "data_weight",
      description: "按用户明确提供的目标总体分布预估或执行 RIM 加权，并生成新的 Weighted Dataset。禁止猜测目标比例；任何加权都必须先 confirmed=false 预估，再由用户确认后执行。",
      parameters: objectSchema({
        dataset_id: { type: "string", minLength: 1 },
        method: { type: "string", enum: ["rim"], description: "当前仅支持 rim" },
        confirmed: { type: "boolean", description: "仅在用户明确确认目标分布和诊断后设为 true" },
        name: { type: "string", description: "派生 Weighted Dataset 名称" },
        max_iterations: { type: "integer", minimum: 1, maximum: 100 },
        tolerance: { type: "number", exclusiveMinimum: 0, maximum: 0.01 },
        trim: objectSchema({ min: { type: "number", exclusiveMinimum: 0 }, max: { type: "number", exclusiveMinimum: 0 } }),
        targets: {
          type: "array", minItems: 1, maxItems: 5,
          items: objectSchema({
            variable: { type: "string", minLength: 1 },
            categories: { type: "array", minItems: 2, maxItems: 30, items: objectSchema({ value: { type: "string", minLength: 1 }, share: { type: "number", exclusiveMinimum: 0 } }, ["value", "share"]) },
          }, ["variable", "categories"]),
        },
      }, ["dataset_id", "method", "targets", "confirmed"]),
    });

    registerTool(ctx, {
      name: "transcript_search",
      description: "在当前 SurveyKit 项目的访谈 Segment 索引中检索相关原声。正式定性分析必须先检索再回查；返回结果只用于定位，不可把摘要冒充直接引用。",
      parameters: objectSchema({
        query: { type: "string", minLength: 1, maxLength: 1_000, description: "与研究问题相关的检索词或简短查询" },
        filters: { type: "object", description: "可选访谈类型、受访者标签或 respondent_metadata 等值过滤", additionalProperties: true },
        transcript_ids: { type: "array", maxItems: 30, items: { type: "string", minLength: 1 }, description: "限定在这些 Transcript ID 中检索" },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "最多返回的候选片段数；默认 12" },
      }, ["query"]),
    });

    registerTool(ctx, {
      name: "transcript_read",
      description: "按 Transcript ID 和 Segment ID 回查逐字原文及前后文。任何 Direct Quote 都必须以本工具返回的 Segment 原文为依据。",
      parameters: objectSchema({
        transcript_id: { type: "string", minLength: 1 },
        segment_id: { type: "string", minLength: 1 },
        context_before: { type: "integer", minimum: 0, maximum: 5, description: "向前读取片段数；默认 2" },
        context_after: { type: "integer", minimum: 0, maximum: 5, description: "向后读取片段数；默认 2" },
      }, ["transcript_id", "segment_id"]),
    });
  },
};
