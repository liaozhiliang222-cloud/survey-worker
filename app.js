const views = document.querySelectorAll(".view");
const navItems = document.querySelectorAll(".nav-item");
const jumpCards = document.querySelectorAll("[data-jump]");

const typoRules = [
  ["请选则", "疑似错字：请选则", "建议改为“请选择”。"],
  ["瓶牌", "疑似错字：瓶牌", "如果这里指品牌名称或品牌选择，建议改为“品牌”。"],
  ["牌品", "疑似错字：牌品", "如果这里指品牌名称或品牌选择，建议改为“品牌”。"],
  ["品脾", "疑似错字：品脾", "如果这里指品牌名称或品牌选择，建议改为“品牌”。"],
  ["产牌", "疑似错字：产牌", "如果这里指产品或品牌，请确认是否应改为“品牌”或“产品”。"],
  ["登陆", "用词不统一：登陆", "如指账号操作，建议统一为“登录”。"],
  ["帐号", "用词不统一：帐号", "建议与项目标准统一，常见写法为“账号”。"],
  ["价钱", "口语化表述：价钱", "价格研究中建议统一为“价格”。"],
  ["非常满", "疑似漏字：非常满", "请确认是否应为“非常满意”。"],
  ["比交", "疑似错字：比交", "请确认是否应为“比较”。"],
  ["添写", "疑似错字：添写", "请确认是否应为“填写”。"],
  ["是否愿意购买吗", "句式重复", "建议改为“您是否愿意购买？”或“您愿意购买吗？”。"]
];

const exampleQuestionnaire = `Q1. 您的性别是？
A. 男
B. 女

Q2. 您的年龄是？
A. 18-29岁
B. 30-39岁
C. 40岁以上

Q3. 您是否购买过本产品？
A. 是 → 跳至 Q5
B. 否 → 跳至 Q9

Q4. 您最近一次购买的渠道是？
A. 线上
B. 线上
C. 线下
D. 其他

Q5. 请选则您最常购买的品牌
A. 品牌A
B. 品牌B
C. 以上都没有

Q6. 请对以下卖点进行评分，1=非常满意，5=非常不满意
随机呈现：口味、包装、价格、购买便利性、其他

Q7. 为保证答题质量，请选择“比较同意”
A. 非常同意
B. 比较同意
C. 不同意

Q8. 请说明您选择该品牌的主要原因

Q9. 如果 Q3 选择 A，跳到 Q6`;

const examplePsmData = `80,160,260,340
100,180,280,360
120,200,300,380
140,220,320,400
160,240,340,420
180,260,360,440
200,280,380,460
220,300,400,480
240,320,420,500
260,340,440,520
280,360,460,540
300,380,480,560
240,300,340,380
260,320,360,400
280,340,380,420
300,360,400,440
320,380,420,460
340,400,440,480
360,420,460,500
380,440,480,520`;

const exampleKanoData = `配送速度,42,38,16,20,3,1
包装设计,36,22,8,48,4,2
价格优惠,28,46,18,24,3,1
客服响应,18,34,42,20,4,2
会员积分,30,18,10,58,3,1
售后保障,12,32,48,24,3,1`;

const exampleMaxDiffItems = `口味更好
包装更高级
价格更划算
购买更方便
品牌更可靠
成分更健康
规格更合适
售后更安心`;

const exampleMaxDiffScoreData = `口味更好,48,12,80
包装更高级,32,22,80
价格更划算,44,18,80
购买更方便,26,28,80
品牌更可靠,38,20,80
成分更健康,34,24,80
规格更合适,20,36,80
售后更安心,30,26,80`;

const exampleAbcQuestionnaire = `Q1. 您对本产品的整体满意度如何？
A. 非常满意
B. 比较满意
C. 一般
D. 不太满意
E. 非常不满意

Q2. 您有多大可能向朋友或同事推荐本产品？0-10分

Q3. 未来 3 个月，您继续购买本产品的可能性是？
A. 一定会
B. 可能会
C. 不确定
D. 可能不会

Q4. 您通常多久使用一次本产品？
A. 每天
B. 每周数次
C. 每月数次
D. 偶尔

Q5. 您主要在哪些场景使用本产品？
A. 工作
B. 家庭
C. 外出
D. 社交

Q6. 过去 30 天，您购买该品类的金额大约是多少？
A. 100元以下
B. 100-299元
C. 300-499元
D. 500元及以上

Q7. 您一年内购买该品类的频次是？
A. 1-2次
B. 3-5次
C. 6次及以上

Q8. 您目前最常购买的品牌是？
A. 品牌A
B. 品牌B
C. 其他`;

const exampleCrosstabData = `性别,是否购买,满意度
男,是,满意
男,是,满意
男,否,一般
男,否,不满意
男,是,满意
女,是,满意
女,否,一般
女,否,一般
女,是,满意
女,否,不满意
男,是,一般
女,是,满意`;

const exampleWeightingSampleData = `性别,年龄段,城市级别
男,18-29,一线
男,30-39,新一线
女,18-29,一线
女,30-39,二线
女,30-39,新一线
女,40+,二线
男,18-29,一线
女,18-29,新一线
女,30-39,二线
男,40+,二线`;

const exampleWeightingTargetData = `性别,男,50
性别,女,50
年龄段,18-29,35
年龄段,30-39,40
年龄段,40+,25
城市级别,一线,30
城市级别,新一线,35
城市级别,二线,35`;

let lastPsmAnalysis = null;
let lastAuditReport = null;
let lastKanoAnalysis = null;
let lastMaxDiffDesign = null;
let lastMaxDiffScore = null;
let lastAiPrompt = "";
let lastAbcSuggestions = null;
let lastCrosstabAnalysis = null;
let lastQuestionPivot = null;
let lastCrosstabHeaderPlan = null;
let crosstabImportMode = "data";
let lastCrosstabDataContext = null;
let lastWeightingResult = null;
let lastCleaningRules = null;
let lastHeaderPlan = null;
let workspaceProject = null;
let pendingQuestionnaireImport = "";
let sharedImportTargetId = "";

function showView(id) {
  views.forEach((view) => view.classList.toggle("active", view.id === id));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === id));
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    if (!item.dataset.view) return;
    showView(item.dataset.view);
  });
});

jumpCards.forEach((card) => {
  card.addEventListener("click", () => showView(card.dataset.jump));
});

function formatShortDate(value) {
  if (!value) return "未保存";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getWorkspaceFormProject() {
  return {
    projectName: document.querySelector("#workspaceProjectName").value.trim(),
    studyType: document.querySelector("#workspaceStudyType").value,
    stage: document.querySelector("#workspaceStage").value,
    sampleTarget: Number(document.querySelector("#workspaceSampleTarget").value) || 0,
    questionnaireText: document.querySelector("#workspaceQuestionnaire").value.trim(),
    updatedAt: workspaceProject?.updatedAt || null,
    status: {
      projectBrief: Boolean(document.querySelector("#workspaceProjectName").value.trim()),
      questionnaire: Boolean(document.querySelector("#workspaceQuestionnaire").value.trim()),
      audit: Boolean(lastAuditReport),
      quota: false,
      cleaning: false,
      header: false,
      models: Boolean(lastPsmAnalysis || lastKanoAnalysis || lastMaxDiffDesign || lastMaxDiffScore || lastAbcSuggestions)
    }
  };
}

function saveWorkspaceProject() {
  workspaceProject = getWorkspaceFormProject();
  workspaceProject.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem("surveyWorkspaceProject", JSON.stringify(workspaceProject));
  } catch {
    // 隐私模式忽略写入
  }
  applyWorkspaceProject(false);
  renderWorkspaceProject();
}

function loadWorkspaceProject() {
  const raw = localStorage.getItem("surveyWorkspaceProject");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fillWorkspaceProject(project) {
  if (!project) return;
  document.querySelector("#workspaceProjectName").value = project.projectName || "";
  document.querySelector("#workspaceStudyType").value = project.studyType || "概念测试";
  document.querySelector("#workspaceStage").value = project.stage || "调研前";
  document.querySelector("#workspaceSampleTarget").value = project.sampleTarget || "";
  document.querySelector("#workspaceQuestionnaire").value = project.questionnaireText || "";
}

function setValueIfBlank(selector, value) {
  const field = document.querySelector(selector);
  if (!field || !value) return;
  if (!field.value.trim()) field.value = value;
}

function applyWorkspaceProject(showStatus = true) {
  const project = workspaceProject || getWorkspaceFormProject();
  const questionnaire = project.questionnaireText || "";
  if (project.projectName) setValueIfBlank("#projectName", project.projectName);
  setValueIfBlank("#questionnaireText", questionnaire);
  setValueIfBlank("#timeText", questionnaire);
  setValueIfBlank("#cleaningText", questionnaire);
  setValueIfBlank("#headerText", questionnaire);
  setValueIfBlank("#abcText", questionnaire);
  if (document.querySelector("#aiInput")) setValueIfBlank("#aiInput", questionnaire);
  if (showStatus) {
    document.querySelector("#projectSaveStatus").textContent = "已同步到工具";
  }
}

function clearWorkspaceProject() {
  workspaceProject = null;
  try {
    localStorage.removeItem("surveyWorkspaceProject");
  } catch {
    // 隐私模式忽略
  }
  fillWorkspaceProject({
    projectName: "",
    studyType: "概念测试",
    stage: "调研前",
    sampleTarget: 0,
    questionnaireText: ""
  });
  renderWorkspaceProject();
}

function renderWorkspaceProject() {
  const project = workspaceProject || getWorkspaceFormProject();
  const savedProject = loadWorkspaceProject();
  const savedStatus = savedProject?.status || {};
  const status = {
    ...project.status,
    audit: project.status.audit || savedStatus.audit,
    quota: project.status.quota || savedStatus.quota,
    cleaning: project.status.cleaning || savedStatus.cleaning,
    header: project.status.header || savedStatus.header,
    models: project.status.models || savedStatus.models
  };
  const checks = [
    ["projectBrief", "项目基础信息"],
    ["questionnaire", "问卷稿已保存"],
    ["audit", "上线质检已完成"],
    ["quota", "配额方案已生成"],
    ["cleaning", "清洗规则已生成"],
    ["header", "表头建议已生成"],
    ["models", "专项模型已有结果"]
  ];
  const doneCount = checks.filter(([key]) => status[key]).length;
  const completion = Math.round((doneCount / checks.length) * 100);
  const next = checks.find(([key]) => !status[key]);
  document.querySelector("#projectSummaryName").textContent = project.projectName || "未命名项目";
  document.querySelector("#projectSummaryStage").textContent = project.stage || "未设置";
  document.querySelector("#projectSummarySample").textContent = project.sampleTarget
    ? project.sampleTarget.toLocaleString("zh-CN")
    : "未设置";
  document.querySelector("#projectCompletion").textContent = `${completion}%`;
  document.querySelector("#projectNextAction").textContent = next
    ? `建议补充：${next[1]}。`
    : "项目基础流程已齐，可以进入统一导出。";
  document.querySelector("#projectSaveStatus").textContent = project.updatedAt
    ? `最近保存 ${formatShortDate(project.updatedAt)}`
    : "草稿未保存";
  document.querySelector("#projectChecklist").innerHTML = checks
    .map(([key, label]) => `
      <div class="project-check ${status[key] ? "is-done" : ""}">
        <i>${status[key] ? "✓" : "·"}</i>
        <span>${label}</span>
      </div>
    `)
    .join("");
}

function showButtonSaved(button, text = "已保存") {
  if (!button) return;
  const original = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function markWorkspaceStatus(key, value = true) {
  workspaceProject = loadWorkspaceProject() || getWorkspaceFormProject();
  workspaceProject.status = {
    ...(workspaceProject.status || {}),
    [key]: value
  };
  workspaceProject.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem("surveyWorkspaceProject", JSON.stringify(workspaceProject));
  } catch {
    // 隐私模式忽略写入
  }
  fillWorkspaceProject(workspaceProject);
  renderWorkspaceProject();
}

function syncAuditToWorkspaceDraft() {
  const projectName = document.querySelector("#projectName").value.trim();
  const questionnaireText = document.querySelector("#questionnaireText").value.trim();
  if (projectName && !document.querySelector("#workspaceProjectName").value.trim()) {
    document.querySelector("#workspaceProjectName").value = projectName;
  }
  if (questionnaireText && !document.querySelector("#workspaceQuestionnaire").value.trim()) {
    document.querySelector("#workspaceQuestionnaire").value = questionnaireText;
  }
}

function syncQuestionnaireToWorkspace(value) {
  const text = String(value || "").trim();
  if (!text) return;
  const workspaceField = document.querySelector("#workspaceQuestionnaire");
  if (workspaceField.value !== text) {
    workspaceField.value = text;
  }
  workspaceProject = {
    ...(workspaceProject || loadWorkspaceProject() || getWorkspaceFormProject()),
    questionnaireText: text,
    status: {
      ...((workspaceProject || loadWorkspaceProject())?.status || {}),
      questionnaire: true
    }
  };
  try {
    localStorage.setItem("surveyWorkspaceProject", JSON.stringify(workspaceProject));
  } catch {
    // 隐私模式忽略写入
  }
  renderWorkspaceProject();
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if ((char === "," || char === "，") && !inQuotes) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function decodeXmlText(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function normalizeImportedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function uint8ToString(bytes) {
  let result = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return result;
}

function findZipEntry(bytes, entryName) {
  const nameBytes = new TextEncoder().encode(entryName);
  for (let index = 0; index < bytes.length - 30; index += 1) {
    if (bytes[index] !== 0x50 || bytes[index + 1] !== 0x4b || bytes[index + 2] !== 0x03 || bytes[index + 3] !== 0x04) continue;
    const compression = bytes[index + 8] | (bytes[index + 9] << 8);
    const compressedSize = bytes[index + 18] | (bytes[index + 19] << 8) | (bytes[index + 20] << 16) | (bytes[index + 21] << 24);
    const fileNameLength = bytes[index + 26] | (bytes[index + 27] << 8);
    const extraLength = bytes[index + 28] | (bytes[index + 29] << 8);
    const nameStart = index + 30;
    const name = bytes.subarray(nameStart, nameStart + fileNameLength);
    const dataStart = nameStart + fileNameLength + extraLength;
    const matched = name.length === nameBytes.length && name.every((byte, byteIndex) => byte === nameBytes[byteIndex]);
    if (matched) {
      return {
        compression,
        data: bytes.subarray(dataStart, dataStart + compressedSize)
      };
    }
    index = dataStart + Math.max(0, compressedSize) - 1;
  }
  return null;
}

async function readZipText(arrayBuffer, entryName) {
  const entry = findZipEntry(new Uint8Array(arrayBuffer), entryName);
  if (!entry) return "";
  if (entry.compression === 0) return uint8ToString(entry.data);
  if (entry.compression === 8 && "DecompressionStream" in window) {
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }
  throw new Error("当前浏览器不支持解析该压缩格式，请尝试另存为 TXT 或 CSV 后导入。");
}

function docxXmlToText(xml) {
  const paragraphs = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)]
    .map((match) => {
      const paragraph = match[0]
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br\/>/g, "\n");
      return [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((textMatch) => decodeXmlText(textMatch[1]))
        .join("");
    })
    .map((line) => line.trim())
    .filter(Boolean);
  return normalizeImportedText(paragraphs.join("\n"));
}

async function docxToQuestionnaireText(arrayBuffer) {
  const xml = await readZipText(arrayBuffer, "word/document.xml");
  return docxXmlToText(xml);
}

function sharedStringsFromXml(xml) {
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) =>
    [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => decodeXmlText(textMatch[1])).join("")
  );
}

function columnIndexFromRef(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || "";
  return letters.toUpperCase().split("").reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xlsxSheetXmlToRows(xml, sharedStrings) {
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = [];
    [...rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].forEach((cellMatch, fallbackIndex) => {
      const attrs = cellMatch[1];
      const body = cellMatch[2] || "";
      const ref = attrs.match(/r="([^"]+)"/)?.[1] || "";
      const columnIndex = Math.max(0, columnIndexFromRef(ref));
      const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || "";
      const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => decodeXmlText(textMatch[1])).join("");
      const cellValue = /t="s"/.test(attrs) ? sharedStrings[Number(value)] || "" : decodeXmlText(inline || value);
      row[Number.isFinite(columnIndex) ? columnIndex : fallbackIndex] = cellValue;
    });
    return Array.from({ length: row.length }, (_, index) => row[index] ?? "");
  }).filter((row) => row.some(Boolean));
}

function getWorkbookSheetPaths(workbookXml, relationshipXml = "") {
  const sheetIds = [...workbookXml.matchAll(/<sheet[^>]*r:id="([^"]+)"/g)].map((match) => match[1]);
  const relationshipMap = new Map(
    [...relationshipXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
      .map((match) => [match[1], match[2].startsWith("/") ? match[2].slice(1) : `xl/${match[2]}`])
  );
  if (!sheetIds.length) return ["xl/worksheets/sheet1.xml"];
  return sheetIds.map((sheetId, index) => {
    if (relationshipMap.has(sheetId)) return relationshipMap.get(sheetId);
    const number = sheetId.match(/\d+/)?.[0] || String(index + 1);
    return `xl/worksheets/sheet${number}.xml`;
  });
}

async function xlsxToQuestionnaireText(arrayBuffer) {
  const sharedXml = await readZipText(arrayBuffer, "xl/sharedStrings.xml").catch(() => "");
  const workbookXml = await readZipText(arrayBuffer, "xl/workbook.xml").catch(() => "");
  const relationshipXml = await readZipText(arrayBuffer, "xl/_rels/workbook.xml.rels").catch(() => "");
  const sharedStrings = sharedStringsFromXml(sharedXml);
  const sheetPaths = getWorkbookSheetPaths(workbookXml, relationshipXml);
  const sheetTexts = [];
  for (const [index, sheetPath] of sheetPaths.entries()) {
    const sheetXml = await readZipText(arrayBuffer, sheetPath).catch(() => "");
    if (!sheetXml) continue;
    const rows = xlsxSheetXmlToRows(sheetXml, sharedStrings);
    const text = rowsToQuestionnaireText(rows);
    if (text) sheetTexts.push(`【Sheet ${index + 1}】\n${text}`);
  }
  return sheetTexts.join("\n\n");
}

function normalizeCodebookTitle(variable, text) {
  return String(text || "")
    .replace(new RegExp(`^${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.．]?\\s*`, "i"), "")
    .replace(/【[^】]*】/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCodebookRows(rows) {
  const codebook = {};
  let current = null;

  rows.forEach((row) => {
    const line = row.map((cell) => String(cell || "").trim()).filter(Boolean).join(" ").trim();
    if (!line || /^本题选项/.test(line)) return;

    const questionMatch = line.match(/^([A-Za-z][A-Za-z0-9_]*?)\s*[.．]\s*(.+)$/);
    if (questionMatch) {
      const variable = questionMatch[1].trim();
      const title = normalizeCodebookTitle(variable, questionMatch[2]);
      current = { variable, title: title || variable, options: {} };
      codebook[variable] = current;
      return;
    }

    const optionMatch = line.match(/^([0-9]+)\s*[.．、]\s*(.+)$/);
    if (optionMatch && current) {
      current.options[optionMatch[1]] = optionMatch[2].trim();
    }
  });

  return codebook;
}

function getMappedVariableInfo(variable, codebook) {
  if (codebook[variable]) {
    return { source: variable, title: `${variable} ${codebook[variable].title}`, options: codebook[variable].options, binary: false };
  }

  const multiMatch = String(variable).match(/^(.+)__([0-9]+)$/);
  if (multiMatch && codebook[multiMatch[1]]) {
    const parent = codebook[multiMatch[1]];
    const optionLabel = parent.options[multiMatch[2]] || `选项${multiMatch[2]}`;
    return {
      source: multiMatch[1],
      title: `${multiMatch[1]}__${multiMatch[2]} ${optionLabel}`,
      parentTitle: `${multiMatch[1]} ${parent.title}`,
      optionLabel,
      optionCode: multiMatch[2],
      options: { "0": "未选", "1": "选中" },
      binary: true
    };
  }

  return { source: variable, title: variable, options: {}, binary: false };
}

function rowsToMappedDelimitedTable(rows, codebook) {
  if (!rows.length) return "";
  const sourceHeaders = rows[0].map((cell, index) => String(cell || `字段${index + 1}`).trim());
  const usedHeaders = new Map();
  const headerInfos = sourceHeaders.map((header) => {
    const info = getMappedVariableInfo(header, codebook);
    const baseTitle = info.title || header;
    const count = usedHeaders.get(baseTitle) || 0;
    usedHeaders.set(baseTitle, count + 1);
    return {
      ...info,
      sourceHeader: header,
      title: count ? `${baseTitle}_${count + 1}` : baseTitle
    };
  });

  const mappedRows = rows.slice(1).map((row) =>
    headerInfos.map((info, index) => {
      const rawValue = String(row[index] ?? "").trim();
      if (!rawValue) return "";
      if (info.options[rawValue]) return info.options[rawValue];
      return rawValue;
    })
  );
  const displayHeaders = headerInfos.map((info) => info.title);
  lastCrosstabDataContext = {
    rawHeaders: sourceHeaders,
    displayHeaders,
    headerInfos,
    rawRows: rows.slice(1).map((row) =>
      sourceHeaders.reduce((record, header, index) => {
        record[header] = String(row[index] ?? "").trim();
        return record;
      }, {})
    ),
    displayRows: mappedRows.map((row) =>
      displayHeaders.reduce((record, header, index) => {
        record[header] = row[index] ?? "";
        return record;
      }, {})
    )
  };

  return [displayHeaders, ...mappedRows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function rowsToDelimitedTableWithContext(rows) {
  if (!rows.length) return "";
  const headers = rows[0].map((cell, index) => String(cell || `字段${index + 1}`).trim());
  const dataRows = rows.slice(1);
  lastCrosstabDataContext = {
    rawHeaders: headers,
    displayHeaders: headers,
    headerInfos: headers.map((header) => ({ sourceHeader: header, source: header, title: header, options: {}, binary: false })),
    rawRows: dataRows.map((row) => headers.reduce((record, header, index) => {
      record[header] = String(row[index] ?? "").trim();
      return record;
    }, {})),
    displayRows: dataRows.map((row) => headers.reduce((record, header, index) => {
      record[header] = String(row[index] ?? "").trim();
      return record;
    }, {}))
  };
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

async function xlsxToDelimitedTableText(arrayBuffer) {
  const sharedXml = await readZipText(arrayBuffer, "xl/sharedStrings.xml").catch(() => "");
  const workbookXml = await readZipText(arrayBuffer, "xl/workbook.xml").catch(() => "");
  const relationshipXml = await readZipText(arrayBuffer, "xl/_rels/workbook.xml.rels").catch(() => "");
  const sharedStrings = sharedStringsFromXml(sharedXml);
  const sheetPaths = getWorkbookSheetPaths(workbookXml, relationshipXml);
  const sheets = [];

  for (const [index, sheetPath] of sheetPaths.entries()) {
    const sheetXml = await readZipText(arrayBuffer, sheetPath).catch(() => "");
    if (!sheetXml) continue;
    const rows = xlsxSheetXmlToRows(sheetXml, sharedStrings);
    if (rows.length) sheets.push({ index, rows });
  }

  const codeSheet = sheets.find((sheet) =>
    sheet.rows.some((row) => row.some((cell) => /^本题选项/.test(String(cell || "").trim())))
  ) || sheets[1];
  const codebook = codeSheet ? parseCodebookRows(codeSheet.rows) : {};
  const dataSheet = sheets.find((sheet) => sheet !== codeSheet && sheet.rows.length >= 2) || sheets[0];
  if (!dataSheet || dataSheet.rows.length < 2) return "";
  if (Object.keys(codebook).length) return rowsToMappedDelimitedTable(dataSheet.rows, codebook);
  return rowsToDelimitedTableWithContext(dataSheet.rows);
}

function decodeSavText(bytes) {
  const cleaned = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const end = cleaned.findIndex((byte) => byte === 0);
  const slice = cleaned.slice(0, end >= 0 ? end : cleaned.length);
  try {
    const utf8 = new TextDecoder("utf-8").decode(slice).trim();
    if (!utf8.includes("�")) return utf8;
    return new TextDecoder("gb18030").decode(slice).trim();
  } catch (error) {
    return new TextDecoder("gb18030").decode(slice).trim();
  }
}

function savPad(length, unit = 4) {
  return (unit - (length % unit)) % unit;
}

function savNumberText(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e100) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
}

function savLabelKey(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Number.isInteger(numeric) ? String(numeric) : String(Number(numeric.toFixed(10)));
  return String(value || "").trim();
}

function savValueFromBytes(bytes, variable) {
  if (variable.type === 0) {
    const number = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
    return savNumberText(number);
  }
  return decodeSavText(bytes).slice(0, Math.max(0, variable.type)).trim();
}

function savFormatDisplayValue(variable, rawValue) {
  if (!rawValue) return "";
  return variable.valueLabels?.get(savLabelKey(rawValue)) || rawValue;
}

function savUniqueHeader(headers, title) {
  const base = title || `字段${headers.length + 1}`;
  let candidate = base;
  let index = 2;
  while (headers.includes(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

function savToDelimitedTableText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const magic = decodeSavText(bytes.slice(0, 4));
  if (magic !== "$FL2" && magic !== "$FL3") throw new Error("当前文件不是标准 SPSS SAV 文件。");

  const littleEndian = view.getInt32(64, true) === 2 || view.getInt32(64, true) === 3;
  const caseSize = view.getInt32(68, littleEndian);
  const compression = view.getInt32(72, littleEndian);
  const caseCount = view.getInt32(80, littleEndian);
  const bias = view.getFloat64(84, littleEndian) || 100;
  let offset = 176;
  const records = [];
  let pendingLabels = null;

  const readInt = () => {
    const value = view.getInt32(offset, littleEndian);
    offset += 4;
    return value;
  };

  while (offset + 4 <= bytes.length) {
    const recordType = readInt();
    if (recordType === 2) {
      const variableType = readInt();
      const hasLabel = readInt();
      const missingCount = readInt();
      readInt();
      readInt();
      const name = decodeSavText(bytes.slice(offset, offset + 8)).replace(/\s+/g, "");
      offset += 8;
      let label = "";
      if (hasLabel) {
        const labelLength = readInt();
        label = decodeSavText(bytes.slice(offset, offset + labelLength));
        offset += labelLength + savPad(labelLength, 4);
      }
      offset += Math.abs(missingCount) * 8;
      records.push({
        type: variableType,
        name,
        label,
        valueLabels: new Map()
      });
    } else if (recordType === 3) {
      const labelCount = readInt();
      pendingLabels = [];
      for (let index = 0; index < labelCount; index += 1) {
        const valueBytes = bytes.slice(offset, offset + 8);
        offset += 8;
        const labelLength = bytes[offset] || 0;
        offset += 1;
        const label = decodeSavText(bytes.slice(offset, offset + labelLength));
        offset += labelLength + savPad(labelLength + 1, 8);
        pendingLabels.push({ valueBytes, label });
      }
    } else if (recordType === 4) {
      const variableCount = readInt();
      const indexes = Array.from({ length: variableCount }, () => readInt() - 1);
      indexes.forEach((recordIndex) => {
        const variable = records[recordIndex];
        if (!variable || !pendingLabels) return;
        pendingLabels.forEach((item) => {
          const key = variable.type === 0
            ? savLabelKey(new DataView(item.valueBytes.buffer, item.valueBytes.byteOffset, item.valueBytes.byteLength).getFloat64(0, littleEndian))
            : savLabelKey(decodeSavText(item.valueBytes).trim());
          variable.valueLabels.set(key, item.label);
        });
      });
      pendingLabels = null;
    } else if (recordType === 6) {
      const lineCount = readInt();
      offset += lineCount * 80;
    } else if (recordType === 7) {
      readInt();
      const size = readInt();
      const count = readInt();
      offset += size * count;
    } else if (recordType === 999) {
      offset += 4;
      break;
    } else {
      throw new Error(`暂不支持的 SAV 字典记录类型：${recordType}`);
    }
  }

  const activeVariables = [];
  records.forEach((record) => {
    if (record.type !== -1) activeVariables.push(record);
  });
  if (!activeVariables.length || caseCount <= 0) throw new Error("SAV 文件中未识别到有效变量或样本。");

  let savInstructionQueue = [];
  const nextUnit = () => {
    if (compression === 0) {
      const unit = bytes.slice(offset, offset + 8);
      offset += 8;
      return { bytes: unit };
    }
    while (offset < bytes.length) {
      if (!savInstructionQueue.length) {
        savInstructionQueue = Array.from(bytes.slice(offset, offset + 8));
        offset += 8;
      }
      const code = savInstructionQueue.shift();
      if (code === 0) continue;
      if (code === 252) return { eof: true };
      if (code === 253) {
        const unit = bytes.slice(offset, offset + 8);
        offset += 8;
        return { bytes: unit };
      }
      if (code === 254) return { bytes: new Uint8Array(8).fill(32) };
      if (code === 255) return { missing: true, bytes: new Uint8Array(8) };
      return { number: code - bias };
    }
    return { eof: true };
  };

  const displayHeaders = [];
  const headerInfos = [];
  activeVariables.forEach((variable) => {
    const title = savUniqueHeader(displayHeaders, variable.label ? `${variable.name} ${variable.label}` : variable.name);
    displayHeaders.push(title);
    const fullLabel = variable.label || "";
    const optionMatch = fullLabel.match(/[:：]([^:：]+)$/);
    const parentTitle = optionMatch ? fullLabel.replace(/[:：][^:：]+$/, "").trim() : fullLabel;
    const optionLabel = optionMatch ? optionMatch[1].trim() : null;
    headerInfos.push({
      sourceHeader: variable.name,
      source: variable.name,
      title,
      parentTitle,
      optionLabel,
      options: Object.fromEntries(variable.valueLabels.entries()),
      binary: false
    });
  });

  const rawRows = [];
  const displayRows = [];
  for (let caseIndex = 0; caseIndex < caseCount; caseIndex += 1) {
    const rawRow = {};
    const displayRow = {};
    let activeIndex = 0;
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      const record = records[recordIndex];
      if (record.type === 0) {
        const unit = nextUnit();
        const rawValue = unit.missing || unit.eof
          ? ""
          : unit.number !== undefined
            ? savNumberText(unit.number)
            : savValueFromBytes(unit.bytes, record);
        if (record.name) {
          const displayHeader = displayHeaders[activeIndex];
          rawRow[record.name] = rawValue;
          displayRow[displayHeader] = savFormatDisplayValue(record, rawValue);
          activeIndex += 1;
        }
      } else if (record.type > 0) {
        const slotCount = Math.ceil(record.type / 8);
        const chunks = [];
        for (let slot = 0; slot < slotCount; slot += 1) {
          const unit = nextUnit();
          chunks.push(unit.bytes || new Uint8Array(8));
        }
        const rawValue = decodeSavText(Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))).slice(0, record.type).trim();
        const displayHeader = displayHeaders[activeIndex];
        rawRow[record.name] = rawValue;
        displayRow[displayHeader] = savFormatDisplayValue(record, rawValue);
        activeIndex += 1;
        recordIndex += slotCount - 1;
      } else {
        nextUnit();
      }
    }
    rawRows.push(rawRow);
    displayRows.push(displayRow);
  }

  lastCrosstabDataContext = {
    rawHeaders: activeVariables.map((variable) => variable.name),
    displayHeaders,
    headerInfos,
    rawRows,
    displayRows
  };

  return [
    displayHeaders,
    ...displayRows.map((row) => displayHeaders.map((header) => row[header] ?? ""))
  ].map((row) => row.map(csvCell).join(",")).join("\n");
}

function forwardFillRow(row) {
  let current = "";
  return row.map((cell) => {
    const value = String(cell || "").trim();
    if (value) current = value;
    return current;
  });
}

function isHeaderConditionCell(value) {
  return /[A-Za-z]+\d+(?:[-_]\d+)?\s*(?:=|＝)\s*R?\d+/i.test(String(value || ""));
}

function cleanCrosstabGroupCell(value) {
  const text = String(value || "").trim();
  return /^\d+$/.test(text) ? "" : text;
}

function cleanCrosstabConditionCell(value) {
  const text = String(value || "").trim();
  return isHeaderConditionCell(text) ? text : "";
}

function rowNonEmptyCount(row) {
  return row.filter((cell) => String(cell || "").trim()).length;
}

function rowConditionCount(row) {
  return row.filter(isHeaderConditionCell).length;
}

function isMostlyNumericHeaderRow(row) {
  const filled = row.map((cell) => String(cell || "").trim()).filter(Boolean);
  if (!filled.length) return false;
  return filled.filter((cell) => /^\d+$/.test(cell)).length / filled.length > 0.6;
}

function findCrosstabHeaderRows(rows) {
  const conditionIndex = rows
    .map((row, index) => ({ index, count: rowConditionCount(row) }))
    .sort((a, b) => b.count - a.count)[0];
  const finalConditionIndex = conditionIndex?.count ? conditionIndex.index : Math.min(2, rows.length - 1);

  let labelIndex = Math.max(0, finalConditionIndex - 1);
  for (let index = finalConditionIndex - 1; index >= 0; index -= 1) {
    if (rowNonEmptyCount(rows[index]) >= 2 && !isMostlyNumericHeaderRow(rows[index])) {
      labelIndex = index;
      break;
    }
  }

  let groupIndex = Math.max(0, labelIndex - 1);
  for (let index = labelIndex - 1; index >= 0; index -= 1) {
    if (rowNonEmptyCount(rows[index]) >= 1 && !isMostlyNumericHeaderRow(rows[index])) {
      groupIndex = index;
      break;
    }
  }

  return {
    groupRow: rows[groupIndex] || [],
    labelRow: rows[labelIndex] || [],
    conditionRow: rows[finalConditionIndex] || []
  };
}

function parseCrosstabHeaderRows(rows) {
  if (rows.length < 2) return [];
  const { groupRow, labelRow, conditionRow } = findCrosstabHeaderRows(rows);
  const groups = forwardFillRow(groupRow.map(cleanCrosstabGroupCell));
  const labels = labelRow || [];
  const conditions = (conditionRow || []).map(cleanCrosstabConditionCell);
  const maxLength = Math.max(groups.length, labels.length, conditions.length);
  const definitions = [];

  for (let index = 0; index < maxLength; index += 1) {
    const group = String(groups[index] || "").trim();
    const label = String(labels[index] || "").trim();
    const condition = String(conditions[index] || "").trim();
    if (/^\d+$/.test(group) && index > 0) {
      const previousGroup = definitions[definitions.length - 1]?.group || "";
      if (previousGroup && !/^\d+$/.test(previousGroup)) groups[index] = previousGroup;
    }
    if (!group && !label && !condition) continue;
    definitions.push({
      group: String(groups[index] || group).trim(),
      label: label || group || `表头${definitions.length + 1}`,
      condition,
      parts: parseHeaderCondition(condition),
      title: [String(groups[index] || group).trim(), label || "总体"].filter(Boolean).join(" / ")
    });
  }

  return definitions;
}

async function xlsxToCrosstabHeaderPlan(arrayBuffer) {
  const sharedXml = await readZipText(arrayBuffer, "xl/sharedStrings.xml").catch(() => "");
  const workbookXml = await readZipText(arrayBuffer, "xl/workbook.xml").catch(() => "");
  const relationshipXml = await readZipText(arrayBuffer, "xl/_rels/workbook.xml.rels").catch(() => "");
  const sharedStrings = sharedStringsFromXml(sharedXml);
  const sheetPaths = getWorkbookSheetPaths(workbookXml, relationshipXml);

  for (const sheetPath of sheetPaths) {
    const sheetXml = await readZipText(arrayBuffer, sheetPath).catch(() => "");
    if (!sheetXml) continue;
    const rows = xlsxSheetXmlToRows(sheetXml, sharedStrings);
    const definitions = parseCrosstabHeaderRows(rows);
    if (definitions.length) return definitions;
  }
  return [];
}

function rowsToQuestionnaireText(rows) {
  if (!rows.length) return "";
  const header = rows[0].map((cell) => String(cell || "").replace(/^\ufeff/, "").trim());
  const hasHeader = header.some((cell) => /题号|编号|题干|题目|文本|问题|选项|说明|备注|跳题/i.test(cell));
  if (!hasHeader) {
    return normalizeImportedText(rows.map((row) => row.filter(Boolean).join(" ")).join("\n"));
  }
  const findIndex = (patterns, fallback) => {
    const index = header.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)));
    return index >= 0 ? index : fallback;
  };
  const idIndex = findIndex([/题号|编号|question/i], 0);
  const titleIndex = findIndex([/题干|题目|文本|问题|title/i], 1);
  const optionIndex = findIndex([/选项|答案|options?/i], 2);
  const noteIndex = findIndex([/说明|备注|跳题|note/i], 3);

  return rows.slice(1)
    .map((row, index) => {
      const id = row[idIndex] || `Q${index + 1}`;
      const title = row[titleIndex] || "";
      const options = String(row[optionIndex] || "")
        .split(/\s*\|\s*|；|;/)
        .map((item) => item.trim())
        .filter(Boolean);
      const note = row[noteIndex] || "";
      return [`${id}. ${title}`.trim(), ...options, note ? `说明：${note}` : ""].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function csvToQuestionnaireText(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  const rows = lines.map(parseCsvLine);
  return rowsToQuestionnaireText(rows);
}

function renderQuestionnaireImportPreview(text, filename = "已导入文件") {
  pendingQuestionnaireImport = normalizeImportedText(text);
  const preview = document.querySelector("#questionnaireImportPreview");
  const applyButton = document.querySelector("#applyQuestionnaireImport");
  if (!pendingQuestionnaireImport) {
    applyButton.disabled = true;
    preview.innerHTML = `<strong>未识别到有效内容</strong><span>请检查文件内容是否为空，或是否为 DOCX / XLSX / Markdown / TXT / CSV 格式。</span>`;
    return;
  }
  const questions = parseQuestions(pendingQuestionnaireImport);
  const optionLines = pendingQuestionnaireImport.split(/\r?\n/).filter((line) => /^[A-ZＡ-Ｚ]\s*[.．、]/i.test(line.trim())).length;
  applyButton.disabled = false;
  preview.innerHTML = `
    <strong>${escapeHtml(filename)}</strong>
    <span>识别题量：${questions.length}；选项行：${optionLines}。预览：${escapeHtml(pendingQuestionnaireImport.slice(0, 120))}${pendingQuestionnaireImport.length > 120 ? "..." : ""}</span>
  `;
}

function applyImportedTextToTarget(text, targetId, filename = "已导入文件") {
  const normalized = normalizeImportedText(text);
  if (!normalized) return;
  const target = document.querySelector(`#${targetId}`);
  if (!target) return;
  target.value = normalized;
  syncQuestionnaireToWorkspace(normalized);
  showButtonSaved(document.querySelector(`[data-import-target="${targetId}"]`), "已导入");
  const preview = document.querySelector("#questionnaireImportPreview");
  if (preview) {
    const questions = parseQuestions(normalized);
    preview.innerHTML = `<strong>${escapeHtml(filename)}</strong><span>已同步到 ${escapeHtml(targetId)}；识别题量：${questions.length}。</span>`;
  }
}

function handleQuestionnaireImport(file, targetId = "") {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const raw = reader.result;
      const text = /\.docx$/i.test(file.name)
        ? await docxToQuestionnaireText(raw)
        : /\.xlsx$/i.test(file.name)
          ? await xlsxToQuestionnaireText(raw)
          : /\.csv$/i.test(file.name)
          ? csvToQuestionnaireText(String(raw || ""))
            : String(raw || "");
      if (targetId) {
        applyImportedTextToTarget(text, targetId, file.name);
      } else {
        renderQuestionnaireImportPreview(text, file.name);
      }
    } catch (error) {
      pendingQuestionnaireImport = "";
      const applyButton = document.querySelector("#applyQuestionnaireImport");
      const preview = document.querySelector("#questionnaireImportPreview");
      applyButton.disabled = true;
      preview.innerHTML = `
        <strong>导入失败</strong>
        <span>${escapeHtml(error.message || "文件解析失败，请尝试另存为 TXT 或 CSV 后导入。")}</span>
      `;
      if (targetId) {
        showButtonSaved(document.querySelector(`[data-import-target="${targetId}"]`), "导入失败");
      }
    }
  };
  if (/\.(docx|xlsx)$/i.test(file.name)) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file, "utf-8");
  }
}

function applyQuestionnaireImport() {
  if (!pendingQuestionnaireImport) return;
  document.querySelector("#workspaceQuestionnaire").value = pendingQuestionnaireImport;
  syncQuestionnaireToWorkspace(pendingQuestionnaireImport);
  applyWorkspaceProject(true);
  showButtonSaved(document.querySelector("#applyQuestionnaireImport"), "已生成并同步");
}

function renderCrosstabImportState(text, filename) {
  const dataField = document.querySelector("#crosstabData");
  dataField.value = normalizeImportedText(text);
  const parsed = detectCrosstabFields();
  const result = document.querySelector("#crosstabResults");
  document.querySelector("#exportCrosstab").disabled = true;
  lastCrosstabAnalysis = null;
  lastQuestionPivot = null;
  result.innerHTML = `
    <div class="empty-state">
      <strong>${escapeHtml(filename)}</strong>
      <span>已导入 ${parsed.rows.length} 行数据，识别字段 ${parsed.headers.length} 个。请选择行变量和列变量后生成交叉表。</span>
    </div>
  `;
}

function renderCrosstabHeaderImportState(definitions, filename) {
  lastCrosstabHeaderPlan = definitions;
  const grouped = definitions.reduce((groups, item) => {
    groups[item.group || "未分组"] = (groups[item.group || "未分组"] || 0) + 1;
    return groups;
  }, {});
  const groupSummary = Object.entries(grouped).map(([group, count]) => `${group} ${count} 列`).join("；");
  document.querySelector("#crosstabResults").innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>${escapeHtml(filename)}</strong>
        <span class="issue-tag low">表头方案</span>
      </div>
      <p>已识别 ${definitions.length} 个表头列。${escapeHtml(groupSummary)}</p>
      <div class="issue-evidence">${escapeHtml(definitions.slice(0, 8).map((item) => `${item.title}${item.condition ? `：${item.condition}` : ""}`).join("\n"))}${definitions.length > 8 ? "\n..." : ""}</div>
    </article>
  `;
}

function handleCrosstabImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const raw = reader.result;
      if (crosstabImportMode === "header") {
        const definitions = /\.xlsx$/i.test(file.name)
          ? await xlsxToCrosstabHeaderPlan(raw)
          : parseCrosstabHeaderRows(String(raw || "").split(/\r?\n/).map(splitDelimitedLine));
        if (!definitions.length) throw new Error("未识别到有效表头方案。");
        renderCrosstabHeaderImportState(definitions, file.name);
        showButtonSaved(document.querySelector("#importCrosstabHeader"), "已导入");
        return;
      }
      const text = /\.sav$/i.test(file.name)
        ? savToDelimitedTableText(raw)
        : /\.xlsx$/i.test(file.name)
          ? await xlsxToDelimitedTableText(raw)
          : String(raw || "");
      if (!normalizeImportedText(text)) throw new Error("未识别到有效数据。");
      renderCrosstabImportState(text, file.name);
      showButtonSaved(document.querySelector("#importCrosstabData"), "已导入");
    } catch (error) {
      document.querySelector("#crosstabResults").innerHTML = `
        <div class="empty-state">
          <strong>导入失败</strong>
          <span>${escapeHtml(error.message || "文件解析失败，请尝试另存为 CSV 后导入。")}</span>
        </div>
      `;
      showButtonSaved(
        document.querySelector(crosstabImportMode === "header" ? "#importCrosstabHeader" : "#importCrosstabData"),
        "导入失败"
      );
    }
  };
  if (/\.(xlsx|sav)$/i.test(file.name)) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file, "utf-8");
  }
}

function calculateSample() {
  const z = Number(document.querySelector("#confidence").value);
  const margin = Number(document.querySelector("#margin").value) / 100;
  const population = Number(document.querySelector("#population").value);
  const segments = Math.max(1, Number(document.querySelector("#segments").value));
  const responseRate = Math.max(1, Number(document.querySelector("#responseRate").value)) / 100;
  const p = 0.5;

  const infiniteSample = (z * z * p * (1 - p)) / (margin * margin);
  const adjustedSample =
    population > 0
      ? infiniteSample / (1 + (infiniteSample - 1) / population)
      : infiniteSample;

  const base = Math.ceil(adjustedSample);
  const segment = Math.ceil(base / segments);
  const gross = Math.ceil(base / responseRate);

  document.querySelector("#baseSample").textContent = base.toLocaleString("zh-CN");
  document.querySelector("#grossSample").textContent = gross.toLocaleString("zh-CN");
  document.querySelector("#segmentSample").textContent = segment.toLocaleString("zh-CN");

  const populationText = population > 0 ? `用户规模 ${population.toLocaleString("zh-CN")}、` : "用户规模不设上限、";
  document.querySelector("#sampleAdvice").textContent =
    `${populationText}允许误差 ${Math.round(margin * 100)}% 时，建议至少回收 ${base.toLocaleString("zh-CN")} 个有效样本；按当前回收率预估需发放 ${gross.toLocaleString("zh-CN")} 份。`;
}

document.querySelectorAll("#sampleForm input, #sampleForm select").forEach((field) => {
  field.addEventListener("input", calculateSample);
});

function parseQuotaItems(value) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rawName, rawShare] = item.split(/[:：]/);
      return {
        name: (rawName || "").trim(),
        share: Number(String(rawShare || "").replace("%", "").trim())
      };
    })
    .filter((item) => item.name && Number.isFinite(item.share) && item.share > 0);
}

function normalizeQuota(items) {
  const total = items.reduce((sum, item) => sum + item.share, 0);
  return total > 0 ? items.map((item) => ({ ...item, weight: item.share / total })) : [];
}

function allocateIntegers(values, total) {
  const floors = values.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  order.forEach(({ index }) => {
    if (remainder <= 0) return;
    floors[index] += 1;
    remainder -= 1;
  });

  return floors;
}

let quotaMode = "single";

function addQuotaOption(dimension, name = "", share = "") {
  const list = dimension.querySelector(".quota-option-list");
  const row = document.createElement("div");
  row.className = "quota-item-row";
  row.innerHTML = `
    <input class="single-quota-name" type="text" placeholder="配额选项" value="${escapeHtml(name)}" />
    <input class="single-quota-share" type="number" min="0" placeholder="比例" value="${escapeHtml(share)}" />
    <button class="icon-btn" type="button" aria-label="删除配额选项">×</button>
  `;
  list.appendChild(row);

  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", calculateQuota);
  });
  row.querySelector("button").addEventListener("click", () => {
    if (list.children.length <= 1) return;
    row.remove();
    calculateQuota();
  });
}

function addQuotaDimension(name = "性别", options = []) {
  const container = document.querySelector("#singleQuotaDimensions");
  const dimension = document.createElement("div");
  dimension.className = "quota-dimension";
  dimension.innerHTML = `
    <span class="quota-dimension-title">配额维度</span>
    <div class="quota-dimension-head">
      <input class="quota-dimension-name" type="text" placeholder="维度名称" value="${escapeHtml(name)}" />
      <button class="icon-btn" type="button" aria-label="删除配额维度">×</button>
    </div>
    <div class="quota-option-list"></div>
    <div class="quota-total-status">合计 0%</div>
    <button class="secondary-btn add-quota-option" type="button">添加配额选项</button>
  `;
  container.appendChild(dimension);

  dimension.querySelector(".quota-dimension-name").addEventListener("input", calculateQuota);
  dimension.querySelector(".quota-dimension-head button").addEventListener("click", () => {
    if (container.children.length <= 1) return;
    dimension.remove();
    calculateQuota();
  });
  dimension.querySelector(".add-quota-option").addEventListener("click", () => {
    addQuotaOption(dimension);
    calculateQuota();
  });

  const initialOptions = options.length ? options : [["选项", 100]];
  initialOptions.forEach(([optionName, share]) => addQuotaOption(dimension, optionName, share));
}

function addCrossQuotaDimension(name = "新维度", value = "选项A:50, 选项B:50") {
  const container = document.querySelector("#crossQuotaDimensions");
  const dimension = document.createElement("div");
  dimension.className = "cross-quota-dimension";
  dimension.innerHTML = `
    <span class="quota-dimension-title">交叉配额维度</span>
    <div class="quota-dimension-head">
      <input class="cross-quota-name" type="text" placeholder="维度名称" value="${escapeHtml(name)}" />
      <button class="icon-btn" type="button" aria-label="删除交叉维度">×</button>
    </div>
    <textarea class="cross-quota-items" placeholder="选项A:50, 选项B:50">${escapeHtml(value)}</textarea>
    <div class="quota-total-status">合计 0%</div>
  `;
  container.appendChild(dimension);

  dimension.querySelectorAll("input, textarea").forEach((field) => {
    field.addEventListener("input", calculateQuota);
  });
  dimension.querySelector("button").addEventListener("click", () => {
    if (container.children.length <= 2) return;
    dimension.remove();
    calculateQuota();
  });
}

function setCrossQuotaDimensions(dimensions) {
  const container = document.querySelector("#crossQuotaDimensions");
  container.innerHTML = "";
  dimensions.forEach((dimension) => addCrossQuotaDimension(dimension.name, dimension.value));
}

function getSingleQuotaDimensions() {
  return Array.from(document.querySelectorAll(".quota-dimension"))
    .map((dimension) => {
      const items = Array.from(dimension.querySelectorAll(".quota-item-row"))
        .map((row) => ({
          name: row.querySelector(".single-quota-name").value.trim(),
          share: Number(row.querySelector(".single-quota-share").value)
        }))
        .filter((item) => item.name && Number.isFinite(item.share) && item.share > 0);

      return {
        element: dimension,
        name: dimension.querySelector(".quota-dimension-name").value.trim(),
        items,
        shareTotal: items.reduce((sum, item) => sum + item.share, 0)
      };
    })
    .filter((dimension) => dimension.name && dimension.items.length);
}

function getCrossQuotaDimensions() {
  return Array.from(document.querySelectorAll(".cross-quota-dimension"))
    .map((dimension) => {
      const items = parseQuotaItems(dimension.querySelector(".cross-quota-items").value);
      return {
        element: dimension,
        name: dimension.querySelector(".cross-quota-name").value.trim(),
        items,
        shareTotal: items.reduce((sum, item) => sum + item.share, 0)
      };
    })
    .filter((dimension) => dimension.name && dimension.items.length);
}

function updateSingleQuotaValidation(dimensions) {
  document.querySelectorAll(".quota-dimension").forEach((dimensionElement) => {
    const status = dimensionElement.querySelector(".quota-total-status");
    const dimension = dimensions.find((item) => item.element === dimensionElement);
    const total = dimension ? dimension.shareTotal : 0;
    const isValid = Math.abs(total - 100) < 0.001;

    status.textContent = isValid
      ? "合计 100%，比例有效"
      : `合计 ${total}%，需调整为 100%`;
    status.classList.toggle("valid", isValid);
    status.classList.toggle("invalid", !isValid);
  });
}

function updateCrossQuotaValidation(dimensions) {
  document.querySelectorAll(".cross-quota-dimension").forEach((dimensionElement) => {
    const status = dimensionElement.querySelector(".quota-total-status");
    const dimension = dimensions.find((item) => item.element === dimensionElement);
    const total = dimension ? dimension.shareTotal : 0;
    const isValid = Math.abs(total - 100) < 0.001;

    status.textContent = isValid
      ? "合计 100%，比例有效"
      : `合计 ${total}%，将自动归一到 100%`;
    status.classList.toggle("valid", isValid);
    status.classList.toggle("invalid", !isValid);
  });
}

function renderSingleDimensionRows(total, dimension) {
  const normalized = normalizeQuota(dimension.items);
  const counts = allocateIntegers(normalized.map((item) => total * item.weight), total);
  return normalized
    .map((item, index) => `
      <tr>
        <td>${escapeHtml(dimension.name)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${item.share}%</td>
        <td>${counts[index]}</td>
      </tr>
    `)
    .join("");
}

function renderSingleQuota(total, dimensions) {
  const table = document.querySelector("#quotaTable");
  updateSingleQuotaValidation(dimensions);

  if (!dimensions.length) {
    table.innerHTML = `<tbody><tr><td>请添加至少一个有效配额维度和配额选项。</td></tr></tbody>`;
    document.querySelector("#quotaSummary").textContent = "等待生成";
    return;
  }

  const rows = dimensions.map((dimension) => renderSingleDimensionRows(total, dimension)).join("");

  table.innerHTML = `
    <thead><tr><th>配额维度</th><th>配额选项</th><th>目标比例</th><th>目标样本量</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
  const invalidCount = dimensions.filter((dimension) => Math.abs(dimension.shareTotal - 100) >= 0.001).length;
  document.querySelector("#quotaSummary").textContent = invalidCount
    ? `${invalidCount} 个维度比例未合计 100%，当前按比例自动归一`
    : `${dimensions.length} 个单一维度，目标样本量 ${total.toLocaleString("zh-CN")}`;
}

function cartesianQuotaCombinations(dimensions) {
  return dimensions.reduce((combinations, dimension) => {
    const normalized = normalizeQuota(dimension.items);
    return combinations.flatMap((combo) =>
      normalized.map((item) => ({
        labels: [...combo.labels, item.name],
        shares: [...combo.shares, item.share],
        weight: combo.weight * item.weight
      }))
    );
  }, [{ labels: [], shares: [], weight: 1 }]);
}

function renderCrossQuota(total, dimensions) {
  const table = document.querySelector("#quotaTable");
  updateCrossQuotaValidation(dimensions);

  if (dimensions.length < 2) {
    table.innerHTML = `<tbody><tr><td>请至少添加两个有效交叉维度。</td></tr></tbody>`;
    document.querySelector("#quotaSummary").textContent = "等待生成";
    return;
  }

  if (dimensions.length === 2) {
    const rows = normalizeQuota(dimensions[0].items);
    const cols = normalizeQuota(dimensions[1].items);
    const rawCells = rows.flatMap((row) => cols.map((col) => total * row.weight * col.weight));
    const allocatedCells = allocateIntegers(rawCells, total);
    const matrix = rows.map((_, rowIndex) =>
      cols.map((__, colIndex) => allocatedCells[rowIndex * cols.length + colIndex])
    );

    const header = `<thead><tr><th>${escapeHtml(dimensions[0].name)} \\ ${escapeHtml(dimensions[1].name)}</th>${cols.map((col) => `<th>${escapeHtml(col.name)}</th>`).join("")}<th>小计</th></tr></thead>`;
    const bodyRows = rows
      .map((row, rowIndex) => {
        const cells = matrix[rowIndex];
        const rowTotal = cells.reduce((sum, value) => sum + value, 0);
        return `<tr><td>${escapeHtml(row.name)}</td>${cells.map((cell) => `<td>${cell}</td>`).join("")}<td>${rowTotal}</td></tr>`;
      })
      .join("");
    const colTotals = cols.map((_, colIndex) => matrix.reduce((sum, row) => sum + row[colIndex], 0));
    const colTotalSum = colTotals.reduce((sum, value) => sum + value, 0);
    const footer = `<tfoot><tr><td>小计</td>${colTotals.map((cell) => `<td>${cell}</td>`).join("")}<td>${colTotalSum}</td></tr></tfoot>`;
    table.innerHTML = `${header}<tbody>${bodyRows}</tbody>${footer}`;
  } else {
    const combinations = cartesianQuotaCombinations(dimensions);
    const counts = allocateIntegers(combinations.map((combo) => total * combo.weight), total);
    const header = `<thead><tr>${dimensions.map((dimension) => `<th>${escapeHtml(dimension.name)}</th>`).join("")}<th>组合比例</th><th>目标样本量</th></tr></thead>`;
    const bodyRows = combinations
      .map((combo, index) => {
        const comboShare = combo.shares.map((share) => `${share}%`).join(" × ");
        return `<tr>${combo.labels.map((label) => `<td>${escapeHtml(label)}</td>`).join("")}<td>${escapeHtml(comboShare)}</td><td>${counts[index]}</td></tr>`;
      })
      .join("");
    const footer = `<tfoot><tr><td colspan="${dimensions.length + 1}">合计</td><td>${counts.reduce((sum, value) => sum + value, 0)}</td></tr></tfoot>`;
    table.innerHTML = `${header}<tbody>${bodyRows}</tbody>${footer}`;
  }

  const invalidCount = dimensions.filter((dimension) => Math.abs(dimension.shareTotal - 100) >= 0.001).length;
  const comboCount = dimensions.reduce((count, dimension) => count * normalizeQuota(dimension.items).length, 1);
  document.querySelector("#quotaSummary").textContent = invalidCount
    ? `${dimensions.length} 个交叉维度，${comboCount} 个组合；${invalidCount} 个维度比例未合计 100%，已自动归一`
    : `${dimensions.length} 个交叉维度，${comboCount} 个组合，目标样本量 ${total.toLocaleString("zh-CN")}`;
}

function calculateQuota() {
  const total = Math.max(1, Number(document.querySelector("#quotaTotal").value));
  const table = document.querySelector("#quotaTable");

  document.querySelector("#quotaTitle").textContent = quotaMode === "single" ? "单一配额表" : "交叉配额表";

  if (quotaMode === "single") {
    renderSingleQuota(total, getSingleQuotaDimensions());
    return;
  }

  renderCrossQuota(total, getCrossQuotaDimensions());
  return;
}

document.querySelectorAll("#quotaForm input").forEach((field) => {
  field.addEventListener("input", calculateQuota);
});

document.querySelectorAll("[data-quota-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    quotaMode = button.dataset.quotaMode;
    document.querySelectorAll("[data-quota-mode]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    document.querySelector("#singleQuotaFields").classList.toggle("active", quotaMode === "single");
    document.querySelector("#crossQuotaFields").classList.toggle("active", quotaMode === "cross");
    calculateQuota();
  });
});

document.querySelector("#addQuotaDimension").addEventListener("click", () => {
  addQuotaDimension("新维度", [["选项A", 50], ["选项B", 50]]);
  calculateQuota();
});

document.querySelector("#addCrossQuotaDimension").addEventListener("click", () => {
  addCrossQuotaDimension("新维度", "选项A:50, 选项B:50");
  calculateQuota();
});

const quotaTemplates = {
  gender: {
    name: "性别",
    options: [["男", 50], ["女", 50]]
  },
  age: {
    name: "年龄",
    options: [["18-29岁", 35], ["30-39岁", 35], ["40岁及以上", 30]]
  },
  city: {
    name: "城市级别",
    options: [["一线城市", 30], ["新一线城市", 35], ["二线及以下城市", 35]]
  },
  user: {
    name: "用户类型",
    options: [["新用户", 40], ["老用户", 60]]
  }
};

const crossQuotaTemplates = {
  "gender-age": {
    dimensions: [
      { name: "性别", value: "男:50, 女:50" },
      { name: "年龄", value: "18-29岁:35, 30-39岁:35, 40岁及以上:30" }
    ]
  },
  "city-user": {
    dimensions: [
      { name: "城市级别", value: "一线城市:30, 新一线城市:35, 二线及以下城市:35" },
      { name: "用户类型", value: "新用户:40, 老用户:60" }
    ]
  },
  "gender-age-city": {
    dimensions: [
      { name: "性别", value: "男:50, 女:50" },
      { name: "年龄", value: "18-29岁:35, 30-39岁:35, 40岁及以上:30" },
      { name: "城市级别", value: "一线城市:30, 新一线城市:35, 二线及以下城市:35" }
    ]
  }
};

document.querySelectorAll("[data-quota-template]").forEach((button) => {
  button.addEventListener("click", () => {
    const template = quotaTemplates[button.dataset.quotaTemplate];
    if (!template) return;
    addQuotaDimension(template.name, template.options);
    quotaMode = "single";
    document.querySelectorAll("[data-quota-mode]").forEach((item) => {
      item.classList.toggle("active", item.dataset.quotaMode === "single");
    });
    document.querySelector("#singleQuotaFields").classList.add("active");
    document.querySelector("#crossQuotaFields").classList.remove("active");
    calculateQuota();
  });
});

document.querySelectorAll("[data-cross-quota-template]").forEach((button) => {
  button.addEventListener("click", () => {
    const template = crossQuotaTemplates[button.dataset.crossQuotaTemplate];
    if (!template) return;
    setCrossQuotaDimensions(template.dimensions);
    quotaMode = "cross";
    document.querySelectorAll("[data-quota-mode]").forEach((item) => {
      item.classList.toggle("active", item.dataset.quotaMode === "cross");
    });
    document.querySelector("#singleQuotaFields").classList.remove("active");
    document.querySelector("#crossQuotaFields").classList.add("active");
    calculateQuota();
  });
});

document.querySelectorAll(".help-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const help = document.querySelector(`#help-${button.dataset.help}`);
    const isOpen = help.classList.toggle("active");
    button.setAttribute("aria-expanded", String(isOpen));
  });
});

function parseQuestions(text) {
  const lines = text.split(/\r?\n/);
  const questions = [];
  let current = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const prefixedMatch = trimmed.match(/^(Q|S|A|B|C|D|题)\s*(\d+)[\.、\s]/i);
    const numericMatch = trimmed.match(/^(\d+)[\.、\s](.+)$/);
    const looksLikeQuestion =
      numericMatch && /[？?]|请|您|是否|哪|什么|如何|多少|为什么|评价|打分|选择/.test(numericMatch[2]);
    const questionMatch = prefixedMatch || (looksLikeQuestion ? numericMatch : null);

    if (questionMatch) {
      const rawPrefix = prefixedMatch ? questionMatch[1].toUpperCase() : "";
      const prefix = rawPrefix === "题" ? "Q" : rawPrefix;
      const number = Number(prefixedMatch ? questionMatch[2] : questionMatch[1]);
      const id = `${prefix}${number}`;

      current = {
        id,
        prefix,
        number,
        display: prefix ? `${prefix}${number}` : `${number}`,
        title: trimmed,
        line: index + 1,
        options: [],
        lines: [trimmed]
      };
      questions.push(current);
      return;
    }

    if (!current || !trimmed) return;
    current.lines.push(trimmed);

    const optionMatch = trimmed.match(/^([A-Z]|[0-9]+)[\.、\)]\s*(.+)$/i);
    if (optionMatch) {
      current.options.push({
        key: optionMatch[1],
        text: optionMatch[2].trim(),
        line: index + 1
      });
    }
  });

  return questions;
}

function addIssue(issues, severity, title, detail, evidence = "") {
  issues.push({ severity, title, detail, evidence });
}

const auditScenarioLabels = {
  general: "通用上线质检",
  concept: "概念测试",
  ua: "U&A 使用与态度研究",
  satisfaction: "满意度 / NPS",
  psm: "价格研究 / PSM",
  kanoMaxdiff: "KANO / MaxDiff"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addScenarioTemplateIssues(issues, questions, text, scenario) {
  if (!scenario || scenario === "general" || !text.trim()) return;
  const fullText = text.replace(/\s+/g, "");
  const hasAny = (patterns) => patterns.some((pattern) => pattern.test(fullText));
  const addTemplateIssue = (severity, title, detail, evidence = auditScenarioLabels[scenario]) => {
    addIssue(issues, severity, `场景模板：${title}`, detail, evidence);
  };

  if (scenario === "concept") {
    if (!hasAny([/概念|方案|创意|产品介绍|刺激物|图片|视频|文案/])) {
      addTemplateIssue("low", "概念材料呈现需确认", "概念测试通常需要明确概念材料、展示顺序和受访者阅读/观看要求。");
    }
    if (!hasAny([/喜欢|吸引|独特|相关|可信|理解|清晰|购买意愿|尝试意愿/])) {
      addTemplateIssue("medium", "缺少概念评价维度", "建议覆盖吸引力、独特性、相关性、可信度、理解度或购买/尝试意愿等核心指标。");
    }
    if (!hasAny([/为什么|原因|请说明|开放|改进|不喜欢/])) {
      addTemplateIssue("low", "缺少原因追问", "概念测试建议为核心评价题配置原因追问，方便解释高低分。");
    }
  }

  if (scenario === "ua") {
    if (!hasAny([/使用频率|多久|每周|每月|频次|最近一次/])) {
      addTemplateIssue("medium", "缺少使用频率题", "U&A 研究通常需要识别品类或产品使用频率，用于区分轻中重度用户。");
    }
    if (!hasAny([/使用场景|场合|什么时候|地点|用途|需求|动机/])) {
      addTemplateIssue("low", "缺少使用场景或需求题", "建议补充使用场景、需求动机或任务场景，方便后续人群和机会点分析。");
    }
    if (!hasAny([/品牌|竞品|常用|购买过|使用过|知晓|考虑/])) {
      addTemplateIssue("medium", "缺少品牌/竞品使用题", "U&A 通常需要覆盖品牌知晓、使用、常用或购买关系，便于识别竞争格局。");
    }
  }

  if (scenario === "satisfaction") {
    if (!hasAny([/满意度|满意|NPS|推荐|推荐意愿|净推荐/])) {
      addTemplateIssue("medium", "缺少总体满意度或 NPS", "满意度/NPS 项目建议至少包含总体满意度、推荐意愿或核心评价指标。");
    }
    if (!hasAny([/原因|为什么|请说明|开放|不满意|改进/])) {
      addTemplateIssue("low", "缺少低分原因追问", "建议对低满意或低推荐人群设置原因追问，方便定位问题来源。");
    }
    if (!hasAny([/服务|价格|质量|体验|配送|售后|功能|包装|门店|客服/])) {
      addTemplateIssue("low", "缺少细分维度评价", "建议加入产品、服务、价格、体验等细分维度，便于做驱动分析和改进排序。");
    }
  }

  if (scenario === "psm") {
    const hasCheap = /太便宜|便宜到怀疑|担心质量|质量问题/.test(fullText);
    const hasBargain = /便宜|划算|乐意购买|物超所值/.test(fullText);
    const hasExpensive = /贵但|比较贵|可以接受|还能接受/.test(fullText);
    const hasTooExpensive = /太贵|不会买|不考虑购买/.test(fullText);
    if (!(hasCheap && hasBargain && hasExpensive && hasTooExpensive)) {
      addTemplateIssue("medium", "PSM 四类价格题不完整", "价格敏感度研究建议同时包含“太便宜、比较便宜、比较贵、太贵”四类价格问题。");
    }
    if (!questions.some((question) => /价格|金额|元|预算/.test(question.lines.join("")))) {
      addTemplateIssue("low", "价格题单位需确认", "建议明确价格单位、区间或填写格式，例如“元/件”或“请输入整数”。");
    }
  }

  if (scenario === "kanoMaxdiff") {
    const hasKano = /KANO|正向|反向|如果具备|如果不具备|满意|不满意/.test(fullText);
    const hasMaxdiff = /MaxDiff|best.?worst|最想|最不想|最重要|最不重要|最佳|最差/.test(fullText);
    if (!hasKano && !hasMaxdiff) {
      addTemplateIssue("medium", "未识别到 KANO 或 MaxDiff 结构", "KANO 需成对正反向题，MaxDiff 需出现最佳/最差或最想/最不想选择任务。");
      return;
    }
    if (hasKano && !(/正向|如果具备|满意/.test(fullText) && /反向|如果不具备|不满意/.test(fullText))) {
      addTemplateIssue("medium", "KANO 正反向题需成对", "每个属性建议同时配置具备时和不具备时的反应题，避免无法分类属性。");
    }
    if (hasMaxdiff && !/(最想|最佳|最重要|best)/i.test(fullText)) {
      addTemplateIssue("low", "MaxDiff 缺少 Best 选择说明", "MaxDiff 题组建议明确要求选择最偏好/最重要的一项。");
    }
    if (hasMaxdiff && !/(最不想|最差|最不重要|worst)/i.test(fullText)) {
      addTemplateIssue("low", "MaxDiff 缺少 Worst 选择说明", "MaxDiff 题组建议明确要求选择最不偏好/最不重要的一项。");
    }
  }
}

function auditQuestionnaire(text, scenario = "general") {
  const issues = [];
  const questions = parseQuestions(text);
  const questionIds = questions.map((question) => question.id);
  const questionSet = new Set(questionIds);

  if (!text.trim()) {
    addIssue(issues, "high", "缺少问卷稿", "请先粘贴问卷题目、选项和跳题说明，再运行质检。");
    return issues;
  }

  if (questions.length === 0) {
    addIssue(issues, "high", "未识别到题号", "建议使用 Q1、S1、A1、1. 或“题1”这类明确题号，方便检查跳题引用和题号连续性。");
  }

  const duplicates = questionIds.filter((id, index) => questionIds.indexOf(id) !== index);
  [...new Set(duplicates)].forEach((id) => {
    addIssue(issues, "high", `题号重复：${id}`, "重复题号会导致跳题配置和数据字段混乱。", id);
  });

  const groupedQuestions = questions.reduce((groups, question) => {
    const key = question.prefix || "纯数字";
    groups[key] = groups[key] || [];
    groups[key].push(question);
    return groups;
  }, {});

  Object.values(groupedQuestions).forEach((group) => {
    if (group.length <= 1) return;
    const sorted = [...new Set(group.map((question) => question.number))].sort((a, b) => a - b);
    const prefix = group[0].prefix;
    for (let number = sorted[0]; number <= sorted[sorted.length - 1]; number += 1) {
      const id = `${prefix}${number}`;
      if (!questionSet.has(id)) {
        addIssue(issues, "medium", `题号缺失：${prefix ? `${prefix}${number}` : number}`, "请确认是故意跳过，还是问卷稿漏题。", `${prefix ? `${prefix}${number}` : number}`);
      }
    }
  });

  const jumpPattern = /(?:跳至|跳到|转至|进入|goto)\s*(Q|S|A|B|C|D|题)?\s*(\d+)/gi;
  [...text.matchAll(jumpPattern)].forEach((match) => {
    const rawPrefix = match[1] ? match[1].toUpperCase() : "";
    const prefix = rawPrefix === "题" ? "Q" : rawPrefix;
    const targetNumber = Number(match[2]);
    const target = `${prefix}${targetNumber}`;
    const sameNumberQuestions = questions.filter((question) => question.number === targetNumber);
    const inferredTargetExists =
      !prefix && !questionSet.has(target) && sameNumberQuestions.length === 1;
    const targetExists = questionSet.has(target) || inferredTargetExists;
    const display = prefix ? target : targetNumber;

    if (!targetExists) {
      addIssue(issues, "high", `跳题目标不存在：${display}`, "跳题引用的目标题号没有在问卷稿中出现，上线后可能中断路径。", match[0]);
    }
  });

  const conditionalJumpPattern = /如果\s*(Q|S|A|B|C|D|题)?\s*(\d+)\s*选择\s*([A-Z0-9]+)[，,、\s]*(?:则)?\s*(?:跳至|跳到|转至|进入)\s*(Q|S|A|B|C|D|题)?\s*(\d+)/gi;
  [...text.matchAll(conditionalJumpPattern)].forEach((match) => {
    const rawSourcePrefix = match[1] ? match[1].toUpperCase() : "";
    const sourcePrefix = rawSourcePrefix === "题" ? "Q" : rawSourcePrefix;
    const sourceNumber = Number(match[2]);
    const optionKey = match[3].toUpperCase();
    const rawTargetPrefix = match[4] ? match[4].toUpperCase() : "";
    const targetPrefix = rawTargetPrefix === "题" ? "Q" : rawTargetPrefix;
    const targetNumber = Number(match[5]);
    const sourceCandidates = questions.filter((question) =>
      question.number === sourceNumber && (!sourcePrefix || question.prefix === sourcePrefix)
    );
    const targetCandidates = questions.filter((question) =>
      question.number === targetNumber && (!targetPrefix || question.prefix === targetPrefix)
    );
    const sourceQuestion = sourceCandidates.length === 1 ? sourceCandidates[0] : null;
    const sourceDisplay = sourcePrefix ? `${sourcePrefix}${sourceNumber}` : sourceNumber;
    const targetDisplay = targetPrefix ? `${targetPrefix}${targetNumber}` : targetNumber;

    if (!sourceQuestion) {
      addIssue(issues, "high", `条件跳题来源不存在：${sourceDisplay}`, "条件跳题引用的来源题没有在问卷稿中唯一识别到，请确认题号。", match[0]);
      return;
    }

    if (!sourceQuestion.options.some((option) => option.key.toUpperCase() === optionKey)) {
      addIssue(issues, "high", `${sourceQuestion.display} 条件选项不存在：${optionKey}`, "条件跳题引用的选项没有在该题选项中出现，上线后可能导致路径配置错误。", match[0]);
    }

    if (!targetCandidates.length) {
      addIssue(issues, "high", `条件跳题目标不存在：${targetDisplay}`, "条件跳题的目标题号没有在问卷稿中出现。", match[0]);
    }

    if (targetCandidates.length && targetNumber <= sourceQuestion.number) {
      addIssue(issues, "low", `${sourceQuestion.display} 条件跳题方向需确认`, "跳题目标不在来源题之后，可能是回跳、循环或题号引用错误。", match[0]);
    }
  });

  questions.forEach((question) => {
    const optionTexts = question.options.map((option) => option.text.replace(/\s+/g, ""));
    const duplicateOptions = optionTexts.filter((option, index) => optionTexts.indexOf(option) !== index);
    [...new Set(duplicateOptions)].forEach((option) => {
      addIssue(issues, "medium", `${question.display} 选项重复`, "重复选项会影响受访者理解和后续数据编码。", option);
    });

    question.options.forEach((option) => {
      if (/其他/.test(option.text) && !/(请注明|注明|填空|填写|开放|____|：|:)/.test(option.text)) {
        addIssue(issues, "medium", `${question.display} “其他”缺少说明`, "如果需要收集开放答案，建议写明“其他，请注明”；如果不收集，请确认平台配置。", option.text);
      }

      if (/(以上都没有|以上均无|都没有|无|没有)/.test(option.text) && !/(互斥|排他|单独显示|固定)/.test(question.lines.join(""))) {
        addIssue(issues, "medium", `${question.display} 排他选项需确认`, "“以上都没有/无”等选项通常需要设置为互斥或固定位置。", option.text);
      }
    });

    if (/(随机|轮换|random|rotate)/i.test(question.lines.join("")) && /(其他|以上|无|不知道|拒答)/.test(question.lines.join(""))) {
      addIssue(issues, "low", `${question.display} 随机/轮换规则需确认`, "含“其他/以上都没有/不知道”等特殊选项时，建议明确哪些选项不参与随机或固定在末尾。", question.lines.join("\n"));
    }
  });

  typoRules.forEach(([needle, title, detail]) => {
    if (text.includes(needle)) {
      addIssue(issues, "low", title, detail, needle);
    }
  });

  if (/1\s*[=＝]\s*非常满意/.test(text) && /5\s*[=＝]\s*非常满意/.test(text)) {
    addIssue(issues, "medium", "量表方向可能不一致", "同一份问卷中出现了不同的满意度端点定义，建议统一量表方向。", "1=非常满意 / 5=非常满意");
  }

  addScenarioTemplateIssues(issues, questions, text, scenario);

  return issues;
}

function renderAuditResults(issues) {
  const severityLabel = { high: "阻塞", medium: "重要", low: "建议" };
  const result = document.querySelector("#auditResults");
  if (issues.length === 0) {
    result.innerHTML = `
      <div class="empty-state">
        <strong>未发现明显规则问题</strong>
        <span>当前规则未发现题号、跳题引用、重复选项或常见细节错误。仍建议进行真实页面路径复核。</span>
      </div>
    `;
    document.querySelector("#issueCount").textContent = "0";
    document.querySelector("#blockerCount").textContent = "0";
    return;
  }

  result.innerHTML = issues
    .map((issue) => `
      <article class="audit-issue">
        <div class="issue-head">
          <strong>${escapeHtml(issue.title)}</strong>
          <span class="issue-tag ${issue.severity}">${severityLabel[issue.severity]}</span>
        </div>
        <p>${escapeHtml(issue.detail)}</p>
        ${issue.evidence ? `<div class="issue-evidence">${escapeHtml(issue.evidence)}</div>` : ""}
      </article>
    `)
    .join("");

  document.querySelector("#issueCount").textContent = issues.length;
  document.querySelector("#blockerCount").textContent = issues.filter((issue) => issue.severity === "high").length;
}

function questionText(question) {
  return question.lines.join(" ");
}

function isOpenQuestion(text) {
  return /为什么|原因|请说明|请注明|请填写|意见|建议|开放|其他.*注明/i.test(text);
}

function isScaleQuestion(text) {
  return /满意|评分|打分|评价|同意|重要|1\s*[=＝]|5\s*[=＝]|量表|NPS|推荐/i.test(text);
}

function isTrapQuestion(text) {
  return /请选择|请选|质量|注意力|认真|为保证|请回答/i.test(text) && /请选择|请选/.test(text);
}

function isBannerQuestion(text) {
  return /性别|年龄|城市|地区|省份|收入|职业|学历|婚姻|家庭|用户类型|购买频率|使用频率|会员|品牌.*使用|当前.*品牌/i.test(text);
}

function classifyQuestion(question) {
  const text = questionText(question);
  if (isTrapQuestion(text)) return "注意力测试";
  if (isOpenQuestion(text) && !question.options.length) return "开放题";
  if (/矩阵|请对以下|以下.*评分|逐项|每项|属性|卖点|随机呈现/i.test(text)) return "矩阵/量表题";
  if (/多选|可多选|不限项|最多|至少|复选/i.test(text)) return "多选题";
  if (isScaleQuestion(text)) return "量表题";
  if (question.options.length) return "单选题";
  return "说明/跳转题";
}

function estimateQuestionSeconds(question) {
  const type = classifyQuestion(question);
  const optionCount = question.options.length;
  const text = questionText(question);
  const matrixItems = Math.max(
    0,
    (text.match(/、/g) || []).length + (text.match(/，/g) || []).length - 1
  );

  if (type === "注意力测试") return 6;
  if (type === "开放题") return 38;
  if (type === "矩阵/量表题") return 18 + Math.min(8, Math.max(2, matrixItems || optionCount)) * 5;
  if (type === "多选题") return 14 + optionCount * 2.5;
  if (type === "量表题") return 12 + Math.min(optionCount, 5) * 1.5;
  if (type === "单选题") return 8 + optionCount * 1.8;
  return 5;
}

function estimateSurveyTime(text) {
  const questions = parseQuestions(text);
  return questions.map((question) => {
    const seconds = estimateQuestionSeconds(question);
    return {
      id: question.display,
      title: question.title,
      type: classifyQuestion(question),
      optionCount: question.options.length,
      seconds
    };
  });
}

function renderTimeEstimate() {
  const text = document.querySelector("#timeText").value;
  const result = document.querySelector("#timeResults");
  const estimates = estimateSurveyTime(text);

  if (!text.trim() || !estimates.length) {
    result.innerHTML = `
      <div class="empty-state">
        <strong>未识别到可估算题目</strong>
        <span>建议使用 Q1、S1、题1 或 1. 这类题号格式，并保留题目和选项文本。</span>
      </div>
    `;
    return;
  }

  const totalSeconds = estimates.reduce((sum, item) => sum + item.seconds, 0);
  const totalMinutes = Math.max(1, Math.ceil(totalSeconds / 60));
  const openCount = estimates.filter((item) => item.type === "开放题").length;
  const matrixCount = estimates.filter((item) => item.type === "矩阵/量表题").length;
  const rows = estimates
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.id)}</td>
        <td>${escapeHtml(item.type)}</td>
        <td>${item.optionCount || "-"}</td>
        <td>${Math.round(item.seconds)} 秒</td>
      </tr>
    `)
    .join("");
  const advice = totalMinutes > 12
    ? "问卷偏长，建议压缩矩阵题、开放题或低优先级追问题。"
    : totalMinutes > 8
      ? "问卷时长中等，建议上线前做 3-5 人试填校准。"
      : "问卷时长较轻，适合常规线上回收。";

  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>预计完成时长</strong>
        <span class="issue-tag high">${estimates.length} 题</span>
      </div>
      <div class="metric-grid compact-metrics">
        <div><span>预计时长</span><strong>${totalMinutes} 分钟</strong></div>
        <div><span>开放题</span><strong>${openCount}</strong></div>
        <div><span>矩阵/量表题</span><strong>${matrixCount}</strong></div>
      </div>
      <p>${advice}</p>
    </article>
    <article class="audit-issue">
      <div class="issue-head">
        <strong>题目耗时拆分</strong>
        <span class="issue-tag low">估算</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>题号</th><th>识别题型</th><th>选项数</th><th>预计耗时</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function renderSuggestionCards(container, items, emptyTitle, emptyText) {
  const target = document.querySelector(container);
  if (!items.length) {
    target.innerHTML = `
      <div class="empty-state">
        <strong>${escapeHtml(emptyTitle)}</strong>
        <span>${escapeHtml(emptyText)}</span>
      </div>
    `;
    return;
  }

  const tagClass = { high: "high", medium: "medium", low: "low" };
  const tagLabel = { high: "优先", medium: "建议", low: "参考" };
  target.innerHTML = items
    .map((item) => `
      <article class="audit-issue">
        <div class="issue-head">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="issue-tag ${tagClass[item.level]}">${tagLabel[item.level]}</span>
        </div>
        <p>${escapeHtml(item.detail)}</p>
        ${item.evidence ? `<div class="issue-evidence">${escapeHtml(item.evidence)}</div>` : ""}
      </article>
    `)
    .join("");
}

function renderEditableSuggestions(container, items, emptyTitle, emptyText, type) {
  const target = document.querySelector(container);
  const exportButton = document.querySelector(type === "cleaning" ? "#exportCleaningRules" : "#exportHeaderPlan");
  if (!items.length) {
    if (exportButton) exportButton.disabled = true;
    target.innerHTML = `
      <div class="empty-state">
        <strong>${escapeHtml(emptyTitle)}</strong>
        <span>${escapeHtml(emptyText)}</span>
      </div>
    `;
    return;
  }

  const levelLabel = { high: "优先", medium: "建议", low: "参考" };
  if (exportButton) exportButton.disabled = false;
  target.innerHTML = `
    <div class="editable-result-toolbar">
      <strong>${type === "cleaning" ? "清洗规则清单" : "表头方案清单"}</strong>
      <span>可启用/停用、修改说明并补充备注后导出。</span>
    </div>
    ${items.map((item, index) => `
      <article class="audit-issue editable-suggestion" data-suggestion-type="${type}" data-index="${index}">
        <div class="editable-suggestion-head">
          <label class="inline-check">
            <input type="checkbox" data-field="enabled" checked />
            <span>启用</span>
          </label>
          <select data-field="level" aria-label="优先级">
            ${["high", "medium", "low"].map((level) => `<option value="${level}" ${item.level === level ? "selected" : ""}>${levelLabel[level]}</option>`).join("")}
          </select>
        </div>
        <label class="field compact-field">
          标题
          <input data-field="title" type="text" value="${escapeHtml(item.title || "")}" />
        </label>
        <label class="field compact-field">
          说明
          <textarea data-field="detail" rows="3">${escapeHtml(item.detail || "")}</textarea>
        </label>
        <label class="field compact-field">
          适用题目 / 证据
          <textarea data-field="evidence" rows="3">${escapeHtml(item.evidence || "")}</textarea>
        </label>
        <label class="field compact-field">
          备注
          <input data-field="note" type="text" placeholder="可填写人工确认、处理口径或交付备注" />
        </label>
      </article>
    `).join("")}
  `;
}

function collectEditableSuggestions(container) {
  return Array.from(document.querySelectorAll(`${container} .editable-suggestion`)).map((card) => {
    const field = (name) => card.querySelector(`[data-field="${name}"]`);
    return {
      enabled: Boolean(field("enabled")?.checked),
      level: field("level")?.value || "medium",
      title: field("title")?.value.trim() || "",
      detail: field("detail")?.value.trim() || "",
      evidence: field("evidence")?.value.trim() || "",
      note: field("note")?.value.trim() || ""
    };
  });
}

function exportEditableSuggestions(type) {
  const isCleaning = type === "cleaning";
  const rows = collectEditableSuggestions(isCleaning ? "#cleaningResults" : "#headerResults");
  if (!rows.length) return;
  downloadCsv(isCleaning ? "清洗规则配置.csv" : "表头设计方案.csv", [
    ["是否启用", "优先级", "标题", "说明", "适用题目/证据", "备注"],
    ...rows.map((row) => [
      row.enabled ? "启用" : "停用",
      ({ high: "优先", medium: "建议", low: "参考" }[row.level] || row.level),
      row.title,
      row.detail,
      row.evidence,
      row.note
    ])
  ]);
}

function getCleaningConfig() {
  return {
    minDuration: Math.max(30, Number(document.querySelector("#cleanMinDuration").value) || 120),
    openMinChars: Math.max(1, Number(document.querySelector("#cleanOpenMinChars").value) || 5),
    straightThreshold: Math.min(100, Math.max(50, Number(document.querySelector("#cleanStraightThreshold").value) || 90))
  };
}

function generateCleaningRules(text, config = getCleaningConfig()) {
  const questions = parseQuestions(text);
  const rules = [];
  const questionCount = questions.length;
  const scaleQuestions = questions.filter((question) => isScaleQuestion(questionText(question)));
  const openQuestions = questions.filter((question) => isOpenQuestion(questionText(question)));
  const trapQuestions = questions.filter((question) => isTrapQuestion(questionText(question)));
  const exclusiveQuestions = questions.filter((question) => /(以上都没有|以上均无|都没有|不知道|无|没有|拒答)/.test(questionText(question)));
  const screenerQuestions = questions.filter((question) => /是否|购买过|使用过|年龄|城市|地区|行业|职业|本人|决策/.test(questionText(question)));

  if (!text.trim()) {
    return [{ level: "high", title: "缺少问卷稿", detail: "请先粘贴问卷稿，再生成清洗规则。" }];
  }

  rules.push({
    level: "high",
    title: "超短时长规则",
    detail: `建议将答题时长低于 ${config.minDuration} 秒的样本标记为疑似无效，并结合题量、开放题内容和设备行为复核。`,
    evidence: questionCount ? `识别题量：${questionCount} 道；当前阈值：${config.minDuration} 秒` : `未识别到明确题号；当前阈值：${config.minDuration} 秒`
  });

  if (screenerQuestions.length) {
    rules.push({
      level: "high",
      title: "甄别/准入规则",
      detail: "对购买/使用/年龄/城市等准入题设置不符合条件样本剔除或配额满终止规则。",
      evidence: screenerQuestions.map((question) => `${question.display}. ${question.title}`).join("\n")
    });
  }

  if (trapQuestions.length) {
    rules.push({
      level: "high",
      title: "陷阱题失败规则",
      detail: "陷阱题未按指定选项作答的样本建议直接剔除或进入人工复核。",
      evidence: trapQuestions.map((question) => `${question.display}. ${question.title}`).join("\n")
    });
  }

  if (scaleQuestions.length) {
    rules.push({
      level: "medium",
      title: "直线作答规则",
      detail: `对量表/评分题检查全选同一分值、标准差过低或极端一致作答；建议将一致率达到 ${config.straightThreshold}% 以上的样本纳入复核。`,
      evidence: `${scaleQuestions.map((question) => `${question.display}. ${question.title}`).join("\n")}\n当前阈值：${config.straightThreshold}%`
    });
  }

  if (openQuestions.length) {
    rules.push({
      level: "medium",
      title: "开放题质量规则",
      detail: `开放题建议检查少于 ${config.openMinChars} 字、重复文本、无意义回答和明显复制粘贴。`,
      evidence: `${openQuestions.map((question) => `${question.display}. ${question.title}`).join("\n")}\n当前阈值：${config.openMinChars} 字`
    });
  }

  if (exclusiveQuestions.length) {
    rules.push({
      level: "medium",
      title: "排他项冲突规则",
      detail: "多选题中“以上都没有/不知道/拒答”等选项不应与其他实质选项同时选择。",
      evidence: exclusiveQuestions.map((question) => `${question.display}. ${question.title}`).join("\n")
    });
  }

  rules.push({
    level: "low",
    title: "逻辑一致性复核",
    detail: "建议检查前后题一致性，例如未购买者不应出现购买渠道、购买频次等后续行为答案。",
    evidence: "后续接入数据后可自动执行；当前阶段生成规则模板。"
  });

  return rules;
}

function generateHeaderSuggestions(text) {
  const questions = parseQuestions(text);
  const suggestions = [];
  if (!text.trim()) {
    return [{ level: "high", title: "缺少问卷稿", detail: "请先粘贴问卷稿，再生成表头建议。" }];
  }

  const mainBanner = questions.filter((question) =>
    /性别|年龄|城市|地区|区域|省份|级别|收入|学历|职业|行业|婚育|家庭|用户类型|人群/.test(questionText(question)) &&
    !isOpenQuestion(questionText(question))
  );
  const secondaryBanner = questions.filter((question) =>
    /购买频率|使用频率|渠道|平台|品牌|品类|场景|用途|会员|价格段|消费|满意|NPS|推荐/.test(questionText(question)) &&
    !mainBanner.includes(question) &&
    !isOpenQuestion(questionText(question)) &&
    !isTrapQuestion(questionText(question))
  );
  const excluded = questions.filter((question) => isOpenQuestion(questionText(question)) || isTrapQuestion(questionText(question)) || /跳至|跳到|转至|进入/.test(questionText(question)));
  const allBanner = [...mainBanner, ...secondaryBanner];

  suggestions.push({
    level: "high",
    title: "主表头变量",
    detail: "建议作为标准交叉表的第一层横向表头，用于稳定比较样本结构和核心人群差异。",
    evidence: mainBanner.length ? mainBanner.map((question) => `${question.display}. ${question.title}`).join("\n") : "未明显识别到人口属性或样本结构题，建议人工补充性别、年龄、城市级别、用户类型等变量。"
  });

  suggestions.push({
    level: "medium",
    title: "补充表头变量",
    detail: "适合用于专题拆分或附加分析，例如按品牌、渠道、频率、场景、满意度层级比较。",
    evidence: secondaryBanner.length ? secondaryBanner.map((question) => `${question.display}. ${question.title}`).join("\n") : "未明显识别到行为、品牌、渠道或态度类分群变量。"
  });

  suggestions.push({
    level: "low",
    title: "建议表头组合",
    detail: "优先用少量高解释力分群变量组合，避免表头过宽。",
    evidence: allBanner.length
      ? [
          `基础表头：${mainBanner.slice(0, 4).map((question) => question.display).join("、") || "性别、年龄、城市级别"}`,
          `补充表头：${secondaryBanner.slice(0, 4).map((question) => question.display).join("、") || "购买频率、使用场景、渠道"}`,
          "建议避免三层以上交叉，防止单格样本量过小。"
        ].join("\n")
      : "基础表头：性别、年龄、城市级别\n行为表头：购买频率、使用场景、渠道\n品牌表头：当前使用品牌、首选品牌"
  });

  suggestions.push({
    level: "medium",
    title: "不建议入表题",
    detail: "开放题、陷阱题、纯跳转题通常不适合作为标准交叉表题目，可保留在原始数据或附录中单独查看。",
    evidence: excluded.length ? excluded.map((question) => `${question.display}. ${question.title}`).join("\n") : "未明显识别到需要排除的题。"
  });

  return suggestions;
}

function parsePsmRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t,，\s]+/).map((value) => Number(value)))
    .filter((row) => row.length >= 4 && row.slice(0, 4).every((value) => Number.isFinite(value) && value > 0))
    .map((row) => ({
      tooCheap: row[0],
      cheap: row[1],
      expensive: row[2],
      tooExpensive: row[3]
    }));
}

function percentileAtOrAbove(values, price) {
  return (values.filter((value) => value >= price).length / values.length) * 100;
}

function percentileAtOrBelow(values, price) {
  return (values.filter((value) => value <= price).length / values.length) * 100;
}

function buildPsmCurve(rows) {
  const tooCheap = rows.map((row) => row.tooCheap);
  const cheap = rows.map((row) => row.cheap);
  const expensive = rows.map((row) => row.expensive);
  const tooExpensive = rows.map((row) => row.tooExpensive);
  const prices = [...new Set([...tooCheap, ...cheap, ...expensive, ...tooExpensive])].sort((a, b) => a - b);

  return prices.map((price) => ({
    price,
    tooCheap: percentileAtOrAbove(tooCheap, price),
    cheap: percentileAtOrAbove(cheap, price),
    expensive: percentileAtOrBelow(expensive, price),
    tooExpensive: percentileAtOrBelow(tooExpensive, price)
  }));
}

function findCurveIntersection(points, leftKey, rightKey, options = {}) {
  const minAverage = options.minAverage || 0;

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const prevDiff = prev[leftKey] - prev[rightKey];
    const currentDiff = current[leftKey] - current[rightKey];
    const prevAverage = (prev[leftKey] + prev[rightKey]) / 2;
    const currentAverage = (current[leftKey] + current[rightKey]) / 2;

    if (prevDiff === 0 && prevAverage >= minAverage) return prev.price;
    if (prevDiff * currentDiff <= 0) {
      const span = current.price - prev.price;
      const ratio = Math.abs(prevDiff) / (Math.abs(prevDiff) + Math.abs(currentDiff));
      const price = prev.price + span * ratio;
      const average = prevAverage + (currentAverage - prevAverage) * ratio;
      if (average >= minAverage) return price;
    }
  }
  return null;
}

function formatPrice(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, "") : "未识别";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename, rows) {
  const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function excelXmlCell(value) {
  const cell = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { value };
  const styleId = cell.format === "percent" ? ` ss:StyleID="Percent1"` : "";
  if (cell.type === "number") {
    const href = cell.href ? ` ss:HRef="${escapeHtml(cell.href)}"` : "";
    return `<Cell${href}${styleId}><Data ss:Type="Number">${cell.value ?? 0}</Data></Cell>`;
  }
  const text = String(cell.value ?? "");
  const numeric = text !== "" && Number.isFinite(Number(text)) && !/%$/.test(text);
  const type = numeric ? "Number" : "String";
  const href = cell.href ? ` ss:HRef="${escapeHtml(cell.href)}"` : "";
  return `<Cell${href}${styleId}><Data ss:Type="${type}">${escapeHtml(text)}</Data></Cell>`;
}

function excelWorkbookStylesXml() {
  return `<Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="11"/>
    </Style>
    <Style ss:ID="Percent1">
      <NumberFormat ss:Format="0.0%"/>
    </Style>
  </Styles>`;
}

function downloadExcelXml(filename, sheetName, rows) {
  const safeSheetName = String(sheetName || "Sheet1").replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet1";
  const rowXml = rows.map((row) => `<Row>${row.map(excelXmlCell).join("")}</Row>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${excelWorkbookStylesXml()}
  <Worksheet ss:Name="${escapeHtml(safeSheetName)}">
    <Table>${rowXml}</Table>
  </Worksheet>
</Workbook>`;
  downloadTextFile(filename, xml, "application/vnd.ms-excel;charset=utf-8");
}

function excelSafeSheetName(name, fallback = "Sheet1") {
  return String(name || fallback).replace(/[\\/?*[\]:]/g, "").slice(0, 31) || fallback;
}

function downloadExcelWorkbookXml(filename, sheets) {
  const worksheets = sheets.map((sheet, index) => {
    const sheetName = excelSafeSheetName(sheet.name, `Sheet${index + 1}`);
    const rowXml = sheet.rows.map((row) => `<Row>${row.map(excelXmlCell).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${escapeHtml(sheetName)}"><Table>${rowXml}</Table></Worksheet>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${excelWorkbookStylesXml()}
${worksheets}
</Workbook>`;
  downloadTextFile(filename, xml, "application/vnd.ms-excel;charset=utf-8");
}

function splitDelimitedLine(line) {
  const delimiter = line.includes("\t") ? "\t" : ",";
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseDelimitedTable(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitDelimitedLine(lines[0]).map((header, index) => header || `字段${index + 1}`);
  const rows = lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] ?? "";
      return row;
    }, {});
  });
  return { headers, rows };
}

function fillSelectOptions(selector, options) {
  const select = document.querySelector(selector);
  select.innerHTML = options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
}

function gammaLog(value) {
  const coefficients = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953
  ];
  let x = value;
  let y = value;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  coefficients.forEach((coefficient) => {
    y += 1;
    series += coefficient / y;
  });
  return Math.log(2.5066282746310005 * series / x) - tmp;
}

function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 100; n += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-8) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaLog(a));
  }

  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 100; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-8) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gammaLog(a)) * h;
}

function chiSquarePValue(chiSquare, degreesOfFreedom) {
  if (!Number.isFinite(chiSquare) || degreesOfFreedom <= 0) return null;
  return Math.max(0, Math.min(1, 1 - gammaP(degreesOfFreedom / 2, chiSquare / 2)));
}

function formatPercent(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function toNumberOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function modeValue(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function frequencyRows(values, totalBase = values.length, validBase = values.filter(Boolean).length) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  let cumulative = 0;
  return [...counts.entries()]
    .sort((a, b) => {
      const an = toNumberOrNull(a[0]);
      const bn = toNumberOrNull(b[0]);
      if (an !== null && bn !== null) return an - bn;
      return String(a[0]).localeCompare(String(b[0]), "zh-CN");
    })
    .map(([label, count]) => {
      cumulative += count;
      return {
        label,
        count,
        percent: totalBase ? count / totalBase : 0,
        validPercent: validBase ? count / validBase : 0,
        cumulativePercent: validBase ? cumulative / validBase : 0
      };
    });
}

function completeScoreRows(rows, minScore, maxScore, validBase) {
  const byLabel = new Map(rows.map((row) => [String(row.label), row]));
  return Array.from({ length: maxScore - minScore + 1 }, (_, index) => {
    const score = String(minScore + index);
    return byLabel.get(score) || {
      label: score,
      count: 0,
      percent: 0,
      validPercent: 0,
      cumulativePercent: validBase ? 0 : 0
    };
  });
}

function completeScaleRows(rows, values) {
  const numericValues = values.map(toNumberOrNull).filter((value) => value !== null);
  const min = Math.min(...numericValues, 1);
  const max = Math.max(...numericValues, 5);
  const start = min <= 0 ? 0 : 1;
  const end = [5, 7, 10].includes(max) ? max : Math.max(max, 5);
  return completeScoreRows(rows, start, end, numericValues.length);
}

function questionPrefix(header) {
  const text = String(header || "").trim();
  const match = text.match(/^([A-Za-z]+\d+(?:_\d+)?)(?:__\d+|[_a-zA-Z0-9-]*|\s|$)/);
  return match ? match[1] : "";
}

function getHeaderInfo(header) {
  return lastCrosstabDataContext?.headerInfos?.find((info) => info.title === header || info.sourceHeader === header) || null;
}

function groupQuestionHeaders(headers, rows = []) {
  const groups = [];
  const used = new Set();
  headers.forEach((header) => {
    if (used.has(header)) return;
    const info = getHeaderInfo(header);
    if (info?.binary && info.parentTitle) {
      const related = headers.filter((candidate) => {
        const candidateInfo = getHeaderInfo(candidate);
        return candidateInfo?.binary && candidateInfo.parentTitle === info.parentTitle;
      });
      related.forEach((candidate) => used.add(candidate));
      groups.push({ key: info.source, title: info.parentTitle, headers: related, multiResponse: true });
      return;
    }
    const prefix = questionPrefix(header);
    const multiPrefix = String(header).match(/^([A-Za-z]+\d+(?:_\d+)?)__\d+/)?.[1];
    if (multiPrefix) {
      const related = headers.filter((candidate) => String(candidate).startsWith(`${multiPrefix}__`));
      // 仅当所有相关字段的值看起来是二元值（0/1/选中/未选/是/否）时才判定为多选题
      const isMultiResponse = rows.length > 0 && related.every((candidate) => {
        const allValues = rows.map((row) => row[candidate]).filter((v) => v !== undefined && v !== "");
        return allValues.length > 0 && allValues.every((value) => /^(0|1|选中|未选|是|否)$/i.test(String(value).trim()));
      });
      if (isMultiResponse) {
        related.forEach((candidate) => used.add(candidate));
        groups.push({ key: multiPrefix, title: multiPrefix, headers: related, multiResponse: true });
        return;
      }
    }
    if (!prefix) {
      groups.push({ key: header, title: header, headers: [header] });
      used.add(header);
      return;
    }
    const related = headers.filter((candidate) => questionPrefix(candidate) === prefix);
    if (related.length > 1) {
      related.forEach((candidate) => used.add(candidate));
      const firstInfo = getHeaderInfo(related[0]);
      let title = prefix;
      if (firstInfo?.parentTitle) {
        title = firstInfo.parentTitle.replace(/^[A-Z]+\d+\.?\s*/, "").trim();
        if (title.length > 80) title = title.substring(0, 80) + "...";
      }
      groups.push({ key: prefix, title, headers: related });
    } else {
      groups.push({ key: header, title: header, headers: [header] });
      used.add(header);
    }
  });
  return groups;
}

function isBinaryMentionValue(value) {
  return /^(1|选中|是|yes|true)$/i.test(String(value || "").trim());
}

function splitMultiValues(value) {
  return String(value || "")
    .split(/[;,，、|/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferSingleColumnType(header, values) {
  const validValues = values.filter(Boolean);
  const numericValues = validValues.map(toNumberOrNull).filter((value) => value !== null);
  const uniqueNumbers = [...new Set(numericValues)];
  const uniqueValues = [...new Set(validValues)];
  const numericRatio = validValues.length ? numericValues.length / validValues.length : 0;
  const maxNumber = Math.max(...uniqueNumbers, 0);
  const minNumber = Math.min(...uniqueNumbers, 0);

  if (/NPS|推荐/i.test(header) && numericRatio > 0.8 && minNumber >= 0 && maxNumber <= 10) return "nps";
  if (numericRatio > 0.8 && minNumber >= 0 && maxNumber <= 10 && uniqueNumbers.length >= 8) return "scale";
  if (numericRatio > 0.8 && [5, 7, 10].includes(maxNumber) && minNumber >= 1) return "scale";
  if (validValues.some((value) => splitMultiValues(value).length > 1)) return "multi_single_cell";
  if (uniqueValues.length > Math.max(12, validValues.length * 0.45) || validValues.some((value) => String(value).length > 18)) return "open";
  return "single";
}

function inferMultiColumnType(group, rows) {
  const values = group.headers.flatMap((header) => rows.map((row) => row[header]).filter(Boolean));
  const numericValues = values.map(toNumberOrNull).filter((value) => value !== null);
  const uniqueNumbers = [...new Set(numericValues)];
  const allBinary = values.length && values.every((value) => /^(0|1|选中|未选|是|否)$/i.test(String(value).trim()));
  const minNumber = Math.min(...uniqueNumbers, 0);
  const maxNumber = Math.max(...uniqueNumbers, 0);
  if (allBinary) return "multi_columns";
  if (numericValues.length / Math.max(values.length, 1) > 0.8 && minNumber >= 1 && maxNumber <= group.headers.length && group.headers.length >= 3) return "ranking";
  if (numericValues.length / Math.max(values.length, 1) > 0.8 && [5, 7, 10].includes(maxNumber)) return "matrix_scale";
  return "matrix_single";
}

function statRowsForScale(values) {
  const numericValues = values.map(toNumberOrNull).filter((value) => value !== null);
  const max = Math.max(...numericValues, 0);
  const top2 = numericValues.filter((value) => value >= max - 1).length / Math.max(numericValues.length, 1);
  const top3 = numericValues.filter((value) => value >= max - 2).length / Math.max(numericValues.length, 1);
  const bottom2 = numericValues.filter((value) => value <= 2).length / Math.max(numericValues.length, 1);
  const rows = [
    ["均值", mean(numericValues)?.toFixed(2) ?? "-"],
    ["标准差", standardDeviation(numericValues).toFixed(2)],
    ["中位数", median(numericValues) ?? "-"],
    ["众数", modeValue(numericValues) ?? "-"],
    ["Top2 Box", formatPercent(top2)],
    ["Top3 Box", formatPercent(top3)],
    ["Bottom2 Box", formatPercent(bottom2)]
  ];
  // 0-10 分量表增加 NSS（Net Satisfaction Score）
  if (max === 10 && numericValues.length && Math.min(...numericValues) >= 0) {
    const promoters = numericValues.filter((value) => value >= 9).length;
    const detractors = numericValues.filter((value) => value <= 6).length;
    const nss = (promoters - detractors) / numericValues.length;
    rows.push(["NSS", formatPercent(nss)]);
  }
  return rows;
}

function openTextSummary(values) {
  const validValues = values.filter(Boolean);
  const wordCounts = new Map();
  validValues.forEach((value) => {
    String(value).replace(/[，。！？、,.!?；;：:\s]/g, " ").split(/\s+/).filter((word) => word.length >= 2).forEach((word) => {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    });
  });
  return {
    avgLength: validValues.length ? mean(validValues.map((value) => String(value).length)) : 0,
    topWords: [...wordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  };
}

function buildSingleQuestionPivot(parsed) {
  const total = parsed.rows.length;
  return groupQuestionHeaders(parsed.headers, parsed.rows).flatMap((group) => {
    if (group.headers.length > 1) {
      const type = inferMultiColumnType(group, parsed.rows);
      if (type === "multi_columns" || group.multiResponse) {
        const validBase = parsed.rows.filter((row) =>
          group.headers.some((header) => isBinaryMentionValue(row[header]))
        ).length;
        const optionRows = group.headers.map((header) => {
          const mentions = parsed.rows.filter((row) => isBinaryMentionValue(row[header])).length;
          const info = getHeaderInfo(header);
          return {
            label: info?.optionLabel || header.replace(new RegExp(`^${group.key}(?:__\\d+)?\\s*`), "").trim() || header,
            count: mentions,
            mentionPercent: 0,
            countPercent: validBase ? mentions / validBase : 0
          };
        });
        const totalMentions = optionRows.reduce((sum, row) => sum + row.count, 0);
        optionRows.forEach((row) => { row.mentionPercent = totalMentions ? row.count / totalMentions : 0; });
        return [{ title: group.title, type: "多选题", total, validBase, rows: optionRows }];
      }

      if (type === "ranking") {
        const rows = group.headers.map((header) => {
          const values = parsed.rows.map((row) => toNumberOrNull(row[header])).filter((value) => value !== null);
          const avgRank = mean(values) || 0;
          const firstRate = values.filter((value) => value === 1).length / Math.max(values.length, 1);
          const secondRate = values.filter((value) => value === 2).length / Math.max(values.length, 1);
          return { label: header, score: values.length ? group.headers.length + 1 - avgRank : 0, firstRate, secondRate, avgRank };
        });
        return [{ title: group.title, type: "排序题", total, validBase: Math.max(...group.headers.map((header) => parsed.rows.map((row) => toNumberOrNull(row[header])).filter((value) => value !== null).length), 0), rows }];
      }

      if (type === "matrix_scale") {
        return group.headers.map((header) => {
          const values = parsed.rows.map((row) => row[header]).filter(Boolean);
          const info = getHeaderInfo(header);
          const cleanLabel = info?.optionLabel || header.replace(new RegExp(`^${group.key}(?:__\\d+)?\\s*`), "").replace(/^[_\s]+/, "").trim() || header;
          return {
            title: `${group.title} - ${cleanLabel}`,
            type: "量表题",
            total,
            validBase: values.length,
            stats: statRowsForScale(values),
            frequencies: completeScaleRows(frequencyRows(values, values.length, values.length), values)
          };
        });
      }

      const rows = group.headers.map((header) => {
        const values = parsed.rows.map((row) => row[header]).filter(Boolean);
        return {
          label: header,
          validBase: values.length,
          frequencies: frequencyRows(values, values.length, values.length)
        };
      });
      return [{ title: group.title, type: "矩阵单选", total, validBase: Math.max(...rows.map((row) => row.validBase || 0), 0), rows }];
    }

    const header = group.headers[0];
    const values = parsed.rows.map((row) => row[header]);
    const type = inferSingleColumnType(header, values);
    if (type === "nps") {
      const numericValues = values.map(toNumberOrNull).filter((value) => value !== null);
      const promoters = numericValues.filter((value) => value >= 9).length;
      const passives = numericValues.filter((value) => value >= 7 && value <= 8).length;
      const detractors = numericValues.filter((value) => value <= 6).length;
      return [{
        title: header,
        type: "NPS题",
        total,
        validBase: numericValues.length,
        nps: numericValues.length ? ((promoters - detractors) / numericValues.length) * 100 : 0,
        nss: numericValues.length ? (promoters - detractors) / numericValues.length : 0,
        rows: [
          { label: "推荐者 9-10分", count: promoters, percent: numericValues.length ? promoters / numericValues.length : 0 },
          { label: "被动者 7-8分", count: passives, percent: numericValues.length ? passives / numericValues.length : 0 },
          { label: "贬损者 0-6分", count: detractors, percent: numericValues.length ? detractors / numericValues.length : 0 }
        ],
        frequencies: completeScoreRows(frequencyRows(values, numericValues.length, numericValues.length), 0, 10, numericValues.length)
      }];
    }
    if (type === "scale") {
      const validValues = values.filter((value) => toNumberOrNull(value) !== null);
      return [{ title: header, type: "量表题", total, validBase: validValues.length, stats: statRowsForScale(values), frequencies: completeScaleRows(frequencyRows(values, validValues.length, validValues.length), validValues) }];
    }
    if (type === "multi_single_cell") {
      const mentions = new Map();
      values.forEach((value) => splitMultiValues(value).forEach((item) => mentions.set(item, (mentions.get(item) || 0) + 1)));
      const totalMentions = [...mentions.values()].reduce((sum, count) => sum + count, 0);
      const rows = [...mentions.entries()].map(([label, count]) => ({
        label,
        count,
        mentionPercent: totalMentions ? count / totalMentions : 0,
        countPercent: values.filter((value) => splitMultiValues(value).length > 0).length ? count / values.filter((value) => splitMultiValues(value).length > 0).length : 0
      }));
      return [{ title: header, type: "多选题", total, validBase: values.filter((value) => splitMultiValues(value).length > 0).length, rows }];
    }
    if (type === "open") {
      return [];
    }
    const validValues = values.filter(Boolean);
    return [{ title: header, type: "单选题", total, validBase: validValues.length, rows: frequencyRows(values, validValues.length, validValues.length) }];
  });
}

function normalizeConditionVariable(value) {
  return String(value || "").trim().replace(/-/g, "_");
}

function normalizeConditionValue(value) {
  return String(value || "").trim().replace(/^R/i, "");
}

function getWorkingCrosstabData() {
  const parsed = parseDelimitedTable(document.querySelector("#crosstabData").value);
  if (
    lastCrosstabDataContext &&
    parsed.headers.length === lastCrosstabDataContext.displayHeaders.length &&
    parsed.headers.every((header, index) => header === lastCrosstabDataContext.displayHeaders[index])
  ) {
    return {
      headers: lastCrosstabDataContext.displayHeaders,
      rows: lastCrosstabDataContext.displayRows,
      rawHeaders: lastCrosstabDataContext.rawHeaders,
      rawRows: lastCrosstabDataContext.rawRows
    };
  }
  return { headers: parsed.headers, rows: parsed.rows, rawHeaders: parsed.headers, rawRows: parsed.rows };
}

function parseHeaderCondition(condition) {
  return String(condition || "")
    .split(new RegExp("\\s*(?:" + "\\u4e14" + "|and|AND|&|\\+)\\s*"))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(new RegExp("^(.+?)(?:=|" + "\\uff1d" + ")(.+)$"));
      if (!match) return null;
      return {
        variable: normalizeConditionVariable(match[1]),
        value: normalizeConditionValue(match[2])
      };
    })
    .filter(Boolean);
}

function rawValueMatches(actual, expected) {
  const actualText = String(actual ?? "").trim();
  const expectedText = String(expected ?? "").trim();
  return actualText === expectedText || actualText === `R${expectedText}` || actualText.split(/[;,，、|/]/).map((item) => normalizeConditionValue(item)).includes(expectedText);
}

function conditionPartMatches(rawRow, rawHeaders, part) {
  if (!part.variable) return true;
  const directHeader = rawHeaders.find((header) => normalizeConditionVariable(header) === part.variable);
  if (directHeader && rawValueMatches(rawRow[directHeader], part.value)) return true;

  const multiHeader = rawHeaders.find((header) => normalizeConditionVariable(header) === `${part.variable}__${part.value}`);
  if (multiHeader) return isBinaryMentionValue(rawRow[multiHeader]);

  const singleUnderscoreHeader = rawHeaders.find((header) => normalizeConditionVariable(header) === `${part.variable}_${part.value}`);
  if (singleUnderscoreHeader) return isBinaryMentionValue(rawRow[singleUnderscoreHeader]);

  return false;
}

function filterRowsByHeaderCondition(data, condition) {
  const parts = parseHeaderCondition(condition);
  return filterRowsByConditionParts(data, parts);
}

function filterRowsByConditionParts(data, parts) {
  if (!parts.length) return data.rows;
  return data.rows.filter((_, index) => {
    const rawRow = data.rawRows[index] || {};
    return parts.every((part) => conditionPartMatches(rawRow, data.rawHeaders, part));
  });
}

function findPivotItem(items, sourceItem) {
  return items.find((item) => item.title === sourceItem.title && item.type === sourceItem.type) || sourceItem;
}

function pivotKey(item) {
  return `${item.type}::${item.title}`;
}

function indexPivotItems(items) {
  return new Map(items.map((item) => [pivotKey(item), item]));
}

function renderFrequencyTable(rows, includeValid = true) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>选项</th><th>频数</th><th>百分比</th>${includeValid ? "<th>有效百分比</th><th>累计百分比</th>" : ""}</tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.label)}</td>
              <td>${row.count}</td>
              <td>${formatPercent(row.percent)}</td>
              ${includeValid ? `<td>${formatPercent(row.validPercent)}</td><td>${formatPercent(row.cumulativePercent)}</td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderQuestionPivotItem(item) {
  if (item.type === "多选题") {
    return `
      <div class="table-wrap"><table><thead><tr><th>选项</th><th>响应数</th><th>响应率</th><th>普及率</th></tr></thead><tbody>
        ${item.rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${formatPercent(row.mentionPercent)}</td><td>${formatPercent(row.countPercent)}</td></tr>`).join("")}
      </tbody></table></div>
    `;
  }
  if (item.type === "量表题") {
    return `
      <div class="table-wrap"><table><thead><tr><th>统计量</th><th>值</th></tr></thead><tbody>${item.stats.map((row) => `<tr><td>${row[0]}</td><td>${row[1]}</td></tr>`).join("")}</tbody></table></div>
      ${renderFrequencyTable(item.frequencies, false)}
    `;
  }
  if (item.type === "NPS题") {
    return `
      <div class="metric-grid compact-metrics"><div><span>NPS 得分</span><strong>${item.nps.toFixed(1)}</strong></div></div>
      <div class="table-wrap"><table><thead><tr><th>分类</th><th>频数</th><th>占比</th></tr></thead><tbody>${item.rows.map((row) => `<tr><td>${row.label}</td><td>${row.count}</td><td>${formatPercent(row.percent)}</td></tr>`).join("")}</tbody></table></div>
      ${renderFrequencyTable(item.frequencies, false)}
    `;
  }
  if (item.type === "矩阵量表") {
    return `<div class="table-wrap"><table><thead><tr><th>属性</th><th>均值</th><th>标准差</th><th>Top2 Box</th></tr></thead><tbody>
      ${item.rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.stats[0]?.[1] || "-"}</td><td>${row.stats[1]?.[1] || "-"}</td><td>${row.stats.find((stat) => stat[0] === "Top2 Box")?.[1] || "-"}</td></tr>`).join("")}
    </tbody></table></div>`;
  }
  if (item.type === "矩阵单选") {
    return item.rows.map((row) => `<h4>${escapeHtml(row.label)}</h4>${renderFrequencyTable(row.frequencies, false)}`).join("");
  }
  if (item.type === "排序题") {
    return `<div class="table-wrap"><table><thead><tr><th>项目</th><th>加权得分</th><th>首选率</th><th>次选率</th><th>平均排名</th></tr></thead><tbody>
      ${item.rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.score.toFixed(2)}</td><td>${formatPercent(row.firstRate)}</td><td>${formatPercent(row.secondRate)}</td><td>${row.avgRank.toFixed(2)}</td></tr>`).join("")}
    </tbody></table></div>`;
  }
  if (item.type === "开放题") {
    return `<div class="metric-grid compact-metrics"><div><span>平均字数</span><strong>${item.avgLength.toFixed(1)}</strong></div></div>
      <div class="table-wrap"><table><thead><tr><th>高频词</th><th>次数</th></tr></thead><tbody>${item.topWords.map(([word, count]) => `<tr><td>${escapeHtml(word)}</td><td>${count}</td></tr>`).join("")}</tbody></table></div>`;
  }
  return renderFrequencyTable(item.rows, true);
}

function generateQuestionPivot() {
  const parsed = getWorkingCrosstabData();
  const result = document.querySelector("#crosstabResults");
  if (!parsed.rows.length) {
    result.innerHTML = `<div class="empty-state"><strong>无法生成全部交叉表</strong><span>请先导入或粘贴带表头的数据文件。</span></div>`;
    return;
  }
  lastQuestionPivot = buildSingleQuestionPivot(parsed);
  if (!lastQuestionPivot.length) {
    result.innerHTML = `<div class="empty-state"><strong>无法生成全部交叉表</strong><span>当前数据只识别到开放题或填空题；全部交叉表已默认排除开放题。</span></div>`;
    return;
  }
  const progressEl = document.querySelector("#pivotProgress");
  if (progressEl) progressEl.textContent = `已识别 ${lastQuestionPivot.length} 题（已排除开放题），正在构建 Banner 交叉与 Excel 导出...`;
  window.setTimeout(() => {
    exportQuestionPivot();
    const typeCounts = lastQuestionPivot.reduce((counts, item) => {
      counts[item.type] = (counts[item.type] || 0) + 1;
      return counts;
    }, {});
    const typeSummary = Object.entries(typeCounts).map(([type, count]) => `${type} ${count} 题`).join("，");
    result.innerHTML = `
      <article class="audit-issue">
        <div class="issue-head"><strong>全部交叉表已生成</strong><span class="issue-tag high">${lastQuestionPivot.length} 题</span></div>
        <p>已直接导出 Excel 文件，包含“目录、频数、百分比、显著性检验”四个工作表，页面不再展开全部结果，避免输出区过长。</p>
        <div class="issue-evidence">${escapeHtml(`${typeSummary || "未识别到可统计题型"}${lastCrosstabHeaderPlan?.length ? `\n已按表头条件逐列筛选并计算：${lastCrosstabHeaderPlan.length} 列` : "\n未带入表头方案；如需顶部 Banner 表头，请先点击“导入表头”。"}\n多选拆列已按多重响应集输出选项提及，不再输出“选中/未选中”。矩阵量表已按子题拆分为独立量表题。`)}</div>
      </article>
    `;
  }, 50);
}

function renderQuestionPivot() {
  const result = document.querySelector("#crosstabResults");
  result.innerHTML = `
    <div class="empty-state">
      <strong>正在生成全部交叉表</strong>
      <span id="pivotProgress">正在识别题型、计算频数并排除开放题，请稍候...</span>
    </div>
  `;
  window.setTimeout(generateQuestionPivot, 100);
}

function questionBannerRows(questionTitle) {
  if (!lastCrosstabHeaderPlan?.length) return [];
  const groupRow = ["", ""];
  const labelRow = ["", ""];
  const metricRow = ["", ""];
  lastCrosstabHeaderPlan.forEach((item) => {
    groupRow.push(item.group || "", "");
    labelRow.push(item.label || "", "");
    metricRow.push("计数", "列 N %");
  });
  return [
    [questionTitle, "", ...groupRow.slice(2)],
    labelRow,
    metricRow
  ];
}

function bannerWidth() {
  return 2 + (lastCrosstabHeaderPlan?.length || 0) * 2;
}

function bannerResultRow(label, questionTitle = "") {
  const row = Array.from({ length: bannerWidth() }, () => "");
  row[0] = questionTitle;
  row[1] = label;
  return row;
}

function setBannerPair(row, bannerIndex, count, percent) {
  const start = 2 + bannerIndex * 2;
  row[start] = count ?? "-";
  row[start + 1] = percent ?? "-";
}

function appendBannerFormatRows(rows, item, bannerItems) {
  if (item.type === "多选题") {
    item.rows.forEach((option, index) => {
      const row = bannerResultRow(option.label, index === 0 ? item.title : "");
      bannerItems.forEach((bannerItem, bannerIndex) => {
        const matched = bannerItem.rows?.find((candidate) => candidate.label === option.label);
        setBannerPair(row, bannerIndex, matched?.count || 0, formatPercent(matched?.countPercent || 0));
      });
      rows.push(row);
    });
    return;
  }
  if (item.type === "量表题") {
    item.stats.forEach((stat, index) => {
      const row = bannerResultRow(stat[0], index === 0 ? item.title : "");
      bannerItems.forEach((bannerItem, bannerIndex) => {
        const matched = bannerItem.stats?.find((candidate) => candidate[0] === stat[0]);
        setBannerPair(row, bannerIndex, matched?.[1] || "-", "");
      });
      rows.push(row);
    });
    item.frequencies.forEach((option) => {
      const row = bannerResultRow(option.label);
      bannerItems.forEach((bannerItem, bannerIndex) => {
        const matched = bannerItem.frequencies?.find((candidate) => candidate.label === option.label);
        setBannerPair(row, bannerIndex, matched?.count || 0, formatPercent(matched?.percent || 0));
      });
      rows.push(row);
    });
    return;
  }
  if (item.type === "NPS题") {
    const scoreRow = bannerResultRow("NPS得分", item.title);
    bannerItems.forEach((bannerItem, bannerIndex) => setBannerPair(scoreRow, bannerIndex, bannerItem.nps?.toFixed(1) || "0.0", ""));
    rows.push(scoreRow);
    item.rows.forEach((option) => {
      const row = bannerResultRow(option.label);
      bannerItems.forEach((bannerItem, bannerIndex) => {
        const matched = bannerItem.rows?.find((candidate) => candidate.label === option.label);
        setBannerPair(row, bannerIndex, matched?.count || 0, formatPercent(matched?.percent || 0));
      });
      rows.push(row);
    });
    return;
  }
  if (item.type === "矩阵量表") {
    item.rows.forEach((subItem, index) => {
      const row = bannerResultRow(subItem.label, index === 0 ? item.title : "");
      bannerItems.forEach((bannerItem, bannerIndex) => {
        const matched = bannerItem.rows?.find((candidate) => candidate.label === subItem.label);
        setBannerPair(row, bannerIndex, matched?.stats?.[0]?.[1] || "-", matched?.stats?.find((stat) => stat[0] === "Top2 Box")?.[1] || "-");
      });
      rows.push(row);
    });
    return;
  }
  if (item.type === "排序题") {
    item.rows.forEach((option, index) => {
      const row = bannerResultRow(option.label, index === 0 ? item.title : "");
      bannerItems.forEach((bannerItem, bannerIndex) => {
        const matched = bannerItem.rows?.find((candidate) => candidate.label === option.label);
        setBannerPair(row, bannerIndex, matched?.score?.toFixed(2) || "-", matched ? `首选率 ${formatPercent(matched.firstRate)}` : "-");
      });
      rows.push(row);
    });
    return;
  }
  if (item.type === "开放题") {
    const avgRow = bannerResultRow("平均字数", item.title);
    bannerItems.forEach((bannerItem, bannerIndex) => setBannerPair(avgRow, bannerIndex, bannerItem.avgLength?.toFixed(1) || "0.0", ""));
    rows.push(avgRow);
    item.topWords.forEach(([word]) => {
      const row = bannerResultRow(word);
      bannerItems.forEach((bannerItem, bannerIndex) => {
        const matched = bannerItem.topWords?.find(([candidate]) => candidate === word);
        setBannerPair(row, bannerIndex, matched?.[1] || 0, "");
      });
      rows.push(row);
    });
    return;
  }
  item.rows.forEach((option, index) => {
    const row = bannerResultRow(option.label, index === 0 ? item.title : "");
    bannerItems.forEach((bannerItem, bannerIndex) => {
      const matched = bannerItem.rows?.find((candidate) => candidate.label === option.label);
      setBannerPair(row, bannerIndex, matched?.count || 0, formatPercent(matched?.percent || 0));
    });
    rows.push(row);
  });
}

function questionPivotRows(items) {
  const rows = [];
  const data = getWorkingCrosstabData();
  const bannerPivotIndexes = lastCrosstabHeaderPlan?.length
    ? lastCrosstabHeaderPlan.map((banner) => {
      const filteredRows = filterRowsByConditionParts(data, banner.parts || parseHeaderCondition(banner.condition));
      return indexPivotItems(buildSingleQuestionPivot({ headers: data.headers, rows: filteredRows }));
    })
    : [];
  if (lastCrosstabHeaderPlan?.length) {
    rows.push(["表头条件说明"]);
    rows.push(["分组", "列名", "筛选条件"]);
    lastCrosstabHeaderPlan.forEach((item) => rows.push([item.group, item.label, item.condition]));
    rows.push([]);
  }
  items.forEach((item) => {
    rows.push(...questionBannerRows(item.title));
    if (lastCrosstabHeaderPlan?.length) {
      const key = pivotKey(item);
      const bannerItems = bannerPivotIndexes.map((index) => index.get(key) || item);
      appendBannerFormatRows(rows, item, bannerItems);
      rows.push([]);
      return;
    }
    rows.push([item.title, item.type]);
    if (item.type === "多选题") {
      rows.push(["选项", "响应数", "响应率", "普及率"]);
      item.rows.forEach((row) => rows.push([row.label, row.count, formatPercent(row.mentionPercent), formatPercent(row.countPercent)]));
    } else if (item.type === "量表题") {
      rows.push(["统计量", "值"], ...item.stats, [], ["选项", "频数", "百分比"]);
      item.frequencies.forEach((row) => rows.push([row.label, row.count, formatPercent(row.percent)]));
    } else if (item.type === "NPS题") {
      rows.push(["NPS得分", item.nps.toFixed(1)], ["分类", "频数", "占比"]);
      item.rows.forEach((row) => rows.push([row.label, row.count, formatPercent(row.percent)]));
    } else if (item.type === "矩阵量表") {
      rows.push(["属性", "均值", "标准差", "Top2 Box"]);
      item.rows.forEach((row) => rows.push([row.label, row.stats[0]?.[1] || "", row.stats[1]?.[1] || "", row.stats.find((stat) => stat[0] === "Top2 Box")?.[1] || ""]));
    } else if (item.type === "排序题") {
      rows.push(["项目", "加权得分", "首选率", "次选率", "平均排名"]);
      item.rows.forEach((row) => rows.push([row.label, row.score.toFixed(2), formatPercent(row.firstRate), formatPercent(row.secondRate), row.avgRank.toFixed(2)]));
    } else if (item.type === "开放题") {
      rows.push(["平均字数", item.avgLength.toFixed(1)], ["高频词", "次数"]);
      item.topWords.forEach(([word, count]) => rows.push([word, count]));
    } else {
      rows.push(["选项", "频数", "百分比", "有效百分比", "累计百分比"]);
      item.rows.forEach((row) => rows.push([row.label, row.count, formatPercent(row.percent), formatPercent(row.validPercent), formatPercent(row.cumulativePercent)]));
    }
    rows.push([]);
  });
  return rows;
}

function activeCrosstabHeaderPlan() {
  return lastCrosstabHeaderPlan?.length
    ? lastCrosstabHeaderPlan
    : [{ group: "总体", label: "总体", condition: "", parts: [] }];
}

function buildBannerPivotIndexes(data, plan) {
  if (!plan.length) return [];
  const baseIndex = lastQuestionPivot?.length ? indexPivotItems(lastQuestionPivot) : null;
  return plan.map((banner) => {
    if (!banner.parts?.length && !banner.condition && baseIndex) {
      return baseIndex;
    }
    const filteredRows = filterRowsByConditionParts(data, banner.parts || parseHeaderCondition(banner.condition));
    return indexPivotItems(buildSingleQuestionPivot({ headers: data.headers, rows: filteredRows }));
  });
}

function normalizedQuestionType(item) {
  if (item.nps !== undefined) return "NPS题";
  if (item.avgLength !== undefined && item.topWords) return "开放题";
  if (item.stats && item.frequencies) return "量表题";
  if (item.rows?.some((row) => row.stats || row.frequencies)) {
    return item.rows.some((row) => row.stats?.length) ? "矩阵量表" : "矩阵单选";
  }
  if (item.rows?.some((row) => row.score !== undefined)) return "排序题";
  if (item.rows?.some((row) => row.mentionPercent !== undefined || row.countPercent !== undefined)) return "多选题";
  return "单选题";
}

function questionValidBase(item) {
  if (!item) return 0;
  if (Number.isFinite(item.validBase)) return item.validBase;
  if (item.frequencies?.length) return item.frequencies.reduce((sum, row) => sum + (row.count || 0), 0);
  if (item.rows?.length && item.rows.every((row) => Number.isFinite(row.count))) {
    return item.rows.reduce((sum, row) => sum + (row.count || 0), 0);
  }
  return item.total || 0;
}

function metricLabelForMode(mode) {
  if (mode === "count") return "频数";
  if (mode === "percent") return "百分比";
  return "显著性";
}

function bannerHeaderRows(plan, mode) {
  const groupRow = ["", ""];
  const labelRow = ["", ""];
  const metricRow = ["", ""];
  plan.forEach((banner) => {
    groupRow.push(banner.group || "");
    labelRow.push(banner.label || "");
    metricRow.push(metricLabelForMode(mode));
  });
  return [groupRow, labelRow, metricRow];
}

function excelColumnLetter(index) {
  let current = index + 1;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function findByLabel(rows, label) {
  return rows?.find((row) => row.label === label) || null;
}

function findStat(stats, label) {
  return stats?.find((row) => row[0] === label)?.[1] ?? "";
}

function percentNumber(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (text.endsWith("%")) return Number(text.slice(0, -1)) / 100;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function percentExcelValue(value) {
  const number = percentNumber(value);
  return Number.isFinite(number) ? { value: number, type: "number", format: "percent" } : "";
}

function proportionSigMarker(count, base, refCount, refBase) {
  if (!base || !refBase || base === refBase) return "";
  const p1 = count / base;
  const p2 = refCount / refBase;
  const pooled = (count + refCount) / (base + refBase);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / base + 1 / refBase));
  if (!standardError) return "";
  const z = Math.abs(p1 - p2) / standardError;
  if (z < 1.96) return "";
  return p1 > p2 ? "↑" : "↓";
}

function valueForQuestionRow(source, reference, mode, countGetter, percentGetter, baseGetter, referenceBaseGetter = baseGetter) {
  const count = Number(countGetter(source) || 0);
  const percent = percentNumber(percentGetter(source)) || 0;
  if (mode === "count") return count;
  if (mode === "percent") return percentExcelValue(percent);
  const refCount = Number(countGetter(reference) || 0);
  return proportionSigMarker(count, baseGetter(source), refCount, referenceBaseGetter(reference));
}

function buildWorkbookLineDescriptors(item) {
  const descriptors = [];
  const type = normalizedQuestionType(item);

  if (type === "量表题") {
    item.stats.forEach((stat) => descriptors.push({ label: stat[0], kind: "stat" }));
    item.frequencies.forEach((row) => descriptors.push({ label: row.label, kind: "frequency" }));
    return descriptors;
  }

  if (type === "NPS题") {
    descriptors.push({ label: "NPS得分", kind: "nps" });
    descriptors.push({ label: "NSS", kind: "nss" });
    item.rows.forEach((row) => descriptors.push({ label: row.label, kind: "row" }));
    item.frequencies?.forEach((row) => descriptors.push({ label: `${row.label}分`, kind: "nps_frequency", score: row.label }));
    return descriptors;
  }

  if (type === "矩阵量表") {
    item.rows.forEach((subItem) => {
      descriptors.push({ label: subItem.label, kind: "section" });
      subItem.frequencies?.forEach((row) => descriptors.push({ label: `${row.label}分`, kind: "matrix_frequency", parent: subItem.label, score: row.label }));
    });
    return descriptors;
  }

  if (type === "矩阵单选") {
    item.rows.forEach((subItem) => {
      descriptors.push({ label: subItem.label, kind: "section" });
      subItem.frequencies?.forEach((row) => descriptors.push({ label: row.label, kind: "matrix_frequency", parent: subItem.label }));
    });
    return descriptors;
  }

  if (type === "排序题") {
    item.rows.forEach((row) => descriptors.push({ label: row.label, kind: "ranking" }));
    return descriptors;
  }

  if (type === "开放题") {
    descriptors.push({ label: "平均字数", kind: "open_avg" });
    item.topWords?.forEach(([word]) => descriptors.push({ label: word, kind: "open_word" }));
    return descriptors;
  }

  item.rows?.forEach((row) => descriptors.push({ label: row.label, kind: type === "多选题" ? "multi" : "row" }));
  return descriptors;
}

function workbookValueForDescriptor(item, referenceItem, descriptor, mode) {
  const type = normalizedQuestionType(item);
  const reference = referenceItem || item;

  if (descriptor.kind === "section") return "";

  if (descriptor.kind === "stat") {
    const value = findStat(item.stats, descriptor.label);
    return mode === "significance" ? "" : value;
  }

  if (descriptor.kind === "frequency") {
    const row = findByLabel(item.frequencies, descriptor.label);
    const refRow = findByLabel(reference.frequencies, descriptor.label);
    return valueForQuestionRow(row, refRow, mode, (x) => x?.count, (x) => x?.percent, () => questionValidBase(item), () => questionValidBase(reference));
  }

  if (descriptor.kind === "nps") {
    return mode === "significance" ? "" : (item.nps?.toFixed(1) || "0.0");
  }

  if (descriptor.kind === "nss") {
    if (mode === "significance") return "";
    if (mode === "percent") return percentExcelValue(item.nss || 0);
    return ((item.nss || 0) * 100).toFixed(1);
  }

  if (descriptor.kind === "nps_frequency") {
    const row = findByLabel(item.frequencies, descriptor.score);
    const refRow = findByLabel(reference.frequencies, descriptor.score);
    return valueForQuestionRow(row, refRow, mode, (x) => x?.count, (x) => x?.percent, () => questionValidBase(item), () => questionValidBase(reference));
  }

  if (descriptor.kind === "matrix_scale") {
    return "";
  }

  if (descriptor.kind === "matrix_frequency") {
    const subItem = findByLabel(item.rows, descriptor.parent);
    const refSubItem = findByLabel(reference.rows, descriptor.parent);
    const row = findByLabel(subItem?.frequencies, descriptor.score || descriptor.label);
    const refRow = findByLabel(refSubItem?.frequencies, descriptor.score || descriptor.label);
    return valueForQuestionRow(row, refRow, mode, (x) => x?.count, (x) => x?.percent, () => questionValidBase(item), () => questionValidBase(reference));
  }

  if (descriptor.kind === "ranking") {
    const row = findByLabel(item.rows, descriptor.label);
    if (mode === "count") return row?.score?.toFixed(2) || "";
    if (mode === "percent") return row ? percentExcelValue(row.firstRate || 0) : "";
    return "";
  }

  if (descriptor.kind === "open_avg") {
    return mode === "significance" ? "" : (item.avgLength?.toFixed(1) || "");
  }

  if (descriptor.kind === "open_word") {
    const match = item.topWords?.find(([word]) => word === descriptor.label);
    return mode === "percent" ? "" : (match?.[1] || 0);
  }

  const row = findByLabel(item.rows, descriptor.label);
  const refRow = findByLabel(reference.rows, descriptor.label);
  if (type === "多选题" || descriptor.kind === "multi") {
    return valueForQuestionRow(row, refRow, mode, (x) => x?.count, (x) => x?.countPercent, () => questionValidBase(item), () => questionValidBase(reference));
  }
  return valueForQuestionRow(row, refRow, mode, (x) => x?.count, (x) => x?.percent, () => questionValidBase(item), () => questionValidBase(reference));
}

function buildCrosstabWorkbookSheet(items, plan, bannerPivotIndexes, mode) {
  const rows = [];
  const positions = [];
  items.forEach((item, index) => {
    const key = pivotKey(item);
    const bannerItems = bannerPivotIndexes.map((pivotIndex) => pivotIndex.get(key) || item);
    positions.push({ title: item.title, type: normalizedQuestionType(item), row: rows.length + 1 });
    rows.push([`CAPTION:${index + 1}. ${item.title}`]);
    rows.push(...bannerHeaderRows(plan, mode));
    if (mode === "significance") {
      rows.push(["", "", ...bannerItems.map((_, bannerIndex) => excelColumnLetter(bannerIndex))]);
    }
    rows.push(["BASE", "", ...bannerItems.map((bannerItem) => questionValidBase(bannerItem))]);
    rows.push([]);
    buildWorkbookLineDescriptors(item).forEach((descriptor) => {
      rows.push([
        "",
        descriptor.label,
        ...bannerItems.map((bannerItem) => workbookValueForDescriptor(bannerItem, bannerItems[0], descriptor, mode))
      ]);
    });
    rows.push([]);
  });
  return { rows, positions };
}

function buildCrosstabDirectoryRows(positions, plan) {
  const rows = [
    ["目录"],
    ["工作表", "说明"],
    [{ value: "频数", href: "#'频数'!A1" }, "各题各表头列的样本数"],
    [{ value: "百分比", href: "#'百分比'!A1" }, "各题各表头列的列百分比"],
    [{ value: "显著性检验", href: "#'显著性检验'!A1" }, "与第一列相比，↑ 表示显著更高，↓ 表示显著更低"],
    [],
    ["表头方案"],
    ["分组", "列名", "筛选条件"]
  ];
  plan.forEach((item) => rows.push([item.group || "", item.label || "", item.condition || "总体"]));
  rows.push([]);
  rows.push(["题目", "题型", "频数", "百分比", "显著性检验"]);
  positions.forEach((item) => {
    rows.push([
      item.title,
      item.type,
      { value: "查看", href: `#'频数'!A${item.row}` },
      { value: "查看", href: `#'百分比'!A${item.row}` },
      { value: "查看", href: `#'显著性检验'!A${item.row}` }
    ]);
  });
  return rows;
}

function exportQuestionPivotWorkbook() {
  const data = getWorkingCrosstabData();
  const plan = activeCrosstabHeaderPlan();
  const bannerPivotIndexes = buildBannerPivotIndexes(data, plan);
  const countSheet = buildCrosstabWorkbookSheet(lastQuestionPivot, plan, bannerPivotIndexes, "count");
  const percentSheet = buildCrosstabWorkbookSheet(lastQuestionPivot, plan, bannerPivotIndexes, "percent");
  const sigSheet = buildCrosstabWorkbookSheet(lastQuestionPivot, plan, bannerPivotIndexes, "significance");
  downloadExcelWorkbookXml("全部交叉表.xls", [
    { name: "目录", rows: buildCrosstabDirectoryRows(countSheet.positions, plan) },
    { name: "频数", rows: countSheet.rows },
    { name: "百分比", rows: percentSheet.rows },
    { name: "显著性检验", rows: sigSheet.rows }
  ]);
}

function exportQuestionPivot() {
  if (!lastQuestionPivot) return;
  exportQuestionPivotWorkbook();
}

function detectCrosstabFields() {
  const parsed = parseDelimitedTable(document.querySelector("#crosstabData").value);
  fillSelectOptions("#crosstabRowVar", parsed.headers);
  fillSelectOptions("#crosstabColVar", parsed.headers);
  if (parsed.headers[1]) document.querySelector("#crosstabColVar").value = parsed.headers[1];
  return parsed;
}

function buildCrosstab(rows, rowVar, colVar) {
  const rowLabels = [...new Set(rows.map((row) => row[rowVar]).filter(Boolean))];
  const colLabels = [...new Set(rows.map((row) => row[colVar]).filter(Boolean))];
  const matrix = rowLabels.map((rowLabel) =>
    colLabels.map((colLabel) =>
      rows.filter((row) => row[rowVar] === rowLabel && row[colVar] === colLabel).length
    )
  );
  const rowTotals = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
  const colTotals = colLabels.map((_, colIndex) => matrix.reduce((sum, row) => sum + row[colIndex], 0));
  const total = rowTotals.reduce((sum, value) => sum + value, 0);
  let chiSquare = 0;
  let lowExpectedCells = 0;

  matrix.forEach((row, rowIndex) => {
    row.forEach((observed, colIndex) => {
      const expected = total ? (rowTotals[rowIndex] * colTotals[colIndex]) / total : 0;
      if (expected > 0) chiSquare += ((observed - expected) ** 2) / expected;
      if (expected > 0 && expected < 5) lowExpectedCells += 1;
    });
  });

  const degreesOfFreedom = Math.max(0, (rowLabels.length - 1) * (colLabels.length - 1));
  const pValue = chiSquarePValue(chiSquare, degreesOfFreedom);
  return { rowLabels, colLabels, matrix, rowTotals, colTotals, total, chiSquare, degreesOfFreedom, pValue, lowExpectedCells };
}

function renderCrosstabAnalysis() {
  const parsed = parseDelimitedTable(document.querySelector("#crosstabData").value);
  if (!document.querySelector("#crosstabRowVar").options.length) {
    fillSelectOptions("#crosstabRowVar", parsed.headers);
    fillSelectOptions("#crosstabColVar", parsed.headers);
    if (parsed.headers[1]) document.querySelector("#crosstabColVar").value = parsed.headers[1];
  }
  const rowVar = document.querySelector("#crosstabRowVar").value || parsed.headers[0];
  const colVar = document.querySelector("#crosstabColVar").value || parsed.headers[1];
  const result = document.querySelector("#crosstabResults");

  if (!parsed.rows.length || !rowVar || !colVar || rowVar === colVar) {
    result.innerHTML = `
      <div class="empty-state">
        <strong>无法生成交叉表</strong>
        <span>请粘贴包含表头和至少两列分类变量的数据，并选择不同的行变量和列变量。</span>
      </div>
    `;
    return;
  }

  const analysis = buildCrosstab(parsed.rows, rowVar, colVar);
  lastCrosstabAnalysis = { ...analysis, rowVar, colVar };
  document.querySelector("#exportCrosstab").disabled = false;
  const significant = analysis.pValue !== null && analysis.pValue < 0.05;
  const rowsHtml = analysis.rowLabels.map((rowLabel, rowIndex) => `
    <tr>
      <th>${escapeHtml(rowLabel)}</th>
      ${analysis.colLabels.map((_, colIndex) => {
        const count = analysis.matrix[rowIndex][colIndex];
        const percent = analysis.colTotals[colIndex] ? count / analysis.colTotals[colIndex] : 0;
        return `<td><strong>${count}</strong><span>${formatPercent(percent)}</span></td>`;
      }).join("")}
      <td>${analysis.rowTotals[rowIndex]}</td>
    </tr>
  `).join("");
  const colTotalHtml = analysis.colTotals.map((total) => `<td>${total}</td>`).join("");
  const pText = analysis.pValue === null ? "不适用" : analysis.pValue.toFixed(4);
  const warning = analysis.lowExpectedCells
    ? `有 ${analysis.lowExpectedCells} 个单元格期望频数低于 5，建议谨慎解释或合并选项。`
    : "期望频数结构基本可用。";

  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>${escapeHtml(rowVar)} × ${escapeHtml(colVar)}</strong>
        <span class="issue-tag ${significant ? "high" : "low"}">${significant ? "显著" : "未显著"}</span>
      </div>
      <div class="metric-grid compact-metrics">
        <div><span>样本量</span><strong>${analysis.total}</strong></div>
        <div><span>卡方值</span><strong>${analysis.chiSquare.toFixed(2)}</strong></div>
        <div><span>自由度</span><strong>${analysis.degreesOfFreedom}</strong></div>
        <div><span>p 值</span><strong>${pText}</strong></div>
      </div>
      <p>${significant ? "两个变量之间存在统计显著关联，可进一步比较列百分比差异。" : "当前数据未显示显著关联，建议结合样本量和业务假设判断。"}</p>
      <p>${warning}</p>
    </article>
    <article class="audit-issue">
      <div class="issue-head">
        <strong>交叉表：频数 / 列百分比</strong>
        <span class="issue-tag low">列%</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>${escapeHtml(rowVar)}</th>${analysis.colLabels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}<th>合计</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot><tr><th>合计</th>${colTotalHtml}<td>${analysis.total}</td></tr></tfoot>
        </table>
      </div>
    </article>
  `;
}

function exportCrosstabAnalysis() {
  if (!lastCrosstabAnalysis) return;
  const rows = [
    [`${lastCrosstabAnalysis.rowVar} x ${lastCrosstabAnalysis.colVar}`],
    ["卡方值", lastCrosstabAnalysis.chiSquare.toFixed(4)],
    ["自由度", lastCrosstabAnalysis.degreesOfFreedom],
    ["p值", lastCrosstabAnalysis.pValue === null ? "" : lastCrosstabAnalysis.pValue.toFixed(6)],
    [],
    [lastCrosstabAnalysis.rowVar, ...lastCrosstabAnalysis.colLabels, "合计"]
  ];
  lastCrosstabAnalysis.rowLabels.forEach((rowLabel, rowIndex) => {
    rows.push([rowLabel, ...lastCrosstabAnalysis.matrix[rowIndex], lastCrosstabAnalysis.rowTotals[rowIndex]]);
  });
  rows.push(["合计", ...lastCrosstabAnalysis.colTotals, lastCrosstabAnalysis.total]);
  downloadCsv("交叉表分析.csv", rows);
}

function parseWeightTargets(text) {
  const rows = parseDelimitedTable(`变量,类别,目标\n${text}`).rows;
  const targets = {};
  rows.forEach((row) => {
    const variable = row["变量"]?.trim();
    const category = row["类别"]?.trim();
    const target = Number(row["目标"]);
    if (!variable || !category || !Number.isFinite(target) || target <= 0) return;
    targets[variable] = targets[variable] || {};
    targets[variable][category] = target > 1 ? target / 100 : target;
  });
  Object.values(targets).forEach((targetMap) => {
    const total = Object.values(targetMap).reduce((sum, value) => sum + value, 0);
    if (total > 0) {
      Object.keys(targetMap).forEach((key) => {
        targetMap[key] = targetMap[key] / total;
      });
    }
  });
  return targets;
}

function calculateRimWeights(records, targets, iterations = 30) {
  const weightedRecords = records.map((record, index) => ({ ...record, __id: index + 1, __weight: 1 }));
  const variables = Object.keys(targets).filter((variable) => Object.prototype.hasOwnProperty.call(records[0] || {}, variable));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    variables.forEach((variable) => {
      const totalWeight = weightedRecords.reduce((sum, record) => sum + record.__weight, 0);
      Object.entries(targets[variable]).forEach(([category, targetShare]) => {
        const currentWeight = weightedRecords
          .filter((record) => record[variable] === category)
          .reduce((sum, record) => sum + record.__weight, 0);
        if (currentWeight <= 0 || totalWeight <= 0) return;
        const factor = targetShare / (currentWeight / totalWeight);
        weightedRecords.forEach((record) => {
          if (record[variable] === category) record.__weight *= factor;
        });
      });
    });
    const averageWeight = weightedRecords.reduce((sum, record) => sum + record.__weight, 0) / weightedRecords.length;
    if (averageWeight > 0) weightedRecords.forEach((record) => { record.__weight /= averageWeight; });
  }
  return { records: weightedRecords, variables };
}

function calculateCellWeights(text) {
  const rows = parseDelimitedTable(`cell,sample,target\n${text}`).rows
    .map((row) => ({
      cell: row.cell || row["cell"] || row["单元格"],
      sample: Number(row.sample || row["样本"] || row["当前样本"]),
      target: Number(row.target || row["目标"] || row["目标样本"])
    }))
    .filter((row) => row.cell && row.sample > 0 && row.target > 0);
  return rows.map((row) => ({ ...row, weight: row.target / row.sample }));
}

function summarizeRimTargets(records, targets) {
  const totalWeight = records.reduce((sum, record) => sum + record.__weight, 0);
  return Object.entries(targets).flatMap(([variable, targetMap]) =>
    Object.entries(targetMap).map(([category, targetShare]) => {
      const rawCount = records.filter((record) => record[variable] === category).length;
      const weightedShare = totalWeight
        ? records.filter((record) => record[variable] === category).reduce((sum, record) => sum + record.__weight, 0) / totalWeight
        : 0;
      return { variable, category, rawCount, targetShare, weightedShare };
    })
  );
}

function renderWeighting() {
  const mode = document.querySelector("#weightingMode").value;
  const sampleText = document.querySelector("#weightingSampleData").value;
  const targetText = document.querySelector("#weightingTargetData").value;
  const result = document.querySelector("#weightingResults");

  if (mode === "cell") {
    const rows = calculateCellWeights(sampleText);
    if (!rows.length) {
      result.innerHTML = `<div class="empty-state"><strong>无法计算 Cell 权重</strong><span>请按 cell,sample,target 格式粘贴单元格结构。</span></div>`;
      return;
    }
    lastWeightingResult = { mode, rows };
    document.querySelector("#exportWeighting").disabled = false;
    const body = rows.map((row) => `<tr><td>${escapeHtml(row.cell)}</td><td>${row.sample}</td><td>${row.target}</td><td>${row.weight.toFixed(3)}</td></tr>`).join("");
    const maxWeight = Math.max(...rows.map((row) => row.weight));
    const minWeight = Math.min(...rows.map((row) => row.weight));
    result.innerHTML = `
      <article class="audit-issue">
        <div class="issue-head"><strong>Cell 加权结果</strong><span class="issue-tag medium">${rows.length} 格</span></div>
        <div class="metric-grid compact-metrics">
          <div><span>最小权重</span><strong>${minWeight.toFixed(2)}</strong></div>
          <div><span>最大权重</span><strong>${maxWeight.toFixed(2)}</strong></div>
        </div>
        <p>${maxWeight > 3 || minWeight < 0.3 ? "存在较极端权重，建议检查配额结构或考虑截尾。" : "权重范围相对温和，可进入后续分析复核。"}</p>
      </article>
      <article class="audit-issue"><div class="table-wrap"><table><thead><tr><th>单元格</th><th>当前样本</th><th>目标样本</th><th>权重</th></tr></thead><tbody>${body}</tbody></table></div></article>
    `;
    return;
  }

  const parsed = parseDelimitedTable(sampleText);
  const targets = parseWeightTargets(targetText);
  const targetVariables = Object.keys(targets);
  if (!parsed.rows.length || !targetVariables.length) {
    result.innerHTML = `<div class="empty-state"><strong>无法计算 RIM 权重</strong><span>请粘贴原始样本数据，并按“变量,类别,目标%”提供目标结构。</span></div>`;
    return;
  }

  const weighted = calculateRimWeights(parsed.rows, targets);
  const summary = summarizeRimTargets(weighted.records, targets);
  lastWeightingResult = { mode, records: weighted.records, summary, headers: parsed.headers };
  document.querySelector("#exportWeighting").disabled = false;
  const weights = weighted.records.map((record) => record.__weight);
  const maxWeight = Math.max(...weights);
  const minWeight = Math.min(...weights);
  const effectiveN = (weights.reduce((sum, value) => sum + value, 0) ** 2) / weights.reduce((sum, value) => sum + value ** 2, 0);
  const body = summary.map((row) => `
    <tr>
      <td>${escapeHtml(row.variable)}</td>
      <td>${escapeHtml(row.category)}</td>
      <td>${row.rawCount}</td>
      <td>${formatPercent(row.targetShare)}</td>
      <td>${formatPercent(row.weightedShare)}</td>
    </tr>
  `).join("");
  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head"><strong>RIM 加权结果</strong><span class="issue-tag high">${weighted.variables.length} 个边际变量</span></div>
      <div class="metric-grid compact-metrics">
        <div><span>原始样本</span><strong>${parsed.rows.length}</strong></div>
        <div><span>有效样本量</span><strong>${effectiveN.toFixed(1)}</strong></div>
        <div><span>最小权重</span><strong>${minWeight.toFixed(2)}</strong></div>
        <div><span>最大权重</span><strong>${maxWeight.toFixed(2)}</strong></div>
      </div>
      <p>${maxWeight > 3 || minWeight < 0.3 ? "存在较极端权重，建议设置截尾规则或复核目标结构。" : "权重范围相对温和，边际结构已按目标校准。"}</p>
    </article>
    <article class="audit-issue">
      <div class="issue-head"><strong>边际结构校准结果</strong><span class="issue-tag low">目标 vs 加权后</span></div>
      <div class="table-wrap"><table><thead><tr><th>变量</th><th>类别</th><th>原始样本</th><th>目标占比</th><th>加权后占比</th></tr></thead><tbody>${body}</tbody></table></div>
    </article>
  `;
}

function exportWeightingResult() {
  if (!lastWeightingResult) return;
  if (lastWeightingResult.mode === "cell") {
    downloadCsv("Cell加权结果.csv", [["单元格", "当前样本", "目标样本", "权重"], ...lastWeightingResult.rows.map((row) => [row.cell, row.sample, row.target, row.weight.toFixed(6)])]);
    return;
  }
  const rows = [["记录ID", ...lastWeightingResult.headers, "weight"]];
  lastWeightingResult.records.forEach((record) => {
    rows.push([record.__id, ...lastWeightingResult.headers.map((header) => record[header]), record.__weight.toFixed(6)]);
  });
  downloadCsv("RIM加权样本权重.csv", rows);
}

function downloadTextFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([`\ufeff${content}`], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportSvgChartAsPng(containerSelector, filename) {
  const svg = document.querySelector(`${containerSelector} svg`);
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = clone.getAttribute("viewBox")?.split(/\s+/).map(Number) || [];
  const width = viewBox[2] || svg.clientWidth || 900;
  const height = viewBox[3] || svg.clientHeight || 520;
  clone.setAttribute("width", width);
  clone.setAttribute("height", height);

  const svgText = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(2, 2);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(filename, blob);
    }, "image/png");
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

function interpolateCurveValue(points, key, price) {
  if (!Number.isFinite(price)) return null;
  if (price <= points[0].price) return points[0][key];
  if (price >= points[points.length - 1].price) return points[points.length - 1][key];

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    if (price >= prev.price && price <= current.price) {
      const span = current.price - prev.price || 1;
      const ratio = (price - prev.price) / span;
      return prev[key] + (current[key] - prev[key]) * ratio;
    }
  }
  return null;
}

function intersectionY(points, price, leftKey, rightKey) {
  const left = interpolateCurveValue(points, leftKey, price);
  const right = interpolateCurveValue(points, rightKey, price);
  if (left === null || right === null) return null;
  return (left + right) / 2;
}

function renderPsmChart(curve, keyPoints) {
  const width = 980;
  const height = 470;
  const padding = { top: 76, right: 38, bottom: 62, left: 58 };
  const minPrice = Math.min(...curve.map((point) => point.price));
  const maxPrice = Math.max(...curve.map((point) => point.price));
  const xRange = Math.max(1, maxPrice - minPrice);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const series = [
    ["tooExpensive", "太贵", "#e87645"],
    ["expensive", "比较贵", "#09a64f"],
    ["cheap", "比较便宜", "#0872bd"],
    ["tooCheap", "太便宜", "#0a1b9f"]
  ];
  const x = (price) => padding.left + ((price - minPrice) / xRange) * chartWidth;
  const y = (value) => padding.top + (1 - value / 100) * chartHeight;
  const priceTicks = curve.map((point) => point.price);
  const valueTicks = [0, 25, 50, 75, 100];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const smoothPath = (points) => {
    if (points.length < 2) return "";
    const commands = [`M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`];
    for (let index = 0; index < points.length - 1; index += 1) {
      const previous = points[Math.max(0, index - 1)];
      const current = points[index];
      const next = points[index + 1];
      const after = points[Math.min(points.length - 1, index + 2)];
      const tension = 0.16;
      const minX = Math.min(current[0], next[0]);
      const maxX = Math.max(current[0], next[0]);
      const minY = Math.min(current[1], next[1]);
      const maxY = Math.max(current[1], next[1]);
      const cp1x = clamp(current[0] + (next[0] - previous[0]) * tension, minX, maxX);
      const cp1y = clamp(current[1] + (next[1] - previous[1]) * tension, minY, maxY);
      const cp2x = clamp(next[0] - (after[0] - current[0]) * tension, minX, maxX);
      const cp2y = clamp(next[1] - (after[1] - current[1]) * tension, minY, maxY);
      commands.push(
        `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next[0].toFixed(2)} ${next[1].toFixed(2)}`
      );
    }
    return commands.join(" ");
  };

  const lines = series
    .map(([key, label, color]) => {
      const pointPairs = curve.map((point) => [x(point.price), y(point[key])]);
      const path = smoothPath(pointPairs);
      return `
        <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="0.92" stroke-linecap="round" stroke-linejoin="round" />
      `;
    })
    .join("");

  const legend = series
    .map(([, label, color], index) => {
      const lx = padding.left + 220 + index * 132;
      const ly = 28;
      return `<g><line x1="${lx}" y1="${ly}" x2="${lx + 30}" y2="${ly}" stroke="${color}" stroke-width="3" stroke-linecap="round" /><text x="${lx + 38}" y="${ly + 7}" font-size="15" font-weight="700" fill="#525a62">${label}</text></g>`;
    })
    .join("");
  const inChart = (value) => Number.isFinite(value) && value >= minPrice && value <= maxPrice;
  const pointLabel = (label, value, percent, color, offsetX, offsetY, anchor = "start") => {
    if (!inChart(value) || percent === null) return "";
    const pointX = x(value);
    const pointY = y(percent);
    const labelX = clamp(pointX + offsetX, padding.left + 42, width - padding.right - 42);
    const labelY = clamp(pointY + offsetY, padding.top + 18, height - padding.bottom - 18);
    const text = `${label} ${formatPrice(value)}`;
    return `
      <circle cx="${pointX}" cy="${pointY}" r="5.5" fill="${color}" stroke="#fff" stroke-width="2.4" />
      <text x="${labelX}" y="${labelY}" text-anchor="${anchor}" font-size="13" font-weight="800" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round">${text}</text>
      <text x="${labelX}" y="${labelY}" text-anchor="${anchor}" font-size="13" font-weight="800" fill="${color}">${text}</text>
    `;
  };
  const pmcY = intersectionY(curve, keyPoints.pmc, "tooCheap", "expensive");
  const oppY = intersectionY(curve, keyPoints.opp, "tooCheap", "tooExpensive");
  const ippY = intersectionY(curve, keyPoints.ipp, "cheap", "expensive");
  const pmeY = intersectionY(curve, keyPoints.pme, "tooExpensive", "cheap");
  const keyCallouts = [
    pointLabel("PMC", keyPoints.pmc, pmcY, "#11a7aa", -14, -24, "end"),
    pointLabel("OPP", keyPoints.opp, oppY, "#ff6b00", 16, 28),
    pointLabel("IPP", keyPoints.ipp, ippY, "#d99b00", -8, -34, "middle"),
    pointLabel("PME", keyPoints.pme, pmeY, "#d10f0f", 16, -18)
  ].join("");

  return `
    <div class="psm-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="PSM 价格敏感度曲线图">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff" />
        ${legend}
        ${valueTicks.map((tick) => `
          <text x="${padding.left - 14}" y="${y(tick) + 5}" text-anchor="end" font-size="16" fill="#555">${tick}%</text>
        `).join("")}
        ${priceTicks.map((tick, index) => index % Math.ceil(priceTicks.length / 10) === 0 || index === priceTicks.length - 1 ? `
          <text x="${x(tick)}" y="${height - padding.bottom + 24}" text-anchor="middle" font-size="13" fill="#555">${formatPrice(tick)}</text>
        ` : "").join("")}
        <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#b7b7b7" stroke-width="1.2" />
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#b7b7b7" stroke-width="1.2" />
        ${lines}
        ${keyCallouts}
      </svg>
    </div>
  `;
}

function runPsmAnalysis() {
  const rows = parsePsmRows(document.querySelector("#psmData").value);
  const result = document.querySelector("#psmResults");
  const exportButton = document.querySelector("#exportPsm");
  const exportPngButton = document.querySelector("#exportPsmPng");

  if (!rows.length) {
    lastPsmAnalysis = null;
    exportButton.disabled = true;
    exportPngButton.disabled = true;
    result.innerHTML = `
      <div class="empty-state">
        <strong>未识别到有效数据</strong>
        <span>请确认每行至少包含四个正数，顺序为：太便宜、便宜、贵、太贵。</span>
      </div>
    `;
    return;
  }

  const curve = buildPsmCurve(rows);
  const pmc = findCurveIntersection(curve, "tooCheap", "expensive");
  const pme = findCurveIntersection(curve, "tooExpensive", "cheap");
  const ipp = findCurveIntersection(curve, "cheap", "expensive");
  const opp = findCurveIntersection(curve, "tooCheap", "tooExpensive", { minAverage: 3 });
  const acceptable = pmc !== null && pme !== null ? `${formatPrice(pmc)} - ${formatPrice(pme)}` : "未识别";
  const psmNotes = [
    opp === null ? "当前数据中“太便宜”和“太贵”曲线未形成有效交点，因此 OPP 最优价格点暂不输出。" : "",
    pmc === null || pme === null ? "可接受价格区间需要 PMC 与 PME 同时存在；若未识别，建议增加样本或检查四列价格题顺序。" : ""
  ].filter(Boolean);
  lastPsmAnalysis = {
    sampleCount: rows.length,
    acceptable,
    pmc,
    pme,
    ipp,
    opp,
    curve,
    notes: psmNotes
  };
  exportButton.disabled = false;
  exportPngButton.disabled = false;
  const noteBlock = psmNotes.length
    ? `
      <div class="psm-note">
        ${psmNotes.map((note) => `<span>${note}</span>`).join("")}
      </div>
    `
    : "";
  const curveRows = curve
    .map((point) => `
      <tr>
        <td>${point.price}</td>
        <td>${point.tooCheap.toFixed(0)}%</td>
        <td>${point.cheap.toFixed(0)}%</td>
        <td>${point.expensive.toFixed(0)}%</td>
        <td>${point.tooExpensive.toFixed(0)}%</td>
      </tr>
    `)
    .join("");

  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>关键价格点</strong>
        <span class="issue-tag high">${rows.length} 样本</span>
      </div>
      <div class="metric-grid">
        <div><span>可接受价格区间</span><strong>${acceptable}</strong></div>
        <div><span>IPP 无差异价格点</span><strong>${formatPrice(ipp)}</strong></div>
        <div><span>OPP 最优价格点</span><strong>${formatPrice(opp)}</strong></div>
        <div><span>PMC 下限</span><strong>${formatPrice(pmc)}</strong></div>
        <div><span>PME 上限</span><strong>${formatPrice(pme)}</strong></div>
      </div>
      ${noteBlock}
    </article>
    <article class="audit-issue">
      <div class="issue-head">
        <strong>价格敏感度曲线</strong>
        <span class="issue-tag low">图表</span>
      </div>
      ${renderPsmChart(curve, { pmc, pme, ipp, opp })}
    </article>
    <article class="audit-issue">
      <div class="issue-head">
        <strong>价格曲线表</strong>
        <span class="issue-tag low">累计比例</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>价格</th><th>太便宜</th><th>便宜</th><th>贵</th><th>太贵</th></tr>
          </thead>
          <tbody>${curveRows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function exportPsmAnalysis() {
  if (!lastPsmAnalysis) return;
  const rows = [
    ["PSM 价格敏感度分析"],
    ["导出时间", new Date().toLocaleString("zh-CN")],
    ["样本量", lastPsmAnalysis.sampleCount],
    [],
    ["关键价格点", "结果"],
    ["可接受价格区间", lastPsmAnalysis.acceptable],
    ["IPP 无差异价格点", formatPrice(lastPsmAnalysis.ipp)],
    ["OPP 最优价格点", formatPrice(lastPsmAnalysis.opp)],
    ["PMC 下限", formatPrice(lastPsmAnalysis.pmc)],
    ["PME 上限", formatPrice(lastPsmAnalysis.pme)],
    [],
    ["备注"],
    ...(lastPsmAnalysis.notes.length ? lastPsmAnalysis.notes.map((note) => [note]) : [["无"]]),
    [],
    ["价格曲线表"],
    ["价格", "太便宜", "比较便宜", "比较贵", "太贵"]
  ];

  lastPsmAnalysis.curve.forEach((point) => {
    rows.push([
      point.price,
      `${point.tooCheap.toFixed(0)}%`,
      `${point.cheap.toFixed(0)}%`,
      `${point.expensive.toFixed(0)}%`,
      `${point.tooExpensive.toFixed(0)}%`
    ]);
  });

  downloadCsv("PSM价格敏感度分析.csv", rows);
}

function parseKanoRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t,，]+/).map((value) => value.trim()))
    .filter((row) => row.length >= 7)
    .map((row) => {
      const counts = row.slice(1, 7).map((value) => Number(value));
      if (!row[0] || counts.some((value) => !Number.isFinite(value) || value < 0)) return null;
      return {
        name: row[0],
        attractive: counts[0],
        oneDimensional: counts[1],
        mustBe: counts[2],
        indifferent: counts[3],
        reverse: counts[4],
        questionable: counts[5]
      };
    })
    .filter(Boolean);
}

function analyzeKanoRow(row) {
  const effective = row.attractive + row.oneDimensional + row.mustBe + row.indifferent;
  const classificationEntries = [
    ["魅力属性", row.attractive],
    ["期望属性", row.oneDimensional],
    ["必备属性", row.mustBe],
    ["无差异属性", row.indifferent]
  ];
  const classification = classificationEntries.sort((a, b) => b[1] - a[1])[0][0];
  const better = effective ? (row.attractive + row.oneDimensional) / effective : 0;
  const worse = effective ? -((row.mustBe + row.oneDimensional) / effective) : 0;
  const riskShare = effective ? (row.reverse + row.questionable) / (effective + row.reverse + row.questionable) : 0;
  const priority =
    classification === "必备属性"
      ? "优先保障"
      : classification === "期望属性"
        ? "重点优化"
        : classification === "魅力属性"
          ? "差异化加分"
          : "低优先级";

  return {
    ...row,
    effective,
    classification,
    better,
    worse,
    riskShare,
    priority
  };
}

function renderKanoChart(items) {
  const width = 720;
  const height = 420;
  const padding = { top: 44, right: 36, bottom: 68, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (value) => padding.left + value * chartWidth;
  const y = (value) => padding.top + (1 - value) * chartHeight;
  const colors = {
    "魅力属性": "#2f8f5b",
    "期望属性": "#1f6fb8",
    "必备属性": "#b7791f",
    "无差异属性": "#687482"
  };
  const quadrantLabels = [
    { label: "魅力属性", cx: x(0.13), cy: padding.top + 22, color: colors["魅力属性"] },
    { label: "期望属性", cx: x(0.87), cy: padding.top + 22, color: colors["期望属性"] },
    { label: "无差异属性", cx: x(0.13), cy: padding.top + chartHeight - 22, color: colors["无差异属性"] },
    { label: "必备属性", cx: x(0.87), cy: padding.top + chartHeight - 22, color: colors["必备属性"] }
  ]
    .map((item) => `
      <g>
        <rect x="${item.cx - 42}" y="${item.cy - 15}" width="84" height="30" rx="6" fill="${item.color}" opacity="0.14" />
        <text x="${item.cx}" y="${item.cy + 5}" text-anchor="middle" font-size="13" font-weight="900" fill="${item.color}">${item.label}</text>
      </g>
    `)
    .join("");

  const points = items
    .map((item) => `
      <g>
        <circle cx="${x(Math.abs(item.worse))}" cy="${y(item.better)}" r="6" fill="${colors[item.classification]}" stroke="#fff" stroke-width="2" />
        <text x="${x(Math.abs(item.worse)) + 10}" y="${y(item.better) + 4}" font-size="12" font-weight="700" fill="#314253">${escapeHtml(item.name)}</text>
      </g>
    `)
    .join("");

  return `
    <div class="psm-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="KANO Better-Worse 图">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff" />
        <text x="18" y="${padding.top + chartHeight / 2}" font-size="13" font-weight="800" fill="#314253" transform="rotate(-90 18 ${padding.top + chartHeight / 2})">Better 系数</text>
        <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${width - padding.right}" y2="${padding.top + chartHeight}" stroke="#b7b7b7" />
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="#b7b7b7" />
        <line x1="${x(0.5)}" y1="${padding.top}" x2="${x(0.5)}" y2="${padding.top + chartHeight}" stroke="#d9e2ea" stroke-dasharray="5 5" />
        <line x1="${padding.left}" y1="${y(0.5)}" x2="${width - padding.right}" y2="${y(0.5)}" stroke="#d9e2ea" stroke-dasharray="5 5" />
        ${quadrantLabels}
        ${[0, 0.25, 0.5, 0.75, 1].map((tick) => `
          <text x="${x(tick)}" y="${height - 34}" text-anchor="middle" font-size="12" fill="#555">${tick.toFixed(2).replace("0.", ".")}</text>
        `).join("")}
        <text x="${padding.left + chartWidth / 2}" y="${height - 12}" text-anchor="middle" font-size="13" font-weight="800" fill="#314253">Worse 系数绝对值</text>
        ${[1, 0.75, 0.5, 0.25, 0].map((tick) => `
          <text x="${padding.left - 12}" y="${y(tick) + 4}" text-anchor="end" font-size="12" fill="#555">${tick}</text>
        `).join("")}
        ${points}
      </svg>
    </div>
  `;
}

function runKanoAnalysis() {
  const result = document.querySelector("#kanoResults");
  const exportButton = document.querySelector("#exportKano");
  const exportPngButton = document.querySelector("#exportKanoPng");
  const rows = parseKanoRows(document.querySelector("#kanoData").value);

  if (!rows.length) {
    lastKanoAnalysis = null;
    exportButton.disabled = true;
    exportPngButton.disabled = true;
    result.innerHTML = `
      <div class="empty-state">
        <strong>未识别到有效 KANO 数据</strong>
        <span>请按“属性名, A, O, M, I, R, Q”的顺序粘贴分类人数。</span>
      </div>
    `;
    return;
  }

  const items = rows.map(analyzeKanoRow);
  lastKanoAnalysis = items;
  exportButton.disabled = false;
  exportPngButton.disabled = false;
  const tableRows = items
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.classification)}</td>
        <td>${item.better.toFixed(2)}</td>
        <td>${item.worse.toFixed(2)}</td>
        <td>${escapeHtml(item.priority)}</td>
      </tr>
    `)
    .join("");
  const warnings = items
    .filter((item) => item.riskShare >= 0.08)
    .map((item) => `${item.name} 的反向/可疑占比偏高，建议复核题目理解或数据编码。`);

  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>KANO 属性分类</strong>
        <span class="issue-tag high">${items.length} 个属性</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>属性</th><th>分类</th><th>Better</th><th>Worse</th><th>建议</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      ${warnings.length ? `<div class="psm-note">${warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}
    </article>
    <article class="audit-issue">
      <div class="issue-head">
        <strong>Better-Worse 图</strong>
        <span class="issue-tag low">图表</span>
      </div>
      ${renderKanoChart(items)}
    </article>
  `;
}

function exportKanoAnalysis() {
  if (!lastKanoAnalysis) return;
  const rows = [
    ["KANO 模型分析"],
    ["导出时间", new Date().toLocaleString("zh-CN")],
    [],
    ["属性", "分类", "Better", "Worse", "优先级", "魅力A", "期望O", "必备M", "无差异I", "反向R", "可疑Q"]
  ];

  lastKanoAnalysis.forEach((item) => {
    rows.push([
      item.name,
      item.classification,
      item.better.toFixed(3),
      item.worse.toFixed(3),
      item.priority,
      item.attractive,
      item.oneDimensional,
      item.mustBe,
      item.indifferent,
      item.reverse,
      item.questionable
    ]);
  });

  downloadCsv("KANO模型分析.csv", rows);
}

function parseLineItems(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function generateMaxDiffDesign() {
  const result = document.querySelector("#maxdiffDesignResults");
  const exportButton = document.querySelector("#exportMaxDiffDesign");
  const items = [...new Set(parseLineItems(document.querySelector("#maxdiffItems").value))];
  const setCount = Math.max(2, Number(document.querySelector("#maxdiffSetCount").value));
  const itemsPerSet = Math.max(2, Number(document.querySelector("#maxdiffItemsPerSet").value));

  if (items.length < itemsPerSet) {
    lastMaxDiffDesign = null;
    exportButton.disabled = true;
    result.innerHTML = `
      <div class="empty-state">
        <strong>项目数量不足</strong>
        <span>待测试项目数需要不少于每题展示项目数。</span>
      </div>
    `;
    return;
  }

  const counts = new Map(items.map((item) => [item, 0]));
  const sets = [];
  for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
    const ordered = [...items].sort((a, b) => {
      const countDiff = counts.get(a) - counts.get(b);
      if (countDiff !== 0) return countDiff;
      return ((items.indexOf(a) + setIndex * 2) % items.length) - ((items.indexOf(b) + setIndex * 2) % items.length);
    });
    const selected = [];
    let cursor = setIndex % items.length;
    while (selected.length < itemsPerSet) {
      const candidate = ordered[cursor % ordered.length];
      if (!selected.includes(candidate)) selected.push(candidate);
      cursor += 1;
    }
    selected.forEach((item) => counts.set(item, counts.get(item) + 1));
    sets.push({ set: setIndex + 1, items: selected });
  }

  lastMaxDiffDesign = { items, sets, counts };
  exportButton.disabled = false;
  const coverageRows = items
    .map((item) => `
      <tr>
        <td>${escapeHtml(item)}</td>
        <td>${counts.get(item)}</td>
      </tr>
    `)
    .join("");
  const setCards = sets
    .map((set) => `
      <article class="maxdiff-set">
        <strong>任务 ${set.set}</strong>
        <ol>${set.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
      </article>
    `)
    .join("");

  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>MaxDiff 题组设计</strong>
        <span class="issue-tag high">${sets.length} 组</span>
      </div>
      <div class="maxdiff-grid">${setCards}</div>
    </article>
    <article class="audit-issue">
      <div class="issue-head">
        <strong>展示次数检查</strong>
        <span class="issue-tag low">均衡性</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>项目</th><th>展示次数</th></tr></thead>
          <tbody>${coverageRows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function exportMaxDiffDesign() {
  if (!lastMaxDiffDesign) return;
  const rows = [["MaxDiff 设计模板"], ["导出时间", new Date().toLocaleString("zh-CN")], [], ["任务", "位置", "项目"]];
  lastMaxDiffDesign.sets.forEach((set) => {
    set.items.forEach((item, index) => rows.push([set.set, index + 1, item]));
  });
  rows.push([], ["项目展示次数"], ["项目", "展示次数"]);
  lastMaxDiffDesign.items.forEach((item) => rows.push([item, lastMaxDiffDesign.counts.get(item)]));
  downloadCsv("MaxDiff设计模板.csv", rows);
}

function parseMaxDiffScores(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\t,，]+/).map((value) => value.trim()))
    .filter((row) => row.length >= 4)
    .map((row) => {
      const best = Number(row[1]);
      const worst = Number(row[2]);
      const shown = Number(row[3]);
      if (!row[0] || !Number.isFinite(best) || !Number.isFinite(worst) || !Number.isFinite(shown) || shown <= 0) return null;
      return {
        item: row[0],
        best,
        worst,
        shown,
        score: (best - worst) / shown
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function renderMaxDiffScoreChart(rows) {
  const width = 720;
  const rowHeight = 34;
  const padding = { top: 32, right: 72, bottom: 44, left: 160 };
  const height = padding.top + padding.bottom + rows.length * rowHeight;
  const scores = rows.map((row) => row.score);
  const maxAbs = Math.max(0.01, ...scores.map((score) => Math.abs(score)));
  const x = (value) => padding.left + ((value + maxAbs) / (maxAbs * 2)) * (width - padding.left - padding.right);
  const zeroX = x(0);
  const bars = rows
    .map((row, index) => {
      const y = padding.top + index * rowHeight + 7;
      const barX = Math.min(zeroX, x(row.score));
      const barWidth = Math.abs(x(row.score) - zeroX);
      const color = row.score >= 0 ? "#18875b" : "#b42318";
      return `
        <text x="${padding.left - 12}" y="${y + 15}" text-anchor="end" font-size="12" font-weight="700" fill="#314253">${escapeHtml(row.item)}</text>
        <rect x="${barX}" y="${y}" width="${Math.max(2, barWidth)}" height="20" rx="5" fill="${color}" opacity="0.82" />
        <text x="${row.score >= 0 ? x(row.score) + 8 : x(row.score) - 8}" y="${y + 15}" text-anchor="${row.score >= 0 ? "start" : "end"}" font-size="12" font-weight="800" fill="${color}">${row.score.toFixed(2)}</text>
      `;
    })
    .join("");
  const ticks = [-maxAbs, 0, maxAbs]
    .map((tick) => `
      <line x1="${x(tick)}" y1="${padding.top - 8}" x2="${x(tick)}" y2="${height - padding.bottom + 8}" stroke="${tick === 0 ? "#9aa8b4" : "#d9e2ea"}" stroke-dasharray="${tick === 0 ? "0" : "5 5"}" />
      <text x="${x(tick)}" y="${height - 16}" text-anchor="middle" font-size="12" fill="#555">${tick.toFixed(2)}</text>
    `)
    .join("");

  return `
    <div class="psm-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="MaxDiff 相对偏好得分图">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff" />
        <text x="${padding.left}" y="20" font-size="13" font-weight="800" fill="#314253">MaxDiff 相对偏好得分</text>
        ${ticks}
        ${bars}
      </svg>
    </div>
  `;
}

function renderMaxDiffScore() {
  const result = document.querySelector("#maxdiffScoreResults");
  const exportButton = document.querySelector("#exportMaxDiffScore");
  const exportPngButton = document.querySelector("#exportMaxDiffPng");
  const rows = parseMaxDiffScores(document.querySelector("#maxdiffScoreData").value);

  if (!rows.length) {
    lastMaxDiffScore = null;
    exportButton.disabled = true;
    exportPngButton.disabled = true;
    result.innerHTML = `
      <div class="empty-state">
        <strong>未识别到有效计分数据</strong>
        <span>请按“项目名, 最佳次数, 最差次数, 展示次数”的顺序粘贴汇总数据。</span>
      </div>
    `;
    return;
  }

  lastMaxDiffScore = rows;
  exportButton.disabled = false;
  exportPngButton.disabled = false;
  const maxAbs = Math.max(0.01, ...rows.map((row) => Math.abs(row.score)));
  const tableRows = rows
    .map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.item)}</td>
        <td>${row.best}</td>
        <td>${row.worst}</td>
        <td>${row.shown}</td>
        <td>${row.score.toFixed(3)}</td>
      </tr>
    `)
    .join("");
  const bars = rows
    .map((row) => {
      const width = Math.max(4, Math.abs(row.score) / maxAbs * 100);
      const positive = row.score >= 0;
      return `
        <div class="score-bar-row">
          <span>${escapeHtml(row.item)}</span>
          <div class="score-track">
            <i class="${positive ? "positive" : "negative"}" style="width:${width}%"></i>
          </div>
          <strong>${row.score.toFixed(2)}</strong>
        </div>
      `;
    })
    .join("");

  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>相对偏好排序</strong>
        <span class="issue-tag high">${rows.length} 项</span>
      </div>
      ${renderMaxDiffScoreChart(rows)}
      <div class="score-bars">${bars}</div>
    </article>
    <article class="audit-issue">
      <div class="issue-head">
        <strong>计分明细</strong>
        <span class="issue-tag low">Best-Worst</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>排名</th><th>项目</th><th>最佳</th><th>最差</th><th>展示</th><th>得分</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function exportMaxDiffScore() {
  if (!lastMaxDiffScore) return;
  const rows = [
    ["MaxDiff 简单计分"],
    ["导出时间", new Date().toLocaleString("zh-CN")],
    [],
    ["排名", "项目", "最佳次数", "最差次数", "展示次数", "得分"]
  ];
  lastMaxDiffScore.forEach((row, index) => {
    rows.push([index + 1, row.item, row.best, row.worst, row.shown, row.score.toFixed(3)]);
  });
  downloadCsv("MaxDiff简单计分.csv", rows);
}

function scoreAbcQuestion(question) {
  const text = questionText(question);
  const matches = [];
  const addMatch = (dimension, label, weight, reason) => {
    matches.push({ dimension, label, weight, reason });
  };

  if (/推荐|NPS|满意|满意度|偏好|喜欢|认同|信任|购买意愿|继续购买|复购意愿|评价|口碑/i.test(text)) {
    addMatch("attitude", "A 态度指数", /推荐|NPS|满意|满意度|购买意愿|继续购买/.test(text) ? 3 : 2, "题目涉及推荐度、满意度、偏好或购买意愿。");
  }
  if (/频率|频次|多久|每周|每天|每月|使用|场景|渠道|最近|活跃|功能|次数|购买过|使用过|复购|访问/i.test(text)) {
    addMatch("behavior", "B 行为指数", /频率|频次|多久|每天|每周|每月|场景|次数/.test(text) ? 3 : 2, "题目涉及使用频率、使用场景、渠道或行为深度。");
  }
  if (/金额|花费|消费|客单价|价格|预算|购买.*金额|购买.*频次|购买频率|月均|年均|支出|规模|份额|品类.*金额|市场规模/i.test(text)) {
    addMatch("consumption", "C 消费指数", /金额|花费|消费|支出|规模|份额/.test(text) ? 3 : 2, "题目涉及消费金额、支出规模、客单价或市场价值贡献。");
  }

  return matches.map((match) => ({
    ...match,
    id: question.display,
    title: question.title,
    type: classifyQuestion(question),
    priority: match.weight >= 3 ? "推荐" : "备选"
  }));
}

function generateAbcSuggestions(text) {
  const questions = parseQuestions(text);
  const suggestions = {
    attitude: [],
    behavior: [],
    consumption: []
  };

  questions.forEach((question) => {
    scoreAbcQuestion(question).forEach((item) => {
      suggestions[item.dimension].push(item);
    });
  });

  Object.keys(suggestions).forEach((key) => {
    suggestions[key].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  });

  return { questions, suggestions };
}

function renderAbcGroup(title, weight, items, emptyText, groupKey) {
  const rows = items.length
    ? items.map((item, index) => `
      <tr>
        <td><input type="checkbox" class="abc-indicator-check" data-group="${groupKey}" data-index="${index}" checked /></td>
        <td>${escapeHtml(item.id)}</td>
        <td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.type)}</td>
        <td>${escapeHtml(item.priority)}</td>
        <td>${escapeHtml(item.reason)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">${escapeHtml(emptyText)}</td></tr>`;

  return `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>${title}</strong>
        <span class="issue-tag ${items.length ? "high" : "medium"}">权重 ${weight}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>选择</th><th>题号</th><th>候选指标</th><th>题型</th><th>优先级</th><th>推荐理由</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function runAbcAnalysis() {
  const text = document.querySelector("#abcText").value;
  const result = document.querySelector("#abcResults");
  const exportButton = document.querySelector("#exportAbc");
  const confirmButton = document.querySelector("#confirmAbcCalculate");
  const dataInputSection = document.querySelector("#abcDataInputSection");

  if (!text.trim()) {
    lastAbcSuggestions = null;
    exportButton.disabled = true;
    confirmButton.disabled = true;
    dataInputSection.classList.add("hidden");
    result.innerHTML = `
      <div class="empty-state">
        <strong>缺少问卷稿</strong>
        <span>请先粘贴问卷题目，再识别 ABC 指数候选指标。</span>
      </div>
    `;
    return;
  }

  const { questions, suggestions } = generateAbcSuggestions(text);
  lastAbcSuggestions = suggestions;
  exportButton.disabled = false;
  confirmButton.disabled = false;
  dataInputSection.classList.add("hidden");
  const missing = [
    suggestions.attitude.length ? "" : "缺少可识别的态度指数题，建议补充满意度、推荐度或购买意愿题。",
    suggestions.behavior.length ? "" : "缺少可识别的行为指数题，建议补充使用频率、使用场景或购买频次题。",
    suggestions.consumption.length ? "" : "缺少可识别的消费指数题，建议补充消费金额、支出规模或品类消费题。"
  ].filter(Boolean);

  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>ABC 指标识别概览</strong>
        <span class="issue-tag high">${questions.length} 题</span>
      </div>
      <div class="metric-grid compact-metrics">
        <div><span>A 态度候选</span><strong>${suggestions.attitude.length}</strong></div>
        <div><span>B 行为候选</span><strong>${suggestions.behavior.length}</strong></div>
        <div><span>C 消费候选</span><strong>${suggestions.consumption.length}</strong></div>
      </div>
      ${missing.length ? `<div class="psm-note">${missing.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : "<p>三类指数均已识别到候选指标，请勾选确认入模题目后，点击“确认指标并计算”进入数据输入。</p>"}
    </article>
    ${renderAbcGroup("A 态度指数候选指标", "30%", suggestions.attitude, "未识别到明显态度题。", "attitude")}
    ${renderAbcGroup("B 行为指数候选指标", "30%", suggestions.behavior, "未识别到明显行为题。", "behavior")}
    ${renderAbcGroup("C 消费指数候选指标", "40%", suggestions.consumption, "未识别到明显消费题。", "consumption")}
  `;
}

function exportAbcSuggestions() {
  if (!lastAbcSuggestions) return;
  const rows = [
    ["ABC 用户价值模型指标建议"],
    ["导出时间", new Date().toLocaleString("zh-CN")],
    ["模型公式", "ABC用户价值指数=A态度指数x30%+B行为指数x30%+C消费指数x40%"],
    [],
    ["指数", "权重", "题号", "候选指标", "题型", "优先级", "推荐理由"]
  ];
  [
    ["A 态度指数", "30%", lastAbcSuggestions.attitude],
    ["B 行为指数", "30%", lastAbcSuggestions.behavior],
    ["C 消费指数", "40%", lastAbcSuggestions.consumption]
  ].forEach(([dimension, weight, items]) => {
    items.forEach((item) => {
      rows.push([dimension, weight, item.id, item.title, item.type, item.priority, item.reason]);
    });
  });
  downloadCsv("ABC用户价值模型指标建议.csv", rows);
}

let lastAbcSelected = null;
let lastAbcScoreResult = null;

function confirmAbcIndicators() {
  if (!lastAbcSuggestions) return;
  const checks = document.querySelectorAll(".abc-indicator-check:checked");
  const selected = { attitude: [], behavior: [], consumption: [] };
  checks.forEach((checkbox) => {
    const group = checkbox.dataset.group;
    const index = Number(checkbox.dataset.index);
    if (lastAbcSuggestions[group]?.[index]) {
      selected[group].push(lastAbcSuggestions[group][index]);
    }
  });

  const totalSelected = selected.attitude.length + selected.behavior.length + selected.consumption.length;
  if (!totalSelected) {
    alert("请至少勾选一道指标题目。");
    return;
  }

  lastAbcSelected = selected;
  document.querySelector("#abcDataInputSection").classList.remove("hidden");
  document.querySelector("#abcDataInput").value = "";
  document.querySelector("#abcDataInput").placeholder = `已确认 ${totalSelected} 道指标：\n${selected.attitude.map((i) => `[A态度] ${i.id} ${i.title}`).join("\n")}${selected.behavior.length ? "\n" : ""}${selected.behavior.map((i) => `[B行为] ${i.id} ${i.title}`).join("\n")}${selected.consumption.length ? "\n" : ""}${selected.consumption.map((i) => `[C消费] ${i.id} ${i.title}`).join("\n")}\n\n请粘贴包含上述题号字段的数据（CSV 格式，第一行为字段名）：`;
  document.querySelector("#abcResults").innerHTML += `
    <article class="audit-issue">
      <div class="issue-head"><strong>已确认指标</strong><span class="issue-tag high">${totalSelected} 题</span></div>
      <p>请在下方数据输入区粘贴样本数据，字段名建议与题号保持一致（如 Q1、Q2）。</p>
    </article>
  `;
  document.querySelector("#calculateAbcScore").disabled = false;
}

function findAbcField(headers, indicator) {
  const candidates = [
    indicator.id,
    indicator.title,
    indicator.id.replace(/[.．]/g, ""),
    indicator.title.replace(/[【\[\]].*?[\]】]/g, "").trim()
  ];
  for (const candidate of candidates) {
    const exact = headers.find((h) => h === candidate);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = headers.find((h) => h.includes(candidate) || candidate.includes(h));
    if (partial) return partial;
  }
  return null;
}

function selectedAbcIndicatorIds() {
  if (!lastAbcSelected) return ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"];
  return [
    ...lastAbcSelected.attitude,
    ...lastAbcSelected.behavior,
    ...lastAbcSelected.consumption
  ].map((item) => item.id).filter((id, index, ids) => id && ids.indexOf(id) === index);
}

function buildAbcExampleData() {
  const baseRows = [
    { ID: 1, Q1: 8, Q2: 9, Q3: 5, Q4: 3, Q5: 4, Q6: 2500, Q7: 5 },
    { ID: 2, Q1: 6, Q2: 7, Q3: 3, Q4: 2, Q5: 3, Q6: 1500, Q7: 3 },
    { ID: 3, Q1: 9, Q2: 10, Q3: 7, Q4: 5, Q5: 5, Q6: 4000, Q7: 7 },
    { ID: 4, Q1: 5, Q2: 6, Q3: 2, Q4: 1, Q5: 2, Q6: 800, Q7: 2 },
    { ID: 5, Q1: 7, Q2: 8, Q3: 4, Q4: 3, Q5: 4, Q6: 2000, Q7: 4 },
    { ID: 6, Q1: 4, Q2: 5, Q3: 1, Q4: 1, Q5: 1, Q6: 500, Q7: 1 },
    { ID: 7, Q1: 8, Q2: 9, Q3: 6, Q4: 4, Q5: 4, Q6: 3500, Q7: 6 },
    { ID: 8, Q1: 6, Q2: 6, Q3: 3, Q4: 2, Q5: 3, Q6: 1200, Q7: 3 },
    { ID: 9, Q1: 9, Q2: 9, Q3: 7, Q4: 5, Q5: 5, Q6: 4500, Q7: 7 },
    { ID: 10, Q1: 5, Q2: 5, Q3: 2, Q4: 1, Q5: 2, Q6: 600, Q7: 1 }
  ];
  const headers = ["ID", ...selectedAbcIndicatorIds().filter((id) => id in baseRows[0])];
  return [
    headers.join(","),
    ...baseRows.map((row) => headers.map((header) => row[header]).join(","))
  ].join("\n");
}

function looksLikeHeaderRow(cells) {
  return cells.some((cell) => /[A-Za-z\u4e00-\u9fa5]/.test(String(cell || "")));
}

function normalizeAbcDataText(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return text;
  const firstCells = splitDelimitedLine(lines[0]);
  if (looksLikeHeaderRow(firstCells)) return text;

  const legacyExampleRows = [
    "1,8,9,5,3,2500",
    "2,6,7,3,2,1500",
    "3,9,10,7,5,4000",
    "4,5,6,2,1,800",
    "5,7,8,4,3,2000",
    "6,4,5,1,1,500",
    "7,8,9,6,4,3500",
    "8,6,6,3,2,1200",
    "9,9,9,7,5,4500",
    "10,5,5,2,1,600"
  ];
  if (lines.length === legacyExampleRows.length && lines.every((line, index) => line === legacyExampleRows[index])) {
    return buildAbcExampleData();
  }

  const headers = ["ID", ...selectedAbcIndicatorIds()].slice(0, firstCells.length);
  if (headers.length === firstCells.length) {
    return [headers.join(","), ...lines].join("\n");
  }
  return text;
}

function calculateAbcScore() {
  const input = document.querySelector("#abcDataInput");
  const text = normalizeAbcDataText(input.value.trim());
  if (text !== input.value.trim()) input.value = text;
  const result = document.querySelector("#abcResults");
  const exportButton = document.querySelector("#exportAbcScore");

  if (!text) {
    result.innerHTML += `
      <div class="empty-state">
        <strong>缺少数据</strong>
        <span>请先粘贴包含已确认指标字段的样本数据。</span>
      </div>
    `;
    exportButton.disabled = true;
    return;
  }
  if (!lastAbcSelected) {
    result.innerHTML += `
      <div class="empty-state">
        <strong>未确认指标</strong>
        <span>请先点击“识别指标”，然后勾选确认入模题目。</span>
      </div>
    `;
    exportButton.disabled = true;
    return;
  }

  const parsed = parseDelimitedTable(text);
  if (!parsed.rows.length) {
    result.innerHTML += `
      <div class="empty-state">
        <strong>数据解析失败</strong>
        <span>请检查数据格式，确保第一行为字段名，且使用逗号或制表符分隔。</span>
      </div>
    `;
    exportButton.disabled = true;
    return;
  }

  const dimensionConfig = [
    { key: "attitude", label: "A 态度", weight: 0.3 },
    { key: "behavior", label: "B 行为", weight: 0.3 },
    { key: "consumption", label: "C 消费", weight: 0.4 }
  ];

  const dimensionResults = [];
  const matchedFields = [];

  for (const dim of dimensionConfig) {
    const indicators = lastAbcSelected[dim.key];
    if (!indicators.length) {
      dimensionResults.push({ key: dim.key, label: dim.label, weight: dim.weight, fieldMap: [], scores: [] });
      continue;
    }
    const fieldMap = indicators.map((ind) => {
      const field = findAbcField(parsed.headers, ind);
      return { indicator: ind, field, matched: !!field };
    });
    matchedFields.push(...fieldMap);

    const scores = parsed.rows.map((row) => {
      const values = fieldMap
        .filter((f) => f.matched)
        .map((f) => toNumberOrNull(row[f.field]))
        .filter((v) => v !== null);
      return values.length ? mean(values) : null;
    });
    dimensionResults.push({ key: dim.key, label: dim.label, weight: dim.weight, fieldMap, scores });
  }

  const validRows = parsed.rows.map((row, index) => {
    const dimScores = dimensionResults.map((dim) => {
      const validValues = dim.fieldMap
        .filter((f) => f.matched)
        .map((f) => toNumberOrNull(row[f.field]))
        .filter((v) => v !== null);
      return validValues.length ? mean(validValues) : null;
    });

    const hasAll = dimScores.every((s) => s !== null);
    if (!hasAll) return null;

    return {
      index,
      rawScores: dimScores
    };
  }).filter(Boolean);

  if (!validRows.length) {
    result.innerHTML += `
      <div class="empty-state">
        <strong>无法计算</strong>
        <span>未能匹配到有效数据字段，或数据中存在大量缺失值。请检查字段名是否与题号一致。</span>
      </div>
    `;
    exportButton.disabled = true;
    return;
  }

  const ranges = dimensionConfig.map((_, dimIndex) => {
    const values = validRows.map((row) => row.rawScores[dimIndex]).filter((value) => value !== null);
    return {
      min: Math.min(...values),
      max: Math.max(...values)
    };
  });

  validRows.forEach((row) => {
    row.normalized = row.rawScores.map((score, dimIndex) => {
      const range = ranges[dimIndex];
      if (!range || range.max === range.min) return 1;
      return (score - range.min) / (range.max - range.min);
    });
    const abcScore = row.normalized.reduce((sum, value, dimIndex) => sum + value * dimensionConfig[dimIndex].weight, 0);
    row.abcScore = Math.round(abcScore * 1000) / 1000;
  });

  validRows.sort((a, b) => b.abcScore - a.abcScore);
  const scores = validRows.map((r) => r.abcScore);
  const p67 = scores[Math.floor(scores.length * 0.33)] || scores[0];
  const p33 = scores[Math.floor(scores.length * 0.67)] || scores[scores.length - 1];

  validRows.forEach((row) => {
    if (row.abcScore >= p67) row.segment = "高价值";
    else if (row.abcScore >= p33) row.segment = "中价值";
    else row.segment = "低价值";
  });

  const segmentCounts = { "高价值": 0, "中价值": 0, "低价值": 0 };
  validRows.forEach((row) => { segmentCounts[row.segment] += 1; });

  const fieldMatchRows = matchedFields.map((f) => `
    <tr>
      <td>${escapeHtml(f.indicator.id)}</td>
      <td>${escapeHtml(f.indicator.title)}</td>
      <td>${f.matched ? escapeHtml(f.field) : '<span style="color:#b42318">未匹配</span>'}</td>
    </tr>
  `).join("");

  const scoreRows = validRows.slice(0, 20).map((row) => `
    <tr>
      <td>${row.index + 1}</td>
      <td>${row.abcScore.toFixed(3)}</td>
      <td><span class="issue-tag ${row.segment === "高价值" ? "high" : row.segment === "中价值" ? "medium" : "low"}">${row.segment}</span></td>
      <td>${row.rawScores.map((s) => (s !== null ? s.toFixed(2) : "-")).join(" / ")}</td>
    </tr>
  `).join("");

  lastAbcScoreResult = {
    rows: validRows,
    headers: parsed.headers,
    matchedFields,
    dimensionResults,
    segmentCounts
  };
  exportButton.disabled = false;

  result.innerHTML += `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>ABC 指数计算结果</strong>
        <span class="issue-tag high">${validRows.length} 有效样本</span>
      </div>
      <div class="metric-grid compact-metrics">
        <div><span>高价值用户</span><strong>${segmentCounts["高价值"]} (${((segmentCounts["高价值"] / validRows.length) * 100).toFixed(1)}%)</strong></div>
        <div><span>中价值用户</span><strong>${segmentCounts["中价值"]} (${((segmentCounts["中价值"] / validRows.length) * 100).toFixed(1)}%)</strong></div>
        <div><span>低价值用户</span><strong>${segmentCounts["低价值"]} (${((segmentCounts["低价值"] / validRows.length) * 100).toFixed(1)}%)</strong></div>
      </div>
      <p>模型公式：ABC 得分 = A态度标准化得分 × 30% + B行为标准化得分 × 30% + C消费标准化得分 × 40%。当前按每个维度在全样本中的最小值和最大值做 0-1 标准化，再按权重汇总。</p>
    </article>
    <article class="audit-issue">
      <div class="issue-head"><strong>字段匹配情况</strong></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>题号</th><th>指标名称</th><th>数据字段</th></tr></thead>
          <tbody>${fieldMatchRows}</tbody>
        </table>
      </div>
    </article>
    <article class="audit-issue">
      <div class="issue-head"><strong>得分预览（前 20 条）</strong></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>样本序号</th><th>ABC 得分</th><th>价值分群</th><th>A / B / C 原始均值</th></tr></thead>
          <tbody>${scoreRows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function exportAbcScoreResult() {
  if (!lastAbcScoreResult) return;
  const rows = [
    ["ABC 用户价值指数得分"],
    ["导出时间", new Date().toLocaleString("zh-CN")],
    [],
    ["模型公式", "ABC = A态度标准化得分 × 30% + B行为标准化得分 × 30% + C消费标准化得分 × 40%；标准化方式为各维度在全样本内 Min-Max 归一化"],
    [],
    ["样本序号", "ABC 得分", "价值分群", "A 态度原始均值", "B 行为原始均值", "C 消费原始均值"]
  ];
  lastAbcScoreResult.rows.forEach((row) => {
    rows.push([
      row.index + 1,
      row.abcScore.toFixed(3),
      row.segment,
      row.rawScores[0]?.toFixed(2) ?? "-",
      row.rawScores[1]?.toFixed(2) ?? "-",
      row.rawScores[2]?.toFixed(2) ?? "-"
    ]);
  });
  rows.push([]);
  rows.push(["字段匹配情况"]);
  rows.push(["题号", "指标名称", "数据字段", "匹配状态"]);
  lastAbcScoreResult.matchedFields.forEach((f) => {
    rows.push([f.indicator.id, f.indicator.title, f.field || "-", f.matched ? "已匹配" : "未匹配"]);
  });
  downloadCsv("ABC用户价值指数得分.csv", rows);
}

function buildAiResearchBrief(text, context) {
  const issues = auditQuestionnaire(text);
  const cleaningRules = generateCleaningRules(text, {
    minDuration: 120,
    openMinChars: 5,
    straightThreshold: 90
  });
  const headerSuggestions = generateHeaderSuggestions(text);
  const timeItems = estimateSurveyTime(text);
  const totalMinutes = timeItems.length
    ? Math.max(1, Math.ceil(timeItems.reduce((sum, item) => sum + item.seconds, 0) / 60))
    : null;
  const blockerCount = issues.filter((issue) => issue.severity === "high").length;
  const brief = {
    context: context || "未填写",
    questionCount: parseQuestions(text).length,
    issueCount: issues.length,
    blockerCount,
    estimatedMinutes: totalMinutes,
    topIssues: issues.slice(0, 6),
    cleaningRules: cleaningRules.slice(0, 5),
    headerSuggestions: headerSuggestions.slice(0, 4)
  };
  const prompt = [
    "你是一名资深市场研究项目负责人，请基于以下材料进行专业审查。",
    "",
    `业务背景：${brief.context}`,
    "",
    "请输出：",
    "1. 问卷上线风险摘要",
    "2. 必须修改的问题清单",
    "3. 可优化但不阻塞上线的问题",
    "4. 数据清洗规则建议",
    "5. 表头/分群变量建议",
    "6. 面向项目经理的 5 条行动建议",
    "",
    "已由工具预检出的风险：",
    ...(brief.topIssues.length
      ? brief.topIssues.map((issue, index) => `${index + 1}. [${issue.severity}] ${issue.title}：${issue.detail}${issue.evidence ? `；证据：${issue.evidence}` : ""}`)
      : ["未发现明显规则问题。"]),
    "",
    "清洗规则候选：",
    ...brief.cleaningRules.map((rule, index) => `${index + 1}. ${rule.title}：${rule.detail}`),
    "",
    "表头建议候选：",
    ...brief.headerSuggestions.map((item, index) => `${index + 1}. ${item.title}：${item.detail}${item.evidence ? `；${item.evidence}` : ""}`),
    "",
    "原始材料：",
    text
  ].join("\n");

  return { brief, prompt };
}

function renderAiBrief() {
  const text = document.querySelector("#aiInput").value.trim();
  const context = document.querySelector("#aiContext").value.trim();
  const result = document.querySelector("#aiResults");
  const copyButton = document.querySelector("#copyAiPrompt");
  const exportButton = document.querySelector("#exportAiPrompt");

  if (!text) {
    lastAiPrompt = "";
    copyButton.disabled = true;
    exportButton.disabled = true;
    result.innerHTML = `
      <div class="empty-state">
        <strong>缺少材料</strong>
        <span>请先粘贴问卷稿、模型结果或研究材料。</span>
      </div>
    `;
    return;
  }

  const { brief, prompt } = buildAiResearchBrief(text, context);
  lastAiPrompt = prompt;
  copyButton.disabled = false;
  exportButton.disabled = false;
  const risks = brief.topIssues.length
    ? brief.topIssues.map((issue) => `<li><strong>${escapeHtml(issue.title)}</strong><span>${escapeHtml(issue.detail)}</span></li>`).join("")
    : "<li><strong>未发现明显规则问题</strong><span>建议继续进行真实页面路径复核。</span></li>";

  result.innerHTML = `
    <article class="audit-issue">
      <div class="issue-head">
        <strong>AI 审查摘要</strong>
        <span class="issue-tag high">${brief.issueCount} 风险</span>
      </div>
      <div class="metric-grid compact-metrics">
        <div><span>识别题量</span><strong>${brief.questionCount}</strong></div>
        <div><span>阻塞问题</span><strong>${brief.blockerCount}</strong></div>
        <div><span>预计时长</span><strong>${brief.estimatedMinutes ? `${brief.estimatedMinutes} 分钟` : "未识别"}</strong></div>
      </div>
      <ul class="ai-risk-list">${risks}</ul>
    </article>
    <article class="audit-issue">
      <div class="issue-head">
        <strong>可复制 AI 提示词</strong>
        <span class="issue-tag low">Prompt</span>
      </div>
      <textarea class="prompt-box" readonly>${escapeHtml(prompt)}</textarea>
    </article>
  `;
}

async function copyAiPrompt() {
  if (!lastAiPrompt) return;
  try {
    await navigator.clipboard.writeText(lastAiPrompt);
    document.querySelector("#copyAiPrompt").textContent = "已复制";
    window.setTimeout(() => {
      document.querySelector("#copyAiPrompt").textContent = "复制提示词";
    }, 1200);
  } catch {
    downloadTextFile("AI调研提示词.txt", lastAiPrompt);
  }
}

function exportAiPrompt() {
  if (!lastAiPrompt) return;
  downloadTextFile("AI调研提示词.txt", lastAiPrompt);
}

function runAudit() {
  const text = document.querySelector("#questionnaireText").value;
  const scenario = document.querySelector("#auditScenario").value;
  const issues = auditQuestionnaire(text, scenario);
  renderAuditResults(issues);
  lastAuditReport = {
    projectName: document.querySelector("#projectName").value.trim() || "未命名项目",
    scenario,
    scenarioLabel: auditScenarioLabels[scenario],
    testerName: document.querySelector("#testerName").value.trim() || "未填写",
    questionnaireText: text.trim(),
    issues,
    createdAt: new Date()
  };
  document.querySelector("#exportAudit").disabled = false;
  document.querySelector("#exportAuditHtml").disabled = false;
  syncAuditToWorkspaceDraft();
  markWorkspaceStatus("audit");
  return issues;
}

function auditSeverityCounts(issues) {
  return {
    high: issues.filter((issue) => issue.severity === "high").length,
    medium: issues.filter((issue) => issue.severity === "medium").length,
    low: issues.filter((issue) => issue.severity === "low").length
  };
}

function exportAuditReport() {
  if (!lastAuditReport) return;
  const severityLabel = { high: "阻塞", medium: "重要", low: "建议" };
  const blockerCount = lastAuditReport.issues.filter((issue) => issue.severity === "high").length;
  const lines = [
    `# 问卷上线质检报告`,
    "",
    `- 项目名称：${lastAuditReport.projectName}`,
    `- 研究场景：${lastAuditReport.scenarioLabel || "通用上线质检"}`,
    `- 审查人员：${lastAuditReport.testerName}`,
    `- 导出时间：${lastAuditReport.createdAt.toLocaleString("zh-CN")}`,
    `- 发现问题：${lastAuditReport.issues.length}`,
    `- 阻塞问题：${blockerCount}`,
    "",
    "## 质检结论",
    lastAuditReport.issues.length
      ? `本次检查发现 ${lastAuditReport.issues.length} 个规则问题，其中 ${blockerCount} 个为阻塞问题。`
      : "当前规则未发现明显问题，仍建议进行真实页面路径复核。",
    "",
    "## 问题明细"
  ];

  if (!lastAuditReport.issues.length) {
    lines.push("", "无明显规则问题。");
  } else {
    lastAuditReport.issues.forEach((issue, index) => {
      lines.push(
        "",
        `### ${index + 1}. [${severityLabel[issue.severity]}] ${issue.title}`,
        "",
        issue.detail
      );
      if (issue.evidence) {
        lines.push("", "证据：", "", "```", issue.evidence, "```");
      }
    });
  }

  lines.push(
    "",
    "## 复核建议",
    "",
    "- 对阻塞问题优先修改后再上线。",
    "- 对跳题、随机轮换、排他项建议在问卷平台预览页逐路径复核。",
    "- 导出报告为规则检查结果，不替代人工完整试填。"
  );

  downloadTextFile("问卷上线质检报告.md", lines.join("\n"), "text/markdown;charset=utf-8");
}

function exportAuditHtmlReport() {
  if (!lastAuditReport) return;
  const severityLabel = { high: "阻塞", medium: "重要", low: "建议" };
  const counts = auditSeverityCounts(lastAuditReport.issues);
  const blockerIssues = lastAuditReport.issues.filter((issue) => issue.severity === "high");
  const conclusion = lastAuditReport.issues.length
    ? `本次检查发现 ${lastAuditReport.issues.length} 个规则问题，其中 ${counts.high} 个为上线阻断项。`
    : "当前规则未发现明显问题，仍建议进行真实页面路径复核。";
  const issueHtml = lastAuditReport.issues.length
    ? lastAuditReport.issues.map((issue, index) => `
      <article class="issue ${issue.severity}">
        <div class="issue-title">
          <strong>${index + 1}. ${escapeHtml(issue.title)}</strong>
          <span>${severityLabel[issue.severity]}</span>
        </div>
        <p>${escapeHtml(issue.detail)}</p>
        ${issue.evidence ? `<pre>${escapeHtml(issue.evidence)}</pre>` : ""}
      </article>
    `).join("")
    : `<article class="issue low"><div class="issue-title"><strong>未发现明显规则问题</strong><span>通过</span></div><p>建议继续进行真实页面路径复核。</p></article>`;
  const blockerHtml = blockerIssues.length
    ? blockerIssues.map((issue) => `<li>${escapeHtml(issue.title)}：${escapeHtml(issue.detail)}</li>`).join("")
    : "<li>暂无上线阻断项。</li>";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>问卷上线质检报告</title>
  <style>
    body { margin: 0; padding: 32px; color: #18232f; background: #f4f7f8; font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif; }
    main { max-width: 1080px; margin: 0 auto; display: grid; gap: 18px; }
    section, .hero { background: #fff; border: 1px solid #d9e2ea; border-radius: 10px; padding: 24px; }
    h1, h2, p { margin-top: 0; }
    h1 { font-size: 30px; margin-bottom: 12px; }
    h2 { font-size: 20px; margin-bottom: 14px; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; color: #687482; }
    .meta div, .metric { padding: 12px; border: 1px solid #d9e2ea; border-radius: 8px; background: #fbfcfd; }
    .meta strong, .metric strong { display: block; margin-top: 6px; color: #18232f; font-size: 22px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .summary { color: #314253; line-height: 1.7; }
    .blockers { margin: 0; padding-left: 20px; line-height: 1.8; }
    .issue { display: grid; gap: 10px; margin-top: 12px; padding: 16px; border-radius: 8px; border: 1px solid #d9e2ea; }
    .issue.high { border-color: #efb4af; background: #fff7f6; }
    .issue.medium { border-color: #ebd19b; background: #fffaf0; }
    .issue.low { border-color: #b7dbc9; background: #f6fbf8; }
    .issue-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    .issue-title span { border-radius: 999px; padding: 5px 10px; color: #fff; background: #18875b; font-size: 12px; }
    .issue.high .issue-title span { background: #b42318; }
    .issue.medium .issue-title span { background: #b7791f; }
    pre { margin: 0; white-space: pre-wrap; padding: 12px; border-radius: 8px; background: #eef3f5; color: #314253; }
    @media (max-width: 760px) { body { padding: 16px; } .meta, .metrics { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <div class="hero">
      <h1>问卷上线质检报告</h1>
      <p class="summary">${escapeHtml(conclusion)}</p>
      <div class="meta">
        <div>项目名称<strong>${escapeHtml(lastAuditReport.projectName)}</strong></div>
        <div>研究场景<strong>${escapeHtml(lastAuditReport.scenarioLabel || "通用上线质检")}</strong></div>
        <div>审查人员<strong>${escapeHtml(lastAuditReport.testerName)}</strong></div>
        <div>导出时间<strong>${escapeHtml(lastAuditReport.createdAt.toLocaleString("zh-CN"))}</strong></div>
      </div>
    </div>
    <section>
      <h2>质检概览</h2>
      <div class="metrics">
        <div class="metric">发现问题<strong>${lastAuditReport.issues.length}</strong></div>
        <div class="metric">阻塞问题<strong>${counts.high}</strong></div>
        <div class="metric">重要问题<strong>${counts.medium}</strong></div>
        <div class="metric">建议问题<strong>${counts.low}</strong></div>
      </div>
    </section>
    <section>
      <h2>上线阻断项</h2>
      <ul class="blockers">${blockerHtml}</ul>
    </section>
    <section>
      <h2>问题明细</h2>
      ${issueHtml}
    </section>
    <section>
      <h2>复核建议</h2>
      <ul class="blockers">
        <li>对阻塞问题优先修改后再上线。</li>
        <li>对跳题、随机轮换、排他项建议在问卷平台预览页逐路径复核。</li>
        <li>导出报告为规则检查结果，不替代人工完整试填。</li>
      </ul>
    </section>
  </main>
</body>
</html>`;
  downloadTextFile("问卷上线质检报告.html", html, "text/html;charset=utf-8");
}

function saveTestRecord() {
  const issues = runAudit();
  const record = {
    projectName: document.querySelector("#projectName").value.trim(),
    scenario: document.querySelector("#auditScenario").value,
    questionnaireText: document.querySelector("#questionnaireText").value.trim(),
    testerName: document.querySelector("#testerName").value.trim(),
    issues,
    savedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem("surveyQualityAuditRecord", JSON.stringify(record));
  } catch {
    // 隐私模式忽略写入
  }
  document.querySelector("#lastSaved").textContent = new Date(record.savedAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function restoreTestRecord() {
  try {
    const raw = localStorage.getItem("surveyQualityAuditRecord");
    if (!raw) return;
    const record = JSON.parse(raw);
    document.querySelector("#projectName").value = record.projectName || "";
    document.querySelector("#auditScenario").value = record.scenario || "general";
    document.querySelector("#questionnaireText").value = record.questionnaireText || "";
    document.querySelector("#testerName").value = record.testerName || "";
    if (record.issues) renderAuditResults(record.issues);
    if (record.issues) {
      lastAuditReport = {
        projectName: record.projectName || "未命名项目",
        scenario: record.scenario || "general",
        scenarioLabel: auditScenarioLabels[record.scenario || "general"],
        testerName: record.testerName || "未填写",
        questionnaireText: record.questionnaireText || "",
        issues: record.issues,
        createdAt: new Date(record.savedAt || Date.now())
      };
      document.querySelector("#exportAudit").disabled = false;
      document.querySelector("#exportAuditHtml").disabled = false;
    }
    document.querySelector("#lastSaved").textContent = new Date(record.savedAt).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
    markWorkspaceStatus("audit");
  } catch {
    // 数据损坏或隐私模式，静默忽略
  }
}

document.querySelector("#saveWorkspaceProject").addEventListener("click", saveWorkspaceProject);
document.querySelector("#applyWorkspaceProject").addEventListener("click", () => applyWorkspaceProject(true));
document.querySelector("#clearWorkspaceProject").addEventListener("click", clearWorkspaceProject);
document.querySelector("#questionnaireImportFile").addEventListener("change", (event) => {
  handleQuestionnaireImport(event.target.files?.[0]);
});
document.querySelector("#applyQuestionnaireImport").addEventListener("click", applyQuestionnaireImport);
document.querySelectorAll("[data-import-target]").forEach((button) => {
  button.addEventListener("click", () => {
    sharedImportTargetId = button.dataset.importTarget;
    const input = document.querySelector("#sharedQuestionnaireImportFile");
    input.value = "";
    input.click();
  });
});
document.querySelector("#sharedQuestionnaireImportFile").addEventListener("change", (event) => {
  handleQuestionnaireImport(event.target.files?.[0], sharedImportTargetId);
});
document
  .querySelectorAll("#workspaceProjectName, #workspaceStudyType, #workspaceStage, #workspaceSampleTarget, #workspaceQuestionnaire")
  .forEach((field) => field.addEventListener("input", renderWorkspaceProject));
document
  .querySelectorAll("#questionnaireText, #timeText, #cleaningText, #headerText, #abcText, #aiInput")
  .forEach((field) => field.addEventListener("input", () => syncQuestionnaireToWorkspace(field.value)));

document.querySelector("#runAudit").addEventListener("click", runAudit);
document.querySelector("#exportAudit").addEventListener("click", exportAuditReport);
document.querySelector("#exportAuditHtml").addEventListener("click", exportAuditHtmlReport);
document.querySelector("#loadExample").addEventListener("click", () => {
  document.querySelector("#questionnaireText").value = exampleQuestionnaire;
  runAudit();
});
document.querySelector("#saveTest").addEventListener("click", saveTestRecord);
document.querySelector("#saveQuotaProgress").addEventListener("click", (event) => {
  markWorkspaceStatus("quota");
  showButtonSaved(event.currentTarget, "已保存到项目");
});

document.querySelector("#estimateTime").addEventListener("click", renderTimeEstimate);
document.querySelector("#loadTimeExample").addEventListener("click", () => {
  document.querySelector("#timeText").value = exampleQuestionnaire;
  renderTimeEstimate();
});

document.querySelector("#generateCleaning").addEventListener("click", () => {
  lastCleaningRules = generateCleaningRules(document.querySelector("#cleaningText").value);
  renderEditableSuggestions(
    "#cleaningResults",
    lastCleaningRules,
    "未生成清洗规则",
    "请检查问卷稿是否包含明确题号和题目文本。",
    "cleaning"
  );
  markWorkspaceStatus("cleaning");
});

document.querySelector("#loadCleaningExample").addEventListener("click", () => {
  document.querySelector("#cleaningText").value = exampleQuestionnaire;
  document.querySelector("#generateCleaning").click();
});

document.querySelector("#generateHeader").addEventListener("click", () => {
  lastHeaderPlan = generateHeaderSuggestions(document.querySelector("#headerText").value);
  renderEditableSuggestions(
    "#headerResults",
    lastHeaderPlan,
    "未生成表头建议",
    "请检查问卷稿是否包含明确题号和题目文本。",
    "header"
  );
  markWorkspaceStatus("header");
});

document.querySelector("#loadHeaderExample").addEventListener("click", () => {
  document.querySelector("#headerText").value = exampleQuestionnaire;
  document.querySelector("#generateHeader").click();
});

document.querySelector("#exportCleaningRules").addEventListener("click", () => {
  exportEditableSuggestions("cleaning");
});

document.querySelector("#exportHeaderPlan").addEventListener("click", () => {
  exportEditableSuggestions("header");
});

document.querySelector("#detectCrosstabFields").addEventListener("click", detectCrosstabFields);
document.querySelector("#importCrosstabHeader").addEventListener("click", () => {
  crosstabImportMode = "header";
  const input = document.querySelector("#crosstabImportFile");
  input.value = "";
  input.click();
});
document.querySelector("#importCrosstabData").addEventListener("click", () => {
  crosstabImportMode = "data";
  const input = document.querySelector("#crosstabImportFile");
  input.value = "";
  input.click();
});
document.querySelector("#crosstabImportFile").addEventListener("change", (event) => {
  handleCrosstabImport(event.target.files?.[0]);
});
document.querySelector("#runQuestionPivot").addEventListener("click", renderQuestionPivot);
document.querySelector("#runCrosstab").addEventListener("click", renderCrosstabAnalysis);
document.querySelector("#exportCrosstab").addEventListener("click", exportCrosstabAnalysis);
document.querySelector("#loadCrosstabExample").addEventListener("click", () => {
  document.querySelector("#crosstabData").value = exampleCrosstabData;
  detectCrosstabFields();
  renderQuestionPivot();
});

document.querySelector("#runWeighting").addEventListener("click", renderWeighting);
document.querySelector("#exportWeighting").addEventListener("click", exportWeightingResult);
document.querySelector("#loadWeightingExample").addEventListener("click", () => {
  document.querySelector("#weightingMode").value = "rim";
  document.querySelector("#weightingSampleData").value = exampleWeightingSampleData;
  document.querySelector("#weightingTargetData").value = exampleWeightingTargetData;
  renderWeighting();
});

document.querySelector("#runPsm").addEventListener("click", () => {
  runPsmAnalysis();
  if (lastPsmAnalysis) markWorkspaceStatus("models");
});
document.querySelector("#exportPsm").addEventListener("click", exportPsmAnalysis);
document.querySelector("#exportPsmPng").addEventListener("click", () => {
  exportSvgChartAsPng("#psmResults", "PSM价格敏感度曲线.png");
});
document.querySelector("#loadPsmExample").addEventListener("click", () => {
  document.querySelector("#psmData").value = examplePsmData;
  runPsmAnalysis();
  if (lastPsmAnalysis) markWorkspaceStatus("models");
});

document.querySelector("#runKano").addEventListener("click", () => {
  runKanoAnalysis();
  if (lastKanoAnalysis) markWorkspaceStatus("models");
});
document.querySelector("#exportKano").addEventListener("click", exportKanoAnalysis);
document.querySelector("#exportKanoPng").addEventListener("click", () => {
  exportSvgChartAsPng("#kanoResults", "KANO_Better-Worse图.png");
});
document.querySelector("#loadKanoExample").addEventListener("click", () => {
  document.querySelector("#kanoData").value = exampleKanoData;
  runKanoAnalysis();
  if (lastKanoAnalysis) markWorkspaceStatus("models");
});

document.querySelector("#generateMaxDiff").addEventListener("click", () => {
  generateMaxDiffDesign();
  if (lastMaxDiffDesign) markWorkspaceStatus("models");
});
document.querySelector("#exportMaxDiffDesign").addEventListener("click", exportMaxDiffDesign);
document.querySelector("#loadMaxDiffExample").addEventListener("click", () => {
  document.querySelector("#maxdiffItems").value = exampleMaxDiffItems;
  generateMaxDiffDesign();
  if (lastMaxDiffDesign) markWorkspaceStatus("models");
});
document.querySelector("#scoreMaxDiff").addEventListener("click", () => {
  renderMaxDiffScore();
  if (lastMaxDiffScore) markWorkspaceStatus("models");
});
document.querySelector("#exportMaxDiffScore").addEventListener("click", exportMaxDiffScore);
document.querySelector("#exportMaxDiffPng").addEventListener("click", () => {
  exportSvgChartAsPng("#maxdiffScoreResults", "MaxDiff相对偏好得分图.png");
});
document.querySelector("#loadMaxDiffScoreExample").addEventListener("click", () => {
  document.querySelector("#maxdiffScoreData").value = exampleMaxDiffScoreData;
  renderMaxDiffScore();
  if (lastMaxDiffScore) markWorkspaceStatus("models");
});

document.querySelector("#generateAbc").addEventListener("click", () => {
  runAbcAnalysis();
  if (lastAbcSuggestions) markWorkspaceStatus("models");
});
document.querySelector("#exportAbc").addEventListener("click", exportAbcSuggestions);
document.querySelector("#loadAbcExample").addEventListener("click", () => {
  document.querySelector("#abcText").value = exampleAbcQuestionnaire;
  runAbcAnalysis();
  if (lastAbcSuggestions) markWorkspaceStatus("models");
});

document.querySelector("#confirmAbcCalculate").addEventListener("click", confirmAbcIndicators);
document.querySelector("#calculateAbcScore").addEventListener("click", calculateAbcScore);
document.querySelector("#exportAbcScore").addEventListener("click", exportAbcScoreResult);
document.querySelector("#loadAbcDataExample").addEventListener("click", () => {
  document.querySelector("#abcDataInput").value = buildAbcExampleData();
  calculateAbcScore();
});

document.querySelector("#generateAiBrief").addEventListener("click", renderAiBrief);
document.querySelector("#copyAiPrompt").addEventListener("click", copyAiPrompt);
document.querySelector("#exportAiPrompt").addEventListener("click", exportAiPrompt);
document.querySelector("#loadAiExample").addEventListener("click", () => {
  document.querySelector("#aiInput").value = exampleQuestionnaire;
  document.querySelector("#aiContext").value = "新品概念测试，上线前问卷审查";
  renderAiBrief();
});

let deferredInstallPrompt;
const installButton = document.querySelector("#installButton");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.classList.remove("hidden");
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  try {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
  } catch {
    // 安装取消或失败，静默处理
  }
  deferredInstallPrompt = null;
  installButton.classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

workspaceProject = loadWorkspaceProject();
if (workspaceProject) fillWorkspaceProject(workspaceProject);
renderWorkspaceProject();
restoreTestRecord();
calculateSample();
addQuotaDimension("性别", [["男", 50], ["女", 50]]);
setCrossQuotaDimensions(crossQuotaTemplates["gender-age"].dimensions);
calculateQuota();
