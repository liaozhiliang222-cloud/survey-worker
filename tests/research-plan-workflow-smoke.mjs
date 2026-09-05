import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { classifyResearchPlanToolPolicy, evaluateResearchPlanQuality } from "../lib/research-plan-workflow.mjs";

const require = createRequire(import.meta.url);
const { createResearchHandler } = require("../lib/research-handler.js");
const { JsonResearchStore } = require("../lib/research-store.js");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-plan-workflow-"));
const store = new JsonResearchStore(path.join(temporary, "research.json"));
const calls = [];
let toolSequence = 0;

function quantitativePlan({ sample = 1067, interviews = 20, margin = "3%" } = {}) {
  return `# 荣耀年轻用户NPS研究调研方案

## 一、项目背景与研究目标
年轻用户NPS下降，本项目要识别体验、产品、服务与品牌关系中的核心流失原因，为客户确定优先改善动作。研究目标既覆盖问题诊断，也覆盖改善机会排序和后续监测基线。

## 二、核心研究问题
哪些触点导致年轻用户推荐意愿下降；流失用户与留存用户的体验差异是什么；哪些改善方向最能影响推荐意愿；不同年龄和城市层级是否存在显著差异。

## 三、整体研究思路与研究方法
采用定量问卷与定性深访结合。定量负责验证问题规模、差异和驱动关系，定性负责解释形成机制并补充产品语言。两阶段结果在最终策略工作坊中交叉验证。

## 四、研究对象
过去12个月购买或持续使用荣耀手机的18—35岁用户，同时覆盖低推荐意愿、已流失及竞品转入用户。全国一至三线城市执行。

## 五、样本设计
按95%置信水平、${margin}允许误差测算，工具计算的统计最低有效样本为${sample}。结合品牌对比、年龄与城市层级分析，方案建议完成1200个有效样本；建议样本高于统计最低值是为保证分层分析稳定性。定性深访${interviews}人。

## 六、配额方案
年龄、性别与城市层级采用单维硬配额，品牌与NPS分层采用软配额；年轻低分用户适度加样，汇总总体结论时进行必要加权。

## 七、研究内容
定量问卷覆盖使用体验、关键触点、NPS评分及原因、竞品比较、品牌关系、流失风险和改善优先级；定性访谈围绕最近一次关键体验、推荐或不推荐的形成过程、流失触发点与理想改善方案展开。

## 八、分析框架
使用NPS分层、关键驱动分析、触点问题矩阵和人群差异分析，把业务问题映射到可执行动作；分析输出需明确证据、影响范围、优先级和责任场景。

## 九、执行流程与周期
第1周完成方案与工具设计，第2周预测试，第3—4周执行，第5周分析，第6周汇报。预算控制在15万元以内，通过线上定量为主、聚焦关键城市深访控制成本。

## 十、交付成果
交付研究方案、定量数据与交叉表、定性洞察小结、管理层报告及行动建议清单。

## 十一、当前假设与待确认事项
当前按95%置信水平测算；统计参数、城市名单和品牌对比范围如有客户标准可调整。`;
}

function qualitativePlan() {
  return `# 新品概念纯定性研究方案

## 一、项目背景与研究目标
通过探索性研究理解目标消费者对新品概念的真实语言、使用情境和顾虑，为概念优化做决策。

## 二、核心研究问题
消费者如何理解概念价值，哪些场景最相关，哪些表达造成疑虑，不同经验用户的判断路径有何差异。

## 三、研究方法
采用半结构化深度访谈与概念任务，不进行统计推断。方法负责解释认知机制、情绪和未被满足需求。

## 四、研究对象与招募
招募12位目标消费者，兼顾新手与高频用户。这里的12人是定性招募规模，不代表总体比例或统计最低样本。

## 五、研究内容
覆盖使用背景、需求触发、概念理解、价值感知、疑虑、替代方案和优化建议，并保留逐字证据。

## 六、分析框架
按主题编码、用户差异、使用情境和机会假设组织分析，区分事实、解释和待验证假设。

## 七、执行周期与交付成果
两周内完成招募、访谈、主题分析和洞察小结，交付概念优化建议与后续定量验证假设。

## 八、当前假设与待确认事项
当前假设目标消费者定义已经由客户确认；如人群边界改变，需要重新调整招募结构。`;
}

function emit(options, toolId, status = "completed") {
  const label = toolId === "sample_size" ? "样本量计算" : "配额设计";
  options.onToolStatus?.({ tool_id: toolId, label, status: "running", message: `正在${label}…` });
  options.onToolStatus?.({ tool_id: toolId, label, status, message: status === "completed" ? `已完成${label}` : "专业工具调用未完成" });
}

const harnessAdapter = {
  async createSession() { return "plan-workflow-session"; },
  async sendMessage(options) {
    const request = String(options.prompt).split("用户当前要求：").at(-1) || "";
    calls.push({ request, allowed: options.allowedResearchTools, prompt: options.prompt });
    const projectId = request.includes("纯定性") ? "qual-project" : request.includes("工具失败") ? "failure-project" : "plan-project";
    if (request.includes("研究对象尚未确定")) return "[[WAITING_INPUT]]\n研究对象是已购买用户，还是包含全体潜在用户？这个选择会改变抽样框和全部研究设计。";
    if (request.includes("工具失败")) { emit(options, "sample_size", "error"); return "研究框架已经完成，但样本量计算工具暂时不可用，因此无法确认最终样本规模；不得自行估算。请确认稍后重试工具。"; }
    if (request.includes("继续完成失败项目")) { emit(options, "sample_size"); await store.createToolResult("owner", "failure-project", "sample-size", { marginPercent: 5 }, { base: 385, gross: 482 }, { source: "agent", agent_call_id: `sample-${++toolSequence}` }); return quantitativePlan({ sample: 385, margin: "5%" }); }
    if (request.includes("纯定性")) return qualitativePlan();
    if (request.includes("3%误差改为5%")) {
      emit(options, "sample_size");
      await store.createToolResult("owner", projectId, "sample-size", { marginPercent: 5 }, { base: 385, gross: 482 }, { source: "agent", agent_call_id: `sample-${++toolSequence}` });
      return quantitativePlan({ sample: 385, interviews: 12, margin: "5%" }).replace("方案建议完成1200个有效样本", "方案建议完成800个有效样本");
    }
    if (request.includes("只把定性访谈")) return quantitativePlan({ interviews: 12 });
    emit(options, "sample_size"); emit(options, "quota_design");
    await store.createToolResult("owner", projectId, "sample-size", { marginPercent: 3 }, { base: 1067, gross: 1334 }, { source: "agent", agent_call_id: `sample-${++toolSequence}` });
    await store.createToolResult("owner", projectId, "quota", { total_sample: 1200 }, { total_sample: 1200, dimensions: [{ name: "年龄" }] }, { source: "agent", agent_call_id: `quota-${++toolSequence}` });
    return quantitativePlan();
  },
};

const main = await store.createProject("owner", { client_project_id: "plan-project", title: "荣耀年轻用户NPS研究", client_name: "荣耀", brief: "年轻用户NPS下降，希望找出核心原因并提出优化建议。", research_goal: "识别NPS下降原因并形成改善优先级。", constraints: { budget: "15万元以内", timeline: "6周", target_sample: "约1200", region_scope: "全国一至三线城市" } });
const qualitative = await store.createProject("owner", { client_project_id: "qual-project", title: "新品概念探索", brief: "纯定性探索", research_goal: "理解概念认知" });
const failure = await store.createProject("owner", { client_project_id: "failure-project", title: "工具失败项目", brief: "需要定量样本", research_goal: "确认需求" });
const handler = createResearchHandler({ env: { RESEARCH_DEV_USER_ID: "owner", RESEARCH_AI_REQUESTS_PER_MINUTE: "100", HARNESS_MAX_TOOL_CALLS: "3" }, store, harnessAdapter, logger: { log() {}, error() {} } });
const server = http.createServer(handler);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/api/research`;

async function request(method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = response.status === 204 ? {} : await response.json(); return { response, payload };
}
async function run(projectId, message, extra = {}) { return request("POST", `/projects/${projectId}/messages`, { message, task_type: "research_plan", client_request_id: `request-${crypto.randomUUID()}`, ...extra }); }

try {
  // Test 1/2/6: complete Brief, conditional tools and real constraints.
  let result = await run(main.id, "请基于当前项目背景，为我设计一份完整的调研方案。");
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.workflow.status, "completed");
  assert.equal(result.payload.artifact_created.type, "research_plan");
  assert.equal(result.payload.artifact_created.version, 1);
  assert.match(result.payload.artifact_created.content, /统计最低有效样本为1067/);
  assert.match(result.payload.artifact_created.content, /预算控制在15万元以内/);
  assert.match(result.payload.reply, /调研方案已经完成并保存/);
  assert.deepEqual(result.payload.tool_calls.map((item) => item.tool_id), ["sample_size", "quota_design"]);
  const v1 = result.payload.artifact_created;

  // Test 3: pure qualitative plan never enables sample/quota and does not force statistical sample size.
  const callCount = calls.length;
  result = await run(qualitative.id, "请为这个纯定性项目设计调研方案。");
  assert.equal(result.payload.workflow.status, "completed");
  assert.deepEqual(calls[callCount].allowed, [], "explicit pure qualitative work disables sample and quota tools");
  assert.equal(result.payload.tool_calls.length, 0);
  assert.doesNotMatch(result.payload.artifact_created.content, /置信水平|允许误差|工具计算/);

  // Test 4/7: interview-only revision reuses deterministic results and creates immutable V2.
  const beforeRevisionCalls = calls.length;
  result = await run(main.id, "只把定性访谈从20人调整为12人，其他内容保持不变。", { artifact_id: v1.id, task_type: "artifact_revision" });
  assert.deepEqual(calls[beforeRevisionCalls].allowed, [], "unchanged statistical/quota parameters must disable duplicate tools");
  assert.equal(result.payload.tool_calls.length, 0);
  assert.equal(result.payload.artifact_created.version, 2);
  assert.equal(result.payload.artifact_created.parent_artifact_id, v1.id);
  assert.match(result.payload.artifact_created.content, /定性深访12人/);
  assert.ok(result.payload.workflow.tool_result_ids.length >= 2, "V2 workflow records reused tool result ids");
  const v2 = result.payload.artifact_created;

  // Test 5: statistical parameter change re-enables sample_size and creates V3.
  result = await run(main.id, "把3%误差改为5%，样本量尽量控制在800左右。", { artifact_id: v2.id, task_type: "artifact_revision" });
  assert.ok(calls.at(-1).allowed.includes("sample_size"));
  assert.deepEqual(result.payload.tool_calls.map((item) => item.tool_id), ["sample_size"]);
  assert.equal(result.payload.artifact_created.version, 3);
  assert.match(result.payload.artifact_created.content, /统计最低有效样本为385/);

  // Test 8: failed critical tool yields waiting_input and never fabricates a final artifact/number.
  result = await run(failure.id, "模拟工具失败：请完成需要样本量计算的定量方案。");
  assert.equal(result.payload.workflow.status, "waiting_input");
  assert.equal(result.payload.artifact_created, undefined);
  assert.doesNotMatch(result.payload.reply, /1067|1068/);
  const waitingWorkflowId = result.payload.workflow.id;
  result = await run(failure.id, "工具已经恢复，请继续完成失败项目。", { workflow_id: waitingWorkflowId });
  assert.equal(result.payload.workflow.id, waitingWorkflowId, "waiting_input continuation resumes the same workflow record");
  assert.equal(result.payload.workflow.status, "completed");
  assert.equal(result.payload.artifact_created.version, 1);

  // Major missing decision also waits, while non-blocking defaults do not.
  result = await run(failure.id, "研究对象尚未确定，请设计方案。");
  assert.equal(result.payload.workflow.status, "waiting_input");
  assert.match(result.payload.reply, /已购买用户/);

  // Test 9: refreshable workflow and artifacts are persisted independently of Harness session state.
  const workflows = await request("GET", `/projects/${main.id}/workflows`);
  const artifacts = await request("GET", `/projects/${main.id}/artifacts`);
  assert.equal(workflows.response.status, 200);
  assert.equal(workflows.payload.workflows[0].status, "completed");
  assert.deepEqual(artifacts.payload.artifacts.map((item) => item.version), [3, 2, 1]);

  const policy = classifyResearchPlanToolPolicy({ message: "只改周期为4周", artifact: v2, toolResults: await store.listToolResults(main.id) });
  assert.deepEqual(policy.allowed_tools, []);
  const quality = evaluateResearchPlanQuality({ content: quantitativePlan(), project: main, toolResults: await store.listToolResults(main.id) });
  assert.equal(quality.errors.length, 0);
  console.log("research plan workflow smoke: PASS (9 acceptance scenarios)");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
