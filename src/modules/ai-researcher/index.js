import { datasetExplanation, artifactPreflight } from "../../../lib/research-readiness.mjs";
/** AI Researcher V0.3.1 frontend. Server /api/research is authoritative; SSE 为可选增强。 */
import { RESEARCH_RUN_RECOVERY_TIMEOUT_MS, latestStreamSnapshot, normalizeStreamPayload, parseSseBuffer, readSseResponse } from "./stream.mjs";
import { downloadBlob } from "../../shared/export.js";
import { buildAiResearchDocxBlob, sanitizeDocxFilename } from "../../shared/docx-export.js";
import { listToolResults, openToolFromProject } from "../tools/index.js";

const API_ROOT = "/api/research";
const TYPE_LABELS = { research_plan: "调研方案", questionnaire: "定量问卷", interview_guide: "访谈大纲", qualitative_summary: "定性小结", qualitative_analysis: "多访谈定性分析", interview_summary: "单访谈小结", analysis: "数据分析", report_outline: "报告大纲", ppt_script: "PPT 脚本", qualitative_ppt: "定性研究 PPT", other: "其他" };
const FILE_CATEGORY_LABELS = { brief: "Brief", historical_report: "历史报告", questionnaire: "问卷", interview: "访谈笔录", data: "数据", other: "其他" };
const PARSE_LABELS = { pending: "等待解析", processing: "解析中", completed: "解析完成", failed: "解析失败", unsupported: "需要人工处理" };
const QUALITATIVE_TEMPLATE_ID = "qualitative_tech_blue_v2";
const QUALITATIVE_LAYOUT_LABELS = { cover_orbit: "封面轨道", chapter_field: "章节场", north_star_stack: "北极星结论", editorial_overview: "核心结论总览", method_rail: "研究方法轨道", hierarchy_tree: "分层树", positioning_map: "定位地图", profile_evidence: "用户画像", stage_rail: "阶段旅程", journey_curve: "决策旅程", contrast_columns: "对比栏", hypothesis_balance: "证据天平", nested_definition: "嵌套定义", evidence_pyramid: "需求金字塔", impact_frequency: "痛点优先级", voice_wall: "用户原声墙", case_chain: "案例链路", decision_grid: "决策矩阵", three_step: "三步诊断", fishbone: "根因鱼骨", three_lane: "三轨行动", action_roadmap: "行动路线图", insight_evidence: "洞察与证据" };
let qualitativeTemplateCatalogPromise = null;
const state = { projects: [], project: null, messages: [], artifacts: [], files: [], transcripts: [], transcriptVersions: [], activeCorrectionDetail: null, evidence: [], insights: [], datasets: [], selectedDatasetId: null, toolResults: [], workflows: [], activeWorkflow: null, selectedFileIds: new Set(), selectedArtifactId: null, targetPptScriptPageId: null, rerenderQualitativeAfterScriptRevision: false, pendingQualitativePptSource: null, pendingQualitativePptButton: null, pendingQualitativePptAnalysis: null, pendingQualitativePptOutline: null, pendingQualitativePptScriptArtifact: null, pendingQualitativePptScript: null, pendingQualitativePptDirty: false, pendingQualitativePptOriginalFingerprint: "", pendingQualitativePreview: null, pendingQualitativePreviewToken: null, selectedQualitativeTemplateId: QUALITATIVE_TEMPLATE_ID, activeFileId: null, activeFile: null, activeTranscript: null, autoRetrieve: true, pendingArtifactContent: "", taskType: "free_chat", pollToken: 0, summaryPollToken: 0, initialized: false, streamController: null, runRecoveryToken: 0 };
const $ = (selector) => document.querySelector(selector);

function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; element.textContent = text == null ? "" : String(text); return element; }
function requestId() { return globalThis.crypto?.randomUUID?.() || `research_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
function formatBytes(value) { const bytes = Number(value || 0); if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function friendlyError(status, payload) { if (status === 401 || status === 403) return "当前登录已失效，请重新登录后再试。"; if (status === 413) return payload?.error?.message || "文件或请求内容超过大小限制。"; if (status === 429) return "AI研究员请求过于频繁，请稍后再试。"; if (status === 504 || payload?.error?.type === "harness_timeout") return "AI研究员响应超时，请稍后重试。"; if ([502, 503].includes(status)) return payload?.error?.message || "AI研究员暂时无法连接，请稍后重试。"; return payload?.error?.message || payload?.message || "请求未完成，请稍后重试。"; }
async function api(path, options = {}) { const headers = { Accept: "application/json", ...(options.headers || {}) }; if (typeof options.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json"; const response = await fetch(`${API_ROOT}${path}`, { credentials: "same-origin", ...options, headers }); const payload = response.status === 204 ? {} : await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(friendlyError(response.status, payload)); error.status = response.status; error.retryable = Boolean(payload?.error?.retryable || [429, 502, 503, 504].includes(response.status)); throw error; } return payload?.data && typeof payload.data === "object" ? payload.data : payload; }
const jsonBody = (value) => JSON.stringify(value);
function notify(message, tone = "info", retry = null) { const box = $("#researchFeedback"); if (!box) return; box.hidden = false; box.className = `research-feedback ${tone}`; const text = node("span", "", message); box.replaceChildren(text); if (retry) { const button = node("button", "secondary-btn", "重试"); button.type = "button"; button.addEventListener("click", async () => { button.disabled = true; button.textContent = "重试中…"; box.className = "research-feedback info"; text.textContent = "正在重新连接 AI 研究员…"; try { await retry(); } catch (error) { notify(error?.message || "重试未完成，请稍后再试。", "error", retry); } }, { once: true }); box.appendChild(button); } }
function clearNotice() { const box = $("#researchFeedback"); if (box) box.hidden = true; }
function setBusy(button, busy, label = "处理中…") { if (!button) return; button.dataset.idleLabel ||= button.textContent; button.disabled = busy; button.textContent = busy ? label : button.dataset.idleLabel; }
function showMode(mode) { $("#researchHome").hidden = mode !== "home"; $("#researchCreate").hidden = mode !== "create"; $("#researchWorkspace").hidden = mode !== "workspace"; $("#researchNewProject").hidden = mode === "workspace"; }

function exportWord(content, title) {
  try {
    const projectTitle = state.project?.title || "AI研究项目";
    const blob = buildAiResearchDocxBlob({ content, projectTitle, title });
    downloadBlob(`${sanitizeDocxFilename(title || projectTitle)}.docx`, blob);
    notify("Word 文档已开始下载。", "success");
  } catch {
    notify("Word 文档生成失败，请刷新页面后重试。", "error");
  }
}

function downloadResearchFile(file) {
  if (!state.project?.id || !file?.id) return;
  const link = document.createElement("a");
  link.href = `${API_ROOT}/projects/${encodeURIComponent(state.project.id)}/files/${encodeURIComponent(file.id)}/download`;
  link.download = file.file_name || "项目文件";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function updatedLabel(value) { if (!value) return "刚刚更新"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? "最近更新" : `更新于 ${date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`; }

function renderProjects() { const list = $("#researchProjectList"); list.replaceChildren(); if (!state.projects.length) { const empty = node("div", "research-empty-state", "还没有调研项目。创建一个项目，开始与 AI 研究员协作。"); const create = node("button", "primary-btn", "＋ 新建调研项目"); create.type = "button"; create.addEventListener("click", () => showMode("create")); empty.appendChild(create); list.appendChild(empty); return; } state.projects.forEach((project) => { const card = node("button", "research-project-card", ""); card.type = "button"; const head = node("span", "research-project-card-head", ""); head.append(node("strong", "", project.title || "未命名项目"), node("span", "", project.status || "进行中")); card.append(head, node("span", "research-project-client", project.client_name || "未填写客户"), node("p", "", project.research_goal || project.brief || "尚未填写研究目标"), node("small", "", updatedLabel(project.updated_at || project.updatedAt))); card.addEventListener("click", () => openProject(project.id)); list.appendChild(card); }); }
async function loadProjects() { clearNotice(); try { const result = await api("/projects"); state.projects = result.projects || []; renderProjects(); } catch (error) { notify(error.message, "error", error.retryable ? loadProjects : null); } }
function fillProject(project) { const constraints = project.constraints || {}; $("#researchWorkspaceTitle").textContent = project.title || "未命名项目"; $("#researchWorkspaceMeta").textContent = [project.client_name, project.status || "进行中"].filter(Boolean).join(" · ") || "AI Researcher 工作台"; $("#researchProjectTitle").value = project.title || ""; $("#researchProjectClient").value = project.client_name || ""; $("#researchProjectBrief").value = project.brief || ""; $("#researchProjectGoal").value = project.research_goal || ""; $("#researchProjectBudget").value = constraints.budget || ""; $("#researchProjectTimeline").value = constraints.timeline || ""; $("#researchProjectTargetSample").value = constraints.target_sample || ""; $("#researchProjectMethod").value = constraints.research_method_preference || ""; $("#researchProjectRegion").value = constraints.region_scope || ""; $("#researchProjectOtherConstraints").value = constraints.other_constraints || ""; }
function isNearBottom(list) { return list.scrollHeight - list.scrollTop - list.clientHeight < 80; }
function scrollMessagesToBottom(list) { list.scrollTop = list.scrollHeight; }
function renderMessages() {
  const list = $("#researchMessageList"); const shouldStick = isNearBottom(list) || list.querySelector(".research-welcome"); list.replaceChildren();
  if (!state.messages.filter((item) => item.role !== "system").length) { const welcome = node("div", "research-welcome", ""); welcome.append(node("strong", "", "我是你的 AI 调研研究员。"), node("p", "", "选择当前任务需要的文件或成果，我会基于项目记忆持续协作。")); list.appendChild(welcome); return; }
  state.messages.forEach((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) return;
    const item = node("article", `research-message ${message.role}${message.pending ? " pending" : ""}${message.error ? " error" : ""}`, ""); item.append(node("span", "research-message-role", message.role === "user" ? "你" : "AI研究员"));
    if (message.role === "assistant" && message.toolCalls?.length) { const tools = node("div", "research-message-tools", ""); message.toolCalls.forEach((tool) => { const status = ["running", "completed", "error"].includes(tool.status) ? tool.status : "running"; const card = node("div", `research-message-tool ${status}`, ""); card.append(node("span", "research-message-tool-icon", status === "running" ? "" : status === "completed" ? "✓" : "!"), node("strong", "", tool.label || "专业工具"), node("span", "", tool.message || (status === "running" ? "正在调用…" : status === "completed" ? "调用完成" : "调用未完成"))); tools.appendChild(card); }); item.appendChild(tools); }
    const content = node("div", "research-message-content", message.content || ""); if (message.streaming) content.appendChild(node("span", "research-streaming-cursor", "")); item.appendChild(content);
    if (message.error) item.appendChild(node("p", "research-message-state", message.error)); else if (message.pending && message.role === "user") item.appendChild(node("p", "research-message-state", "正在发送…")); else if (message.streaming) item.appendChild(node("p", "research-message-state", "正在接收回复…"));
    if (message.role === "assistant" && !message.streaming && !message.error && message.content) {
      const actions = node("div", "research-message-actions", "");
      if (message.generatedFile) { const download = node("button", "primary-btn", "下载 Excel 小结"); download.type = "button"; download.addEventListener("click", () => downloadResearchFile(message.generatedFile)); actions.appendChild(download); }
      if (message.artifactCreated) {
        const view = node("button", "primary-btn", message.artifactCreated.type === "report_outline" ? "查看报告大纲" : message.artifactCreated.type === "ppt_script" ? "查看 PPT 脚本" : "查看完整方案"); view.type = "button"; view.addEventListener("click", () => { setMobileTab("artifacts"); renderArtifactDetail(message.artifactCreated); });
        const revise = node("button", "secondary-btn", "继续修改"); revise.type = "button"; revise.addEventListener("click", () => selectArtifact(message.artifactCreated));
        actions.append(view, revise); if (message.artifactCreated.type !== "ppt_script") { const exportBtn = node("button", "ghost-btn", "导出 Word"); exportBtn.type = "button"; exportBtn.addEventListener("click", () => exportWord(message.artifactCreated.content || "", message.artifactCreated.title || "调研方案")); actions.appendChild(exportBtn); }
      } else {
        const save = node("button", "secondary-btn", "保存为新版本"); save.type = "button"; save.addEventListener("click", () => openSaveDialog(message.content || ""));
        const exportBtn = node("button", "ghost-btn", "导出 Word"); exportBtn.type = "button"; exportBtn.addEventListener("click", () => exportWord(message.content || "", state.project?.title || "AI研究成果")); actions.append(save, exportBtn);
      }
      item.appendChild(actions);
    }
    list.appendChild(item);
  });
  if (shouldStick) scrollMessagesToBottom(list);
}
async function loadMessages() { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/messages`); state.messages = result.messages || []; renderMessages(); }

function artifactLabel(artifact) { return TYPE_LABELS[artifact.type] || "其他"; }
function parsedOutline(artifact) { if (artifact?.type !== "report_outline") return null; try { const value = JSON.parse(artifact.content || "{}"); return value?.schema_version === "surveykit.report_outline.v1" ? value : null; } catch { return null; } }
function parsedPptScript(artifact) { if (artifact?.type !== "ppt_script") return null; try { const value = JSON.parse(artifact.content || "{}"); return value?.schema_version === "surveykit.ppt_script.v1" ? value : null; } catch { return null; } }
function parsedQualitativePpt(artifact) { if (artifact?.type !== "qualitative_ppt") return null; try { const value = JSON.parse(artifact.content || "{}"); return value?.schema_version === "surveykit.qualitative_ppt.v1" ? value : null; } catch { return null; } }
const EVIDENCE_STATUS_LABELS = { sufficient: "✓ 证据充分", limited: "△ 证据一般", needs_supplement: "! 需要补充" };
function coverageText(coverage = {}) { const labels = []; if (coverage.quantitative) labels.push("定量"); if (coverage.qualitative) labels.push("定性"); if (coverage.transcript_quote) labels.push("原声"); if (coverage.tool_result) labels.push("Tool Result"); if (coverage.project_file) labels.push("项目文件"); return labels.length ? labels.join(" + ") : "暂无证据"; }
function evidenceById(evidenceId) { return state.evidence.find((item) => item.id === evidenceId); }
async function toggleInsightPin(insightId, pinned, button) { setBusy(button, true, "保存中…"); try { await api(`/projects/${encodeURIComponent(state.project.id)}/insights/${encodeURIComponent(insightId)}`, { method: "PATCH", body: jsonBody({ is_pinned: !pinned }) }); await loadInsights(); button.dataset.idleLabel = !pinned ? "已锁定" : "锁定结论"; button.textContent = button.dataset.idleLabel; notify(!pinned ? "核心结论已锁定，后续重排会尽量保留。" : "已取消锁定。", "success"); } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }
async function toggleEvidenceExcluded(evidence, button) { setBusy(button, true, "保存中…"); try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/evidence/${encodeURIComponent(evidence.id)}`, { method: "PATCH", body: jsonBody({ excluded: !evidence.excluded }) }); Object.assign(evidence, result.evidence || result); await loadArtifacts(); button.dataset.idleLabel = evidence.excluded ? "恢复用于 Storyline" : "排除 Evidence"; button.textContent = button.dataset.idleLabel; notify(evidence.excluded ? "该 Evidence 已排除，但原始证据未删除。" : "该 Evidence 已恢复。", "success"); } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }
function appendOutlineEvidence(container, evidenceIds = []) { const ids = [...new Set(evidenceIds)]; if (!ids.length) { container.appendChild(node("p", "research-outline-gap", "! 当前结论没有绑定可追溯 Evidence")); return; } const box = node("div", "research-outline-evidence", ""); ids.forEach((evidenceId) => { const evidence = evidenceById(evidenceId); if (!evidence) return; const card = node("article", `research-evidence-card strength-${evidence.strength || "medium"}${evidence.excluded ? " excluded" : ""}`, ""); card.append(node("strong", "", evidence.claim || "研究证据"), node("small", "", `${({ strong: "Strong", medium: "Medium", weak: "Weak" })[evidence.strength] || "Medium"} · ${evidence.type || evidence.source_type}`)); const view = node("button", "ghost-btn", "查看来源"); view.type = "button"; view.addEventListener("click", () => showEvidenceDetail(evidence, card)); const exclude = node("button", "ghost-btn", evidence.excluded ? "恢复用于 Storyline" : "排除 Evidence"); exclude.type = "button"; exclude.addEventListener("click", () => toggleEvidenceExcluded(evidence, exclude)); card.append(view, exclude); box.appendChild(card); }); container.appendChild(box); }
function renderReportOutline(detail, artifact, outline) {
  const quality = node("section", "research-outline-summary", ""); const pages = (outline.chapters || []).flatMap((chapter) => chapter.pages || []); quality.append(node("strong", "", `${outline.core_insights?.length || 0} 条核心结论 · ${outline.chapters?.length || 0} 章 · ${pages.length} 个页面主题`), node("p", "", outline.rationale || outline.report_goal || "围绕项目 Evidence 组织报告逻辑。")); if (artifact.has_new_evidence) quality.appendChild(node("p", "research-outline-update", "有新的 Evidence 可用，可点击“基于最新证据更新报告大纲”。")); detail.appendChild(quality);
  const insights = node("section", "research-outline-section", ""); insights.appendChild(node("h5", "", "核心结论")); (outline.core_insights || []).forEach((insight, index) => { const card = node("article", "research-outline-insight", ""); card.append(node("span", "research-outline-index", String(index + 1).padStart(2, "0")), node("h6", "", insight.title), node("p", "", insight.statement), node("small", "", `置信度 ${insight.confidence || "low"} · Evidence Coverage：${coverageText(insight.evidence_coverage)}`)); if (insight.interpretation) card.appendChild(node("p", "research-outline-interpretation", `解释：${insight.interpretation}`)); if (insight.business_implication) card.appendChild(node("p", "research-outline-implication", `业务含义：${insight.business_implication}`)); const persisted = state.insights.find((item) => item.id === insight.id); const pin = node("button", "ghost-btn", persisted?.is_pinned ? "已锁定" : "锁定结论"); pin.type = "button"; pin.addEventListener("click", () => toggleInsightPin(insight.id, Boolean(persisted?.is_pinned), pin)); card.appendChild(pin); appendOutlineEvidence(card, insight.evidence_ids); insights.appendChild(card); }); detail.appendChild(insights);
  const story = node("section", "research-outline-section", ""); story.appendChild(node("h5", "", "Storyline")); (outline.storyline || []).forEach((section, index) => { const card = node("article", "research-outline-story", ""); card.append(node("span", "research-outline-index", String(index + 1).padStart(2, "0")), node("h6", "", section.section_title), node("p", "", section.core_message), node("small", "", `Purpose：${section.section_purpose || "—"}`)); if (section.transition) card.appendChild(node("p", "research-outline-transition", `Transition：${section.transition}`)); story.appendChild(card); }); detail.appendChild(story);
  const chapters = node("section", "research-outline-section", ""); chapters.appendChild(node("h5", "", "章节与页面建议")); (outline.chapters || []).forEach((chapter) => { const chapterBox = node("article", "research-outline-chapter", ""); chapterBox.append(node("h6", "", `${chapter.chapter_no}. ${chapter.title}`), node("p", "", chapter.core_message || chapter.purpose)); (chapter.pages || []).forEach((page) => { const pageBox = node("div", `research-outline-page status-${page.evidence_status || "limited"}`, ""); pageBox.append(node("span", "research-outline-page-no", `P${page.page_no}`), node("strong", "", page.page_title), node("p", "", page.key_message), node("small", "research-outline-evidence-status", `${EVIDENCE_STATUS_LABELS[page.evidence_status] || "△ 证据一般"} · ${coverageText(page.evidence_coverage)}`)); if (page.suggested_visual) pageBox.appendChild(node("small", "", `建议视觉：${page.suggested_visual}`)); appendOutlineEvidence(pageBox, page.evidence_ids); chapterBox.appendChild(pageBox); }); chapters.appendChild(chapterBox); }); detail.appendChild(chapters);
  if (outline.evidence_conflicts?.length) { const conflicts = node("section", "research-outline-section", ""); conflicts.appendChild(node("h5", "", "Evidence Conflict")); outline.evidence_conflicts.forEach((item) => { const card = node("article", "research-outline-conflict", ""); card.append(node("strong", "", item.theme || "冲突证据"), node("p", "", item.explanation), node("small", "", item.status === "segmented" ? "已识别人群/渠道/阶段边界" : item.status === "resolved" ? "已解释" : "待进一步验证")); appendOutlineEvidence(card, item.evidence_ids); conflicts.appendChild(card); }); detail.appendChild(conflicts); }
  if (outline.evidence_gaps?.length) { const gaps = node("section", "research-outline-section", ""); gaps.appendChild(node("h5", "", "Evidence Gap")); outline.evidence_gaps.forEach((gap) => { const card = node("article", "research-outline-gap-card", ""); card.append(node("strong", "", gap.claim), node("p", "", gap.reason), node("small", "", `建议：${gap.recommendation || "补充对应证据"}`)); gaps.appendChild(card); }); detail.appendChild(gaps); }
}
async function savePptScriptVersion(artifact, script, message = "PPT Script 已保存为新版本。") { const pages = script.pages || []; pages.forEach((page, index) => { page.page_number = index + 1; }); const result = await api(`/projects/${encodeURIComponent(state.project.id)}/artifacts`, { method: "POST", body: jsonBody({ type: "ppt_script", title: script.title || artifact.title, content: JSON.stringify(script, null, 2), parent_artifact_id: artifact.id }) }); const saved = result.artifact || result; state.selectedArtifactId = saved.id; await loadArtifacts(); renderArtifactDetail(state.artifacts.find((item) => item.id === saved.id) || saved); notify(`${message} V${saved.version}`, "success"); return saved; }
function startPptScript(outlineArtifact) { state.selectedArtifactId = outlineArtifact.id; state.targetPptScriptPageId = null; state.taskType = "ppt_script"; state.selectedFileIds.clear(); state.autoRetrieve = false; $("#researchChatInput").value = "请基于这份 Report Outline 生成完整的页面级 PPT Script。"; renderContextChips(); renderArtifacts(); setMobileTab("chat"); $("#researchChatInput").focus(); }
function revisePptScriptPage(artifact, page) { const instruction = window.prompt("输入这一页的修改要求", "压缩到一个核心结论和三条支撑信息，保持 Evidence 不变。"); if (!instruction?.trim()) return; state.selectedArtifactId = artifact.id; state.targetPptScriptPageId = page.id; state.rerenderQualitativeAfterScriptRevision = true; state.taskType = "ppt_script"; state.selectedFileIds.clear(); state.autoRetrieve = false; $("#researchChatInput").value = instruction.trim(); renderContextChips(); setMobileTab("chat"); $("#researchChatInput").focus(); }

function base64PptxBlob(value) { const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }); }
async function runResearchWorkflow(body) { const outcome = await postMessage({ ...body, client_request_id: requestId(), selected_file_ids: [], auto_retrieve: false }, {}); if (!outcome.result) throw new Error("工作流未返回完整结果，请稍后重试。"); await refreshGeneratedOutputs(outcome.result); return outcome.result.artifact_created; }
async function loadQualitativeTemplateCatalog() {
  if (!qualitativeTemplateCatalogPromise) qualitativeTemplateCatalogPromise = fetch("/pptx-api/qualitative-templates", { credentials: "same-origin", headers: { Accept: "application/json" } }).then(async (response) => { const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.error?.message || "无法读取定性 PPT 模板。"); return payload; }).catch((error) => { qualitativeTemplateCatalogPromise = null; throw error; });
  return qualitativeTemplateCatalogPromise;
}
function resetQualitativePptPreviewState() {
  state.pendingQualitativePptSource = null; state.pendingQualitativePptButton = null;
  state.pendingQualitativePptAnalysis = null; state.pendingQualitativePptOutline = null;
  state.pendingQualitativePptScriptArtifact = null; state.pendingQualitativePptScript = null;
  state.pendingQualitativePptDirty = false; state.pendingQualitativePptOriginalFingerprint = "";
  state.pendingQualitativePreview = null; state.pendingQualitativePreviewToken = null;
}
async function resolveQualitativePptSources(sourceArtifact) {
  let scriptArtifact = sourceArtifact.type === "ppt_script" ? sourceArtifact : null;
  const analysis = sourceArtifact.type === "qualitative_analysis" ? sourceArtifact : state.artifacts.find((item) => item.type === "qualitative_analysis") || null;
  let outline = sourceArtifact.type === "report_outline" ? sourceArtifact : scriptArtifact ? state.artifacts.find((item) => item.id === parsedPptScript(scriptArtifact)?.source_report_outline_id) || null : null;
  if (scriptArtifact) { const script = parsedPptScript(scriptArtifact); if (!script) throw new Error("PPT Script 结构无效，无法渲染。"); return { analysis, outline, scriptArtifact, script }; }
  if (!analysis) throw new Error("请先完成多访谈定性分析。");
  if (!outline) outline = await runResearchWorkflow({ message: `请基于当前最新定性分析（${analysis.title} V${analysis.version}）生成面向定性研究报告的 Storyline 与 Report Outline。`, task_type: "report_storyline" });
  if (!scriptArtifact) scriptArtifact = await runResearchWorkflow({ message: "请基于这份 Report Outline 生成完整的定性研究报告 PPT Script，优先使用定性 Page Type。", artifact_id: outline.id, task_type: "ppt_script" });
  const script = parsedPptScript(scriptArtifact);
  if (!script) throw new Error("PPT Script 结构无效，无法渲染。");
  return { analysis, outline, scriptArtifact, script };
}
async function requestQualitativePptPreview(script, sourcePageId = "") {
  const response = await fetch("/pptx-api/qualitative-preview", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Project-Id": state.project.id }, body: jsonBody({ project_id: state.project.id, script, template_id: state.selectedQualitativeTemplateId, ...(sourcePageId ? { source_page_id: sourcePageId } : {}) }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "定性 PPT 真实预览失败。");
  if (payload?.renderer?.engine !== "officecli" || !Array.isArray(payload.slides)) throw new Error("预览服务未返回有效的 OfficeCLI 逐页缩略图。");
  return payload;
}
function renderQualitativePreviewLoading() {
  $("#researchPptPreviewSummary").textContent = "OfficeCLI 正在临时渲染当前 PPT Script；此过程不会创建正式 PPT Artifact。";
  const container = $("#researchPptLayoutPreviews"); container.replaceChildren(node("div", "research-ppt-preview-loading", "正在生成全部页面真实缩略图…"));
}
function previewDensityLabel(status) { return ({ low: "低", medium: "中", high: "高", balanced: "均衡", dense: "偏高", overloaded: "过载" })[status] || status || "中"; }
function previewEvidenceLabel(status) { return ({ sufficient: "证据充分", limited: "证据一般", needs_supplement: "需补充", not_required: "无需证据" })[status] || status || "证据一般"; }
function renderQualitativePagePreviews(preview) {
  const container = $("#researchPptLayoutPreviews"); container.replaceChildren();
  $("#researchPptPreviewSummary").textContent = `${preview.slide_count || preview.slides?.length || 0} 页真实预览 · OfficeCLI 临时渲染 · 不创建 qualitative_ppt Artifact${state.pendingQualitativePptDirty ? " · 布局修改待保存" : ""}`;
  (preview.slides || []).forEach((slide, index) => {
    const card = node("article", `research-ppt-page-preview density-${slide.density?.status || "medium"}`, ""); card.dataset.sourcePageId = slide.source_page_id || "";
    const head = node("div", "research-ppt-page-preview-head", "");
    head.append(node("span", "research-ppt-page-number", `P${String(index + 1).padStart(2, "0")}`), node("span", "research-ppt-page-type", slide.page_type || "qualitative_insight"), node("strong", "", slide.title || "未命名页面"));
    if (slide.continuation?.total > 1) head.appendChild(node("span", "research-ppt-page-continuation", `${slide.continuation.is_continuation ? "续页" : "拆页"} ${slide.continuation.part}/${slide.continuation.total}`));
    const image = document.createElement("img"); image.className = "research-ppt-page-image"; image.alt = `第 ${index + 1} 页真实预览：${slide.title || slide.page_type}`; image.loading = "lazy"; image.src = `data:${slide.thumbnail_mime_type || "image/png"};base64,${slide.thumbnail_base64 || ""}`;
    const meta = node("div", "research-ppt-page-preview-meta", "");
    meta.append(node("span", `density ${slide.density?.status || "medium"}`, `密度 ${previewDensityLabel(slide.density?.status)}`), node("span", `evidence ${slide.evidence?.status || "limited"}`, `${previewEvidenceLabel(slide.evidence?.status)} · ${slide.evidence?.count || 0} 条${slide.evidence?.quote_count ? ` · ${slide.evidence.quote_count} 条原声` : ""}`));
    const layout = node("label", "research-ppt-page-layout", ""); layout.appendChild(node("span", "", "候选布局"));
    const select = document.createElement("select"); select.setAttribute("aria-label", `${slide.title || "当前页"}候选布局`);
    (slide.layout_candidates || []).forEach((candidate) => { const option = document.createElement("option"); option.value = candidate.id; option.textContent = candidate.label || QUALITATIVE_LAYOUT_LABELS[candidate.id] || candidate.id; option.selected = candidate.id === slide.layout_variant; select.appendChild(option); });
    select.disabled = (slide.layout_candidates || []).length < 2; select.addEventListener("change", () => rerenderQualitativeSourcePage(slide, select, card)); layout.appendChild(select); meta.appendChild(layout);
    const issues = node("div", "research-ppt-page-issues", "");
    if (slide.validation_issues?.length) slide.validation_issues.forEach((issue) => issues.appendChild(node("p", issue.severity || "warning", `${issue.severity === "error" ? "!" : issue.severity === "fixed" ? "✓" : "△"} ${issue.message}`)));
    else issues.appendChild(node("p", "passed", "✓ 当前页未发现 Script 校验问题"));
    card.append(head, image, meta, issues); container.appendChild(card);
  });
}
function renderQualitativePptPreflight(sourceArtifact, catalog, preview = null) {
  const template = (catalog.templates || []).find((item) => item.template_id === state.selectedQualitativeTemplateId) || catalog.templates?.[0] || {};
  state.selectedQualitativeTemplateId = template.template_id || QUALITATIVE_TEMPLATE_ID;
  $("#researchPptTemplateName").textContent = `${template.name || "Tech Blue V2"} · ${template.version || "2.0"}`;
  $("#researchPptTemplateDescription").textContent = template.description || "企业级定性研究报告模板";
  const palette = $("#researchPptTemplatePalette"); palette.replaceChildren();
  Object.entries(template.tokens || {}).filter(([key]) => ["navy", "deep_blue", "primary", "cyan", "ice"].includes(key)).forEach(([name, color]) => { const swatch = node("span", "", ""); swatch.title = `${name} ${color}`; swatch.style.background = color; palette.appendChild(swatch); });
  const script = parsedPptScript(sourceArtifact);
  const pages = script?.pages || [];
  const evidenceIds = new Set(pages.flatMap((page) => page.evidence_ids || []));
  const quoteCount = pages.reduce((sum, page) => sum + (page.quotes || []).length, 0);
  const denseCount = pages.filter((page) => ["dense", "overloaded"].includes(page.density?.status)).length;
  const sourceLabel = sourceArtifact.type === "ppt_script" ? `PPT Script V${sourceArtifact.version || 1}` : sourceArtifact.type === "qualitative_analysis" ? `定性分析 V${sourceArtifact.version || 1}` : artifactLabel(sourceArtifact);
  const metrics = [
    ["输入来源", sourceLabel, "ready"],
    ["页面规划", preview ? `${preview.slide_count} 个真实渲染页${preview.layout_adaptations?.continuation_page_count ? ` · ${preview.layout_adaptations.continuation_page_count} 个续页` : ""}` : pages.length ? `${pages.length} 个 Script 页面${denseCount ? ` · ${denseCount} 页将检查续页` : ""}` : "将先生成 Outline 与 PPT Script", preview ? "ready" : pages.length ? "ready" : "pending"],
    ["证据绑定", pages.length ? `${evidenceIds.size} 条 Evidence · ${quoteCount} 条逐字原声` : "由上游 Analysis / Outline 继承", pages.length && !evidenceIds.size ? "warning" : "ready"],
    ["输出对象", "文本、形状与连接线均为原生可编辑对象", "ready"],
  ];
  const metricBox = $("#researchPptPreflightMetrics"); metricBox.replaceChildren();
  metrics.forEach(([label, value, tone]) => { const item = node("article", `research-ppt-preflight-metric ${tone}`, ""); item.append(node("small", "", label), node("strong", "", value)); metricBox.appendChild(item); });
  const renderer = catalog.renderer || {}; const officeReady = Boolean(renderer.officecli_installed); const previewReady = Boolean(preview?.slides?.length); const scriptErrors = Number(preview?.validation?.error_count || 0); const gateFailed = preview?.quality_gate?.passed === false; const sourceCheck = artifactPreflight({...sourceArtifact, content: state.pendingQualitativePptScript || sourceArtifact.content}, state.evidence); const blocked = !officeReady || !previewReady || scriptErrors > 0 || gateFailed || !sourceCheck.can_generate;
  const rendererState = $("#researchPptRendererState"); rendererState.className = `research-ppt-renderer-state ${blocked ? "blocked" : "ready"}`;
  rendererState.replaceChildren(node("span", "", blocked ? (previewReady ? "!" : "…") : "✓"), node("div", "", ""));
  const rendererTitle = !officeReady ? "OfficeCLI 尚未就绪" : !previewReady ? `OfficeCLI ${renderer.officecli_version || ""} 正在生成真实预览` : gateFailed ? "预览未通过 OfficeCLI 质量门禁" : scriptErrors ? `PPT Script 仍有 ${scriptErrors} 个错误` : `OfficeCLI ${preview.quality_gate?.version || renderer.officecli_version || ""} 真实预览已通过`;
  const rendererCopy = !officeReady ? "为避免生成兼容稿，本次确认按钮已锁定。请先部署 OfficeCLI。" : !previewReady ? "正在临时生成原生 PPTX 并逐页截图，不会创建正式 Artifact。" : blocked ? "请先修复页面校验问题或更换布局，再生成正式可编辑 PPTX。" : "全部缩略图来自当前 Script 的临时原生 PPTX；正式生成仍会再次执行 validate / issues。";
  rendererState.lastChild.append(node("strong", "", rendererTitle), node("p", "", rendererCopy)); for(const issue of sourceCheck.issues)rendererState.lastChild.append(node("p", `research-preflight-${issue.code}`, issue.message));
  $("#researchPptPreviewConfirm").disabled = blocked;
  $("#researchPptPreviewConfirm").textContent = blocked ? (previewReady ? "请先处理校验问题" : "正在生成真实预览…") : state.pendingQualitativePptDirty ? "保存新 Script 并生成 PPTX" : "确认并生成可编辑 PPTX";
  $("#researchPptTemplateId").textContent = state.selectedQualitativeTemplateId;
}
async function rerenderQualitativeSourcePage(slide, select, card) {
  const script = state.pendingQualitativePptScript; const target = script?.pages?.find((page) => page.id === slide.source_page_id); if (!target) { notify("找不到该源页面，无法重新渲染。", "error"); return; }
  const previewToken = state.pendingQualitativePreviewToken;
  const oldVariant = target.layout_variant || target.variant || target.layout_spec?.variant || ""; const nextVariant = select.value; if (oldVariant === nextVariant) return;
  const oldLayoutSpec = target.layout_spec && typeof target.layout_spec === "object" ? { ...target.layout_spec } : target.layout_spec;
  target.layout_variant = nextVariant; target.layout_spec = { ...(target.layout_spec && typeof target.layout_spec === "object" ? target.layout_spec : {}), variant: nextVariant };
  select.disabled = true; card.classList.add("rendering");
  try {
    const result = await requestQualitativePptPreview(script, slide.source_page_id); if (!previewToken || state.pendingQualitativePreviewToken !== previewToken) return; const retained = (state.pendingQualitativePreview?.slides || []).filter((item) => item.source_page_id !== slide.source_page_id); const sourceOrder = new Map((script.pages || []).map((page, index) => [page.id, index]));
    const slides = [...retained, ...result.slides].sort((left, right) => (sourceOrder.get(left.source_page_id) ?? 9999) - (sourceOrder.get(right.source_page_id) ?? 9999) || (left.continuation?.part || 1) - (right.continuation?.part || 1));
    state.pendingQualitativePptDirty = result.script_fingerprint !== state.pendingQualitativePptOriginalFingerprint; state.pendingQualitativePreview = { ...state.pendingQualitativePreview, ...result, slides };
    renderQualitativePagePreviews(state.pendingQualitativePreview); renderQualitativePptPreflight(state.pendingQualitativePptScriptArtifact, await loadQualitativeTemplateCatalog(), state.pendingQualitativePreview);
    notify(`已仅重新渲染“${target.title || "当前页"}”及其续页。`, "success");
  } catch (error) {
    target.layout_variant = oldVariant; target.layout_spec = oldLayoutSpec; select.value = oldVariant; notify(error.message, "error");
  } finally { select.disabled = false; card.classList.remove("rendering"); }
}
async function openQualitativePptPreview(sourceArtifact, button = null) {
  if (!state.project || !sourceArtifact) return;
  setBusy(button, true, "准备预览…"); clearNotice();
  try {
    const resolved = await resolveQualitativePptSources(sourceArtifact);
    const catalog = await loadQualitativeTemplateCatalog();
    state.pendingQualitativePptSource = sourceArtifact; state.pendingQualitativePptButton = button; state.pendingQualitativePptAnalysis = resolved.analysis; state.pendingQualitativePptOutline = resolved.outline; state.pendingQualitativePptScriptArtifact = resolved.scriptArtifact; state.pendingQualitativePptScript = JSON.parse(JSON.stringify(resolved.script));
    state.selectedQualitativeTemplateId = catalog.default_template_id || QUALITATIVE_TEMPLATE_ID;
    const token = requestId(); state.pendingQualitativePreviewToken = token;
    renderQualitativePptPreflight(resolved.scriptArtifact, catalog); renderQualitativePreviewLoading();
    $("#researchQualitativePptPreviewDialog").showModal();
    const preview = await requestQualitativePptPreview(state.pendingQualitativePptScript); if (state.pendingQualitativePreviewToken !== token) return;
    state.pendingQualitativePptOriginalFingerprint = preview.script_fingerprint; state.pendingQualitativePptDirty = false; state.pendingQualitativePreview = preview;
    renderQualitativePagePreviews(preview); renderQualitativePptPreflight(resolved.scriptArtifact, catalog, preview);
  } catch (error) { notify(error.message, "error"); if (!$("#researchQualitativePptPreviewDialog")?.open) resetQualitativePptPreviewState(); }
  finally { setBusy(button, false); }
}
async function confirmQualitativePptPreview(event) {
  event.preventDefault(); const confirm = $("#researchPptPreviewConfirm"); if (confirm.disabled || !state.pendingQualitativePreview) return;
  const sourceButton = state.pendingQualitativePptButton; const templateId = state.selectedQualitativeTemplateId; const resolved = { analysis: state.pendingQualitativePptAnalysis, outline: state.pendingQualitativePptOutline, scriptArtifact: state.pendingQualitativePptScriptArtifact };
  setBusy(confirm, true, state.pendingQualitativePptDirty ? "保存脚本中…" : "开始正式生成…");
  try {
    if (state.pendingQualitativePptDirty) resolved.scriptArtifact = await savePptScriptVersion(resolved.scriptArtifact, state.pendingQualitativePptScript, "布局修改已保存为");
    $("#researchQualitativePptPreviewDialog").close(); resetQualitativePptPreviewState();
    await generateQualitativePpt(resolved.scriptArtifact, sourceButton, { templateId, requireOfficeCli: true, resolved });
  } catch (error) { notify(error.message, "error"); }
  finally { setBusy(confirm, false); }
}
async function generateQualitativePpt(sourceArtifact, button = null, options = {}) {
  if (!state.project || !sourceArtifact) return;
  setBusy(button, true, "生成中…"); clearNotice();
  try {
    const templateId = options.templateId || QUALITATIVE_TEMPLATE_ID;
    const resolved = options.resolved || await resolveQualitativePptSources(sourceArtifact); const analysis = resolved.analysis; const outline = resolved.outline; const scriptArtifact = resolved.scriptArtifact;
    if (!analysis || !outline) throw new Error("正式生成需要可回溯的定性分析与 Report Outline。");
    const script = parsedPptScript(scriptArtifact);
    if (!script) throw new Error("PPT Script 结构无效，无法渲染。");
    const response = await fetch("/pptx-api/qualitative-report", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Project-Id": state.project.id }, body: jsonBody({ project_id: state.project.id, script, template_id: templateId, require_officecli: options.requireOfficeCli !== false }) });
    const rendered = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(rendered?.error?.message || "定性 PPT 渲染失败。");
    const blob = base64PptxBlob(rendered.content_base64 || "");
    const uploaded = await api(`/projects/${encodeURIComponent(state.project.id)}/files`, { method: "POST", headers: { "Content-Type": blob.type, "X-Research-File-Name": encodeURIComponent(rendered.filename || "定性研究报告.pptx"), "X-Research-File-Category": "other" }, body: blob });
    const previous = state.artifacts.find((item) => item.type === "qualitative_ppt");
    const metadata = { schema_version: "surveykit.qualitative_ppt.v1", template_id: rendered.template_id || templateId, file_id: uploaded.file.id, file_name: uploaded.file.file_name, source_report_outline: outline.id, source_ppt_script: scriptArtifact.id, source_analysis_artifacts: [analysis.id], slide_count: rendered.slide_count, validation: rendered.validation, object_counts: rendered.object_counts, renderer: rendered.renderer, quality_gate: rendered.quality_gate, layout_adaptations: rendered.layout_adaptations, render_llm_tokens: rendered.llm_tokens, generated_at: new Date().toISOString() };
    const created = await api(`/projects/${encodeURIComponent(state.project.id)}/artifacts`, { method: "POST", body: jsonBody({ type: "qualitative_ppt", title: (script.title || analysis.title || "定性研究报告").replace(/PPT\s*脚本/gi, "PPT"), content: JSON.stringify(metadata, null, 2), parent_artifact_id: previous?.id || undefined }) });
    await Promise.all([loadArtifacts(), loadFiles({ poll: false })]);
    const artifact = created.artifact || created; state.selectedArtifactId = artifact.id;
    renderArtifactDetail(state.artifacts.find((item) => item.id === artifact.id) || artifact);
    downloadBlob(rendered.filename || "定性研究报告.pptx", blob);
    notify(`Tech Blue V2 定性报告 PPT V${artifact.version || 1} 已生成：${rendered.slide_count} 页，Render LLM Token = ${rendered.llm_tokens || 0}。`, "success");
  } catch (error) { notify(error.message, "error"); }
  finally { setBusy(button, false); }
}

function renderQualitativePpt(detail, artifact, metadata) {
  const gate = metadata.quality_gate || {}; const gateText = gate.status === "passed" ? `OfficeCLI ${gate.version || ""} 已通过` : gate.status === "unavailable" ? "OfficeCLI 未安装（已显式记录）" : gate.status === "skipped" ? "OfficeCLI 校验已关闭" : gate.status === "error" ? "OfficeCLI 校验执行异常" : "历史版本未记录 OfficeCLI 校验";
  const adaptation = metadata.layout_adaptations || {}; const adaptationText = adaptation.continuation_page_count ? ` · 自适应续页：${adaptation.continuation_page_count} 页` : "";
  const variantUsage = Object.entries(adaptation.variant_usage || {}).map(([variant, count]) => `${QUALITATIVE_LAYOUT_LABELS[variant] || variant} × ${count}`).join(" · ");
  const summary = node("section", "research-ppt-script-summary", ""); summary.append(node("strong", "", `${metadata.slide_count || 0} 页 · 原生可编辑 PPTX`), node("p", "", `模板：${metadata.template_id === QUALITATIVE_TEMPLATE_ID ? "Tech Blue V2" : metadata.template_id || "历史模板"} · 渲染器：${metadata.renderer?.engine || "python-pptx"} · ${gateText}${adaptationText} · Render LLM Token：${metadata.render_llm_tokens || 0} · 验证问题：${metadata.validation?.issue_count || 0} · 全页图片：${metadata.object_counts?.full_slide_images || 0}`)); if (variantUsage) summary.appendChild(node("p", "research-ppt-layout-coverage", `版式覆盖：${variantUsage}`)); detail.appendChild(summary);
  const file = state.files.find((item) => item.id === metadata.file_id); const actions = node("div", "research-ppt-script-toolbar", "");
  if (file) { const download = node("button", "primary-btn", "下载可编辑 PPTX"); download.type = "button"; download.addEventListener("click", () => downloadResearchFile(file)); actions.appendChild(download); }
  const script = state.artifacts.find((item) => item.id === metadata.source_ppt_script); if (script) { const rerender = node("button", "secondary-btn", "基于当前 Script 重新渲染"); rerender.type = "button"; rerender.addEventListener("click", () => openQualitativePptPreview(script, rerender)); actions.appendChild(rerender); }
  detail.appendChild(actions);
}
async function editPptScriptPage(artifact, script, page) { const title = window.prompt("页面标题", page.title || ""); if (title == null) return; const purpose = window.prompt("Page Purpose", page.purpose || ""); if (purpose == null) return; const keyMessage = window.prompt("Key Message", page.key_message || ""); if (keyMessage == null) return; const visual = window.prompt("Visual Type", page.visual_spec?.type || "text_summary"); if (visual == null) return; const allowedVisuals = ["bar_chart", "line_chart", "stacked_bar", "matrix", "journey", "funnel", "table", "quote", "comparison", "process", "framework", "timeline", "pyramid", "text_summary", "none"]; if (!allowedVisuals.includes(visual.trim() || "text_summary")) { notify("Visual Type 不在允许列表中。", "error"); return; } const layout = window.prompt("Layout Spec", page.layout_spec?.composition || ""); if (layout == null) return; const evidenceIds = window.prompt("Evidence IDs（逗号分隔）", (page.evidence_ids || []).join(",")); if (evidenceIds == null) return; const next = JSON.parse(JSON.stringify(script)); const target = next.pages.find((item) => item.id === page.id); Object.assign(target, { title: title.trim(), purpose: purpose.trim(), key_message: keyMessage.trim(), evidence_ids: evidenceIds.split(/[,，\s]+/).filter(Boolean), visual_spec: { ...(target.visual_spec || {}), type: visual.trim() || "text_summary" }, layout_spec: { ...(target.layout_spec || {}), composition: layout.trim() }, updated_at: new Date().toISOString() }); await savePptScriptVersion(artifact, next, "页面修改已保存为"); }
async function movePptScriptPage(artifact, script, index, direction) { const target = index + direction; if (target < 0 || target >= script.pages.length) return; const next = JSON.parse(JSON.stringify(script)); [next.pages[index], next.pages[target]] = [next.pages[target], next.pages[index]]; await savePptScriptVersion(artifact, next, "页面顺序已保存为"); }
async function deletePptScriptPage(artifact, script, page) { if (!window.confirm(`删除 P${page.page_number}“${page.title}”并生成新版本吗？`)) return; const next = JSON.parse(JSON.stringify(script)); next.pages = next.pages.filter((item) => item.id !== page.id); await savePptScriptVersion(artifact, next, "删除结果已保存为"); }
async function addPptScriptPage(artifact, script) { const title = window.prompt("新页面结论标题", ""); if (!title?.trim()) return; const next = JSON.parse(JSON.stringify(script)); const timestamp = new Date().toISOString(); next.pages.push({ id: globalThis.crypto?.randomUUID?.() || `page_${Date.now()}`, page_number: next.pages.length + 1, chapter: next.pages.at(-1)?.chapter || "补充页面", page_type: "qualitative_insight", title: title.trim(), subtitle: "", purpose: "说明该页面在报告中的作用", key_message: title.trim(), insight_id: "", theme_ids: [], supporting_findings: [], supporting_points: [], content_structure: [], data_points: [], quotes: [], visual_spec: { type: "text_summary", description: "待编辑", evidence_ids: [] }, layout_spec: { composition: "单页结论与支撑信息", regions: [] }, evidence_ids: [], transcript_segment_ids: [], source_notes: "", transition_from_previous: "", transition_to_next: "", transition: "", finding_refs: [], recommendation_priority: "", evidence_status: "needs_supplement", evidence_coverage: { evidence_count: 0, types: [] }, density: { character_count: title.length, module_count: 0, title_length: title.length, status: "balanced", recommendation: "" }, created_at: timestamp, updated_at: timestamp }); await savePptScriptVersion(artifact, next, "新页面已保存为"); }
function renderPptScript(detail, artifact, script) {
  const summary = node("section", "research-ppt-script-summary", ""); const quality = script.quality || {};
  summary.append(node("strong", "", (script.pages?.length || 0) + " 页 · " + (quality.evidence_sufficient_count || 0) + " 页证据充分 · " + (quality.evidence_gap_count || 0) + " 页待补充"), node("p", "", "Based on：Report Outline V" + (script.source_report_outline_version || "—") + " · Style：" + (script.style_profile?.id || "research_consulting") + " · " + (script.style_profile?.aspect_ratio || "16:9"))); detail.appendChild(summary);
  const toolbar = node("div", "research-ppt-script-toolbar", ""); const generate = node("button", "primary-btn", "生成定性报告PPT"); generate.type = "button"; generate.addEventListener("click", () => openQualitativePptPreview(artifact, generate)); const add = node("button", "secondary-btn", "＋ 新增页面"); add.type = "button"; add.addEventListener("click", () => addPptScriptPage(artifact, script)); toolbar.append(generate, add); detail.appendChild(toolbar);
  const pages = node("section", "research-ppt-script-pages", "");
  (script.pages || []).forEach((page, index) => {
    const card = node("article", "research-ppt-script-page density-" + (page.density?.status || "balanced"), ""); const head = node("div", "research-ppt-script-page-head", "");
    head.append(node("span", "research-outline-page-no", "P" + String(page.page_number || index + 1).padStart(2, "0")), node("span", "research-ppt-script-type", page.page_type || "data_insight"), node("strong", "", page.title));
    const actions = node("div", "research-ppt-script-page-actions", ""); [["↑", () => movePptScriptPage(artifact, script, index, -1)], ["↓", () => movePptScriptPage(artifact, script, index, 1)], ["编辑", () => editPptScriptPage(artifact, script, page)], ["让 AI 优化此页", () => revisePptScriptPage(artifact, page)], ["删除", () => deletePptScriptPage(artifact, script, page)]].forEach(([label, action]) => { const button = node("button", "ghost-btn", label); button.type = "button"; button.addEventListener("click", action); actions.appendChild(button); }); head.appendChild(actions); card.appendChild(head);
    card.append(node("p", "research-ppt-script-purpose", "Purpose：" + (page.purpose || "待补充")), node("p", "research-ppt-script-message", "Key Message：" + (page.key_message || "待补充"))); if (page.subtitle) card.appendChild(node("p", "", page.subtitle));
    const specs = node("div", "research-ppt-script-specs", ""); specs.append(node("small", "", "Visual：" + (page.visual_spec?.type || "text_summary") + " · " + (page.visual_spec?.description || "")), node("small", "", "Layout：" + (page.layout_spec?.composition || "待补充")), node("small", page.density?.status === "overloaded" ? "warning" : "", "Density：" + (page.density?.status || "balanced") + (page.density?.recommendation ? " · " + page.density.recommendation : ""))); card.appendChild(specs);
    if (page.content_structure?.length) { const content = node("div", "research-ppt-script-content", ""); page.content_structure.forEach((block) => { const item = node("section", "", ""); item.append(node("strong", "", (block.region || "区域") + (block.width ? " " + block.width : "") + (block.title ? " · " + block.title : "")), node("p", "", block.body || (block.items || []).join("；"))); content.appendChild(item); }); card.appendChild(content); }
    if (page.data_points?.length) card.appendChild(node("p", "research-ppt-script-data", "数据：" + page.data_points.map((item) => item.label + "=" + item.value + (item.unit || "")).join("；")));
    (page.quotes || []).forEach((quote) => card.append(node("blockquote", "research-ppt-script-quote", "“" + quote.text + "”"), node("small", "", (quote.source_label || "访谈") + " · " + quote.segment_id)));
    card.appendChild(node("small", "research-outline-evidence-status status-" + page.evidence_status, (EVIDENCE_STATUS_LABELS[page.evidence_status] || (page.evidence_status === "not_required" ? "— 无需证据" : "△ 证据一般")) + " · " + (page.evidence_ids || []).length + " 条 Evidence")); appendOutlineEvidence(card, page.evidence_ids);
    if (page.transition_from_previous || page.transition_to_next) card.appendChild(node("p", "research-outline-transition", (page.transition_from_previous ? "From：" + page.transition_from_previous : "") + (page.transition_from_previous && page.transition_to_next ? "\n" : "") + (page.transition_to_next ? "To：" + page.transition_to_next : "")));
    pages.appendChild(card);
  }); detail.appendChild(pages);
  if (script.evidence_gaps?.length || script.validation_issues?.length) { const issues = node("section", "research-outline-section", ""); issues.appendChild(node("h5", "", "脚本检查与 Evidence Gap")); [...(script.evidence_gaps || []), ...(script.validation_issues || [])].slice(0, 40).forEach((item) => issues.appendChild(node("p", "research-outline-gap", "! " + (item.claim || item.message || item.reason)))); detail.appendChild(issues); }
}
function renderArtifactDetail(artifact) {
  const detail = $("#researchArtifactDetail"); detail.replaceChildren(); detail.hidden = !artifact; if (!artifact) return;
  const head = node("div", "research-artifact-detail-head", ""); head.append(node("strong", "", artifact.title), node("span", "", artifactLabel(artifact) + " · V" + (artifact.version || 1))); const close = node("button", "ghost-btn", "关闭"); close.type = "button"; close.addEventListener("click", () => renderArtifactDetail(null)); head.appendChild(close);
  const actions = node("div", "research-artifact-detail-actions", ""); if (artifact.type !== "qualitative_ppt") { const derive = node("button", "secondary-btn", artifact.type === "report_outline" && artifact.has_new_evidence ? "基于最新证据更新报告大纲" : "基于此版本派生"); derive.type = "button"; derive.addEventListener("click", () => selectArtifact(artifact)); actions.appendChild(derive); } if (!["ppt_script", "qualitative_ppt"].includes(artifact.type)) { const exportBtn = node("button", "ghost-btn", "导出 Word"); exportBtn.type = "button"; exportBtn.addEventListener("click", () => exportWord(artifact.content || "", artifact.title || "AI研究成果")); actions.appendChild(exportBtn); }
  if (artifact.type === "qualitative_analysis") { const generate = node("button", "primary-btn", "生成定性报告PPT"); generate.type = "button"; generate.addEventListener("click", () => openQualitativePptPreview(artifact, generate)); actions.prepend(generate); }
  if (artifact.type === "report_outline") { const script = node("button", "primary-btn", "生成 PPT 脚本"); script.type = "button"; script.addEventListener("click", () => startPptScript(artifact)); actions.prepend(script); }
  if (artifact.parent_artifact_id) { const compare = node("button", "ghost-btn", "与父版本对比"); compare.type = "button"; compare.addEventListener("click", () => compareArtifact(artifact)); actions.appendChild(compare); }
  detail.append(head, actions); const outline = parsedOutline(artifact); const pptScript = parsedPptScript(artifact); const qualitativePpt = parsedQualitativePpt(artifact); if (outline) renderReportOutline(detail, artifact, outline); else if (pptScript) renderPptScript(detail, artifact, pptScript); else if (qualitativePpt) renderQualitativePpt(detail, artifact, qualitativePpt); else detail.appendChild(node("pre", "", artifact.content || ""));
  const evidence = state.evidence.filter((item) => item.value?.artifact_id === artifact.id); if (!outline && !pptScript && evidence.length) { const section = node("section", "research-evidence-list", ""); section.appendChild(node("strong", "", "原声证据（" + evidence.length + "）")); evidence.forEach((item) => { const card = node("article", "research-evidence-card", ""); card.append(node("blockquote", "", "“" + (item.value?.quote || "") + "”"), node("small", "", (item.value?.transcript_title || "访谈") + (item.value?.respondent_label ? " · " + item.value.respondent_label : ""))); const view = node("button", "ghost-btn", "查看原文上下文"); view.type = "button"; view.addEventListener("click", () => showEvidenceContext(item, card)); card.appendChild(view); section.appendChild(card); }); detail.appendChild(section); }
}
function renderArtifacts() { const list = $("#researchArtifactList"); $("#researchArtifactCount").textContent = `${state.artifacts.length} 项`; list.replaceChildren(); if (!state.artifacts.length) { list.appendChild(node("p", "research-empty-copy", "AI 回复可保存为调研方案、问卷或访谈大纲。")); renderContextChips(); return; } state.artifacts.forEach((artifact) => { const card = node("article", `research-artifact-card${state.selectedArtifactId === artifact.id ? " selected" : ""}`, ""); const meta = node("div", "research-artifact-meta", ""); meta.append(node("span", "", artifactLabel(artifact)), node("strong", "", `V${artifact.version || 1}`)); card.append(meta, node("h5", "", artifact.title || artifactLabel(artifact))); if (artifact.freshness?.status && artifact.freshness.status !== "current") card.append(node("p", "research-artifact-freshness", `${artifact.freshness.label || "待更新"}：来源证据或上游成果已变化，旧版本保留，可基于此版本派生更新。`)); if (artifact.parent_artifact_id) card.append(node("small", "research-version-parent", artifact.type === "ppt_script" ? "基于上一版 PPT Script 生成" : "基于上一版本生成")); const actions = node("div", "research-artifact-actions", ""); const entries = [["查看", () => renderArtifactDetail(artifact)], ["基于此版本派生", () => selectArtifact(artifact)], ["重命名", () => renameArtifact(artifact)], ["删除", () => deleteArtifact(artifact)]]; if (artifact.type === "report_outline") entries.splice(1, 0, ["生成 PPT 脚本", () => startPptScript(artifact)]); if (["qualitative_analysis", "ppt_script"].includes(artifact.type)) entries.splice(1, 0, ["生成定性报告PPT", () => openQualitativePptPreview(artifact)]); if (artifact.type === "qualitative_ppt") entries.splice(1, 1); entries.forEach(([label, action], index) => { const button = node("button", label.includes("生成") || index === 1 ? "secondary-btn" : "ghost-btn", label); button.type = "button"; button.addEventListener("click", action); actions.appendChild(button); }); card.appendChild(actions); list.appendChild(card); }); renderContextChips(); }
async function compareArtifact(artifact) { const detail = $("#researchArtifactDetail"); try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/artifacts/${encodeURIComponent(artifact.id)}/compare`); const comparison = result.comparison; const panel = node("section", "research-artifact-diff", ""); panel.append(node("strong", "", `V${comparison.base.version} → V${comparison.target.version}：新增 ${comparison.summary.added} 行，删除 ${comparison.summary.removed} 行`)); const changes = node("pre", "", ""); changes.replaceChildren(...comparison.changes.filter((change) => change.type !== "unchanged").slice(0, 160).map((change) => node("span", change.type, `${change.type === "added" ? "+" : "−"} ${change.text}\n`))); panel.appendChild(changes); detail.querySelector(".research-artifact-diff")?.remove(); detail.appendChild(panel); } catch (error) { notify(error.message, "error"); } }
async function loadArtifacts() { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/artifacts`); state.artifacts = result.artifacts || []; if (state.selectedArtifactId && !state.artifacts.some((artifact) => artifact.id === state.selectedArtifactId)) state.selectedArtifactId = null; renderArtifacts(); await loadReadiness(); }

const WORKFLOW_STATUS_LABELS = { pending: "等待开始", running: "执行中", waiting_input: "等待补充", completed: "已完成", failed: "执行失败" };
function renderWorkflow(workflow = state.activeWorkflow) {
  const panel = $("#researchWorkflowPanel"); if (!panel) return; state.activeWorkflow = workflow || null; panel.hidden = !workflow; if (!workflow) return;
  $("#researchWorkflowTitle").textContent = workflow.task_type === "research_plan" ? "调研方案工作流" : workflow.task_type === "data_analysis" ? "数据分析工作流" : workflow.task_type === "qualitative_analysis" ? "多访谈定性分析工作流" : workflow.task_type === "transcript_correction" ? "笔录校正工作流" : workflow.task_type === "report_storyline" ? "报告大纲工作流" : workflow.task_type === "ppt_script" ? "PPT 脚本工作流" : "研究工作流";
  const status = $("#researchWorkflowStatus"); status.textContent = WORKFLOW_STATUS_LABELS[workflow.status] || workflow.status || "执行中"; status.className = `research-workflow-status ${workflow.status || "running"}`;
  const currentArtifact = state.artifacts.find((item) => item.id === (workflow.artifact_id || workflow.parent_artifact_id)); const current = $("#researchCurrentArtifact"); current.hidden = !currentArtifact; current.textContent = currentArtifact ? `当前正在编辑：${currentArtifact.title} V${currentArtifact.version}` : "";
  const list = $("#researchWorkflowSteps"); list.replaceChildren(); const stages = workflow.stages?.length ? workflow.stages : [{ id: workflow.stage || "understanding", label: workflow.label || "正在理解项目需求", status: workflow.status === "completed" ? "completed" : workflow.status === "waiting_input" ? "waiting_input" : "running" }];
  stages.forEach((stage) => list.appendChild(node("li", stage.status || "pending", stage.label || stage.id)));
}
async function loadWorkflows() { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/workflows`); state.workflows = result.workflows || []; state.activeWorkflow = state.workflows[0] || null; renderWorkflow(); }
function restoreActiveWorkflowArtifact() { const workflow = state.activeWorkflow; if (!workflow) return; const artifactId = workflow.artifact_id || workflow.parent_artifact_id; if (artifactId && state.artifacts.some((item) => item.id === artifactId)) { state.selectedArtifactId = artifactId; state.taskType = workflow.task_type === "data_analysis" ? "data_analysis" : workflow.task_type === "qualitative_analysis" ? "qualitative_analysis" : workflow.task_type === "report_storyline" ? "report_storyline" : workflow.task_type === "ppt_script" ? "ppt_script" : "research_plan"; } if (workflow.task_type === "data_analysis" && workflow.constraints?.dataset_id && state.datasets.some((item) => item.id === workflow.constraints.dataset_id)) state.selectedDatasetId = workflow.constraints.dataset_id; renderWorkflow(workflow); renderArtifacts(); renderDatasets(); }

function fileStatus(file) { return PARSE_LABELS[file.parse_status] || file.parse_status || "未知状态"; }
function renderFiles() { const list = $("#researchFileList"); $("#researchFileCount").textContent = `${state.files.length} 个文件`; list.replaceChildren(); if (!state.files.length) list.appendChild(node("p", "research-empty-copy", "还没有项目文件。上传后可按需加入 AI 上下文。")); state.files.forEach((file) => { const button = node("button", `research-file-item status-${file.parse_status}${state.selectedFileIds.has(file.id) ? " selected" : ""}`, ""); button.type = "button"; const copy = node("span", "research-file-item-copy", ""); copy.append(node("strong", "", file.file_name), node("small", "", `${FILE_CATEGORY_LABELS[file.category] || "其他"} · ${formatBytes(file.file_size)}`)); button.append(copy, node("span", "research-file-status", fileStatus(file))); button.addEventListener("click", () => openFile(file.id)); list.appendChild(button); }); renderContextChips(); }
async function loadFiles({ poll = true } = {}) { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/files`); state.files = result.files || []; for (const id of [...state.selectedFileIds]) if (!state.files.some((file) => file.id === id)) state.selectedFileIds.delete(id); renderFiles(); await loadTranscripts().catch(() => {}); if (poll && state.files.some((file) => ["pending", "processing"].includes(file.parse_status) || file.ocr_status === "processing")) { const token = ++state.pollToken; setTimeout(() => { if (state.project && token === state.pollToken) loadFiles({ poll: true }).catch(() => {}); }, 1200); } }
function summaryStatusLabel(transcript) { return transcript.summary_status === "ready" && transcript.deep_summary && transcript.summary_source_fingerprint === transcript.source_fingerprint ? "深度摘要已缓存" : transcript.summary_status === "processing" ? "深度摘要生成中" : transcript.summary_status === "failed" ? "深度摘要失败" : "仅结构摘要"; }
function renderTranscripts() { const list = $("#researchTranscriptList"); if (!list) return; $("#researchTranscriptCount").textContent = `${state.transcripts.length} 份访谈`; const batch = $("#researchGenerateTranscriptSummaries"); if (batch) batch.disabled = !state.transcripts.some((item) => item.status === "ready" && item.summary_status !== "ready"); list.replaceChildren(); if (!state.transcripts.length) { list.appendChild(node("p", "research-empty-copy", "把文件分类设为“访谈笔录”后，将在这里建立可检索的原声索引。")); return; } state.transcripts.forEach((transcript) => { const file = state.files.find((item) => item.id === transcript.file_id); const card = node("button", `research-transcript-item status-${transcript.status} summary-${transcript.summary_status || "pending"}`, ""); card.type = "button"; card.append(node("strong", "", transcript.respondent_label || transcript.title), node("span", "research-transcript-status", transcript.status === "ready" ? "可分析" : transcript.status === "failed" ? "解析失败" : "处理中"), node("small", "", `${({ consumer: "消费者", expert: "专家", internal: "内部人员", other: "其他" })[transcript.interview_type] || "其他"} · ${transcript.segment_count || 0} 个 Segment · ${summaryStatusLabel(transcript)}`)); if (file) card.addEventListener("click", () => openFile(file.id)); list.appendChild(card); }); }
async function loadTranscripts({ poll = true } = {}) { if (!state.project) return; const result = await api(`/projects/${encodeURIComponent(state.project.id)}/transcripts`); state.transcripts = result.transcripts || []; if (state.activeFileId) state.activeTranscript = state.transcripts.find((item) => item.file_id === state.activeFileId) || null; renderTranscripts(); if (state.activeTranscript) renderActiveTranscriptSummary(); if (poll && state.transcripts.some((item) => item.summary_status === "processing")) { const token = ++state.summaryPollToken; setTimeout(() => { if (state.project && token === state.summaryPollToken) loadTranscripts({ poll: true }).catch(() => {}); }, 2_000); } }
async function loadEvidence() { if (!state.project) return; const result = await api(`/projects/${encodeURIComponent(state.project.id)}/evidence`); state.evidence = result.evidence || []; }
async function loadInsights() { if (!state.project) return; const result = await api(`/projects/${encodeURIComponent(state.project.id)}/insights`); state.insights = result.insights || []; }
async function showEvidenceDetail(evidence, card) { if (evidence.source_type === "transcript_segment" && evidence.value?.transcript_id) return showEvidenceContext(evidence, card); const existing = card.querySelector(".research-evidence-context"); if (existing) { existing.remove(); return; } try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/evidence/${encodeURIComponent(evidence.id)}`); const context = node("div", "research-evidence-context", ""); context.append(node("p", "", result.evidence?.claim || evidence.claim), node("small", "", `来源：${result.evidence?.source_type || evidence.source_type} · ${result.evidence?.source_id || evidence.source_id}`)); const source = result.source; if (source) context.appendChild(node("pre", "research-evidence-source", JSON.stringify(source.compact_result || source.result || source, null, 2).slice(0, 8_000))); else context.appendChild(node("p", "research-empty-copy", "来源记录当前不可展开，但 Evidence ID 与来源 ID 已保留。")); card.appendChild(context); } catch (error) { notify(error.message, "error"); } }
async function showEvidenceContext(evidence, card) { const transcriptId = evidence.value?.transcript_id; const segmentId = evidence.value?.segment_id || evidence.source_id; if (!transcriptId || !segmentId) return; const existing = card.querySelector(".research-evidence-context"); if (existing) { existing.remove(); return; } try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/transcripts/${encodeURIComponent(transcriptId)}/segments/${encodeURIComponent(segmentId)}?before=2&after=2`); const context = node("div", "research-evidence-context", ""); if (result.context?.quote_source_version) context.appendChild(node("small", "research-evidence-version", `引用版本：${result.context.quote_source_version}${result.context.warning ? ` · ${result.context.warning}` : ""}`)); (result.context?.segments || []).forEach((segment) => { const paragraph = node("p", segment.is_target ? "target" : "", `${segment.speaker || "片段"}：${segment.content}`); context.appendChild(paragraph); if (segment.is_target && segment.raw_content && segment.raw_content !== segment.content) { const raw = document.createElement("details"); raw.append(node("summary", "", "查看 Raw 原文"), node("p", "research-evidence-raw", segment.raw_content)); context.appendChild(raw); } }); card.appendChild(context); } catch (error) { notify(error.message, "error"); } }
function renderDatasets() { const list = $("#researchDatasetList"); if (!list) return; $("#researchDatasetCount").textContent = `${state.datasets.length} 个版本`; list.replaceChildren(); if (!state.datasets.length) list.appendChild(node("p", "research-empty-copy", "还没有数据集。请上传 SAV、XLSX 或 CSV 原始数据。")); state.datasets.forEach((dataset) => { const button = node("button", `research-dataset-item kind-${dataset.type}${state.selectedDatasetId === dataset.id ? " selected" : ""}`, ""); button.type = "button"; button.append(node("strong", "", dataset.name || "未命名数据集"), node("span", "research-dataset-kind", dataset.type), node("small", "", `${dataset.row_count} 样本 × ${dataset.column_count} 字段${dataset.parent_dataset_id ? " · 派生版本" : " · 原始版本"}`)); button.addEventListener("click", () => { state.selectedDatasetId = dataset.id; renderDatasets(); }); const info = state.readiness?.datasets?.find(d => d.dataset_id === dataset.id) || dataset.explanation || datasetExplanation(dataset); const details = node('span', 'research-dataset-explanation', ''); details.append(node('small', '', `${info.weight_label} · ${info.convergence_label}`), node('small', '', `Sheet：${info.sheet_name || '未记录'} · 来源版本：${info.parent_version || '原始版本'}`), node('small', '', info.missing_policy), node('small', '', info.base_note)); if(info.effective_n != null)details.append(node('small', '', `加权有效样本量：${info.effective_n}`)); for(const base of info.bases || [])details.append(node('small', '', `${base.variable} · 有效 base：${base.base ?? '未记录'}`)); button.append(details); list.appendChild(button); }); const disabled = !state.selectedDatasetId; if ($("#researchProfileDataset")) $("#researchProfileDataset").disabled = disabled; if ($("#researchWeightDataset")) $("#researchWeightDataset").disabled = disabled || state.datasets.find((item) => item.id === state.selectedDatasetId)?.type === "weighted"; if ($("#researchAnalyzeDataset")) $("#researchAnalyzeDataset").disabled = disabled; if ($("#researchExportCrosstabs")) $("#researchExportCrosstabs").disabled = disabled; }
async function loadDatasets() { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/datasets`); state.datasets = result.datasets || []; if (!state.datasets.some((item) => item.id === state.selectedDatasetId)) state.selectedDatasetId = state.datasets[0]?.id || null; renderDatasets(); await loadReadiness(); }
async function uploadDataset(file) { if (!file || !state.project) return; const button = $("#researchUploadDataset"); setBusy(button, true, "上传中…"); try { const lowerName = file.name.toLowerCase(); const fallbackType = lowerName.endsWith(".csv") ? "text/csv" : lowerName.endsWith(".sav") ? "application/x-spss-sav" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; const uploaded = await api(`/projects/${encodeURIComponent(state.project.id)}/files`, { method: "POST", headers: { "Content-Type": file.type || fallbackType, "X-Research-File-Name": encodeURIComponent(file.name), "X-Research-File-Category": "data" }, body: file }); const created = await api(`/projects/${encodeURIComponent(state.project.id)}/datasets`, { method: "POST", body: jsonBody({ file_id: uploaded.file.id, name: file.name.replace(/\.(xlsx|csv|sav)$/i, "") }) }); state.selectedDatasetId = created.dataset.id; await Promise.all([loadFiles({ poll: false }), loadDatasets()]); notify(`原始数据集已登记：${created.dataset.row_count} 样本 × ${created.dataset.column_count} 字段。`, "success"); } catch (error) { notify(error.message, "error"); } finally { $("#researchDatasetInput").value = ""; setBusy(button, false); } }
let dataJobsPoll = 0;
const dataJobStates = new Map();
function dataJobError(job) {
  if (!job.error) return '';
  const messages = {DATA_JOB_LEASE_EXPIRED:'执行中断，可重试',DATA_JOB_LEGACY_INTERRUPTED:'此前执行中断，可重试',DATA_JOB_TIMEOUT:'执行超时，可重试',DATA_JOB_STORAGE_INCOMPLETE:'文件写入不完整，可重试',ENOENT:'源文件缺失，请恢复后重试',DATASET_FILE_NOT_FOUND:'源文件缺失，请恢复后重试',DATASET_SOURCE_CHANGED:'源文件版本已改变，请重新上传',FIELD_NOT_FOUND:'所选字段不存在，请检查参数',WEIGHT_TARGETS_REQUIRED:'缺少目标分布，请补充参数'};
  return messages[job.error] || '任务未完成，请检查输入后重试';
}
async function loadDataJobs(projectId = state.project?.id) {
  if (!projectId) return;
  const response = await api(`/projects/${encodeURIComponent(projectId)}/data-jobs`);
  if (state.project?.id !== projectId) return;
  let panel = $('#researchDataJobs');
  if (!panel) { panel = node('section', 'research-data-jobs', ''); panel.id = 'researchDataJobs'; panel.setAttribute('aria-label', '数据任务'); $('#researchDatasetList')?.after(panel); }
  panel.replaceChildren();
  const completedNow = (response.jobs || []).some((job) => ['pending','running'].includes(dataJobStates.get(`${projectId}:${job.id}`)) && job.status === 'completed');
  for (const job of response.jobs || []) dataJobStates.set(`${projectId}:${job.id}`,job.status);
  if (completedNow) await Promise.all([loadDatasets(),loadToolResults(),loadFiles({poll:false}),loadEvidence()]);
  const toolNames = {data_profile:'数据检查',data_clean:'数据清洗',data_weight:'数据加权',crosstab:'交叉分析'};
  const labels = { pending: '等待处理', running: '正在处理', completed: '已完成', failed: '失败，可重试', cancelled: '已取消' };
  for (const job of (response.jobs || []).slice(0, 20)) {
    const row = node('div', 'research-data-job', '');
    row.append(node('span', '', `${toolNames[job.tool_id] || job.tool_id} · ${labels[job.status] || job.status}${job.error ? ` · ${dataJobError(job)}` : ''}`));
    for (const [action, label, enabled] of [['retry', '重试', job.retryable], ['cancel', '取消', job.cancellable]]) if (enabled) {
      const button = node('button', '', label); button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await api(`/projects/${encodeURIComponent(projectId)}/data-jobs/${encodeURIComponent(job.id)}/${action}`, { method: 'POST', body: jsonBody({}) }); await loadDataJobs(projectId); }
        catch (error) { notify(error.message, 'error'); button.disabled = false; }
      }); row.append(button);
    }
    panel.append(row);
  }
  clearTimeout(dataJobsPoll);
  if ((response.jobs || []).some((job) => ['pending','running'].includes(job.status))) dataJobsPoll = setTimeout(() => {
    if (state.project?.id === projectId) loadDataJobs(projectId).catch(() => notify('任务状态连接中断，点击重新连接。', 'info', () => loadDataJobs(projectId)));
  }, 2000);
}
async function waitDataJob(job) {
  const projectId = job.project_id || state.project.id;
  let current = job;
  for (let attempt = 0; attempt < 360; attempt += 1) {
    if (state.project?.id !== projectId) throw new Error('任务继续在原项目中处理。');
    if (current.status === 'completed') { await loadDataJobs(projectId); return current.result || {}; }
    if (['failed','cancelled'].includes(current.status)) { await loadDataJobs(projectId); throw Object.assign(new Error(dataJobError(current) || (current.status === 'cancelled' ? '任务已取消。' : '任务失败，请在任务列表重试。')), {cancelled:current.status === 'cancelled'}); }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try { current = (await api(`/projects/${encodeURIComponent(projectId)}/data-jobs/${encodeURIComponent(current.id)}`)).job; }
    catch { throw new Error('连接中断，任务状态已保存。重新打开项目可查看或重试。'); }
  }
  throw new Error('任务仍在处理中，可在任务列表查看进度。');
}
async function profileSelectedDataset() {
  const dataset = state.datasets.find((item) => item.id === state.selectedDatasetId); if (!dataset) return;
  const projectId = state.project.id, storageKey = `research-data-profile:${projectId}:${dataset.id}`;
  const requestKey = sessionStorage.getItem(storageKey) || crypto.randomUUID(); sessionStorage.setItem(storageKey, requestKey);
  const button = $('#researchProfileDataset'); setBusy(button, true, '检查中…');
  try {
    let result = await api(`/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(dataset.id)}/profile`, { method:'POST', body:jsonBody({ async:true, idempotency_key:requestKey }) });
    await loadDataJobs(projectId);
    if (result.job) result = await waitDataJob(result.job);
    sessionStorage.removeItem(storageKey);
    if (state.project?.id !== projectId) return;
    await loadToolResults(); const data = result.data || {};
    notify(`数据检查完成：${data.sample_size ?? dataset.row_count} 样本、${data.variables ?? dataset.column_count} 字段，发现 ${(data.issues || []).length} 项提示。`, 'success');
  } catch (error) { if(error.cancelled) sessionStorage.removeItem(storageKey); notify(error.message, 'error'); } finally { setBusy(button, false); }
}
function startDatasetAnalysis() { if (!state.selectedDatasetId) { notify("请先上传并选择数据集。", "info"); return; } state.taskType = "data_analysis"; state.selectedFileIds = new Set([...state.selectedFileIds].filter((id) => state.files.find((file) => file.id === id)?.category !== "data")); state.autoRetrieve = true; $("#researchChatInput").value = "请先检查当前数据集质量，再围绕项目目标设计最小必要的交叉分析并形成有证据的分析成果。"; setMobileTab("chat"); $("#researchChatInput").focus(); }
async function exportSelectedDatasetCrosstabs() { const dataset = state.datasets.find((item) => item.id === state.selectedDatasetId); if (!dataset) { notify("请先选择数据集。", "info"); return; } const button = $("#researchExportCrosstabs"); setBusy(button, true, "正在合并…"); try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/datasets/${encodeURIComponent(dataset.id)}/crosstab-export`, { method: "POST", body: jsonBody({}) }); downloadResearchFile(result.file); await loadFiles({ poll: false }); notify(`交叉表已导出：${result.variable_count} 个题目、${result.banner_count} 个 Banner，共 ${result.analysis_count} 张表。`, "success"); } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }
function startDatasetWeighting() { if (!state.selectedDatasetId) return; state.taskType = "data_analysis"; $("#researchChatInput").value = "请评估当前数据集是否需要加权。不要假设目标总体比例；如果项目材料没有明确目标分布，请先向我询问。获得目标分布后先展示预计权重诊断，等待我确认再执行。"; setMobileTab("chat"); $("#researchChatInput").focus(); }
function toolResultSummary(item) {
  if (item.tool_id === "sample-size") return `有效样本 ${item.result?.base ?? "-"} · 建议发放 ${item.result?.gross ?? "-"}`;
  if (item.tool_id === "quota") return `${item.result?.mode === "cross" ? "交叉" : "单一"}配额 · N=${item.result?.total_sample ?? "-"}`;
  if (item.tool_id === "questionnaire-check") return `${item.result?.summary?.errors ?? 0} 个错误 · ${item.result?.summary?.warnings ?? 0} 个提醒`;
  if (item.tool_id === "data-profile") return `${item.result?.sample_size ?? "-"} 样本 · ${item.result?.variables ?? "-"} 字段 · ${(item.result?.issues || []).length} 项提示`;
  if (item.tool_id === "data-clean") return item.result?.requires_confirmation ? `预计删除 ${item.result?.removed_rows ?? 0} 行 · 等待确认` : `${item.result?.before_rows ?? "-"} → ${item.result?.after_rows ?? "-"}`;
  if (item.tool_id === "data-weight") return item.result?.requires_confirmation ? `预计有效样本 ${item.result?.diagnostics?.effective_n ?? "-"} · 等待确认` : `已生成 Weighted Dataset · 有效样本 ${item.result?.diagnostics?.effective_n ?? "-"}`;
  if (item.tool_id === "crosstab") return `${item.result?.analyses ?? "-"} 组分析 · ${(item.result?.key_findings || []).length} 条关键差异`;
  if (item.tool_id === "transcript-search") return `${item.result?.transcript_count ?? "-"} 份访谈 · ${(item.result?.matches || []).length} 个候选 Segment`;
  if (item.tool_id === "transcript-read") return `${item.result?.segments?.length ?? "-"} 个上下文 Segment · 已回查原文`;
  return "已保存结构化结果";
}
function renderToolResults() {
  const box = $("#researchToolResultList");
  if (!box) return;
  box.replaceChildren();
  if (!state.toolResults.length) { box.appendChild(node("p", "research-empty-copy", "暂无已保存的工具结果。")); return; }
  state.toolResults.slice(0, 8).forEach((item) => {
    const card = node("article", "research-tool-result-item", "");
    const labels = { "sample-size": "样本量计算", quota: "配额设计", "questionnaire-check": "问卷质检", "data-profile": "数据结构检查", "data-clean": "数据清洗", "data-weight": "数据加权", crosstab: "交叉表分析", "transcript-search": "访谈原声检索", "transcript-read": "访谈上下文回查" };
    card.append(node("strong", "", labels[item.tool_id] || item.tool_id), node("span", "", toolResultSummary(item)), node("small", "", updatedLabel(item.created_at)));
    box.appendChild(card);
  });
}
async function loadToolResults() {
  const result = await listToolResults(state.project.id);
  state.toolResults = result.data?.results || [];
  renderToolResults();
}
function inferredFileCategory(fileName) { const name = String(fileName || ""); if (/brief|需求|项目背景|客户资料/i.test(name)) return "brief"; if (/历史|往期|研究报告|历史报告|benchmark/i.test(name)) return "historical_report"; if (/访谈|深访|座谈|逐字稿/i.test(name)) return "interview"; if (/问卷/i.test(name)) return "questionnaire"; return "other"; }
async function uploadFiles(fileList) { if (!state.project || !fileList?.length) return; const button = $("#researchUploadFile"); setBusy(button, true, "上传中…"); clearNotice(); try { for (const file of [...fileList]) await api(`/projects/${encodeURIComponent(state.project.id)}/files`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-Research-File-Name": encodeURIComponent(file.name), "X-Research-File-Category": inferredFileCategory(file.name) }, body: file }); $("#researchFileInput").value = ""; await loadFiles(); notify("文件已上传，后台正在解析。", "success"); } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }
function structureSummary(structure) { if (structure?.kind === "qualitative_summary_template") return `访谈小结模板 · ${structure.question_count || 0} 个问题 · 每页 ${structure.respondent_capacity || 0} 位受访者\n工作表：${structure.sheet_name || "未识别"}`; if (structure?.kind === "qualitative_excel_output") return `已生成 Excel 小结 · ${structure.respondent_count || 0} 位受访者 · ${structure.question_count || 0} 个问题 · ${structure.sheet_count || 1} 个工作表`; if (structure?.kind === "sav_dataset") return (structure.sheets || []).map((sheet) => { const shown = (sheet.variables || []).length || (sheet.fields || []).length; const total = sheet.variable_count || sheet.field_count || sheet.column_count || shown; const note = sheet.variables_truncated || sheet.fields_truncated ? `\n界面仅展示前 ${shown}/${total} 个变量；分析工具可按字段名或题目标签检索全部变量。` : ""; return `SPSS SAV · ${sheet.row_count} 行 × ${sheet.column_count} 列${structure.encoding ? ` · ${structure.encoding}` : ""}\n变量：${(sheet.variables || []).map((item) => item.label ? `${item.name}（${item.label}）` : item.name).join("、") || (sheet.fields || []).join("、") || "未识别"}${note}`; }).join("\n\n"); if (structure?.kind !== "xlsx_workbook") return ""; return (structure.sheets || []).map((sheet) => `${sheet.name} · ${sheet.row_count} 行 × ${sheet.column_count} 列\n字段：${(sheet.fields || []).join("、") || "未识别"}\n预览：\n${(sheet.preview_rows || []).map((row) => row.join(" | ")).join("\n") || "无"}`).join("\n\n"); }
function renderActiveTranscriptSummary() { const transcript = state.activeTranscript; if (!transcript) return; $("#researchTranscriptSummaryState").textContent = summaryStatusLabel(transcript); $("#researchTranscriptDeepSummary").textContent = transcript.deep_summary || transcript.summary_error || "尚未生成；当前分析会回退使用结构导航摘要。"; const button = $("#researchGenerateTranscriptSummary"); button.disabled = transcript.status !== "ready" || transcript.summary_status === "processing"; button.textContent = transcript.summary_status === "processing" ? "正在生成…" : transcript.summary_status === "ready" ? "重新生成深度摘要" : transcript.summary_status === "failed" ? "重试生成深度摘要" : "生成深度摘要"; }
async function openFile(fileId) { try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/files/${encodeURIComponent(fileId)}`); const file = result.file; state.activeFileId = file.id; state.activeFile = file; state.activeTranscript = state.transcripts.find((item) => item.file_id === file.id) || null; $("#researchFileDialogTitle").textContent = file.file_name; $("#researchFileDialogMeta").textContent = `${file.file_type.toUpperCase()} · ${formatBytes(file.file_size)} · ${fileStatus(file)} · ${updatedLabel(file.created_at)}`; $("#researchFileCategory").value = file.category || "other"; $("#researchFileSummary").textContent = file.summary || file.parse_note || "暂无摘要"; $("#researchFilePreview").textContent = file.preview || file.parse_note || "暂无可预览内容"; const structured = structureSummary(file.structured_data); $("#researchFileStructure").hidden = !structured; $("#researchFileStructurePreview").textContent = structured; const editor = $("#researchTranscriptEditor"); editor.hidden = !state.activeTranscript; $("#researchFileCorrectTranscript").hidden = !state.activeTranscript || state.activeTranscript.status !== "ready"; $("#researchFileReviewTranscript").hidden = !state.activeTranscript; if (state.activeTranscript) { $("#researchTranscriptType").value = state.activeTranscript.interview_type || "other"; $("#researchTranscriptLabel").value = state.activeTranscript.respondent_label || ""; $("#researchTranscriptMetadata").value = JSON.stringify(state.activeTranscript.respondent_metadata || {}, null, 2); renderActiveTranscriptSummary(); } const ocr = $("#researchFileOcr"); ocr.hidden = file.file_type !== "pdf"; ocr.disabled = file.ocr_status === "processing"; ocr.textContent = file.ocr_status === "processing" ? "OCR 处理中…" : "按需 OCR"; $("#researchFileOcrState").textContent = file.ocr_note || ""; $("#researchFileDialog").showModal(); } catch (error) { notify(error.message, "error"); } }
async function updateFileCategory() { if (!state.activeFileId) return; try { await api(`/projects/${state.project.id}/files/${state.activeFileId}`, { method: "PATCH", body: jsonBody({ category: $("#researchFileCategory").value }) }); await loadFiles({ poll: false }); } catch (error) { notify(error.message, "error"); } }
async function reparseFile() { if (!state.activeFileId) return; try { await api(`/projects/${state.project.id}/files/${state.activeFileId}/reparse`, { method: "POST", body: jsonBody({}) }); $("#researchFileDialog").close(); await loadFiles(); notify("文件已进入重新解析队列。", "success"); } catch (error) { notify(error.message, "error"); } }
async function requestOcr() { if (!state.activeFileId) return; const button = $("#researchFileOcr"); setBusy(button, true, "提交中…"); try { await api(`/projects/${state.project.id}/files/${state.activeFileId}/ocr`, { method: "POST", body: jsonBody({}) }); $("#researchFileDialog").close(); await loadFiles(); notify("PDF 已进入 OCR 队列。", "success"); } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }
async function deleteFile() { if (!state.activeFileId || !window.confirm("删除这个项目文件吗？")) return; const fileId = state.activeFileId; try { await api(`/projects/${state.project.id}/files/${fileId}`, { method: "DELETE" }); state.selectedFileIds.delete(fileId); state.activeFileId = null; $("#researchFileDialog").close(); await loadFiles({ poll: false }); notify("文件已删除。", "success"); } catch (error) { notify(error.message, "error"); } }
async function saveTranscriptMetadata(event) { event.preventDefault(); if (!state.activeTranscript) return; let metadata; try { metadata = JSON.parse($("#researchTranscriptMetadata").value.trim() || "{}"); if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") throw new Error(); } catch { notify("受访者 Metadata 必须是 JSON 对象。", "error"); return; } const button = $("#researchTranscriptSave"); setBusy(button, true, "保存中…"); try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/transcripts/${encodeURIComponent(state.activeTranscript.id)}`, { method: "PATCH", body: jsonBody({ interview_type: $("#researchTranscriptType").value, respondent_label: $("#researchTranscriptLabel").value.trim(), respondent_metadata: metadata }) }); state.activeTranscript = result.transcript; await loadTranscripts(); notify("访谈信息已保存。", "success"); } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }

async function requestTranscriptSummary(transcript, force = false) {
  const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(state.project.id)}/transcripts/${encodeURIComponent(transcript.id)}/summary`, { method: "POST", credentials: "same-origin", headers: { Accept: "text/event-stream, application/json", "Content-Type": "application/json" }, body: jsonBody({ force }) });
  if (!response.ok) throw await responseError(response);
  if ((response.headers.get("content-type") || "").includes("text/event-stream")) return (await readSseResponse(response)).result;
  const payload = await response.json(); return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}
async function generateTranscriptSummaries(targets, { force = false, button = null } = {}) {
  const queue = (targets || []).filter((item) => item?.status === "ready"); if (!queue.length) { notify("没有可生成深度摘要的访谈。", "info"); return; }
  const total = queue.length; if (button) setBusy(button, true, total > 1 ? `生成中 0/${total}` : "生成中…"); let completed = 0; const failures = [];
  const worker = async () => { while (queue.length) { const transcript = queue.shift(); transcript.summary_status = "processing"; renderTranscripts(); if (state.activeTranscript?.id === transcript.id) { state.activeTranscript = transcript; renderActiveTranscriptSummary(); } try { const result = await requestTranscriptSummary(transcript, force); if (result?.transcript) Object.assign(transcript, result.transcript); } catch (error) { failures.push({ transcript, error }); transcript.summary_status = "failed"; transcript.summary_error = error.message; } finally { completed += 1; if (button) button.textContent = total > 1 ? `生成中 ${completed}/${total}` : "生成中…"; renderTranscripts(); } } };
  try { await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker)); await loadTranscripts({ poll: false }); if (state.activeTranscript) renderActiveTranscriptSummary(); if (failures.length) notify(`${completed - failures.length} 份摘要已缓存，${failures.length} 份生成失败，可稍后重试。`, "error"); else notify(`${completed} 份单访谈深度摘要已缓存；跨访谈分析仍会回查原始 Segment。`, "success"); } finally { if (button) setBusy(button, false); renderTranscripts(); if (state.activeTranscript) renderActiveTranscriptSummary(); }
}
async function generateMissingTranscriptSummaries() { const targets = state.transcripts.filter((item) => item.status === "ready" && !(item.summary_status === "ready" && item.deep_summary && item.summary_source_fingerprint === item.source_fingerprint)); await generateTranscriptSummaries(targets, { button: $("#researchGenerateTranscriptSummaries") }); }
async function generateActiveTranscriptSummary() { if (!state.activeTranscript) return; await generateTranscriptSummaries([state.activeTranscript], { force: state.activeTranscript.summary_status === "ready", button: $("#researchGenerateTranscriptSummary") }); }

function openTranscriptCorrectionDialog(preselectedTranscriptId = "") {
  const box = $("#researchCorrectionTranscriptOptions"); box.replaceChildren();
  const ready = state.transcripts.filter((item) => item.status === "ready");
  if (!ready.length) { box.appendChild(node("p", "research-empty-copy", "暂无可校正的访谈笔录。")); $("#researchTranscriptCorrectionStart").disabled = true; }
  else { $("#researchTranscriptCorrectionStart").disabled = false; ready.forEach((transcript) => { const label = node("label", "research-context-option", ""); const input = document.createElement("input"); input.type = "checkbox"; input.value = transcript.id; input.checked = transcript.id === preselectedTranscriptId || (!preselectedTranscriptId && state.selectedFileIds.has(transcript.file_id)); label.append(input, node("span", "", `${transcript.respondent_label || transcript.title} · ${transcript.segment_count || 0} 个 Segment`)); box.appendChild(label); }); if (![...box.querySelectorAll('input[type="checkbox"]')].some((input) => input.checked)) box.querySelector('input[type="checkbox"]')?.click(); }
  $("#researchTranscriptCorrectionDialog").showModal();
}

async function requestTranscriptCorrection(body, onWorkflowStatus) {
  const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(state.project.id)}/transcript-corrections`, { method: "POST", credentials: "same-origin", headers: { Accept: "text/event-stream, application/json", "Content-Type": "application/json" }, body: jsonBody(body) });
  if (!response.ok) throw await responseError(response);
  if ((response.headers.get("content-type") || "").includes("text/event-stream")) return (await readSseResponse(response, { onWorkflowStatus })).result;
  const payload = await response.json(); return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

async function startTranscriptCorrection(event) {
  event.preventDefault(); const transcriptIds = [...document.querySelectorAll('#researchCorrectionTranscriptOptions input[type="checkbox"]:checked')].map((input) => input.value);
  if (!transcriptIds.length) { notify("请选择至少一份访谈笔录。", "info"); return; }
  const button = $("#researchTranscriptCorrectionStart"); setBusy(button, true, "校正中…"); $("#researchTranscriptCorrectionDialog").close();
  try {
    const result = await requestTranscriptCorrection({ transcript_ids: transcriptIds, correction_categories: ["typo", "asr_error", "proper_noun", "punctuation", "speaker", "duplication"], client_request_id: requestId() }, (workflow) => { state.activeWorkflow = workflow; renderWorkflow(workflow); setConnectionState(workflow.label || "正在校正笔录", workflow.status === "failed" ? "error" : "streaming"); });
    await Promise.all([loadWorkflows(), loadTranscripts({ poll: false })]);
    const first = result?.results?.[0]; const failures = result?.failures?.length || 0;
    notify(`${result?.results?.length || 0} 份笔录已生成校正版${failures ? `，${failures} 份失败` : ""}。`, failures ? "info" : "success");
    if (first?.version_id) await openTranscriptCorrectionReview("", first.version_id);
  } catch (error) { notify(error.message, "error", error.retryable ? () => startTranscriptCorrection({ preventDefault() {} }) : null); }
  finally { setBusy(button, false); setConnectionState("准备就绪", "ready"); }
}

function correctionStatusLabel(item) { return item.status === "auto_applied" ? "已自动应用" : item.status === "pending_review" ? "待复核" : item.status === "accepted" ? "已接受" : "已拒绝"; }
function reasonLabel(reason) { return ({ typo: "错别字", asr_error: "ASR/同音错误", proper_noun: "专有名词", punctuation: "标点断句", speaker: "说话人", duplication: "机械重复", other: "其他" })[reason] || reason; }

function renderTranscriptCorrectionReview(detail) {
  state.activeCorrectionDetail = detail; const { version, corrections = [], segments = [] } = detail; const transcript = state.transcripts.find((item) => item.id === version.transcript_id);
  $("#researchCorrectionReviewTitle").textContent = `${transcript?.respondent_label || transcript?.title || "访谈"} · Corrected V${version.version}`;
  $("#researchCorrectionReviewSummary").textContent = `${version.auto_applied_count || 0} 项自动应用 · ${version.pending_review_count || 0} 项待复核 · ${version.status === "confirmed" ? "已确认" : version.status === "failed" ? "生成失败" : "等待复核"}`;
  const box = $("#researchCorrectionReviewList"); box.replaceChildren();
  if (!corrections.length) box.appendChild(node("p", "research-empty-copy", "本版本没有发现需要修改的转写错误。"));
  corrections.forEach((item) => { const card = node("article", `research-correction-card status-${item.status}`, ""); const head = node("div", "research-correction-card-head", ""); head.append(node("strong", "", `${reasonLabel(item.reason)} · ${item.confidence}`), node("span", "", correctionStatusLabel(item))); const diff = node("div", "research-correction-diff", ""); const original = document.createElement("del"); original.textContent = item.original_text; const corrected = document.createElement("ins"); corrected.textContent = item.corrected_text; diff.append(original, corrected); card.append(head, diff); if (item.note) card.appendChild(node("small", "", item.note)); if (item.status === "pending_review") { const actions = node("div", "button-row", ""); const accept = node("button", "primary-btn", "接受"); const reject = node("button", "secondary-btn", "拒绝"); accept.type = reject.type = "button"; accept.addEventListener("click", () => reviewTranscriptCorrection(item.id, "accept", accept)); reject.addEventListener("click", () => reviewTranscriptCorrection(item.id, "reject", reject)); actions.append(accept, reject); card.appendChild(actions); } box.appendChild(card); });
  $("#researchCorrectionExport").disabled = !segments.length || version.status === "failed"; $("#researchTranscriptCorrectionReviewDialog").showModal();
}

async function openTranscriptCorrectionReview(transcriptId = "", versionId = "") {
  try { let target = versionId; if (!target) { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/transcript-versions?transcript_id=${encodeURIComponent(transcriptId || state.activeTranscript?.id || "")}`); state.transcriptVersions = result.versions || []; target = state.transcriptVersions.find((item) => item.type === "corrected")?.id || ""; } if (!target) { notify("这份访谈还没有校正版，请先执行笔录校正。", "info"); return; } const detail = await api(`/projects/${encodeURIComponent(state.project.id)}/transcript-versions/${encodeURIComponent(target)}`); renderTranscriptCorrectionReview(detail); } catch (error) { notify(error.message, "error"); }
}

async function reviewTranscriptCorrection(correctionId, decision, button) { setBusy(button, true, decision === "accept" ? "接受中…" : "拒绝中…"); try { await api(`/projects/${encodeURIComponent(state.project.id)}/transcript-corrections/${encodeURIComponent(correctionId)}`, { method: "PATCH", body: jsonBody({ decision }) }); const versionId = state.activeCorrectionDetail?.version?.id; if (versionId) await openTranscriptCorrectionReview("", versionId); } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }

function exportCorrectedTranscript() { const detail = state.activeCorrectionDetail; if (!detail?.segments?.length) return; const transcript = state.transcripts.find((item) => item.id === detail.version.transcript_id); const content = detail.segments.map((segment) => `**${segment.speaker || "unknown"}**\n\n${segment.content}`).join("\n\n"); exportWord(content, `${transcript?.respondent_label || transcript?.title || "访谈"}-校正版-V${detail.version.version}`); }

function renderContextChips() { const box = $("#researchContextChips"); if (!box) return; box.replaceChildren(); if (state.autoRetrieve) box.appendChild(node("span", "research-context-chip memory", "⌕ 自动检索项目记忆")); state.files.filter((file) => state.selectedFileIds.has(file.id)).forEach((file) => { const chip = node("span", "research-context-chip file", `📄 ${file.file_name}`); const remove = node("button", "", "×"); remove.type = "button"; remove.setAttribute("aria-label", `移除 ${file.file_name}`); remove.addEventListener("click", () => { state.selectedFileIds.delete(file.id); renderContextChips(); renderFiles(); }); chip.appendChild(remove); box.appendChild(chip); }); const artifact = state.artifacts.find((item) => item.id === state.selectedArtifactId); if (artifact) { const chip = node("span", "research-context-chip artifact", `📋 ${artifact.title} V${artifact.version}`); const remove = node("button", "", "×"); remove.type = "button"; remove.addEventListener("click", clearArtifactContext); chip.appendChild(remove); box.appendChild(chip); } if (!box.children.length) box.appendChild(node("span", "research-context-empty", "仅使用项目基础信息")); }
function openContextDialog() { $("#researchAutoRetrieve").checked = state.autoRetrieve; $("#researchMemoryResults").replaceChildren(node("p", "research-empty-copy", "可先检索，查看系统会匹配到哪些项目片段。")); const fileOptions = $("#researchContextFileOptions"); fileOptions.replaceChildren(); if (!state.files.length) fileOptions.appendChild(node("p", "research-empty-copy", "暂无项目文件")); state.files.forEach((file) => { const label = node("label", "research-context-option", ""); const input = document.createElement("input"); input.type = "checkbox"; input.value = file.id; input.checked = state.selectedFileIds.has(file.id); input.disabled = file.parse_status !== "completed" || file.category === "data"; label.append(input, node("span", "", file.category === "data" ? `${file.file_name} · 数据行仅通过 Data Tool 使用` : `${file.file_name} · ${fileStatus(file)}`)); fileOptions.appendChild(label); }); const artifactOptions = $("#researchContextArtifactOptions"); artifactOptions.replaceChildren(); const noneLabel = node("label", "research-context-option", ""); const none = document.createElement("input"); none.type = "radio"; none.name = "research-context-artifact"; none.value = ""; none.checked = !state.selectedArtifactId; noneLabel.append(none, node("span", "", "不使用成果")); artifactOptions.appendChild(noneLabel); state.artifacts.forEach((artifact) => { const label = node("label", "research-context-option", ""); const input = document.createElement("input"); input.type = "radio"; input.name = "research-context-artifact"; input.value = artifact.id; input.checked = state.selectedArtifactId === artifact.id; label.append(input, node("span", "", `${artifact.title} · V${artifact.version}`)); artifactOptions.appendChild(label); }); $("#researchContextDialog").showModal(); }
async function searchMemory() { const query = $("#researchMemoryQuery").value.trim(); if (!query) return; const box = $("#researchMemoryResults"); box.replaceChildren(node("p", "research-empty-copy", "检索中…")); try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/memory/search?q=${encodeURIComponent(query)}`); box.replaceChildren(); if (!result.matches?.length) box.appendChild(node("p", "research-empty-copy", "没有找到相关片段。")); for (const match of result.matches || []) { const item = node("article", "research-memory-result", ""); item.append(node("strong", "", match.file_name), node("small", "", `${match.heading || `片段 ${match.chunk_index + 1}`} · 相关度 ${Math.round(match.score)}`), node("p", "", match.content)); box.appendChild(item); } } catch (error) { box.replaceChildren(node("p", "research-empty-copy", error.message)); } }
function applyContext(event) { event.preventDefault(); state.autoRetrieve = $("#researchAutoRetrieve").checked; state.selectedFileIds = new Set([...document.querySelectorAll('#researchContextFileOptions input[type="checkbox"]:checked')].map((input) => input.value).slice(0, 8)); state.selectedArtifactId = document.querySelector('input[name="research-context-artifact"]:checked')?.value || null; state.taskType = state.selectedArtifactId ? "artifact_revision" : state.taskType; $("#researchContextDialog").close(); renderContextChips(); renderFiles(); renderArtifacts(); }

async function openProject(projectId) { clearTimeout(dataJobsPoll); clearNotice(); showMode("workspace"); setMobileTab("chat"); state.pollToken += 1; state.summaryPollToken += 1; state.selectedFileIds.clear(); state.selectedArtifactId = null; state.targetPptScriptPageId = null; state.selectedDatasetId = null; state.taskType = "free_chat"; state.workflows = []; state.activeWorkflow = null; state.transcripts = []; state.evidence = []; state.insights = []; renderWorkflow(null); try { const result = await api(`/projects/${encodeURIComponent(projectId)}`); state.project = result.project || result; state.readiness = null; fillProject(state.project); await Promise.all([loadMessages(), loadArtifacts(), loadFiles(), loadEvidence(), loadInsights(), loadDatasets(), loadDataJobs(), loadWorkflows(), loadToolResults().catch(() => { state.toolResults = []; renderToolResults(); })]); restoreActiveWorkflowArtifact(); } catch (error) { notify(error.message, "error", error.retryable ? () => openProject(projectId) : null); } }
async function createProject(event) { event.preventDefault(); const button = $("#researchCreateSubmit"); const body = { title: $("#researchCreateTitle").value.trim(), client_name: $("#researchCreateClient").value.trim(), brief: $("#researchCreateBrief").value.trim(), research_goal: $("#researchCreateGoal").value.trim(), constraints: { budget: $("#researchCreateBudget").value.trim(), timeline: $("#researchCreateTimeline").value.trim() } }; if (!body.title) return; setBusy(button, true, "创建中…"); try { const result = await api("/projects", { method: "POST", body: jsonBody(body) }); $("#researchCreateForm").reset(); await loadProjects(); await openProject((result.project || result).id); } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }
async function updateProject(event) { event.preventDefault(); const button = $("#researchSaveProject"); const body = { title: $("#researchProjectTitle").value.trim(), client_name: $("#researchProjectClient").value.trim(), brief: $("#researchProjectBrief").value.trim(), research_goal: $("#researchProjectGoal").value.trim(), constraints: { budget: $("#researchProjectBudget").value.trim(), timeline: $("#researchProjectTimeline").value.trim(), target_sample: $("#researchProjectTargetSample").value.trim(), research_method_preference: $("#researchProjectMethod").value.trim(), region_scope: $("#researchProjectRegion").value.trim(), other_constraints: $("#researchProjectOtherConstraints").value.trim() } }; setBusy(button, true, "保存中…"); try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}`, { method: "PATCH", body: jsonBody(body) }); state.project = result.project || result; state.readiness = null; fillProject(state.project); $("#researchProjectSaveState").textContent = "刚刚保存"; } catch (error) { notify(error.message, "error"); } finally { setBusy(button, false); } }
function setConnectionState(text, mode = "ready") { const badge = $("#researchConnectionState"); if (!badge) return; badge.textContent = text; badge.dataset.state = mode; }
function normalizeAssistantResult(result) { return result?.message?.role === "assistant" ? result.message : result?.reply ? { role: "assistant", content: result.reply } : null; }
function applyMessageResult(result) { const assistant = normalizeAssistantResult(result); if (assistant) { assistant.toolCalls = result?.tool_calls || []; assistant.artifactCreated = result?.artifact_created || null; assistant.generatedFile = result?.generated_file || null; } if (result?.workflow) { state.activeWorkflow = result.workflow; renderWorkflow(result.workflow); } const applied = result?.applied_context; setConnectionState(applied ? `显式 ${applied.selected_files?.length || 0} 个文件 · 检索 ${applied.retrieved_chunks?.length || 0} 个片段` : "会话已同步", "ready"); return assistant; }
function mergeAssistantResult(assistant) { if (!assistant) return; const existing = assistant.id ? state.messages.find((item) => item.id === assistant.id) : null; if (existing) { existing.toolCalls = assistant.toolCalls || []; existing.artifactCreated = assistant.artifactCreated || null; existing.generatedFile = assistant.generatedFile || null; } else state.messages.push(assistant); }
async function refreshGeneratedOutputs(result) { const tasks = []; if (result?.tool_calls?.length) { tasks.push(loadToolResults().catch(() => {})); if (result.tool_calls.some((item) => ["data_profile", "data_clean", "data_weight", "crosstab"].includes(item.tool_id))) tasks.push(loadDatasets().catch(() => {})); if (result.tool_calls.some((item) => item.tool_id === "crosstab")) tasks.push(loadFiles({ poll: false }).catch(() => {})); if (result.tool_calls.some((item) => ["transcript_search", "transcript_read"].includes(item.tool_id))) tasks.push(loadEvidence().catch(() => {})); } if (result?.artifact_created?.id) { state.selectedArtifactId = result.artifact_created.id; state.taskType = result.artifact_created.type === "research_plan" ? "research_plan" : result.artifact_created.type === "analysis" ? "data_analysis" : result.artifact_created.type === "qualitative_analysis" ? "qualitative_analysis" : result.artifact_created.type === "interview_summary" ? "interview_summary" : result.artifact_created.type === "report_outline" ? "report_storyline" : result.artifact_created.type === "ppt_script" ? "ppt_script" : state.taskType; tasks.push(loadArtifacts()); if (["qualitative_analysis", "interview_summary", "report_outline", "ppt_script"].includes(result.artifact_created.type)) tasks.push(loadEvidence(), loadInsights()); } if (result?.evidence?.length) tasks.push(loadEvidence()); if (result?.workflow?.id) tasks.push(loadWorkflows()); if (result?.generated_file?.id) tasks.push(loadFiles({ poll: false })); await Promise.all(tasks); if (result?.workflow?.id) restoreActiveWorkflowArtifact(); const created = result?.artifact_created || null; if (created?.type === "ppt_script" && state.rerenderQualitativeAfterScriptRevision) { state.rerenderQualitativeAfterScriptRevision = false; await openQualitativePptPreview(created); } return created; }
function artifactCreatedNotice(artifact) { return artifact?.type === "research_plan" ? `调研方案 V${artifact.version || 1} 已保存到项目成果。` : artifact?.type === "analysis" ? `数据分析 V${artifact.version || 1} 已保存，并保留结果证据引用。` : artifact?.type === "qualitative_analysis" ? `多访谈定性分析 V${artifact.version || 1} 已保存，原声证据可展开回查。` : artifact?.type === "report_outline" ? `报告大纲 V${artifact.version || 1} 已保存，可查看 Storyline、页面建议和 Evidence Coverage。` : artifact?.type === "ppt_script" ? `PPT 脚本 V${artifact.version || 1} 已保存，可逐页查看、排序、编辑或让 AI 优化单页。` : artifact?.type === "qualitative_summary" ? "定性小结已保存到项目成果。" : artifact?.type === "questionnaire" ? "问卷已自动保存为新版本。" : "成果已保存到项目。"; }
function streamRunId(payload) { return String(payload?.run_id || payload?.runId || payload?.id || ""); }
async function responseError(response) {
  const payload = await response.json().catch(() => ({}));
  const error = new Error(friendlyError(response.status, payload));
  error.status = response.status;
  error.retryable = Boolean(payload?.error?.retryable || [429, 502, 503, 504].includes(response.status));
  return error;
}
async function postMessage(body, { onDelta, onProgress, onToolStatus, onWorkflowStatus } = {}) {
  const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(state.project.id)}/messages`, { method: "POST", credentials: "same-origin", headers: { Accept: "text/event-stream, application/json", "Content-Type": "application/json" }, body: jsonBody(body) });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    if (!response.ok) throw await responseError(response);
    let runId = "";
    const rememberRun = (payload) => { runId ||= streamRunId(payload); };
    let read;
    try {
      read = await readSseResponse(response, { onDelta, onProgress, onToolStatus, onWorkflowStatus });
    } catch (error) {
      error.runId ||= runId;
      throw error;
    }
    read.events.forEach((event) => rememberRun(event.payload));
    return { streamed: true, result: read.result, partialContent: read.partialContent, runId: runId || streamRunId(read.result) };
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(friendlyError(response.status, payload)); error.status = response.status; error.retryable = Boolean(payload?.error?.retryable || [429, 502, 503, 504].includes(response.status)); throw error; }
  return { streamed: false, result: payload?.data && typeof payload.data === "object" ? payload.data : payload };
}

function failPendingMessage(body, error, partial = "", wasRetry = false) {
  state.messages.forEach((item) => { if (item.id === body.client_request_id) item.pending = false; });
  state.messages = state.messages.filter((item) => ![`${body.client_request_id}-stream`, `${body.client_request_id}-partial`].includes(item.id));
  const timedOut = error?.type === "harness_timeout" || error?.status === 504 || /响应超时|达到时限/.test(String(error?.message || ""));
  if (partial) state.messages.push({ id: `${body.client_request_id}-partial`, role: "assistant", content: partial, error: timedOut ? "本轮处理已达到时限，以上为已完成的部分回复；已完成的工具结果仍已保存。" : "连接中断，以上为已接收的部分回复。" });
  renderMessages();
  setConnectionState(timedOut ? "处理超时" : "连接失败", "error");
  notify(`${wasRetry ? "重试未成功：" : ""}${error.message}`, "error", error.retryable ? () => sendMessage(null, body) : null);
}
async function recoverRun(runId, onProgress) {
  const deadline = Date.now() + RESEARCH_RUN_RECOVERY_TIMEOUT_MS;
  let delay = 800;
  while (Date.now() < deadline) {
    const { run } = await api(`/projects/${encodeURIComponent(state.project.id)}/runs/${encodeURIComponent(runId)}`);
    if (run?.partial_content) onProgress?.(run.partial_content);
    if (run?.status === "completed" && run.result) return run.result;
    if (run?.status === "failed") { const error = new Error(run.error?.message || "AI研究员运行失败。"); error.retryable = Boolean(run.error?.retryable); error.type = run.error?.type || ""; error.status = error.type === "harness_timeout" ? 504 : undefined; throw error; }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(2_000, Math.round(delay * 1.35));
  }
  const error = new Error("连接中断，后台任务仍在运行，请稍后重试以同步结果。"); error.retryable = true; throw error;
}
async function sendMessage(event, retryBody = null) {
  event?.preventDefault?.();
  if (!state.project) return;
  const input = $("#researchChatInput");
  const body = retryBody || { message: input.value.trim(), artifact_id: state.selectedArtifactId || undefined, page_id: state.taskType === "ppt_script" ? state.targetPptScriptPageId || undefined : undefined, workflow_id: state.activeWorkflow?.status === "waiting_input" ? state.activeWorkflow.id : undefined, dataset_id: state.taskType === "data_analysis" || state.activeWorkflow?.task_type === "data_analysis" ? state.selectedDatasetId || undefined : undefined, selected_file_ids: [...state.selectedFileIds], auto_retrieve: state.autoRetrieve, task_type: state.taskType, client_request_id: requestId() };
  if (!body.message) return;
  if (!retryBody) clearNotice();
  if (!retryBody) {
    state.messages.push({ id: body.client_request_id, role: "user", content: body.message, pending: true });
    input.value = "";
    renderMessages();
  }
  const button = $("#researchSendMessage");
  setBusy(button, true, "AI思考中…");
  setConnectionState(retryBody ? "正在重试" : "正在连接", "connecting");
  let streamedText = "";
  const streamedTools = [];
  const renderStreamingAssistant = (content) => {
    let assistant = state.messages.find((item) => item.id === `${body.client_request_id}-stream`);
    if (!assistant) { assistant = { id: `${body.client_request_id}-stream`, role: "assistant", content: "", streaming: true }; state.messages.push(assistant); }
    assistant.content = content;
    assistant.toolCalls = streamedTools.map((item) => ({ ...item }));
    renderMessages();
    setConnectionState("正在接收回复", "streaming");
  };
  try {
    const { streamed, result, partialContent, runId } = await postMessage(body, {
      onDelta: (delta) => { streamedText += delta; renderStreamingAssistant(streamedText); },
      onProgress: (snapshot) => { streamedText = snapshot; renderStreamingAssistant(streamedText); },
      onToolStatus: (status) => { const index = streamedTools.findIndex((item) => item.tool_id === status.tool_id); if (index >= 0) streamedTools[index] = status; else streamedTools.push(status); renderStreamingAssistant(streamedText); setConnectionState(status.message || "正在调用专业工具", status.status === "error" ? "error" : "streaming"); },
      onWorkflowStatus: (status) => { const taskType = status.task_type || state.activeWorkflow?.task_type || (body.task_type === "data_analysis" ? "data_analysis" : body.task_type === "report_storyline" ? "report_storyline" : body.task_type === "ppt_script" ? "ppt_script" : "research_plan"); state.activeWorkflow = { ...(state.activeWorkflow || {}), ...status, task_type: taskType, stages: status.stages || state.activeWorkflow?.stages || [] }; renderWorkflow(state.activeWorkflow); setConnectionState(status.label || "研究工作流执行中", status.status === "failed" ? "error" : "streaming"); },
    });
    streamedText = partialContent || streamedText;
    await loadMessages();
    if (result) {
      state.messages = state.messages.filter((item) => item.id !== `${body.client_request_id}-stream`);
      const assistant = applyMessageResult(result);
      mergeAssistantResult(assistant);
      renderMessages();
      const artifactCreated = await refreshGeneratedOutputs(result);
      state.targetPptScriptPageId = null;
      clearNotice();
      if (artifactCreated) notify(artifactCreatedNotice(artifactCreated), "success");
    } else if (streamed) {
      state.messages = state.messages.filter((item) => item.id !== `${body.client_request_id}-stream`);
      if (streamedText) state.messages.push({ id: `${body.client_request_id}-partial`, role: "assistant", content: streamedText, error: "已接收部分回复；可重试以同步完整结果。" });
      setConnectionState("已接收部分回复，等待同步", "streaming");
      renderMessages();
    }
    if (!result) clearNotice();
  } catch (error) {
    if (error.runId) {
      try {
        const result = await recoverRun(error.runId, (snapshot) => { streamedText = snapshot; renderStreamingAssistant(streamedText); });
        await loadMessages();
        state.messages = state.messages.filter((item) => item.id !== `${body.client_request_id}-stream`);
        const assistant = applyMessageResult(result);
        mergeAssistantResult(assistant);
        renderMessages(); const artifactCreated = await refreshGeneratedOutputs(result); clearNotice(); if (artifactCreated) notify(artifactCreatedNotice(artifactCreated), "success");
      } catch (recoveryError) { failPendingMessage(body, recoveryError, streamedText, Boolean(retryBody)); }
    } else failPendingMessage(body, error, streamedText, Boolean(retryBody));
  } finally {
    setBusy(button, false);
    input.focus();
  }
}

function openSaveDialog(content) { state.pendingArtifactContent = content; const title = content.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) || "AI 研究成果"; $("#researchArtifactTitle").value = title.slice(0, 120); const parent = state.artifacts.find((artifact) => artifact.id === state.selectedArtifactId); const taskArtifactType = { research_plan: "research_plan", questionnaire: "questionnaire", interview_guide: "interview_guide", qualitative_summary: "qualitative_summary", qualitative_analysis: "qualitative_analysis", interview_summary: "interview_summary", data_analysis: "analysis", report_storyline: "report_outline", ppt_script: "ppt_script" }[state.taskType]; if (parent) $("#researchArtifactType").value = parent.type; else if (taskArtifactType) $("#researchArtifactType").value = taskArtifactType; $("#researchSaveArtifactDialog").showModal(); }
async function saveArtifact(event) { event.preventDefault(); const body = { title: $("#researchArtifactTitle").value.trim(), type: $("#researchArtifactType").value, content: state.pendingArtifactContent, parent_artifact_id: state.selectedArtifactId || undefined }; try { const result = await api(`/projects/${encodeURIComponent(state.project.id)}/artifacts`, { method: "POST", body: jsonBody(body) }); $("#researchSaveArtifactDialog").close(); state.pendingArtifactContent = ""; state.selectedArtifactId = (result.artifact || result).id; await loadArtifacts(); notify("成果已保存为新版本。", "success"); } catch (error) { notify(error.message, "error"); } }
function selectArtifact(artifact) { state.selectedArtifactId = artifact.id; state.targetPptScriptPageId = null; state.taskType = artifact.type === "ppt_script" ? "ppt_script" : "artifact_revision"; if (["research_plan", "analysis", "qualitative_analysis", "report_outline", "ppt_script"].includes(artifact.type)) { state.activeWorkflow = { ...(state.activeWorkflow || {}), task_type: artifact.type === "analysis" ? "data_analysis" : artifact.type === "qualitative_analysis" ? "qualitative_analysis" : artifact.type === "report_outline" ? "report_storyline" : artifact.type === "ppt_script" ? "ppt_script" : "research_plan", parent_artifact_id: artifact.id, artifact_id: null, status: "pending", stages: [] }; renderWorkflow(state.activeWorkflow); } if (["report_outline", "ppt_script"].includes(artifact.type)) { state.selectedFileIds.clear(); state.autoRetrieve = false; } $("#researchChatInput").value = artifact.type === "report_outline" ? "请基于这份报告大纲调整结构：" : artifact.type === "ppt_script" ? "请基于这份 PPT Script 继续修改：" : "请基于这份成果继续修改："; setMobileTab("chat"); renderContextChips(); renderArtifacts(); $("#researchChatInput").focus(); }
function clearArtifactContext() { state.selectedArtifactId = null; state.targetPptScriptPageId = null; if (["artifact_revision", "ppt_script"].includes(state.taskType)) state.taskType = "free_chat"; renderContextChips(); renderArtifacts(); }
async function renameArtifact(artifact) { const title = window.prompt("输入新的成果名称", artifact.title || ""); if (!title?.trim()) return; try { await api(`/projects/${state.project.id}/artifacts/${artifact.id}`, { method: "PATCH", body: jsonBody({ title: title.trim() }) }); await loadArtifacts(); } catch (error) { notify(error.message, "error"); } }
async function deleteArtifact(artifact) { if (!window.confirm(`删除“${artifact.title}”吗？`)) return; try { await api(`/projects/${state.project.id}/artifacts/${artifact.id}`, { method: "DELETE" }); if (state.selectedArtifactId === artifact.id) clearArtifactContext(); renderArtifactDetail(null); await loadArtifacts(); } catch (error) { notify(error.message, "error"); } }
function setMobileTab(tab) { document.querySelectorAll("[data-research-tab]").forEach((button) => { const active = button.dataset.researchTab === tab; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); }); document.querySelectorAll("[data-research-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.researchPanel === tab)); }
function bindEvents() {
  $("#researchNewProject")?.addEventListener("click", () => showMode("create")); $("#researchCreateCancel")?.addEventListener("click", () => showMode("home")); $("#researchCreateForm")?.addEventListener("submit", createProject); $("#researchRefreshProjects")?.addEventListener("click", loadProjects); $("#researchBackToProjects")?.addEventListener("click", async () => { state.pollToken += 1; state.project = null; state.selectedFileIds.clear(); state.toolResults = []; clearArtifactContext(); showMode("home"); await loadProjects(); });
  $("#researchContextForm")?.addEventListener("submit", updateProject); $("#researchChatForm")?.addEventListener("submit", sendMessage); $("#researchUploadFile")?.addEventListener("click", () => $("#researchFileInput").click()); $("#researchFileInput")?.addEventListener("change", (event) => uploadFiles(event.target.files)); $("#researchUploadDataset")?.addEventListener("click", () => $("#researchDatasetInput").click()); $("#researchDatasetInput")?.addEventListener("change", (event) => uploadDataset(event.target.files?.[0])); $("#researchProfileDataset")?.addEventListener("click", profileSelectedDataset); $("#researchWeightDataset")?.addEventListener("click", startDatasetWeighting); $("#researchAnalyzeDataset")?.addEventListener("click", startDatasetAnalysis); $("#researchExportCrosstabs")?.addEventListener("click", exportSelectedDatasetCrosstabs); $("#researchFileCategory")?.addEventListener("change", updateFileCategory); $("#researchFileDownload")?.addEventListener("click", () => downloadResearchFile(state.activeFile)); $("#researchFileReparse")?.addEventListener("click", reparseFile); $("#researchFileOcr")?.addEventListener("click", requestOcr); $("#researchFileDelete")?.addEventListener("click", deleteFile); $("#researchFileClose")?.addEventListener("click", () => $("#researchFileDialog").close());
  $("#researchTranscriptEditor")?.addEventListener("submit", saveTranscriptMetadata); $("#researchGenerateTranscriptSummaries")?.addEventListener("click", generateMissingTranscriptSummaries); $("#researchGenerateTranscriptSummary")?.addEventListener("click", generateActiveTranscriptSummary); $("#researchFileCorrectTranscript")?.addEventListener("click", () => { $("#researchFileDialog").close(); openTranscriptCorrectionDialog(state.activeTranscript?.id || ""); }); $("#researchFileReviewTranscript")?.addEventListener("click", () => { $("#researchFileDialog").close(); openTranscriptCorrectionReview(state.activeTranscript?.id || ""); });
  $("#researchTranscriptCorrectionForm")?.addEventListener("submit", startTranscriptCorrection); $("#researchTranscriptCorrectionCancel")?.addEventListener("click", () => $("#researchTranscriptCorrectionDialog").close()); $("#researchCorrectionReviewClose")?.addEventListener("click", () => $("#researchTranscriptCorrectionReviewDialog").close()); $("#researchCorrectionExport")?.addEventListener("click", exportCorrectedTranscript);
  $("#researchAddContext")?.addEventListener("click", openContextDialog); $("#researchMemorySearch")?.addEventListener("click", searchMemory); $("#researchContextPickerForm")?.addEventListener("submit", applyContext); $("#researchContextCancel")?.addEventListener("click", () => $("#researchContextDialog").close()); $("#researchSaveArtifactForm")?.addEventListener("submit", saveArtifact); $("#researchArtifactCancel")?.addEventListener("click", () => { state.pendingArtifactContent = ""; $("#researchSaveArtifactDialog").close(); });
  $("#researchQualitativePptPreviewForm")?.addEventListener("submit", confirmQualitativePptPreview); $("#researchPptPreviewCancel")?.addEventListener("click", () => { $("#researchQualitativePptPreviewDialog").close(); resetQualitativePptPreviewState(); }); $("#researchQualitativePptPreviewDialog")?.addEventListener("close", () => { if (state.pendingQualitativePreviewToken) resetQualitativePptPreviewState(); });
  $("#researchQuickTasks")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-research-prompt]"); if (!button) return; state.taskType = button.dataset.researchTaskType || "free_chat";
    if (state.taskType === "transcript_correction") { openTranscriptCorrectionDialog(); return; }
    if (state.taskType === "research_plan") { const projectFiles = state.files.filter((file) => ["brief", "historical_report"].includes(file.category) && file.parse_status === "completed"); state.selectedFileIds = new Set([...state.selectedFileIds, ...projectFiles.map((file) => file.id)].slice(0, 8)); state.autoRetrieve = true; renderFiles(); }
    if (state.taskType === "qualitative_summary") { const interviews = state.files.filter((file) => file.category === "interview" && file.parse_status === "completed").slice(0, 8); if (interviews.length) { state.selectedFileIds = new Set(interviews.map((file) => file.id)); renderFiles(); } else notify("请先上传访谈笔录，并将文件分类设为“访谈资料”。", "info"); }
    if (state.taskType === "qualitative_excel_summary") { const template = state.files.find((file) => file.structure_kind === "qualitative_summary_template" && file.parse_status === "completed"); const interviews = state.files.filter((file) => file.category === "interview" && file.parse_status === "completed").slice(0, 7); if (template && interviews.length) { state.selectedFileIds = new Set([template.id, ...interviews.map((file) => file.id)]); state.autoRetrieve = false; renderFiles(); notify(`已选择 1 份 Excel 模板和 ${interviews.length} 份访谈笔录。`, "info"); } else notify(template ? "请上传访谈笔录，并将文件分类设为“访谈资料”。" : "请先上传符合格式的访谈小结 Excel 模板。", "info"); }
    if (state.taskType === "interview_summary") { const fileId = state.transcripts.find((item) => item.status === "ready" && state.selectedFileIds.has(item.file_id))?.file_id || state.transcripts.find((item) => item.status === "ready")?.file_id; if (fileId) { state.selectedFileIds = new Set([fileId]); state.autoRetrieve = false; renderFiles(); notify("已选择 1 份访谈生成单篇小结。", "info"); } else notify("请先上传访谈笔录，并等待访谈索引完成。", "info"); }
    if (["qualitative_analysis", "find_quotes"].includes(state.taskType)) { const ready = state.transcripts.filter((item) => item.status === "ready").slice(0, 12); const readyIds = ready.map((item) => item.file_id); const deepCount = ready.filter((item) => item.summary_status === "ready" && item.deep_summary && item.summary_source_fingerprint === item.source_fingerprint).length; if (readyIds.length) { state.selectedFileIds = new Set(readyIds); state.autoRetrieve = false; renderFiles(); notify(`已纳入 ${readyIds.length} 份可分析访谈，其中 ${deepCount} 份有深度摘要；最终结论仍由 Segment 原文校验。`, "info"); } else notify("请先上传访谈笔录，并等待访谈索引完成。", "info"); }
    if (state.taskType === "data_analysis") { if (!state.selectedDatasetId) notify("请先在左侧上传并选择一个数据集。", "info"); state.selectedFileIds = new Set([...state.selectedFileIds].filter((id) => state.files.find((file) => file.id === id)?.category !== "data")); state.autoRetrieve = true; renderFiles(); }
    if (state.taskType === "report_storyline") { state.selectedFileIds.clear(); state.selectedArtifactId = null; state.autoRetrieve = false; renderFiles(); renderArtifacts(); notify(`将基于当前项目的 ${state.evidence.filter((item) => !item.excluded).length} 条可用 Evidence 与已有 Insight 生成报告大纲，不会重新读取完整逐字稿或原始数据。`, "info"); }
    $("#researchChatInput").value = button.dataset.researchPrompt; $("#researchChatInput").focus(); if (state.taskType === "research_plan") sendMessage({ preventDefault() {} });
  });
  $("#researchToolActions")?.addEventListener("click", (event) => { const button = event.target.closest("[data-research-tool]"); if (button && state.project) openToolFromProject(button.dataset.researchTool, state.project); }); window.addEventListener("surveykit:tool-result-saved", (event) => { if (state.project?.id === event.detail?.project_id) loadToolResults().catch(() => {}); }); document.querySelectorAll("[data-research-tab]").forEach((button) => button.addEventListener("click", () => setMobileTab(button.dataset.researchTab))); document.querySelector('[data-view="research"]')?.addEventListener("click", () => { showMode(state.project ? "workspace" : "home"); if (!state.project) loadProjects(); });
}
export function initAiResearcher() { if (state.initialized || !$("#research")) return; state.initialized = true; bindEvents(); showMode("home"); renderProjects(); if (window.location.hash === "#research") loadProjects(); }
export const researchApi = { api };
export const researchStreaming = { latestStreamSnapshot, normalizeStreamPayload, parseSseBuffer, readSseResponse };

async function loadReadiness() {
 const projectId = state.project?.id; if(!projectId)return;
 let panel = $('#researchProjectReadiness');
 if(!panel){panel=node('section','research-project-readiness','');panel.id='researchProjectReadiness';panel.setAttribute('aria-live','polite');$('#researchWorkspaceMeta')?.after(panel);}
 try {
  const result=await api(`/projects/${encodeURIComponent(projectId)}/readiness`);
  if(state.project?.id!==projectId)return;
  state.readiness=result.readiness;
  if(!state.readiness)return;
  const r=state.readiness;panel.replaceChildren(node('strong','',r.label),node('p','',r.next));
  if(r.counts.degraded_reports)panel.append(node('p','','存在兼容渲染版本，请查看成果中的渲染说明。'));
  renderDatasets();
 } catch {if(state.project?.id===projectId)panel.replaceChildren(node('p','','项目阶段暂未加载，可继续使用各功能。'));}
}
