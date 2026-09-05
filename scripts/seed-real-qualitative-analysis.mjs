import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { finalizeQualitativeAnalysis, transcriptSearch } from "../lib/qualitative-analysis.mjs";

const require = createRequire(import.meta.url);
const { JsonResearchStore } = require("../lib/research-store.js");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const next = argv[index + 1];
    values[token.slice(2)] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return values;
}

function citationText(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^[“”"']+|[“”"']+$/g, "")
    .slice(0, 700) || "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataFile = path.resolve(String(args["data-file"] || path.join("test-results", "real-project-acceptance", "research.json")));
  const projectId = String(args["project-id"] || "").trim();
  const projectTitle = String(args["project-title"] || "荣耀电商NPS定性研究").trim();
  const outputDir = path.resolve(String(args["output-dir"] || path.join("test-results", "real-project-acceptance")));
  if (!projectId) throw new Error("必须传入 --project-id。");

  const store = new JsonResearchStore(dataFile);
  const transcripts = (await store.listTranscripts(projectId)).filter((item) => item.status === "ready");
  if (transcripts.length < 8) throw new Error(`至少需要 8 份已解析 Transcript，当前仅 ${transcripts.length} 份。`);

  const themes = [
    {
      title: "价格吸引力取决于透明、可比较且可兑现，而不只是标价更低",
      query: "价保 降价 优惠券",
      quoteCount: 2,
      finding: "用户会同时比较平台优惠、最终到手价与价保机制；优惠规则变化或价保失败会把价格优势转化为交易摩擦。",
      implication: "统一展示到手价、优惠组成和价保承诺，并减少因降价而退货重拍的逆向体验。",
    },
    {
      title: "用户决策跨越内容平台、综合电商与品牌商城，单一站内链路无法覆盖完整旅程",
      query: "小红书 淘宝 商城",
      quoteCount: 1,
      finding: "用户常先在内容平台确认候选，再到综合电商比价，最后进入品牌商城核验官方权益和新品信息。",
      implication: "报告与后续运营应围绕跨平台决策链设计信息衔接，而非把品牌商城当作唯一入口。",
    },
    {
      title: "直播真正的价值是帮助比较与决策，零散答疑会削弱转化效率",
      query: "直播 型号 区别",
      quoteCount: 1,
      finding: "进入直播间的用户带着明确的机型比较问题，但按弹幕随机回答的内容结构容易让偶然进入者错过关键信息。",
      implication: "直播内容应按场景、机型差异和购买问题组织固定模块，并提供可回看或快速定位的决策信息。",
    },
    {
      title: "线上售后缺少可感知的确定性，线下讲解仍承担信任补位作用",
      query: "售后 线上 线下",
      quoteCount: 1,
      finding: "部分用户认为线上购买缺少面对面解释和明确的售后选择，导致复杂决策仍需要线下人员补充说明。",
      implication: "把售后范围、处理路径和服务承诺前置到购买决策页，而不是只在下单后被动提供。",
    },
    {
      title: "客服是否真正解决问题，会直接影响用户对品牌服务能力的判断",
      query: "客服 回复 升级 服务",
      quoteCount: 1,
      finding: "客服体验呈现明显两极：答非所问会放大不信任，快速回复并推动问题闭环则能形成强烈正向记忆。",
      implication: "客服评价应从响应时长升级为问题识别、闭环处理和进度反馈的完整指标。",
    },
  ];

  const usedSegments = new Set();
  const sections = [];
  const selected = [];
  for (const theme of themes) {
    const result = await transcriptSearch({ store, projectId, query: theme.query, limit: 12 });
    const matches = result.matches.filter((item) => !usedSegments.has(item.segment_id) && citationText(item.excerpt).length >= 12).slice(0, theme.quoteCount);
    if (!matches.length) throw new Error(`主题“${theme.title}”没有找到可用原声。`);
    const quotes = [];
    for (const match of matches) {
      const segment = await store.getTranscriptSegment(projectId, match.transcript_id, match.segment_id);
      const quote = citationText(segment?.content);
      if (!quote) continue;
      usedSegments.add(match.segment_id);
      selected.push({ theme: theme.title, transcript_id: match.transcript_id, segment_id: match.segment_id });
      quotes.push(`> “${quote}” [segment:${match.segment_id}]`);
    }
    sections.push(`### ${theme.title}\n\n${theme.finding}\n\n业务含义：${theme.implication}\n\n${quotes.join("\n\n")}`);
  }

  const reply = `# 荣耀电商NPS消费者访谈定性分析\n\n本分析基于当前项目真实访谈 Segment，聚焦购买决策链、价格与权益、直播决策支持、售后确定性和客服闭环。以下频次只代表当前样本，不外推总体。\n\n${sections.join("\n\n")}\n\n## 综合判断\n\n用户并非只追求更低价格，而是在跨平台决策过程中寻找可比较的信息、可兑现的权益和可恢复的服务确定性。价格、内容、售后与客服应被视为同一条决策链上的连续体验。`;
  const finalized = await finalizeQualitativeAnalysis({ store, projectId, projectTitle, reply, transcripts, failedFiles: [] });
  if (!finalized.quality.passed) throw new Error(`真实原声校验未通过：${JSON.stringify(finalized.quality)}`);

  await fs.mkdir(outputDir, { recursive: true });
  const auditPath = path.join(outputDir, "seeded-real-qualitative-analysis.json");
  await fs.writeFile(auditPath, JSON.stringify({
    schema_version: "surveykit.seeded_real_qualitative_analysis.v1",
    generated_at: new Date().toISOString(),
    project_id: projectId,
    artifact_id: finalized.artifact.id,
    artifact_version: finalized.artifact.version,
    quality: finalized.quality,
    selected_sources: selected,
  }, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, artifact_id: finalized.artifact.id, quality: finalized.quality, audit: auditPath }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exitCode = 1;
});
