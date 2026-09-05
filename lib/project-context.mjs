const TASK_TYPES = new Set(["research_plan", "questionnaire", "interview_guide", "qualitative_summary", "qualitative_excel_summary", "qualitative_analysis", "interview_summary", "find_quotes", "data_analysis", "report_storyline", "ppt_script", "artifact_revision", "free_chat"]);
const INTERVIEW_GUIDE_STRUCTURE_RULE = "不得使用问卷式字母数字题号（如 A1、A2、B1）。一级章节保留中文序号（一、二、三…）或“环节1、环节2…”；二级模块禁止使用 1-1、4-2、1.1 等编号，统一以“• ”开头；模块下的具体追问统一以“- ”开头；避免多层数字编号造成阅读负担；输出应贴近研究员实际执行访谈时使用的提纲，而不是论文目录或考试题。";
const QUALITATIVE_SUMMARY_RULE = "仅依据提供的访谈笔录、座谈记录和项目资料进行分析，不得补造受访者、观点、频次或原话。先区分材料事实、研究员解释和待验证假设，再输出：一、执行小结；二、核心主题（每个主题含发现、证据、差异与解释）；三、共识与分歧；四、痛点、需求及机会；五、代表性原话；六、研究启示与行动建议；七、证据边界。引用原话必须短且逐字可回溯，并标注“[文件名｜受访者/位置]”；无法识别受访者时标注文件名和可定位位置。不得把定性材料伪装成总体比例，不得声称达到理论饱和或可代表总体；资料不足时明确指出缺口。";

export function normalizeInterviewGuideFormatting(content) {
  return String(content ?? "").replace(/^(?!\s*\d{4}\s*-\s*\d{4}(?:\s|$))\s*\d+\s*[-.、]\s*\d+(?:(?:\s*[.、:](?!\d)\s*)|\s+|$)/gm, "• ");
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}

function text(value) { return String(value ?? "").trim(); }
function object(value) { if (value && typeof value === "object") return value; try { const result = JSON.parse(String(value || "{}")); return result && typeof result === "object" ? result : {}; } catch { return {}; } }
function clipped(value, maximum) {
  const normalized = text(value);
  return normalized.length > maximum ? `${normalized.slice(0, Math.max(0, maximum - 1))}…` : normalized;
}

function limitsFrom(input = {}) {
  return {
    total: integer(input.maxContextChars ?? input.total, 30_000, 8_000, 80_000),
    project: integer(input.maxProjectChars ?? input.project, 6_000, 1_000, 16_000),
    artifact: integer(input.maxArtifactChars ?? input.artifact, 12_000, 2_000, 30_000),
    fileSummary: integer(input.maxFileSummaryChars ?? input.fileSummary, 2_000, 300, 6_000),
    fileExcerpt: integer(input.maxFileExcerptChars ?? input.fileExcerpt, 3_000, 500, 40_000),
    recentCount: integer(input.maxRecentMessages ?? input.recentCount, 6, 0, 10),
    recentMessage: integer(input.maxRecentMessageChars ?? input.recentMessage, 1_200, 200, 4_000),
    selectedFiles: integer(input.maxSelectedFiles ?? input.selectedFiles, 8, 1, 12),
    retrievedChunks: integer(input.maxRetrievedChunks ?? input.retrievedChunks, 5, 1, 12),
    retrievedChunk: integer(input.maxRetrievedChunkChars ?? input.retrievedChunk, 1_600, 300, 4_000),
  };
}

function taskInstruction(taskType, artifactType = "") {
  const instruction = {
    research_plan: "当前任务：设计或完善调研方案。优先围绕业务决策、研究模块、方法、样本与交付物。必须直接在本轮回复正文中给出完整成果。",
    questionnaire: "当前任务：设计或完善定量问卷。确保题目可执行、逻辑完整，并与研究目标一致。必须直接在本轮回复正文中给出完整、可编程的问卷。",
    interview_guide: `当前任务：设计或完善访谈大纲。确保问题开放、中立并能支持研究目标。${INTERVIEW_GUIDE_STRUCTURE_RULE}必须直接在本轮回复正文中给出完整成果。`,
    qualitative_summary: `当前任务：基于选定的定性材料形成专业定性小结。${QUALITATIVE_SUMMARY_RULE}必须直接在本轮回复正文中给出完整成果。`,
    qualitative_excel_summary: "当前任务：基于选中的访谈笔录，按照选中的 Excel 小结模板逐题生成结构化结果。只输出调用方要求的 JSON，不得补造未出现的内容。",
    qualitative_analysis: "当前任务：运行多访谈定性分析 Workflow。正文必须由研究问题驱动，以 Segment 证据区分事实、解释与假设，并呈现共识、差异、反例和证据边界。",
    interview_summary: "当前任务：对单份访谈生成结构化小结，以 Segment 为证据，保留受访者背景、核心观点、关键事实、判断、案例、代表性原声及项目关联。",
    find_quotes: "当前任务：从访谈 Segment 中寻找最相关的逐字原声，并回查上下文；不要生成完整报告。",
    data_analysis: "当前任务：设计最小必要的数据分析路径，并仅根据 SurveyKit 数据工具返回的结构化结果解释发现。原始数据行不在上下文中，也不得索要或自行计算。",
    report_storyline: "当前任务：仅组织当前项目的 Research Evidence 和已验证 Insight，形成核心结论、Storyline、章节与页面级 Report Outline；不得重新读取完整逐字稿或原始数据，也不得生成 PPT。",
    ppt_script: "当前任务：只基于 Report Outline 与其关联 Evidence 生成页面级结构化 PPT Script；不得重新运行底层分析，也不得生成 PowerPoint 文件。",
    artifact_revision: "当前任务：基于指定成果做定向修改。保留未要求改变的有效内容，并直接在本轮回复正文中给出修改后的完整成果。",
    free_chat: "当前任务：回答用户的当前研究问题。",
  }[taskType] || "当前任务：回答用户的当前研究问题。";
  if (taskType === "artifact_revision" && artifactType === "interview_guide") return `${instruction}${INTERVIEW_GUIDE_STRUCTURE_RULE}`;
  if (taskType === "artifact_revision" && artifactType === "qualitative_summary") return `${instruction}${QUALITATIVE_SUMMARY_RULE}`;
  if (taskType === "artifact_revision" && artifactType === "qualitative_analysis") return `${instruction}按正式多访谈定性分析的证据规则重建完整成果，所有直接引用必须能回溯到真实 Segment。`;
  if (taskType === "artifact_revision" && artifactType === "report_outline") return `${instruction}本轮仅调整大纲结构，复用既有 Evidence 和 Insight，不得重新运行底层分析。`;
  if (taskType === "artifact_revision" && artifactType === "ppt_script") return `${instruction}本轮仅修改 PPT Script，复用既有 Outline 与 Evidence，不得生成 PPT 文件。`;
  return instruction;
}

export function contextLimitsFromEnv(env = {}, taskType = "") {
  const qualitative = ["qualitative_summary", "qualitative_excel_summary", "qualitative_analysis", "interview_summary", "find_quotes"].includes(text(taskType).toLowerCase());
  return limitsFrom({
    maxContextChars: qualitative ? env.RESEARCH_QUALITATIVE_MAX_CONTEXT_CHARS || 80_000 : env.RESEARCH_MAX_CONTEXT_CHARS,
    maxProjectChars: env.RESEARCH_MAX_PROJECT_CONTEXT_CHARS,
    maxArtifactChars: qualitative ? env.RESEARCH_QUALITATIVE_MAX_ARTIFACT_CHARS || 30_000 : env.RESEARCH_MAX_ARTIFACT_CHARS,
    maxFileSummaryChars: qualitative ? env.RESEARCH_QUALITATIVE_MAX_FILE_SUMMARY_CHARS || 4_000 : env.RESEARCH_MAX_FILE_SUMMARY_CHARS,
    maxFileExcerptChars: qualitative ? env.RESEARCH_QUALITATIVE_MAX_FILE_EXCERPT_CHARS || 20_000 : env.RESEARCH_MAX_FILE_EXCERPT_CHARS,
    maxRecentMessages: qualitative ? env.RESEARCH_QUALITATIVE_MAX_RECENT_MESSAGES || 4 : env.RESEARCH_MAX_RECENT_MESSAGES,
    maxRecentMessageChars: env.RESEARCH_MAX_RECENT_MESSAGE_CHARS,
    maxSelectedFiles: qualitative ? env.RESEARCH_QUALITATIVE_MAX_SELECTED_FILES || 8 : env.RESEARCH_MAX_SELECTED_FILES,
    maxRetrievedChunks: qualitative ? env.RESEARCH_QUALITATIVE_MAX_RETRIEVED_CHUNKS || 8 : env.RESEARCH_MAX_RETRIEVED_CHUNKS,
    maxRetrievedChunkChars: qualitative ? env.RESEARCH_QUALITATIVE_MAX_RETRIEVED_CHUNK_CHARS || 3_000 : env.RESEARCH_MAX_RETRIEVED_CHUNK_CHARS,
  });
}

export function normalizeTaskType(value, artifact) {
  const requested = text(value).toLowerCase();
  if (artifact) return requested && TASK_TYPES.has(requested) ? requested : "artifact_revision";
  return TASK_TYPES.has(requested) ? requested : "free_chat";
}

export function buildProjectContext({ project, files = [], retrievedChunks = [], artifact = null, recentMessages = [], userMessage, taskType, includeRecentMessages = false, limits = {} }) {
  if (!project) throw new TypeError("ProjectContext requires a project.");
  const budget = limitsFrom(limits);
  const normalizedTask = normalizeTaskType(taskType, artifact);
  const directReplyOnly = normalizedTask !== "free_chat";
  const qualitativeTask = ["qualitative_summary", "qualitative_excel_summary"].includes(normalizedTask) || (normalizedTask === "artifact_revision" && text(artifact?.type) === "qualitative_summary");
  const transcriptTask = ["qualitative_analysis", "interview_summary", "find_quotes"].includes(normalizedTask) || (normalizedTask === "artifact_revision" && ["qualitative_analysis", "interview_summary"].includes(text(artifact?.type)));
  const professionalToolRule = qualitativeTask ? "本轮定性分析不得调用任何专业计算或问卷检查工具；请只基于授权材料完成归纳与解释。" : transcriptTask ? "本轮只可调用 transcript_search 与 transcript_read；必须先检索后回查，工具失败时不得补造原声或证据。" : "仅在确需确定性计算或检查时，可调用 sample_size、quota_design、questionnaire_check；其余工具一律未授权。专业工具失败时必须明确说明无法获得确定结果，不得自行估算或伪造。";
  const directReplyRule = directReplyOnly ? `本轮为正文直出模式：${professionalToolRule}禁止调用 skill、bash、write、edit、read、glob、grep、webfetch、websearch、task、todo、ask_user_question 和 request_user_input；不要创建、读取或修改服务器文件，也不要生成下载链接。请直接在当前回复正文中完成用户要求。` : `${professionalToolRule}不要调用 ask_user_question、request_user_input 或其他需要客户端交互的询问工具；需要澄清时，请直接在回复正文中列出问题并结束本轮。`;
  const system = `你是 SurveyKit 的 AI 调研研究员。请使用中文提供专业、可执行的研究建议。只使用以下授权上下文；没有提供的资料不要假装已经读取。${directReplyRule}`;
  const currentRequest = clipped(userMessage, Math.min(5_000, Math.max(1_500, Math.floor(budget.total / 4))));
  const currentSegment = `【用户当前要求】\n${currentRequest || "未提供"}`;
  const contextLimit = Math.max(2_000, budget.total - system.length - currentSegment.length - 4);
  const segments = [];
  let used = 0;
  const append = (heading, content, cap) => {
    const body = clipped(content, cap);
    if (!body) return false;
    const prefix = `${segments.length ? "\n\n" : ""}${heading}\n`;
    const remaining = contextLimit - used - prefix.length;
    if (remaining <= 0) return false;
    const selected = clipped(body, remaining);
    segments.push(`${heading}\n${selected}`);
    used += prefix.length + selected.length;
    return selected.length === body.length;
  };

  const projectBlock = [
    `项目名称：${text(project.title) || "未命名项目"}`,
    `客户名称：${text(project.client_name) || "未提供"}`,
    `项目背景：${text(project.brief) || "未提供"}`,
    `研究目标：${text(project.research_goal) || "未提供"}`,
    ...Object.entries(object(project.constraints)).filter(([, value]) => text(value)).map(([key, value]) => `${({ budget: "预算约束", timeline: "周期约束", target_sample: "目标样本", research_method_preference: "方法偏好", region_scope: "地域范围", other_constraints: "其他约束" })[key] || key}：${text(value)}`),
  ].join("\n");
  append("【项目基础信息】", projectBlock, budget.project);
  append("【任务类型】", taskInstruction(normalizedTask, text(artifact?.type)), 500);

  let appliedArtifact = null;
  if (artifact) {
    const artifactBlock = [`标题：${artifact.title}`, `类型：${artifact.type}`, `版本：V${artifact.version}`, clipped(artifact.content, budget.artifact)].join("\n");
    const complete = append("【当前成果】", artifactBlock, budget.artifact + 300);
    appliedArtifact = { id: artifact.id, title: artifact.title, version: artifact.version, complete };
  }

  const appliedFiles = [];
  for (const file of files.filter((item) => item.category !== "data").slice(0, budget.selectedFiles)) {
    const status = text(file.parse_status);
    const summary = clipped(file.summary, budget.fileSummary);
    const excerptSource = text(file.parsed_text);
    const excerpt = clipped(excerptSource, budget.fileExcerpt);
    const fileBlock = [
      `文件：${text(file.file_name) || "未命名文件"}`,
      `分类：${text(file.category) || "other"}`,
      `解析状态：${status || "unknown"}`,
      summary ? `摘要：\n${summary}` : "",
      excerpt && excerpt !== summary ? `必要片段：\n${excerpt}` : "",
      !summary && !excerpt ? "该文件当前没有可用解析内容。" : "",
    ].filter(Boolean).join("\n");
    const complete = append("【用户选择的项目文件】", fileBlock, budget.fileSummary + budget.fileExcerpt + 500);
    appliedFiles.push({ id: file.id, name: file.file_name, status, complete });
    if (used >= contextLimit) break;
  }

  const appliedChunks = [];
  for (const chunk of retrievedChunks.slice(0, budget.retrievedChunks)) {
    const chunkBlock = [
      `来源文件：${text(chunk.file_name) || "未命名文件"}`,
      chunk.heading ? `位置：${text(chunk.heading)}` : "",
      `相关片段：\n${clipped(chunk.content, budget.retrievedChunk)}`,
    ].filter(Boolean).join("\n");
    const complete = append("【自动检索的项目记忆】", chunkBlock, budget.retrievedChunk + 300);
    appliedChunks.push({ file_id: chunk.file_id, file_name: chunk.file_name, chunk_index: chunk.chunk_index, score: chunk.score, complete });
    if (used >= contextLimit) break;
  }

  let recentCount = 0;
  if (includeRecentMessages && budget.recentCount > 0) {
    const recent = recentMessages.filter((message) => ["user", "assistant"].includes(message?.role)).slice(-budget.recentCount);
    const block = recent.map((message) => `${message.role === "user" ? "用户" : "AI"}：${clipped(message.content, budget.recentMessage)}`).join("\n");
    if (append("【Session 恢复：最近有效对话】", block, budget.recentCount * (budget.recentMessage + 8))) recentCount = recent.length;
  }

  segments.push(currentSegment);
  const prompt = `${system}\n\n${segments.join("\n\n")}`.slice(0, budget.total);
  return {
    prompt,
    context: {
      task_type: normalizedTask,
      qualitative_summary: qualitativeTask,
      direct_reply_only: directReplyOnly,
      selected_files: appliedFiles,
      retrieved_chunks: appliedChunks,
      artifact: appliedArtifact,
      recent_message_count: recentCount,
      chars: prompt.length,
      max_chars: budget.total,
      truncated: prompt.length >= budget.total || appliedFiles.some((file) => !file.complete) || appliedChunks.some((chunk) => !chunk.complete) || Boolean(appliedArtifact && !appliedArtifact.complete),
    },
  };
}

export const projectContextTaskTypes = [...TASK_TYPES];
