import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SUPPORTED_INPUTS = new Set([".docx", ".txt"]);
const TECH_BLUE_V2 = "qualitative_tech_blue_v2";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    values[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return values;
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function safeFilename(value) {
  return String(value || "定性研究报告")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "定性研究报告";
}

async function requestJson(baseUrl, pathname, options = {}, timeoutMs = 420_000) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

async function waitForParsedFiles(baseUrl, projectId, expectedIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(projectId)}/files`);
    const files = (result.files || []).filter((item) => expectedIds.has(item.id));
    const pending = files.filter((item) => ["pending", "processing"].includes(item.parse_status));
    if (!pending.length && files.length === expectedIds.size) {
      const failed = files.filter((item) => item.parse_status !== "completed");
      if (failed.length) throw new Error(`访谈解析失败：${failed.map((item) => item.file_name).join("；")}`);
      return files;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("等待访谈文件解析超时。");
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = args["input-dir"] ? path.resolve(String(args["input-dir"])) : "";
  const resumeProjectId = String(args["project-id"] || "").trim();
  const existingAnalysisArtifactId = String(args["analysis-artifact-id"] || "").trim();
  const existingOutlineArtifactId = String(args["outline-artifact-id"] || "").trim();
  const existingScriptArtifactId = String(args["script-artifact-id"] || "").trim();
  const templateId = String(args["template-id"] || TECH_BLUE_V2).trim();
  const allowFallback = args["allow-fallback"] === true;
  const baseUrl = String(args["base-url"] || "http://127.0.0.1:4381").replace(/\/+$/, "");
  const outputDir = path.resolve(String(args["output-dir"] || path.join("test-results", "real-project-acceptance")));
  const projectTitle = String(args["project-title"] || "荣耀电商NPS定性研究").trim();
  const maximumFiles = integer(args["max-files"], 15, 8, 20);
  const analysisFileLimit = integer(args["analysis-files"], maximumFiles, 8, 20);
  const summaryConcurrency = integer(args["summary-concurrency"], 2, 1, 4);
  const skipSummaries = args["skip-summaries"] === true;
  if (!resumeProjectId && !inputDir) throw new Error("首次运行必须传入 --input-dir；断点续跑请传入 --project-id。");

  await fs.mkdir(outputDir, { recursive: true });
  const checkpointPath = path.join(outputDir, "real-qualitative-ppt-checkpoint.json");
  const saveCheckpoint = async (stage, status, extra = {}) => fs.writeFile(checkpointPath, JSON.stringify({
    schema_version: "surveykit.real_qualitative_ppt_checkpoint.v1",
    updated_at: new Date().toISOString(),
    stage,
    status,
    base_url: baseUrl,
    ...extra,
  }, null, 2), "utf8");
  const health = await requestJson(baseUrl, "/api/research/health");
  const needsHarness = !existingAnalysisArtifactId || !existingOutlineArtifactId
    || !existingScriptArtifactId || !skipSummaries;
  if (needsHarness && !health.harness_configured) {
    throw new Error("Research Harness 尚未配置，无法生成缺失的分析、大纲、脚本或访谈摘要。");
  }

  let project;
  let uploaded;
  if (resumeProjectId) {
    console.log(`[1/9] 从隔离验收项目断点续跑：${resumeProjectId}`);
    const projectResult = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(resumeProjectId)}`);
    project = projectResult.project || projectResult;
    const filesResult = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/files`);
    uploaded = (filesResult.files || []).filter((item) => item.category === "interview" && item.parse_status === "completed");
    if (uploaded.length < 8) throw new Error(`断点项目至少需要 8 份已解析访谈，当前仅有 ${uploaded.length} 份。`);
    console.log(`[2/9] 复用 ${uploaded.length} 份已解析真实访谈`);
  } else {
    const inputEntries = (await fs.readdir(inputDir, { withFileTypes: true }))
      .filter((item) => item.isFile()
        && !item.name.startsWith("~$")
        && !item.name.startsWith(".")
        && SUPPORTED_INPUTS.has(path.extname(item.name).toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
      .slice(0, maximumFiles);
    if (inputEntries.length < 8) throw new Error(`真实项目验收至少需要 8 份访谈，当前仅找到 ${inputEntries.length} 份。`);

    console.log(`[1/9] 创建隔离验收项目：${projectTitle}`);
    const createdProject = await requestJson(baseUrl, "/api/research/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_project_id: `real-qual-ppt-${Date.now()}`,
        title: projectTitle,
        research_goal: "基于真实消费者访谈识别电商体验中的关键驱动、主要痛点、用户差异与改进优先级，并形成可交付的定性研究报告。",
        constraints: {
          report_constraints: {
            storyline_type: "diagnosis",
            audience: "业务与管理团队",
            slide_range: "12-20",
            style: "technology_blue_qualitative_consulting",
          },
        },
      }),
    });
    project = createdProject.project || createdProject;
    await saveCheckpoint("project_created", "completed", { project: { id: project.id, title: project.title } });

    console.log(`[2/9] 上传并解析 ${inputEntries.length} 份真实访谈`);
    uploaded = [];
    for (const [index, entry] of inputEntries.entries()) {
      const bytes = await fs.readFile(path.join(inputDir, entry.name));
      const response = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/files`, {
        method: "POST",
        headers: {
          "Content-Type": entry.name.toLowerCase().endsWith(".docx")
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "text/plain; charset=utf-8",
          "X-Research-File-Name": encodeURIComponent(entry.name),
          "X-Research-File-Category": "interview",
        },
        body: bytes,
      });
      uploaded.push(response.file);
      console.log(`  ${String(index + 1).padStart(2, "0")}/${inputEntries.length} ${entry.name}`);
    }
    await waitForParsedFiles(baseUrl, project.id, new Set(uploaded.map((item) => item.id)), 180_000);
  }

  const transcriptResult = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/transcripts`);
  const transcripts = (transcriptResult.transcripts || []).filter((item) => item.status === "ready");
  if (transcripts.length !== uploaded.length) throw new Error(`访谈同步数量不一致：文件 ${uploaded.length}，Transcript ${transcripts.length}。`);
  for (const [index, transcript] of transcripts.entries()) {
    await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/transcripts/${encodeURIComponent(transcript.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interview_type: "consumer", respondent_label: `消费者访谈${String(index + 1).padStart(2, "0")}` }),
    });
  }
  await saveCheckpoint("transcripts_ready", "completed", {
    project: { id: project.id, title: project.title },
    inputs: { file_count: uploaded.length, transcript_count: transcripts.length },
    resume_command: `npm run acceptance:qualitative-ppt -- --project-id ${project.id} --base-url ${baseUrl} --output-dir "${outputDir}"`,
  });

  if (!skipSummaries) {
    console.log(`[3/9] 生成 ${transcripts.length} 份可复用深度摘要（并发 ${summaryConcurrency}）`);
    await runPool(transcripts, summaryConcurrency, async (transcript, index) => {
      const response = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/transcripts/${encodeURIComponent(transcript.id)}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      console.log(`  ${String(index + 1).padStart(2, "0")}/${transcripts.length} ${response.cached ? "复用" : "完成"} ${transcript.respondent_label || transcript.title}`);
      return response;
    });
    await saveCheckpoint("transcript_summaries", "completed", { project: { id: project.id, title: project.title }, transcript_count: transcripts.length });
  } else {
    console.log("[3/9] 跳过单访谈深度摘要，跨访谈分析将按需回查原文");
  }

  async function runWorkflow(taskType, message, { artifactId = "", selectedFileIds = [] } = {}) {
    return requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        task_type: taskType,
        client_request_id: randomUUID(),
        selected_file_ids: selectedFileIds,
        auto_retrieve: false,
        ...(artifactId ? { artifact_id: artifactId } : {}),
      }),
    });
  }

  console.log("[4/9] 运行多访谈定性分析并固化真实 Quote / Evidence");
  const analysisFileIds = uploaded.slice(0, Math.min(analysisFileLimit, uploaded.length)).map((item) => item.id);
  let analysisResult;
  let analysisArtifact;
  if (existingAnalysisArtifactId) {
    const artifactResult = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/artifacts`);
    analysisArtifact = (artifactResult.artifacts || []).find((item) => item.id === existingAnalysisArtifactId && item.type === "qualitative_analysis");
    if (!analysisArtifact) throw new Error("指定的定性分析 Artifact 不存在或不属于当前项目。");
    analysisResult = { artifact_created: analysisArtifact, quality: null };
    console.log(`  复用已通过逐字引语校验的定性分析：${analysisArtifact.id}`);
  } else {
    analysisResult = await runWorkflow(
      "qualitative_analysis",
      `请分析选定的${analysisFileIds.length}份消费者访谈，围绕购买决策、产品价值感知、平台内容与服务、售后信任和持续推荐意愿，最多归纳5个核心主题，并选择不超过6条最有代表性的原声。需要识别跨访谈共识、关键差异、少数反例与业务机会。所有直接引语必须逐字引用真实 Transcript Segment，并给出 segment 标记。`,
      { selectedFileIds: analysisFileIds },
    );
    analysisArtifact = analysisResult.artifact_created;
  }
  if (!analysisArtifact?.id) throw new Error("定性分析未生成 Artifact。");
  await saveCheckpoint("qualitative_analysis", "completed", { project: { id: project.id, title: project.title }, artifact_id: analysisArtifact.id, quality: analysisResult.quality });

  console.log("[5/9] 生成 Evidence 驱动的 Storyline / Report Outline");
  let outlineResult;
  let outlineArtifact;
  if (existingOutlineArtifactId) {
    const artifactResult = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/artifacts`);
    outlineArtifact = (artifactResult.artifacts || []).find((item) => item.id === existingOutlineArtifactId && item.type === "report_outline");
    if (!outlineArtifact) throw new Error("指定的 Report Outline Artifact 不存在或不属于当前项目。");
    outlineResult = { artifact_created: outlineArtifact, quality: null };
    console.log(`  复用已验证的 Report Outline：${outlineArtifact.id}`);
  } else {
    outlineResult = await runWorkflow(
      "report_storyline",
      "请基于当前项目已经验证的定性 Insight、Research Evidence 与真实原声，生成一份12–20页的定性研究报告 Storyline 与 Report Outline。优先使用诊断逻辑：核心发现总览 → 用户决策与体验 → 关键问题与根因 → 人群差异与典型原声 → 需求优先级 → 行动建议。标题必须结论化，证据不足时明确标记 Evidence Gap。",
    );
    outlineArtifact = outlineResult.artifact_created;
  }
  if (!outlineArtifact?.id) throw new Error("Report Outline 未生成 Artifact。");
  await saveCheckpoint("report_outline", "completed", { project: { id: project.id, title: project.title }, artifact_id: outlineArtifact.id, quality: outlineResult.quality });

  console.log("[6/9] 生成页面级定性 PPT Script");
  let scriptResult;
  let scriptArtifact;
  let script;
  if (existingScriptArtifactId) {
    const artifactResult = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/artifacts`);
    scriptArtifact = (artifactResult.artifacts || []).find((item) => item.id === existingScriptArtifactId && item.type === "ppt_script");
    if (!scriptArtifact) throw new Error("指定的 PPT Script Artifact 不存在或不属于当前项目。");
    try { script = JSON.parse(String(scriptArtifact.content || "{}")); } catch { script = null; }
    scriptResult = { artifact_created: scriptArtifact, ppt_script: script, quality: null };
    console.log(`  复用已验证的 PPT Script：${scriptArtifact.id}`);
  } else {
    scriptResult = await runWorkflow(
      "ppt_script",
      "请基于这份 Report Outline 生成完整的定性研究报告 PPT Script，style_profile.id 使用 qualitative_tech_blue_v2。根据证据结构优先选择 executive_summary/editorial_overview、research_framework/method_rail、segmentation_map/positioning_map、persona/profile_evidence、journey/journey_curve、concept_definition/nested_definition、needs_pyramid/evidence_pyramid、priority_matrix/impact_frequency、problem_reason/fishbone、recommendation/action_roadmap 和 quote_evidence/voice_wall；每页只表达一个核心结论，并绑定真实 Evidence 与 Transcript Quote。没有坐标、层级或画像证据时不得编造对应页面。",
      { artifactId: outlineArtifact.id },
    );
    scriptArtifact = scriptResult.artifact_created;
    script = scriptResult.ppt_script;
  }
  if (!scriptArtifact?.id || !script?.pages?.length) throw new Error("PPT Script 未生成有效页面。");

  const currentProfile = script.style_profile && typeof script.style_profile === "object"
    ? script.style_profile
    : {};
  const desiredProfile = templateId === TECH_BLUE_V2 ? {
    ...currentProfile,
    id: TECH_BLUE_V2,
    aspect_ratio: "16:9",
    background: "ice_white",
    primary_color: "technology_blue",
    body_color: "deep_text",
    decoration: "restrained",
    icon_usage: "limited",
    title_style: "conclusion",
    preferred_font: "微软雅黑",
    forbid_left_vertical_bar: true,
  } : { ...currentProfile, id: templateId };
  if (JSON.stringify(currentProfile) !== JSON.stringify(desiredProfile)) {
    const parentScriptArtifact = scriptArtifact;
    script = { ...script, style_profile: desiredProfile };
    const revisionResult = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "ppt_script",
        title: script.title,
        content: JSON.stringify(script, null, 2),
        parent_artifact_id: parentScriptArtifact.id,
      }),
    });
    scriptArtifact = revisionResult.artifact || revisionResult;
    console.log(`  已固化模板升级版本：${parentScriptArtifact.id} → ${scriptArtifact.id} (${templateId})`);
  }
  await saveCheckpoint("ppt_script", "completed", { project: { id: project.id, title: project.title }, artifact_id: scriptArtifact.id, quality: scriptResult.quality, page_count: script.pages.length });

  console.log(`[7/9] 使用 OfficeCLI / ${templateId} 生成全部真实逐页预览`);
  const artifactsBeforePreview = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/artifacts`);
  const pptArtifactCountBeforePreview = (artifactsBeforePreview.artifacts || []).filter((item) => item.type === "qualitative_ppt").length;
  const preview = await requestJson(baseUrl, "/pptx-api/qualitative-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Project-Id": project.id },
    body: JSON.stringify({ project_id: project.id, script, template_id: templateId }),
  });
  if (preview.renderer?.engine !== "officecli" || preview.renderer?.artifact_created !== false) throw new Error("真实预览必须由 OfficeCLI 临时渲染且不得创建 Artifact。");
  if (!preview.slides?.length || preview.slides.length !== preview.slide_count) throw new Error("真实预览未返回完整逐页缩略图。");
  const previewDir = path.join(outputDir, "preview-slides");
  await fs.mkdir(previewDir, { recursive: true });
  for (const [index, slide] of preview.slides.entries()) {
    const png = Buffer.from(slide.thumbnail_base64 || "", "base64");
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`预览第 ${index + 1} 页不是有效 PNG。`);
    await fs.writeFile(path.join(previewDir, `slide-${String(index + 1).padStart(2, "0")}.png`), png);
  }
  const artifactsAfterPreview = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/artifacts`);
  const pptArtifactCountAfterPreview = (artifactsAfterPreview.artifacts || []).filter((item) => item.type === "qualitative_ppt").length;
  if (pptArtifactCountAfterPreview !== pptArtifactCountBeforePreview) throw new Error("真实预览错误创建了 qualitative_ppt Artifact。");

  console.log(`[8/9] 使用 OfficeCLI / ${templateId} 正式渲染 ${script.pages.length} 个 Script 页面`);
  const rendered = await requestJson(baseUrl, "/pptx-api/qualitative-report", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Project-Id": project.id },
    body: JSON.stringify({ project_id: project.id, script }),
  });
  if (!rendered.content_base64) throw new Error("PPT 渲染结果缺少文件内容。");
  if (!allowFallback && rendered.renderer?.engine !== "officecli") {
    throw new Error(`真实项目验收要求 OfficeCLI，实际为 ${rendered.renderer?.engine || "unknown"}。`);
  }
  if (templateId === TECH_BLUE_V2 && rendered.layout_adaptations?.profile !== TECH_BLUE_V2) {
    throw new Error(`模板路由未生效：${rendered.layout_adaptations?.profile || "unknown"}。`);
  }
  if (!rendered.object_counts?.editable_native || rendered.object_counts?.full_slide_images) {
    throw new Error("真实项目验收要求对象级可编辑且禁止整页图片。");
  }
  const pptxBytes = Buffer.from(rendered.content_base64, "base64");
  const outputFilename = `${safeFilename(rendered.filename || script.title || projectTitle)}.pptx`.replace(/\.pptx\.pptx$/i, ".pptx");
  const outputPath = path.join(outputDir, outputFilename);
  await fs.writeFile(outputPath, pptxBytes);

  const uploadedPpt = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/files`, {
    method: "POST",
    headers: {
      "Content-Type": PPTX_MIME,
      "X-Research-File-Name": encodeURIComponent(outputFilename),
      "X-Research-File-Category": "other",
    },
    body: pptxBytes,
  });
  const analysisArtifacts = [analysisArtifact.id];
  const metadata = {
    schema_version: "surveykit.qualitative_ppt.v1",
    template_id: templateId,
    file_id: uploadedPpt.file.id,
    file_name: uploadedPpt.file.file_name,
    source_report_outline: outlineArtifact.id,
    source_ppt_script: scriptArtifact.id,
    source_analysis_artifacts: analysisArtifacts,
    slide_count: rendered.slide_count,
    validation: rendered.validation,
    object_counts: rendered.object_counts,
    renderer: rendered.renderer,
    quality_gate: rendered.quality_gate,
    layout_adaptations: rendered.layout_adaptations,
    render_llm_tokens: rendered.llm_tokens,
    generated_at: new Date().toISOString(),
  };
  const pptArtifactResult = await requestJson(baseUrl, `/api/research/projects/${encodeURIComponent(project.id)}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "qualitative_ppt", title: script.title || `${projectTitle}定性研究报告`, content: JSON.stringify(metadata, null, 2) }),
  });

  console.log("[9/9] 输出不含访谈正文的验收审计记录");
  const audit = {
    schema_version: "surveykit.real_qualitative_ppt_acceptance.v2",
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    project: { id: project.id, title: project.title },
    inputs: { available_transcript_count: transcripts.length, analyzed_transcript_count: analysisFileIds.length, summaries_requested: !skipSummaries },
    artifacts: {
      qualitative_analysis: { id: analysisArtifact.id, version: analysisArtifact.version, quality: analysisResult.quality },
      report_outline: { id: outlineArtifact.id, version: outlineArtifact.version, quality: outlineResult.quality },
      ppt_script: { id: scriptArtifact.id, version: scriptArtifact.version, quality: scriptResult.quality, page_count: script.pages.length },
      qualitative_ppt: { id: (pptArtifactResult.artifact || pptArtifactResult).id, version: (pptArtifactResult.artifact || pptArtifactResult).version },
    },
    preview: {
      renderer: preview.renderer,
      slide_count: preview.slide_count,
      rendered_slide_count: preview.rendered_slide_count,
      quality_gate: preview.quality_gate,
      validation: preview.validation,
      layout_adaptations: preview.layout_adaptations,
      artifact_count_unchanged: pptArtifactCountAfterPreview === pptArtifactCountBeforePreview,
      output_directory: previewDir,
    },
    render: {
      template_id: templateId,
      output_path: outputPath,
      slide_count: rendered.slide_count,
      renderer: rendered.renderer,
      quality_gate: rendered.quality_gate,
      validation: rendered.validation,
      object_counts: rendered.object_counts,
      layout_adaptations: rendered.layout_adaptations,
      llm_tokens: rendered.llm_tokens,
    },
  };
  const auditPath = path.join(outputDir, "real-qualitative-ppt-acceptance.json");
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, project_id: project.id, transcript_count: transcripts.length, pptx: outputPath, audit: auditPath }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message, status: error.status || null, type: error.payload?.error?.type || null }, null, 2));
  process.exitCode = 1;
});
