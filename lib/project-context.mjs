const TASK_TYPES = new Set(["research_plan", "questionnaire", "interview_guide", "artifact_revision", "free_chat"]);

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}

function text(value) { return String(value ?? "").trim(); }
function clipped(value, maximum) {
  const normalized = text(value);
  return normalized.length > maximum ? `${normalized.slice(0, Math.max(0, maximum - 1))}…` : normalized;
}

function limitsFrom(input = {}) {
  return {
    total: integer(input.maxContextChars, 30_000, 8_000, 80_000),
    project: integer(input.maxProjectChars, 6_000, 1_000, 16_000),
    artifact: integer(input.maxArtifactChars, 12_000, 2_000, 30_000),
    fileSummary: integer(input.maxFileSummaryChars, 2_000, 300, 6_000),
    fileExcerpt: integer(input.maxFileExcerptChars, 3_000, 500, 10_000),
    recentCount: integer(input.maxRecentMessages, 6, 0, 10),
    recentMessage: integer(input.maxRecentMessageChars, 1_200, 200, 4_000),
    selectedFiles: integer(input.maxSelectedFiles, 8, 1, 12),
    retrievedChunks: integer(input.maxRetrievedChunks, 5, 1, 12),
    retrievedChunk: integer(input.maxRetrievedChunkChars, 1_600, 300, 4_000),
  };
}

function taskInstruction(taskType) {
  return {
    research_plan: "当前任务：设计或完善调研方案。优先围绕业务决策、研究模块、方法、样本与交付物。必须直接在本轮回复正文中给出完整成果。",
    questionnaire: "当前任务：设计或完善定量问卷。确保题目可执行、逻辑完整，并与研究目标一致。必须直接在本轮回复正文中给出完整、可编程的问卷。",
    interview_guide: "当前任务：设计或完善访谈大纲。确保问题开放、中立并能支持研究目标。必须直接在本轮回复正文中给出完整成果。",
    artifact_revision: "当前任务：基于指定成果做定向修改。保留未要求改变的有效内容，并直接在本轮回复正文中给出修改后的完整成果。",
    free_chat: "当前任务：回答用户的当前研究问题。",
  }[taskType] || "当前任务：回答用户的当前研究问题。";
}

export function contextLimitsFromEnv(env = {}) {
  return limitsFrom({
    maxContextChars: env.RESEARCH_MAX_CONTEXT_CHARS,
    maxProjectChars: env.RESEARCH_MAX_PROJECT_CONTEXT_CHARS,
    maxArtifactChars: env.RESEARCH_MAX_ARTIFACT_CHARS,
    maxFileSummaryChars: env.RESEARCH_MAX_FILE_SUMMARY_CHARS,
    maxFileExcerptChars: env.RESEARCH_MAX_FILE_EXCERPT_CHARS,
    maxRecentMessages: env.RESEARCH_MAX_RECENT_MESSAGES,
    maxRecentMessageChars: env.RESEARCH_MAX_RECENT_MESSAGE_CHARS,
    maxSelectedFiles: env.RESEARCH_MAX_SELECTED_FILES,
    maxRetrievedChunks: env.RESEARCH_MAX_RETRIEVED_CHUNKS,
    maxRetrievedChunkChars: env.RESEARCH_MAX_RETRIEVED_CHUNK_CHARS,
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
  const directReplyRule = directReplyOnly ? "本轮为正文直出模式：禁止调用任何工具，包括 skill、bash、write、edit、read、glob、grep、webfetch、websearch、task、todo、ask_user_question 和 request_user_input；不要创建、读取或修改服务器文件，也不要生成下载链接。请直接在当前回复正文中完成用户要求。" : "不要调用 ask_user_question、request_user_input 或其他需要客户端交互的询问工具；需要澄清时，请直接在回复正文中列出问题并结束本轮。";
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
  ].join("\n");
  append("【项目基础信息】", projectBlock, budget.project);
  append("【任务类型】", taskInstruction(normalizedTask), 500);

  let appliedArtifact = null;
  if (artifact) {
    const artifactBlock = [`标题：${artifact.title}`, `类型：${artifact.type}`, `版本：V${artifact.version}`, clipped(artifact.content, budget.artifact)].join("\n");
    const complete = append("【当前成果】", artifactBlock, budget.artifact + 300);
    appliedArtifact = { id: artifact.id, title: artifact.title, version: artifact.version, complete };
  }

  const appliedFiles = [];
  for (const file of files.slice(0, budget.selectedFiles)) {
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
