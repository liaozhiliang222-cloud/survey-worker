/**
 * 用户分群分析 — 界面与交互模块
 *
 * 依赖：
 *   - cluster-core.js（算法核心，globalThis.ClusterCore）
 *   - cluster-worker.js（Web Worker，可降级为同步计算）
 *   - app.js（showView / projectDataBus / 文件解析等全局能力，缺失时降级）
 *
 * 全部计算在浏览器本地完成，不调用任何 AI 接口、不调用 Python 服务、
 * 不上传受访者原始数据。
 */
(function initClusterAnalysis(root) {
  "use strict";

  // ─── 状态 ─────────────────────────────────────────────────

  const state = {
    method: "kmeans",          // kmeans | twostep | hierarchical
    parsed: null,              // { headers, rows, fileName, sheetNames, sheetIndex }
    definitions: [],           // 变量定义
    multiGroups: [],
    results: {},               // 按算法保存结果
    diagnostics: null,         // K-Means K 诊断结果
    clusterNames: {},          // 群体名称（key: method:id）
    hierarchicalK: 3,          // 系统聚类结果页当前切割群数
    worker: null,
    workerBroken: false,
    requestId: null,
    running: false,
    cancelled: false
  };

  const METHOD_LABELS = {
    kmeans: "K-Means 聚类",
    twostep: "两步聚类",
    hierarchical: "系统聚类"
  };

  const ROLE_LABELS = {
    id: "ID 变量",
    cluster: "聚类变量",
    profile: "描述变量",
    weight: "权重变量",
    excluded: "排除"
  };

  const MEASUREMENT_LABELS = {
    scale: "连续",
    ordinal: "有序",
    nominal: "名义",
    binary: "二元",
    count: "计数"
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function showToast(message, type, duration) {
    if (typeof root.showToast === "function") {
      root.showToast(message, type, duration);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[用户分群] ${message}`);
  }

  function core() {
    return root.ClusterCore;
  }

  // ─── 分隔符解析（本地实现，避免依赖 app.js 内部函数）─────

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

  // ─── 方法切换 ─────────────────────────────────────────────

  const METHOD_NOTES = {
    kmeans: "K-Means 面向连续数值变量，需要预先指定分群数量；支持批量更新、运行均值更新与仅分类模式。",
    twostep: "两步聚类可同时处理连续与分类变量，通过 BIC/AIC 自动判断群数，适合样本量较大的混合类型数据。",
    hierarchical: "系统聚类（又称层次聚类）通过树状图观察群体逐步合并过程，支持七种联接方法，适合样本量较小或对变量聚类的探索。"
  };

  function switchMethod(method) {
    if (!["kmeans", "twostep", "hierarchical"].includes(method)) return;
    state.method = method;
    document.querySelectorAll("[data-cluster-method]").forEach((tab) => {
      const active = tab.dataset.clusterMethod === method;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    $("clusterMethodNote").textContent = METHOD_NOTES[method];
    $("clusterKmeansOptions").classList.toggle("hidden", method !== "kmeans");
    $("clusterTwostepOptions").classList.toggle("hidden", method !== "twostep");
    $("clusterHierarchicalOptions").classList.toggle("hidden", method !== "hierarchical");
    refreshMethodAdvice();
    // 已有该算法结果时直接展示
    if (state.results[method]) {
      renderResults(state.results[method]);
    } else {
      renderResultsEmpty();
    }
    updateRunButtonState();
  }

  function refreshMethodAdvice() {
    const adviceEl = $("clusterMethodAdvice");
    if (!adviceEl) return;
    if (!state.parsed) {
      adviceEl.innerHTML = "<span>导入数据并选择聚类变量后，系统会根据变量结构与样本量给出方法建议。</span>";
      return;
    }
    const clusterDefs = state.definitions.filter((definition) => definition.role === "cluster");
    const advice = core().recommendMethod(clusterDefs, state.parsed.rows.length);
    const lines = [];
    advice.reasons.forEach((reason) => { lines.push(`<li>${escapeHtml(reason)}</li>`); });
    advice.warnings.forEach((warning) => { lines.push(`<li class="warning-text">⚠ ${escapeHtml(warning)}</li>`); });
    const highlighted = advice.recommendedMethod === state.method;
    adviceEl.innerHTML = `
      <div class="advice-row">
        <span class="advice-label">建议方法：</span>
        <strong class="${highlighted ? "advice-current" : ""}">${escapeHtml(METHOD_LABELS[advice.recommendedMethod])}</strong>
        ${highlighted ? '<span class="advice-tag">当前方法</span>' : ""}
      </div>
      <ul class="advice-list">${lines.join("") || "<li>暂无可建议内容。</li>"}</ul>
      <p class="panel-note">方法建议仅作为提示，你可以忽略并手动选择其他可兼容算法。</p>`;
  }

  // ─── 数据导入 ─────────────────────────────────────────────

  function setupDropzone() {
    const dropzone = $("clusterDropzone");
    const input = $("clusterFileInput");
    if (!dropzone || !input) return;
    dropzone.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      input.value = "";
      input.click();
    });
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
      const file = event.dataTransfer?.files?.[0];
      if (file) await handleImportFile(file);
    });
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await handleImportFile(file);
    });
  }

  async function handleImportFile(file) {
    try {
      if (!/\.(xlsx|xls|csv|txt|sav)$/i.test(file.name)) {
        throw new Error("仅支持 .xlsx / .csv / .txt / .sav 文件。");
      }
      const raw = await file.arrayBuffer();
      const text = /\.sav$/i.test(file.name)
        ? await root.savToDelimitedTableText?.(raw) || savTextFallback(raw)
        : /\.xlsx?$/i.test(file.name)
          ? await parseWorkbookText(raw, file.name)
          : await file.text();
      const parsed = parseDelimitedTable(text);
      if (!parsed.headers.length || !parsed.rows.length) {
        throw new Error("未识别到有效表格数据，请确认文件包含表头和样本行。");
      }
      // Excel 多工作表：尝试读取工作表列表供选择
      let sheetNames = [];
      let sheetIndex = 0;
      if (/\.xlsx?$/i.test(file.name) && typeof root.getWorkbookSheets === "function") {
        try {
          sheetNames = root.getWorkbookSheets(
            await root.readZipText?.(raw, "xl/workbook.xml"),
            await root.readZipText?.(raw, "xl/_rels/workbook.xml.rels")
          ).map((sheet) => sheet.name);
        } catch (_) { /* 解析失败时忽略工作表列表 */ }
      }
      loadParsed({ headers: parsed.headers, rows: parsed.rows, fileName: file.name, sheetNames, sheetIndex });
    } catch (error) {
      showToast(`数据导入失败：${error.message || error}`, "error", 4800);
    }
  }

  async function parseWorkbookText(raw, fileName) {
    if (typeof root.xlsxToDelimitedTableText === "function") {
      return root.xlsxToDelimitedTableText(raw);
    }
    throw new Error("当前环境缺少 Excel 解析能力，请改用 CSV 文件导入。");
  }

  function savTextFallback() {
    throw new Error("当前环境缺少 SAV 解析能力，请改用 CSV 文件导入。");
  }

  function loadParsed({ headers, rows, fileName, sheetNames = [], sheetIndex = 0 }) {
    state.parsed = { headers, rows, fileName, sheetNames, sheetIndex };
    state.definitions = core().detectVariableTypes(rows, headers);
    state.multiGroups = core().detectMultiSelectGroups(headers);
    state.results = {};
    state.diagnostics = null;
    state.clusterNames = {};
    state.hierarchicalK = 3;
    renderDataPreview();
    renderSheetPicker();
    renderVariableTable();
    renderMultiGroups();
    refreshMethodAdvice();
    $("clusterClearData")?.removeAttribute("disabled");
    $("clusterRoleSuggest")?.removeAttribute("disabled");
    updateRunButtonState();
    showToast(`已加载 ${rows.length} 条样本 · ${headers.length} 个字段`, "success", 2600);
  }

  function renderSheetPicker() {
    const picker = $("clusterSheetPicker");
    const select = $("clusterSheetSelect");
    if (!picker || !select) return;
    const sheetNames = state.parsed?.sheetNames || [];
    if (sheetNames.length > 1) {
      picker.classList.remove("hidden");
      select.innerHTML = sheetNames.map((name, index) =>
        `<option value="${index}" ${index === state.parsed.sheetIndex ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");
      select.onchange = async () => {
        const index = Number(select.value);
        // 重新解析对应工作表
        if (state.lastWorkbook && typeof root.xlsxToDelimitedTableText === "function") {
          try {
            const text = await root.xlsxSheetToDelimitedTableText?.(state.lastWorkbook, index);
            const parsed = parseDelimitedTable(text || "");
            if (parsed.headers.length && parsed.rows.length) {
              loadParsed({ ...state.parsed, headers: parsed.headers, rows: parsed.rows, sheetIndex: index, fileName: state.parsed.fileName, sheetNames });
            }
          } catch (error) {
            showToast(`工作表切换失败：${error.message}`, "error", 3600);
          }
        } else {
          showToast("当前环境不支持按工作表切换，请重新上传文件。", "info", 3600);
        }
      };
    } else {
      picker.classList.add("hidden");
    }
  }

  function renderDataPreview() {
    const preview = $("clusterDataPreview");
    if (!preview || !state.parsed) return;
    const { headers, rows, fileName } = state.parsed;
    const numericFields = headers.filter((header) =>
      rows.some((row) => row[header] !== "" && Number.isFinite(Number(row[header]))));
    const categoricalFields = headers.filter((header) => {
      const uniq = new Set(rows.map((row) => String(row[header] ?? "").trim()).filter(Boolean));
      return uniq.size > 1 && uniq.size <= 20;
    });
    let missingCells = 0;
    const duplicateIds = new Map();
    const idCandidate = state.definitions.find((definition) => definition.role === "id");
    rows.forEach((row, index) => {
      headers.forEach((header) => {
        if (String(row[header] ?? "").trim() === "") missingCells += 1;
      });
      if (idCandidate) {
        const key = String(row[idCandidate.name] ?? "").trim();
        if (key) duplicateIds.set(key, (duplicateIds.get(key) || 0) + 1);
      }
    });
    const duplicateCount = Array.from(duplicateIds.values()).filter((count) => count > 1).length;
    const headRows = rows.slice(0, 10);
    preview.classList.remove("hidden");
    preview.innerHTML = `
      <div class="data-stats-grid">
        <div><strong>${escapeHtml(fileName)}</strong><span>文件名</span></div>
        <div><strong>${rows.length}</strong><span>样本量</span></div>
        <div><strong>${headers.length}</strong><span>字段数</span></div>
        <div><strong>${numericFields.length}</strong><span>数值字段</span></div>
        <div><strong>${categoricalFields.length}</strong><span>分类字段</span></div>
        <div><strong>${missingCells}</strong><span>缺失单元格</span></div>
        <div><strong>${duplicateCount}</strong><span>重复 ID 数</span></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${headRows.map((row) =>
            `<tr>${headers.map((header) => `<td>${escapeHtml(String(row[header] ?? "").slice(0, 40))}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
      <p class="panel-note">前 10 行预览；原始受访者数据仅保存在浏览器本地。</p>`;
  }

  // ─── 变量定义 ─────────────────────────────────────────────

  function definitionRow(definition) {
    const name = definition.name;
    const groupInfo = definition.multiGroup
      ? `<span class="cluster-group-tag" title="多选变量组 ${escapeHtml(definition.multiGroup)}">组</span>`
      : "";
    const reverseControl = definition.measurement === "ordinal"
      ? `<label class="cluster-mini-option"><input type="checkbox" data-role="reverse" ${definition.reverseScoring?.enabled ? "checked" : ""}> 反向计分</label>`
      : "";
    const binaryControls = definition.measurement === "binary"
      ? `<label class="cluster-mini-option">正:<input type="text" size="3" value="${escapeHtml(definition.positiveValue ?? "1")}" data-role="positive"></label>
         <label class="cluster-mini-option">负:<input type="text" size="3" value="${escapeHtml(definition.negativeValue ?? "0")}" data-role="negative"></label>`
      : "";
    return `<tr data-variable="${escapeHtml(name)}">
      <td class="cluster-var-name">${escapeHtml(name)}${groupInfo}</td>
      <td>
        <select data-role="role">
          ${Object.entries(ROLE_LABELS).map(([value, label]) =>
            `<option value="${value}" ${definition.role === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </td>
      <td>
        <select data-role="measurement">
          ${Object.entries(MEASUREMENT_LABELS).map(([value, label]) =>
            `<option value="${value}" ${definition.measurement === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </td>
      <td><span class="cluster-detect-tag">${escapeHtml(MEASUREMENT_LABELS[definition.detectedMeasurement] || definition.detectedMeasurement)}</span></td>
      <td>${definition.uniqueCount}</td>
      <td>${definition.missingCount}</td>
      <td>
        <input type="text" class="cluster-missing-codes" value="${escapeHtml((definition.missingCodes || []).join(","))}"
          placeholder="如 99,999,-1,拒答" data-role="missingCodes" />
      </td>
      <td class="cluster-var-options">${reverseControl}${binaryControls}</td>
    </tr>`;
  }

  function renderVariableTable() {
    const table = $("clusterVariableTable");
    if (!table) return;
    const body = table.querySelector("tbody");
    body.innerHTML = state.definitions.map(definitionRow).join("");
    body.querySelectorAll("select[data-role='role']").forEach((select) => {
      select.addEventListener("change", () => {
        const definition = findDefinition(select.closest("tr").dataset.variable);
        if (definition) {
          definition.role = select.value;
          definition.userConfirmed = true;
        }
        refreshMethodAdvice();
        updateRunButtonState();
      });
    });
    body.querySelectorAll("select[data-role='measurement']").forEach((select) => {
      select.addEventListener("change", () => {
        const definition = findDefinition(select.closest("tr").dataset.variable);
        if (!definition) return;
        definition.measurement = select.value;
        definition.userConfirmed = true;
        if (select.value === "ordinal" && !definition.reverseScoring) {
          definition.reverseScoring = { enabled: false, min: 1, max: 5 };
        }
        renderVariableTable();
        refreshMethodAdvice();
      });
    });
    body.querySelectorAll("input[data-role='missingCodes']").forEach((input) => {
      input.addEventListener("change", () => {
        const definition = findDefinition(input.closest("tr").dataset.variable);
        if (definition) {
          definition.missingCodes = String(input.value).split(/[,，;；]/).map((code) => code.trim()).filter(Boolean);
        }
      });
    });
    body.querySelectorAll("input[data-role='reverse']").forEach((input) => {
      input.addEventListener("change", () => {
        const definition = findDefinition(input.closest("tr").dataset.variable);
        if (!definition) return;
        if (!definition.reverseScoring) definition.reverseScoring = { enabled: true, min: 1, max: 5 };
        definition.reverseScoring.enabled = input.checked;
      });
    });
    body.querySelectorAll("input[data-role='positive'], input[data-role='negative']").forEach((input) => {
      input.addEventListener("change", () => {
        const definition = findDefinition(input.closest("tr").dataset.variable);
        if (!definition) return;
        if (input.dataset.role === "positive") definition.positiveValue = input.value;
        else definition.negativeValue = input.value;
      });
    });
  }

  function findDefinition(name) {
    return state.definitions.find((definition) => definition.name === name);
  }

  function renderMultiGroups() {
    const container = $("clusterMultiGroups");
    if (!container) return;
    if (!state.multiGroups.length) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = `
      <h4>多选变量组</h4>
      ${state.multiGroups.map((group) => {
        const members = group.variables.map((name) => findDefinition(name)).filter(Boolean);
        const allCluster = members.length && members.every((definition) => definition.role === "cluster");
        return `<div class="cluster-group-row">
          <label><input type="checkbox" data-group="${escapeHtml(group.name)}" ${allCluster ? "checked" : ""}> 整组加入聚类（${escapeHtml(group.name)}）</label>
          <span class="panel-note">${members.map((definition) => escapeHtml(definition.name)).join("、")}</span>
          <label class="cluster-mini-option">选中值:<input type="text" size="3" value="1" data-group-value="${escapeHtml(group.name)}" data-kind="positive"></label>
          <label class="cluster-mini-option">未选中值:<input type="text" size="3" value="0" data-group-value="${escapeHtml(group.name)}" data-kind="negative"></label>
        </div>`;
      }).join("")}
      <p class="panel-note">多选变量按二元变量组处理；勾选“整组加入”会把组内所有选项变量加入聚类，缺失值视为未选中。</p>`;
    container.querySelectorAll("input[type='checkbox'][data-group]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const group = state.multiGroups.find((item) => item.name === checkbox.dataset.group);
        group?.variables.forEach((name) => {
          const definition = findDefinition(name);
          if (definition) {
            definition.role = checkbox.checked ? "cluster" : "excluded";
            definition.measurement = "binary";
          }
        });
        renderVariableTable();
        refreshMethodAdvice();
        updateRunButtonState();
      });
    });
    container.querySelectorAll("input[data-group-value]").forEach((input) => {
      input.addEventListener("change", () => {
        const group = state.multiGroups.find((item) => item.name === input.dataset.groupValue);
        group?.variables.forEach((name) => {
          const definition = findDefinition(name);
          if (!definition) return;
          if (input.dataset.kind === "positive") definition.positiveValue = input.value;
          else definition.negativeValue = input.value;
        });
      });
    });
  }

  function applyRoleSuggestions() {
    state.definitions = core().detectVariableTypes(state.parsed.rows, state.parsed.headers);
    state.multiGroups = core().detectMultiSelectGroups(state.parsed.headers);
    renderVariableTable();
    renderMultiGroups();
    refreshMethodAdvice();
    showToast("已按数据特征重新应用角色建议", "success", 2400);
  }

  // ─── 收集配置 ─────────────────────────────────────────────

  function collectClusterVariables() {
    return state.definitions.filter((definition) => definition.role === "cluster").map((definition) => definition.name);
  }

  function collectProfileVariables() {
    return state.definitions.filter((definition) => definition.role === "profile").map((definition) => definition.name);
  }

  function collectWeightColumn() {
    return state.definitions.find((definition) => definition.role === "weight")?.name || "";
  }

  function collectMethodOptions() {
    const val = (id) => $(id)?.value ?? "";
    const num = (id, fallback) => {
      const value = Number($(id)?.value);
      return Number.isFinite(value) ? value : fallback;
    };
    if (state.method === "kmeans") {
      return {
        k: Math.max(2, num("kmK", 3)),
        initMode: val("kmInitMode") || "scattered",
        initialCenters: val("kmInitMode") === "manual" && val("kmManualCenters").trim()
          ? val("kmManualCenters").split(/\r?\n/).filter(Boolean).map((line) => splitDelimitedLine(line).map((cell) => Number(cell.trim())))
          : null,
        runMode: val("kmRunMode") || "batch",
        maxIterations: Math.min(999, Math.max(1, num("kmMaxIterations", 10))),
        convergence: Math.min(1, Math.max(0, num("kmConvergence", 0))),
        missing: val("kmMissing") || "listwise",
        standardization: val("kmStandardization") || "zscore",
        useWeight: val("kmUseWeight") === "weightField",
        seed: num("tsSeed", 20240101) || 20240101
      };
    }
    if (state.method === "twostep") {
      return {
        distance: val("tsDistance") || "loglikelihood",
        autoSelect: val("tsAutoSelect") === "auto",
        criterion: val("tsCriterion") || "BIC",
        maxClusters: Math.min(30, Math.max(2, num("tsMaxClusters", 15))),
        fixedK: Math.min(30, Math.max(2, num("tsFixedK", 3))),
        standardization: val("tsStandardization") || "zscore",
        missing: val("tsMissing") || "exclude",
        noiseThreshold: Math.max(0, num("tsNoiseThreshold", 0)),
        stabilityRuns: [0, 3, 5].includes(Number(val("tsStabilityRuns"))) ? Number(val("tsStabilityRuns")) : 0,
        initialDistanceThreshold: val("tsInitialThreshold").trim() ? num("tsInitialThreshold", 0) : null,
        maxBranch: Math.max(4, num("tsMaxBranch", 8)),
        seed: num("tsSeed", 20240101) || 20240101
      };
    }
    // hierarchical
    const dataType = val("hiDataType") || "interval";
    return {
      object: val("hiObject") || "cases",
      dataType,
      linkage: val("hiLinkage") || "ward",
      distance: val("hiDistance") || "squared-euclidean",
      minkowskiP: Math.max(0.1, num("hiMinkowskiP", 2)),
      standardization: val("hiStandardization") || "zscore",
      distanceTransform: val("hiDistanceTransform") || "none",
      positiveValue: val("hiPositiveValue") || "1",
      negativeValue: val("hiNegativeValue") || "0",
      selectedK: Math.max(1, num("hiSelectedK", 3)),
      kRange: { min: 2, max: 10 },
      seed: num("tsSeed", 20240101) || 20240101
    };
  }

  function validateMethodOptions(options) {
    const clusterVariables = collectClusterVariables();
    const issues = [];
    if (state.method === "kmeans") {
      const nonNumeric = clusterVariables.filter((name) => {
        const definition = findDefinition(name);
        return definition && !["scale", "ordinal", "count"].includes(definition.measurement);
      });
      if (nonNumeric.length) {
        issues.push(`K-Means 不接受名义/二元聚类变量：${nonNumeric.join("、")}。请调整变量角色或改用两步聚类。`);
      }
      if (options.k >= state.parsed.rows.length) {
        issues.push(`分群数量 K=${options.k} 需要小于有效样本量（${state.parsed.rows.length}）。`);
      }
      if (options.initMode !== "scattered" && (!options.initialCenters || options.initialCenters.length !== options.k)) {
        issues.push(`手动/导入初始中心数量（${options.initialCenters?.length || 0}）必须等于 K（${options.k}）。`);
      }
    }
    if (state.method === "twostep" && options.distance === "euclidean") {
      const hasCategorical = clusterVariables.some((name) => {
        const definition = findDefinition(name);
        return definition && ["nominal", "binary"].includes(definition.measurement);
      });
      if (hasCategorical) issues.push("欧氏距离仅在所有聚类变量均为连续变量时可用；当前包含分类变量，请改用对数似然距离。");
    }
    if (state.method === "hierarchical") {
      const dataType = options.dataType;
      const distance = options.distance;
      if (dataType === "interval" && !["euclidean", "squared-euclidean", "cosine", "pearson", "chebyshev", "cityblock", "minkowski"].includes(distance)) {
        issues.push("当前数据类型为区间/连续，请选择对应的距离方式。");
      }
      if (dataType === "count" && !["chi-square", "phi-square"].includes(distance)) {
        issues.push("当前数据类型为计数，请选择卡方距离或 Phi-square 距离。");
      }
      if (dataType === "binary" && !["simple-matching", "jaccard", "dice", "russell-rao", "phi", "yule-q", "rogers-tanimoto", "sokal-sneath"].includes(distance)) {
        issues.push("当前数据类型为二元，请选择二元距离方式。");
      }
      if (options.linkage === "ward" && !["euclidean", "squared-euclidean"].includes(distance)) {
        issues.push("Ward 法要求使用欧氏距离或平方欧氏距离。");
      }
      if (["centroid", "median"].includes(options.linkage) && !["euclidean", "squared-euclidean", "cityblock", "chebyshev", "minkowski"].includes(distance)) {
        issues.push("重心法与中位数法要求使用欧氏类距离。");
      }
      if (options.object === "cases" && options.dataType === "interval") {
        const n = state.parsed.rows.length;
        if (n > 1000) {
          issues.push(`样本量 ${n} 超过 1000，案例系统聚类需要计算约 ${Math.round(n * n / 2)} 个距离值，可能导致浏览器卡顿或内存不足。如仍要运行，请先在数据清洗中筛选样本。`);
        }
      }
    }
    return issues;
  }

  // ─── 计算（Worker 优先，失败降级同步）────────────────────

  function getWorker() {
    if (state.workerBroken) return null;
    if (!state.worker) {
      try {
        state.worker = new Worker("./cluster-worker.js");
      } catch (_) {
        state.worker = null;
        state.workerBroken = true;
      }
    }
    return state.worker;
  }

  function computeInWorker(payload, onProgress) {
    return new Promise((resolve, reject) => {
      const worker = getWorker();
      if (!worker) {
        reject(new Error("worker_unavailable"));
        return;
      }
      const requestId = `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      state.requestId = requestId;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("聚类计算超时，请重试或减少样本量。"));
      }, 10 * 60 * 1000);
      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };
      const onMessage = (event) => {
        const data = event.data || {};
        if (data.requestId !== requestId) return;
        if (data.type === "cluster_progress" && onProgress) {
          onProgress(data.progress, data.stage, data.message);
        } else if (data.type === "cluster_done") {
          cleanup();
          state.requestId = null;
          resolve(data.result);
        } else if (data.type === "cluster_error") {
          cleanup();
          state.requestId = null;
          if (data.errorCode === "cancelled") {
            reject(new Error("任务已取消。"));
          } else {
            reject(new Error(data.message || "聚类计算失败"));
          }
        }
      };
      const onError = () => {
        cleanup();
        state.worker?.terminate?.();
        state.worker = null;
        state.workerBroken = true;
        reject(new Error("聚类 Worker 异常退出，将改用本地同步计算重试。"));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({
        type: "cluster_run",
        requestId,
        payload: {
          method: state.method,
          rows: state.parsed.rows,
          variableDefinitions: state.definitions,
          profileVariables: collectProfileVariables(),
          idColumn: state.definitions.find((definition) => definition.role === "id")?.name || "",
          weightColumn: collectWeightColumn(),
          preprocessing: {},
          methodOptions: payload
        }
      });
    });
  }

  function computeSynchronously(payload, onProgress) {
    const rows = state.parsed.rows;
    const definitions = state.definitions;
    const clusterVariables = collectClusterVariables();
    onProgress?.(0.1, "prepare", "数据准备");
    const qualityChecks = core().runQualityChecks({ rows, definitions, clusterVariables, weightVariable: collectWeightColumn() });
    const blockingIssues = qualityChecks.filter((issue) => issue.level === "block");
    if (blockingIssues.length) {
      throw new Error(`数据质量检查未通过：${blockingIssues.map((issue) => issue.title).join("；")}`);
    }
    onProgress?.(0.3, "cluster", "聚类计算");
    let result;
    const input = { rows, definitions, clusterVariables, options: payload };
    if (state.method === "kmeans") {
      input.weightColumn = collectWeightColumn();
      result = core().kmeansCluster(input);
    } else if (state.method === "twostep") {
      result = core().twostepCluster(input);
    } else {
      result = core().hierarchicalCluster(input);
    }
    result.qualityChecks = qualityChecks;
    onProgress?.(0.7, "profile", "群体画像");
    let profile = null;
    if (!(state.method === "hierarchical" && (payload || {}).object === "variables")) {
      profile = core().profileClusters({
        rows,
        definitions,
        clusterVariables,
        profileVariables: collectProfileVariables(),
        assignments: result.assignments,
        clusterSizes: result.clusterSizes
      });
    }
    result.profile = profile;
    result.variableDefinitions = definitions;
    onProgress?.(0.95, "export", "结果整理");
    return result;
  }

  function updateProgress(progress, stage, message) {
    const bar = $("clusterProgressFill");
    const text = $("clusterProgressText");
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    if (text) text.textContent = `${Math.round(progress * 100)}% · ${message || stage || ""}`;
  }

  async function runCluster() {
    if (!state.parsed || state.running) return;
    const options = collectMethodOptions();
    const validationIssues = validateMethodOptions(options);
    if (validationIssues.length) {
      showToast(validationIssues.join("\n"), "error", 5200);
      return;
    }
    state.running = true;
    state.cancelled = false;
    $("clusterRunButton").disabled = true;
    $("clusterCancelButton").disabled = false;
    $("clusterProgress").classList.remove("hidden");
    updateProgress(0.02, "prepare", "正在启动…");
    $("clusterRunStatus").textContent = "";
    try {
      let result;
      try {
        result = await computeInWorker(options, updateProgress);
      } catch (error) {
        if (error.message === "任务已取消。") throw error;
        if (error.message !== "worker_unavailable") {
          // Worker 执行失败（可能浏览器环境限制），降级为同步计算
        }
        updateProgress(0.15, "prepare", "Worker 不可用，正在使用本地同步计算…");
        result = await new Promise((resolve, reject) => {
          // 让进度 UI 有机会渲染
          setTimeout(() => {
            try {
              resolve(computeSynchronously(options, updateProgress));
            } catch (computeError) {
              reject(computeError);
            }
          }, 30);
        });
      }
      if (state.cancelled) return;
      state.results[state.method] = result;
      state.diagnostics = null;
      state.clusterNames[state.method] = {};
      renderResults(result);
      saveToProject(result);
      $("clusterExportPanel").classList.remove("hidden");
      $("clusterRunStatus").textContent = `分析完成 · ${METHOD_LABELS[state.method]} · ${result.validN} 个有效样本`;
      showToast(`用户分群分析完成：${METHOD_LABELS[state.method]} · ${result.selectedK} 个群体`, "success", 3600);
    } catch (error) {
      $("clusterRunStatus").textContent = `分析失败：${error.message || error}`;
      showToast(`分析失败：${error.message || error}`, "error", 5200);
    } finally {
      state.running = false;
      $("clusterRunButton").disabled = false;
      $("clusterCancelButton").disabled = true;
      if (!state.cancelled) $("clusterProgress").classList.add("hidden");
    }
  }

  function cancelRun() {
    if (!state.running) return;
    state.cancelled = true;
    const worker = getWorker();
    if (worker && state.requestId) {
      try {
        worker.postMessage({ type: "cluster_cancel", requestId: state.requestId });
      } catch (_) { /* ignore */ }
    }
    $("clusterRunStatus").textContent = "已取消";
    showToast("已取消本次聚类计算", "info", 2400);
  }

  // ─── K 诊断（K=2—8）──────────────────────────────────────

  async function runKDiagnostics() {
    if (!state.parsed || state.running) return;
    const clusterVariables = collectClusterVariables();
    const numericOk = clusterVariables.every((name) => {
      const definition = findDefinition(name);
      return definition && ["scale", "ordinal", "count"].includes(definition.measurement);
    });
    if (!numericOk) {
      showToast("K 诊断需要聚类变量全部为连续/尺度变量。", "error", 3600);
      return;
    }
    const container = $("kmDiagnosticsResult");
    if (!container) return;
    const maxK = Math.min(8, state.parsed.rows.length - 1);
    if (maxK < 2) return;
    container.innerHTML = "<span>正在计算 K=2—" + maxK + " 的 SSE 与 Silhouette…</span>";
    const baseOptions = collectMethodOptions();
    const entries = [];
    for (let k = 2; k <= maxK; k += 1) {
      try {
        const result = core().kmeansCluster({
          rows: state.parsed.rows,
          definitions: state.definitions,
          clusterVariables,
          options: { ...baseOptions, k }
        });
        entries.push({ k, sse: result.sse, silhouette: result.silhouette, sizes: result.clusterSizes.map((size) => size.count) });
      } catch (_) {
        break;
      }
    }
    state.diagnostics = { maxK, entries };
    renderKDiagnostics();
  }

  function renderKDiagnostics() {
    const container = $("kmDiagnosticsResult");
    if (!container || !state.diagnostics) return;
    const { entries } = state.diagnostics;
    if (!entries.length) {
      container.innerHTML = "";
      return;
    }
    const maxSse = Math.max(...entries.map((entry) => entry.sse));
    const maxSil = Math.max(...entries.map((entry) => entry.silhouette));
    const bestSil = entries.reduce((best, entry) => (entry.silhouette > best.silhouette ? entry : best), entries[0]);
    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>K</th><th>SSE</th><th>SSE 降幅</th><th>Silhouette</th><th>群体规模</th><th></th></tr></thead>
          <tbody>${entries.map((entry) => {
            const previous = entries[entries.length - 1];
            const drop = previous && entry.k === previous.k + 1
              ? null
              : null;
            void drop;
            const index = entries.indexOf(entry);
            const prevEntry = entries[index - 1];
            const dropPct = prevEntry && prevEntry.sse > 0 ? ((prevEntry.sse - entry.sse) / prevEntry.sse) * 100 : null;
            const best = entry.k === bestSil.k;
            return `<tr class="${best ? "cluster-best-row" : ""}">
              <td><strong>${entry.k}</strong>${best ? ' <span class="advice-tag">Silhouette 最优</span>' : ""}</td>
              <td>${entry.sse.toFixed(1)}</td>
              <td>${dropPct !== null ? `${dropPct.toFixed(1)}%` : "—"}</td>
              <td>${entry.silhouette.toFixed(3)}</td>
              <td>${entry.sizes.join(" / ")}</td>
              <td><div class="mini-bar"><div style="width:${maxSse ? (entry.sse / maxSse) * 100 : 0}%" title="SSE"></div></div>
                  <div class="mini-bar accent"><div style="width:${maxSil ? (entry.silhouette / maxSil) * 100 : 0}%" title="Silhouette"></div></div></td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>
      <p class="panel-note">SSE 越低说明组内越紧凑，Silhouette 越高说明群体分离越好；两者只是辅助参考，请结合业务含义选择最终 K 值。</p>`;
  }

  // ─── 结果渲染 ─────────────────────────────────────────────

  function renderResultsEmpty() {
    const container = $("clusterResults");
    if (!container) return;
    container.innerHTML = `
      <div class="empty-state">
        <strong>等待分析</strong>
        <span>导入数据 → 定义变量 → 配置模型后点击“开始分析”。</span>
      </div>`;
  }

  function nameOf(result, clusterId) {
    if (clusterId <= 0) return "噪声/离群样本";
    const key = `${result.method}:${clusterId}`;
    return state.clusterNames[result.method]?.[clusterId] || `群体${clusterId}`;
  }

  function renderResults(result) {
    const container = $("clusterResults");
    if (!container) return;
    // 系统聚类：按当前切割群数重建视图（规模 / 归属 / 画像）
    if (result.method === "hierarchical") {
      const kEntry = result.kAssignments.find((entry) => entry.k === state.hierarchicalK);
      if (kEntry) {
        const viewResult = { ...result, selectedK: kEntry.k };
        const isCases = result.object === "cases";
        viewResult.assignments = isCases
          ? kEntry.assignment.map((label, index) => ({ rowIndex: (result.validRowIndexes || [])[index] ?? index, clusterId: label }))
          : [];
        const sizeMap = new Map();
        kEntry.assignment.forEach((label) => sizeMap.set(label, (sizeMap.get(label) || 0) + 1));
        viewResult.clusterSizes = Array.from(sizeMap.entries()).sort((a, b) => a[0] - b[0]).map(([label, count]) => ({
          id: label,
          name: `群体${label}`,
          count,
          pct: (count / kEntry.assignment.length) * 100
        }));
        if (isCases && state.parsed) {
          try {
            viewResult.profile = core().profileClusters({
              rows: state.parsed.rows,
              definitions: state.definitions,
              clusterVariables: collectClusterVariables(),
              profileVariables: collectProfileVariables(),
              assignments: viewResult.assignments,
              clusterSizes: viewResult.clusterSizes
            });
          } catch (_) { /* 画像计算失败不阻断展示 */ }
        } else {
          viewResult.profile = null;
        }
        result = viewResult;
      }
    }
    const sizes = result.clusterSizes.filter((size) => size.id > 0);
    const minPct = sizes.length ? Math.min(...sizes.map((size) => size.pct)).toFixed(1) : "—";
    const totalPct = sizes.reduce((sum, size) => sum + size.pct, 0).toFixed(1);
    const qualityWarnings = (result.qualityChecks || []).filter((issue) => issue.level !== "block");
    const riskText = qualityWarnings.length
      ? qualityWarnings.slice(0, 3).map((issue) => `· ${issue.title}`).join("<br>")
      : "无显著风险";
    const qualitySummary = qualityNote(result);

    container.innerHTML = `
      <article class="audit-issue">
        <div class="issue-head"><strong>模型概览</strong><span class="issue-tag low">${escapeHtml(METHOD_LABELS[result.method] || result.methodName)}</span></div>
        <div class="model-overview-grid">
          <div><strong>${result.selectedK}</strong><span>最终群数</span></div>
          <div><strong>${result.validN}</strong><span>有效样本</span></div>
          <div><strong>${result.excludedN ?? 0}</strong><span>排除样本</span></div>
          <div><strong>${minPct}%</strong><span>最小群体占比</span></div>
          <div><strong>${result.variables?.length ?? 0}</strong><span>聚类变量</span></div>
          <div><strong>${collectProfileVariables().length}</strong><span>描述变量</span></div>
        </div>
        <p class="panel-note" style="margin-top:10px">${overviewDetail(result)}</p>
        ${result.method === "kmeans" ? `<p class="panel-note">SSE=${formatNum(result.sse)} · Silhouette=${formatNum(result.silhouette, 4)} · 迭代 ${result.iterationHistory.length} 次${result.converged ? "（已收敛）" : "（未收敛）"}</p>` : ""}
        ${result.method === "twostep" && result.stability ? `<p class="panel-note">案例顺序稳定性：${result.stability.level}（一致率 ${formatNum(result.stability.meanConsistency, 3)}，推荐群数 ${result.stability.recommendedK.join(" / ")}）</p>` : ""}
        <div class="risk-box">${riskText}</div>
        ${result.method === "hierarchical" && result.suggestedK ? `<p class="panel-note">聚合系数跳升提示：可关注 K=${result.suggestedK} 的切割方案（仅建议，非唯一正确群数）。</p>` : ""}
      </article>

      <article class="audit-issue">
        <div class="issue-head"><strong>群体规模</strong><span class="issue-tag low">横向条形图</span></div>
        ${renderSizeChart(result)}
        ${result.method === "hierarchical" ? renderKSwitch(result) : ""}
      </article>

      <article class="audit-issue">
        <div class="issue-head">
          <strong>群体特征矩阵</strong>
          <span class="issue-tag low">视图</span>
          <span class="view-switch" data-view-switch>
            <button type="button" data-view="original" class="active">原始值</button>
            <button type="button" data-view="standardized">标准化差异</button>
            <button type="button" data-view="category">占比差异</button>
          </span>
        </div>
        <div id="clusterMatrixHost">${result.profile ? renderMatrix(result, "original") : '<p class="panel-note">对变量聚类不生成群体画像（画像基于受访者样本计算）。</p>'}</div>
      </article>

      <article class="audit-issue">
        <div class="issue-head"><strong>群体画像卡</strong><span class="issue-tag low">可编辑名称</span></div>
        <div class="profile-card-grid" id="clusterProfileCards">${result.profile ? renderProfileCards(result) : '<p class="panel-note">对变量聚类不生成群体画像卡。</p>'}</div>
        <p class="panel-note">核心特征按“高于总体 / 低于总体”的标准化差异与百分点差异排序，仅描述群体差异，不代表因果结论。</p>
      </article>

      <article class="audit-issue">
        <div class="issue-head"><strong>样本归属</strong><span class="issue-tag low">${result.assignments.length} 条</span>
          <button class="ghost-btn" type="button" id="clusterCopyAssignments">复制表格</button>
        </div>
        ${renderAssignmentTable(result)}
      </article>

      ${result.method === "twostep" ? renderTwostepDetail(result) : ""}
      ${result.method === "kmeans" ? renderKmeansDetail(result) : ""}
      ${result.method === "hierarchical" ? renderHierarchicalDetail(result) : ""}

      <article class="audit-issue">
        <div class="issue-head"><strong>结果质量与稳定性</strong><span class="issue-tag low">说明</span></div>
        <p class="panel-note">${qualitySummary}</p>
        <p class="panel-note">本工具参考主流统计软件的聚类方法与公开算法原理实现。由于初始化、数据顺序和软件内部优化机制不同，结果可能与其他统计软件存在差异。ANOVA 的 F 值和显著性仅用于描述变量对群体区分的相对贡献，不作为独立假设检验结论。</p>
      </article>`;

    container.querySelectorAll("[data-view-switch] button").forEach((button) => {
      button.addEventListener("click", () => {
        container.querySelectorAll("[data-view-switch] button").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        const host = $("clusterMatrixHost");
        if (host) host.innerHTML = renderMatrix(result, button.dataset.view);
      });
    });
    const copyButton = $("clusterCopyAssignments");
    if (copyButton) {
      copyButton.addEventListener("click", () => copyAssignmentTable(result));
    }
    const kSwitch = $("clusterKSwitch");
    if (kSwitch) {
      kSwitch.addEventListener("change", () => {
        state.hierarchicalK = Number(kSwitch.value);
        renderResults(state.results.hierarchical);
      });
    }
    // 画像卡名称编辑
    container.querySelectorAll("[data-cluster-name-input]").forEach((input) => {
      input.addEventListener("change", () => {
        const clusterId = Number(input.dataset.clusterNameInput);
        const key = `${result.method}:${clusterId}`;
        state.clusterNames[result.method] = state.clusterNames[result.method] || {};
        state.clusterNames[result.method][clusterId] = input.value.trim() || `群体${clusterId}`;
        renderResults(result);
        saveToProject(result);
      });
    });
  }

  function overviewDetail(result) {
    if (result.method === "kmeans") {
      return `聚类变量：${escapeHtml(result.variables.join("、"))} · 标准化：${result.preprocessing?.standardization} · 缺失处理：${result.preprocessing?.missingMode === "pairwise" ? "Pairwise" : "Listwise"} · 计算方法：${result.runMode === "batch" ? "迭代并分类" : result.runMode === "sequential" ? "运行均值更新" : "仅分类"}${result.preprocessing?.weightUsed ? " · 使用频数权重" : ""}`;
    }
    if (result.method === "twostep") {
      return `连续变量：${result.continuousVariables.length} 个 · 分类变量：${result.categoricalVariables.length} 个 · 距离：${result.distance === "loglikelihood" ? "对数似然" : "欧氏"} · 群数选择：${result.autoSelect ? `自动（${result.criterion}，最大 ${result.maxClusters}）` : "固定"}${result.noiseCount ? ` · 噪声样本 ${result.noiseCount} 个` : ""}`;
    }
    return `聚类对象：${result.object === "cases" ? "案例（受访者）" : "变量"} · 数据类型：${result.dataType === "interval" ? "区间/连续" : result.dataType === "count" ? "计数" : "二元"} · 联接方法：${escapeHtml(result.linkage)} · 距离：${escapeHtml(result.distance)} · 标准化：${result.standardization}`;
  }

  function qualityNote(result) {
    const parts = [];
    if (result.method === "kmeans") {
      const sil = result.silhouette;
      if (sil >= 0.7) parts.push("当前群体分离良好（Silhouette ≥ 0.7），群体之间中心距离较大，区分度较好。");
      else if (sil >= 0.4) parts.push("当前群体具有一定区分度（Silhouette 0.4—0.7），可结合业务含义判断群体是否可解释。");
      else parts.push("当前群体区分度较弱（Silhouette < 0.4），部分群体中心距离较近，建议考虑合并群体、增加变量或调整 K 值。");
      const small = result.clusterSizes.filter((size) => size.id > 0 && size.pct < 5);
      if (small.length) parts.push(`存在小群体（${small.map((size) => size.name).join("、")}，占比 < 5%），解读时请谨慎。`);
    } else if (result.method === "twostep") {
      parts.push("群体规模合理性：请结合最小群体占比与业务含义判断是否需要合并小群体。");
      const discrimination = result.discrimination;
      if (discrimination.length) {
        const weak = discrimination.filter((item) => item.score < 30);
        if (weak.length) parts.push(`区分度较弱的变量：${weak.map((item) => item.variable).join("、")}（得分 < 30）。`);
        else parts.push("各聚类变量均具有较好区分度。");
      }
      if (result.stability) {
        parts.push(result.stability.level === "高"
          ? "案例顺序稳定性高，结果对数据顺序不敏感。"
          : `案例顺序稳定性为“${result.stability.level}”，结果受数据顺序影响，建议结合业务复核。`);
      }
    } else {
      parts.push("系统聚类结果请结合聚合系数跳升与树状图判断切割位置；树状图与聚合过程提供了群体形成过程的可视依据。");
    }
    return parts.join("");
  }

  function renderSizeChart(result) {
    const sizes = result.clusterSizes.filter((size) => size.id > 0);
    const maxCount = Math.max(...sizes.map((size) => size.count));
    const rows = sizes.map((size) => {
      const width = maxCount ? (size.count / maxCount) * 100 : 0;
      const weightedText = size.weightedPct !== null && size.weightedPct !== undefined
        ? `加权 ${formatNum(size.weightedPct, 1)}%`
        : "";
      return `<div class="size-bar-row">
        <span class="size-bar-name">${escapeHtml(nameOf(result, size.id))}</span>
        <span class="size-bar-track"><span class="size-bar-fill" style="width:${width}%"></span></span>
        <span class="size-bar-value">${size.count} · ${formatNum(size.pct, 1)}% ${weightedText}</span>
      </div>`;
    }).join("");
    return `<div class="size-chart">${rows}</div>`;
  }

  function renderKSwitch(result) {
    const options = result.kAssignments.map((entry) =>
      `<option value="${entry.k}" ${entry.k === state.hierarchicalK ? "selected" : ""}>K=${entry.k}</option>`).join("");
    return `<div class="k-switch-row">
      <label for="clusterKSwitch">切割群数：</label>
      <select id="clusterKSwitch">${options}</select>
      <span class="panel-note">切换后重新计算规模、特征矩阵与画像。</span>
    </div>`;
  }

  function renderMatrix(result, view) {
    const profile = result.profile;
    if (!profile) return "<p class=\"panel-note\">暂无画像数据。</p>";
    const clusterIds = result.clusterSizes.filter((size) => size.id > 0).map((size) => size.id);
    const headerCells = ["变量"].concat(clusterIds.map((id) => escapeHtml(nameOf(result, id))));
    const body = profile.variables.map((variable) => {
      if (variable.type === "continuous") {
        const cells = [escapeHtml(variable.name)];
        if (view === "standardized") {
          clusterIds.forEach((id) => {
            const item = variable.perCluster.find((entry) => entry.clusterId === id);
            const diff = item ? item.standardizedDiff : null;
            cells.push(diff === null || diff === undefined ? "—" : `<span class="${diff > 0.3 ? "pos-diff" : diff < -0.3 ? "neg-diff" : ""}">${formatNum(diff, 2)}</span>`);
          });
        } else {
          clusterIds.forEach((id) => {
            const item = variable.perCluster.find((entry) => entry.clusterId === id);
            cells.push(item?.mean !== null && item?.mean !== undefined ? formatNum(item.mean, 2) : "—");
          });
        }
        return `<tr><td>${cells[0]}</td>${cells.slice(1).map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
      }
      return variable.categories.flatMap((category) => {
        const cells = [`${escapeHtml(variable.name)} · ${escapeHtml(category.category)}`];
        clusterIds.forEach((id) => {
          const item = category.perCluster.find((entry) => entry.clusterId === id);
          if (view === "category") {
            const diff = item?.ppDiff ?? null;
            cells.push(diff === null ? "—" : `<span class="${diff > 5 ? "pos-diff" : diff < -5 ? "neg-diff" : ""}">${diff > 0 ? "+" : ""}${formatNum(diff, 1)}pp</span>`);
          } else {
            cells.push(item?.pct !== undefined ? `${formatNum(item.pct, 1)}%` : "—");
          }
        });
        return `<tr><td>${cells[0]}</td>${cells.slice(1).map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
      });
    }).join("");
    return `<div class="table-wrap matrix-wrap"><table class="matrix-table">
      <thead><tr>${headerCells.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody></table></div>
      <p class="panel-note">${view === "standardized" ? "标准化差异 =（群体均值 − 总体均值）/ 总体标准差，|差异| > 0.3 高亮。" : view === "category" ? "百分点差异 = 群体占比 − 总体占比，|差异| > 5pp 高亮。" : "连续变量显示群体均值，分类变量显示群体占比。"}</p>`;
  }

  function renderProfileCards(result) {
    const profile = result.profile;
    if (!profile) return "";
    return profile.groupProfiles.map((group) => {
      const above = group.above.slice(0, 4).map((item) => `<li>${escapeHtml(item.variable)}：${formatNum(item.value, 2)}（总体 ${formatNum(item.overall, 2)}）</li>`).join("");
      const below = group.below.slice(0, 4).map((item) => `<li>${escapeHtml(item.variable)}：${formatNum(item.value, 2)}（总体 ${formatNum(item.overall, 2)}）</li>`).join("");
      const top = group.categoricalTop.slice(0, 4).map((item) => `<li>${escapeHtml(item.variable)} · ${escapeHtml(item.category)}：${formatNum(item.pct, 1)}%（+${formatNum(item.ppDiff, 1)}pp）</li>`).join("");
      return `<div class="profile-card">
        <div class="profile-card-head">
          <input type="text" value="${escapeHtml(nameOf(result, group.clusterId))}" data-cluster-name-input="${group.clusterId}" />
          <span>N=${group.count} · ${formatNum(group.pct, 1)}%</span>
        </div>
        <div class="profile-card-body">
          ${above ? `<div><h5>高于总体</h5><ul>${above}</ul></div>` : ""}
          ${below ? `<div><h5>低于总体</h5><ul>${below}</ul></div>` : ""}
          ${top ? `<div><h5>主要分类特征</h5><ul>${top}</ul></div>` : ""}
          ${!above && !below && !top ? "<p class=\"panel-note\">无明显差异化特征。</p>" : ""}
        </div>
      </div>`;
    }).join("");
  }

  function renderAssignmentTable(result) {
    if (!result.assignments || !result.assignments.length) {
      return '<p class="panel-note">对变量聚类不生成受访者样本归属；请查看“多群数归属”或通过 Excel 导出查看变量分组。</p>';
    }
    const idColumn = state.definitions.find((definition) => definition.role === "id")?.name || "";
    const headers = ["原始行号", idColumn ? escapeHtml(idColumn) : "ID"];
    const hasDistance = result.method !== "hierarchical" || result.assignments.some((assignment) => assignment.distance !== undefined);
    headers.push("分群编号", "分群名称");
    if (hasDistance) headers.push("距离/置信信息");
    const rows = result.assignments.slice(0, 100).map((assignment) => {
      const rowIndex = assignment.rowIndex;
      const rawRow = state.parsed?.rows[rowIndex];
      const idValue = idColumn && rawRow ? String(rawRow[idColumn] ?? "") : rowIndex + 1;
      const cells = [rowIndex + 1, escapeHtml(String(idValue).slice(0, 30))];
      cells.push(assignment.clusterId ?? "—", escapeHtml(assignment.clusterName || nameOf(result, assignment.clusterId)));
      if (hasDistance) {
        cells.push(assignment.distance !== undefined && assignment.distance !== null ? formatNum(assignment.distance, 4) : "—");
      }
      return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
    }).join("");
    const total = result.assignments.length;
    return `<div class="table-wrap"><table>
      <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="panel-note">显示前 100 条（共 ${total} 条）。系统聚类没有中心距离时不会显示错误的距离字段。</p>`;
  }

  function copyAssignmentTable(result) {
    const idColumn = state.definitions.find((definition) => definition.role === "id")?.name || "";
    const lines = ["行号," + (idColumn ? `"${idColumn}"` : "ID") + ",cluster_id,cluster_name,cluster_distance"];
    result.assignments.forEach((assignment) => {
      const rawRow = state.parsed?.rows[assignment.rowIndex];
      const idValue = idColumn && rawRow ? String(rawRow[idColumn] ?? "") : assignment.rowIndex + 1;
      const dist = assignment.distance !== undefined && assignment.distance !== null ? assignment.distance : "";
      lines.push(`${assignment.rowIndex + 1},"${String(idValue).replaceAll('"', '""')}",${assignment.clusterId ?? ""},"${nameOf(result, assignment.clusterId)}",${dist}`);
    });
    navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      showToast("已复制样本归属表格", "success", 2400);
    }).catch(() => {
      showToast("复制失败，请手动选择复制", "error", 2400);
    });
  }

  function renderKmeansDetail(result) {
    return `
      <article class="audit-issue">
        <div class="issue-head"><strong>初始与最终聚类中心</strong><span class="issue-tag low">原始尺度</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>群体</th>${result.variables.map((variable) => `<th>${escapeHtml(variable)}</th>`).join("")}</tr></thead>
          <tbody>
            <tr><td><strong>初始</strong></td>${(result.centersOriginal || result.initialCenters).map((center) => center.map((value) => `<td>${formatNum(value, 2)}</td>`).join("")).join("</tr><tr><td><strong>初始</strong></td>")}</tr>
            <tr><td><strong>最终</strong></td>${(result.finalCentersOriginal || result.finalCenters).map((center) => center.map((value) => `<td>${formatNum(value, 2)}</td>`).join("")).join("</tr><tr><td><strong>最终</strong></td>")}</tr>
          </tbody>
        </table></div>
        <div class="table-wrap"><table>
          <thead><tr><th>迭代</th><th>中心最大变化</th><th>收敛</th></tr></thead>
          <tbody>${result.iterationHistory.map((entry) => `<tr><td>${entry.iteration}</td><td>${formatNum(entry.maxChange, 6)}</td><td>${entry.converged ? "是" : "—"}</td></tr>`).join("")}</tbody>
        </table></div>
      </article>
      <article class="audit-issue">
        <div class="issue-head"><strong>ANOVA 描述表</strong><span class="issue-tag low">仅描述性</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>变量</th><th>群体均值</th><th>总体均值</th><th>F</th><th>显著性 p</th></tr></thead>
          <tbody>${result.anova.map((item) => `<tr>
            <td>${escapeHtml(item.variable)}</td>
            <td>${item.clusterMeans.map((value) => formatNum(value, 2)).join(" / ")}</td>
            <td>${formatNum(item.grandMean, 2)}</td>
            <td>${formatNum(item.f, 2)}</td>
            <td>${formatNum(item.p, 4)}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        <p class="panel-note">F 值和显著性仅用于描述变量对群体区分的相对贡献，不作为独立假设检验结论。</p>
      </article>`;
  }

  function renderTwostepDetail(result) {
    return `
      <article class="audit-issue">
        <div class="issue-head"><strong>群数信息准则</strong><span class="issue-tag low">${result.criterion}</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>群数</th><th>对数似然</th><th>BIC</th><th>AIC</th><th>BIC 变化</th><th>最小群体占比</th><th></th></tr></thead>
          <tbody>${result.criterionTable.map((entry) => `<tr class="${entry.clusters === result.selectedK ? "cluster-best-row" : ""}">
            <td><strong>${entry.clusters}</strong>${entry.clusters === result.selectedK ? ' <span class="advice-tag">已选择</span>' : ""}</td>
            <td>${formatNum(entry.logLikelihood, 1)}</td>
            <td>${formatNum(entry.bic, 1)}</td>
            <td>${formatNum(entry.aic, 1)}</td>
            <td>${formatNum(entry.bicChange, 1)}</td>
            <td>${formatNum(entry.minClusterPct, 1)}%</td>
            <td>${entry.clusters === result.selectedK ? "✓" : ""}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        <p class="panel-note">自动选择按信息准则最小确定群数；固定群数模式直接采用指定值。信息准则只作为统计参考，请结合业务判断。</p>
      </article>
      <article class="audit-issue">
        <div class="issue-head"><strong>变量区分度</strong><span class="issue-tag low">本工具确定性方法</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>变量</th><th>类型</th><th>统计量</th><th>区分度得分（0—100）</th><th></th></tr></thead>
          <tbody>${result.discrimination.map((item) => `<tr>
            <td>${escapeHtml(item.variable)}</td>
            <td>${item.type === "continuous" ? "连续" : "分类"}</td>
            <td>${item.type === "continuous" ? `F=${formatNum(item.f, 2)}` : `χ²=${formatNum(item.chiSquare, 2)}`}</td>
            <td>${formatNum(item.score, 1)}</td>
            <td><div class="mini-bar accent"><div style="width:${item.score}%"></div></div></td>
          </tr>`).join("")}</tbody>
        </table></div>
        <p class="panel-note">变量区分度使用本工具可解释的确定性方法计算（连续变量 F 统计量 / 分类变量卡方贡献归一化），仅用于比较变量对分群的贡献。</p>
      </article>`;
  }

  function renderHierarchicalDetail(result) {
    return `
      <article class="audit-issue">
        <div class="issue-head"><strong>聚合过程</strong><span class="issue-tag low">${result.merges.length} 步</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>步骤</th><th>对象A</th><th>对象B</th><th>聚合系数</th><th>合并后对象数</th></tr></thead>
          <tbody>${result.merges.slice(-30).reverse().map((merge) => `<tr>
            <td>${merge.step}</td>
            <td>${result.object === "cases" ? `案例${merge.clusterA + 1}` : escapeHtml(result.objectNames[merge.clusterA] ?? "")}</td>
            <td>${result.object === "cases" ? `案例${merge.clusterB + 1}` : escapeHtml(result.objectNames[merge.clusterB] ?? "")}</td>
            <td>${formatNum(merge.distance, 4)}</td>
            <td>${result.objectCount - merge.step}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        <p class="panel-note">显示最近 30 步；完整聚合过程可在 Excel 导出中查看。</p>
      </article>
      <article class="audit-issue">
        <div class="issue-head"><strong>树状图</strong><span class="issue-tag low">切割线 K=${state.hierarchicalK}</span></div>
        ${renderDendrogram(result)}
      </article>
      <article class="audit-issue">
        <div class="issue-head"><strong>多群数归属</strong><span class="issue-tag low">K=2—10</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>对象</th>${result.kAssignments.map((entry) => `<th>K=${entry.k}</th>`).join("")}</tr></thead>
          <tbody>${result.kAssignments[0].assignment.map((_, objectIndex) => `<tr>
            <td>${result.object === "cases" ? `案例${objectIndex + 1}` : escapeHtml(result.objectNames[objectIndex] ?? "")}</td>
            ${result.kAssignments.map((entry) => `<td>${entry.assignment[objectIndex]}</td>`).join("")}
          </tr>`).join("")}</tbody>
        </table></div>
      </article>`;
  }

  /** 简易树状图（SVG）：仅对象数 ≤ 60 时渲染，否则提示查看导出 */
  function renderDendrogram(result) {
    if (result.objectCount > 60) {
      return '<p class="panel-note">对象数较多（>60），树状图请通过 Excel 导出的“多群数归属”与“聚合过程”查看。</p>';
    }
    const m = result.objectCount;
    const height = Math.max(120, m * 14);
    const width = 720;
    const merge = (id) => {
      if (id < m) return { leaf: true, label: result.object === "cases" ? `R${id + 1}` : result.objectNames[id] };
      const node = result.tree.find((item) => item.left === id || item.right === id);
      return { leaf: false, ...node };
    };
    const maxDistance = Math.max(...result.merges.map((entry) => entry.distance));
    const x = (distance) => 120 + ((maxDistance ? distance / maxDistance : 0) * (width - 150));
    let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px" role="img" aria-label="系统聚类树状图">
      <style>.dend-line{stroke:#5b7cfa;stroke-width:1.2;fill:none}.dend-label{font-size:10px;fill:#4a5568}.dend-cut{stroke:#e53e3e;stroke-width:1;stroke-dasharray:4 3}</style>`;
    // 计算每个内部节点在切割高度下的位置：从叶到根布局
    const leafX = 40;
    const positions = new Map();
    const heights = new Map();
    // 叶位置
    result.merges.forEach((entry, index) => {
      heights.set(m + index, entry.distance);
    });
    // 后序遍历计算 y
    const nodeChildren = new Map();
    result.merges.forEach((entry) => {
      const parent = m + entry.step - 1;
      nodeChildren.set(parent, [entry.left, entry.right]);
    });
    const computeY = (nodeId) => {
      if (positions.has(nodeId)) return positions.get(nodeId);
      const children = nodeChildren.get(nodeId);
      if (!children) {
        const order = result.merges.find((entry) => entry.membersA.includes(nodeId) || entry.membersB.includes(nodeId));
        // 叶节点按最终合并顺序排列
        const leafOrder = result.merges[result.merges.length - 1].membersA.concat(result.merges[result.merges.length - 1].membersB);
        const leafIndex = leafOrder.indexOf(nodeId);
        const y = 14 + leafIndex * ((height - 28) / Math.max(1, m - 1));
        positions.set(nodeId, y);
        return y;
      }
      const yA = computeY(children[0]);
      const yB = computeY(children[1]);
      const y = (yA + yB) / 2;
      positions.set(nodeId, y);
      return y;
    };
    const drawNode = (nodeId) => {
      const children = nodeChildren.get(nodeId);
      if (!children) return "";
      const y = positions.get(nodeId);
      const xNode = x(heights.get(nodeId));
      const yA = positions.get(children[0]);
      const yB = positions.get(children[1]);
      const xA = children[0] < m ? leafX : x(heights.get(children[0]));
      const xB = children[1] < m ? leafX : x(heights.get(children[1]));
      const svgChildren = drawNode(children[0]) + drawNode(children[1]);
      return `${svgChildren}
        <path class="dend-line" d="M${xA},${yA} H${xNode} V${y} H${xB}"/>
        <path class="dend-line" d="M${xA},${yA} V${yA}"/>`;
    };
    const rootId = m + result.merges.length - 1;
    computeY(rootId);
    // 叶标签
    result.merges[result.merges.length - 1].membersA.concat(result.merges[result.merges.length - 1].membersB).forEach((leafId) => {
      const label = result.object === "cases" ? `R${leafId + 1}` : result.objectNames[leafId];
      const y = positions.get(leafId);
      svg += `<text class="dend-label" x="2" y="${y + 3}">${escapeHtml(String(label).slice(0, 10))}</text>`;
    });
    // 切割线
    const cutK = Math.min(state.hierarchicalK, m);
    const cutStep = m - cutK;
    const cutDistance = cutStep > 0 && cutStep <= result.merges.length ? result.merges[cutStep - 1].distance : 0;
    if (cutStep > 0 && cutStep <= result.merges.length) {
      const cutX = x(cutDistance);
      svg += `<line class="dend-cut" x1="${cutX}" y1="6" x2="${cutX}" y2="${height - 6}"/>`;
      svg += `<text class="dend-label" x="${cutX + 4}" y="12" fill="#e53e3e">K=${cutK}</text>`;
    }
    svg += drawNode(rootId);
    svg += `</svg>`;
    return svg;
  }

  // ─── 导出 ─────────────────────────────────────────────────

  function currentResult() {
    return state.results[state.method];
  }

  function exportExcel() {
    const result = currentResult();
    if (!result) return;
    const sheets = core().buildExportSheets(result, {
      clusterNames: state.clusterNames[result.method] || {},
      profileVariables: collectProfileVariables(),
      fullRows: state.parsed?.rows || [],
      headers: state.parsed?.headers || [],
      assignments: result.assignments,
      profile: result.profile,
      stability: result.stability
    });
    if (typeof root.downloadExcelWorkbookXml === "function") {
      root.downloadExcelWorkbookXml(`用户分群_${METHOD_LABELS[result.method]}.xlsx`, sheets);
    } else {
      showToast("当前环境缺少 Excel 导出能力", "error", 3600);
    }
  }

  function exportCsv() {
    const result = currentResult();
    if (!result) return;
    const rows = core().buildAssignmentCsvRows(result, { clusterNames: state.clusterNames[result.method] || {} });
    if (typeof root.downloadCsv === "function") {
      root.downloadCsv(`用户分群归属_${result.method}.csv`, rows);
    } else {
      showToast("当前环境缺少 CSV 导出能力", "error", 3600);
    }
  }

  function exportFullCsv() {
    const result = currentResult();
    if (!result || !state.parsed) return;
    const rows = core().buildFullDataCsvRows(result, {
      clusterNames: state.clusterNames[result.method] || {},
      headers: state.parsed.headers,
      fullRows: state.parsed.rows
    });
    if (typeof root.downloadCsv === "function") {
      root.downloadCsv(`用户分群完整数据_${result.method}.csv`, rows);
    } else {
      showToast("当前环境缺少 CSV 导出能力", "error", 3600);
    }
  }

  // ─── 项目数据保存 ─────────────────────────────────────────

  function saveToProject(result) {
    if (typeof root.projectDataBus?.set !== "function") return;
    const key = `modelResults.cluster.${result.method}`;
    // 大体积样本归属优先保留聚合结果；原始行数据不写入项目总线（内存态持有）
    const payload = {
      ...result,
      assignments: result.assignments.length > 20000 ? result.assignments.slice(0, 20000) : result.assignments
    };
    root.projectDataBus.set(key, payload, {
      type: "用户分群",
      method: result.method,
      clusters: result.selectedK,
      sampleCount: result.sampleCount || result.validN
    });
    root.projectDataBus.set("modelResults.cluster.active", {
      method: result.method,
      key,
      selectedK: result.selectedK,
      validN: result.validN,
      methodName: result.methodName
    }, {
      type: "用户分群",
      method: result.method,
      clusters: result.selectedK,
      sampleCount: result.sampleCount || result.validN
    });
  }

  // ─── 示例数据 ─────────────────────────────────────────────

  function loadExampleData() {
    const random = core().mulberry32(20240804);
    const rows = [];
    const genders = ["男", "女"];
    const cities = ["一线城市", "新一线", "二线城市", "三四线及以下"];
    const segments = [
      { sat: [7, 10], need: [4, 5], price: [7, 10], freq: [4, 5], name: "高需求高价值" },
      { sat: [4, 6], need: [3, 4], price: [4, 7], freq: [3, 4], name: "中间型" },
      { sat: [1, 4], need: [1, 3], price: [1, 4], freq: [1, 3], name: "价格敏感型" }
    ];
    const pick = (min, max) => min + Math.floor(random() * (max - min + 1));
    for (let i = 0; i < 180; i += 1) {
      const segment = segments[i % 3];
      const noise = random() < 0.1 ? (random() < 0.5 ? -1 : 1) : 0;
      rows.push({
        rid: `R${String(i + 1).padStart(4, "0")}`,
        "性别": genders[random() < 0.52 ? 0 : 1],
        "城市级别": cities[Math.floor(random() * cities.length)],
        "年龄": pick(18, 55),
        "满意度": clamp(segment.sat[0] + pick(0, segment.sat[1] - segment.sat[0]) + noise, 1, 10),
        "功能需求度": clamp(segment.need[0] + pick(0, segment.need[1] - segment.need[0]) + noise, 1, 5),
        "价格敏感度": clamp(segment.price[0] + pick(0, segment.price[1] - segment.price[0]) + noise, 1, 10),
        "购买频率": clamp(segment.freq[0] + pick(0, segment.freq[1] - segment.freq[0]) + noise, 1, 5)
      });
    }
    loadParsed({
      headers: ["rid", "性别", "城市级别", "年龄", "满意度", "功能需求度", "价格敏感度", "购买频率"],
      rows,
      fileName: "示例数据（模拟用户分群数据集）",
      sheetNames: [],
      sheetIndex: 0
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // ─── 使用当前项目数据 ─────────────────────────────────────

  function useProjectData() {
    let parsed = null;
    const bus = root.projectDataBus;
    if (bus?.get) {
      const cleaned = bus.get("cleanedData");
      if (cleaned && Array.isArray(cleaned.rows) && cleaned.headers?.length) {
        parsed = { headers: cleaned.headers, rows: cleaned.rows };
      }
    }
    if (!parsed && typeof root.cleaningCenterState?.parsed === "object" && root.cleaningCenterState.parsed) {
      const center = root.cleaningCenterState.parsed;
      if (center.headers?.length && center.rows?.length) {
        parsed = { headers: center.headers, rows: center.rows };
      }
    }
    if (!parsed) {
      showToast("当前项目没有可用的数据（清洗后数据或已解析数据）。请先上传数据文件。", "error", 4200);
      return;
    }
    loadParsed({
      headers: parsed.headers,
      rows: parsed.rows,
      fileName: "当前项目数据",
      sheetNames: [],
      sheetIndex: 0
    });
  }

  // ─── 深链接 ───────────────────────────────────────────────

  function applyDeepLink() {
    try {
      const params = new URLSearchParams(root.location?.search || "");
      if (params.get("view") !== "cluster-analysis") return;
      const method = params.get("method");
      if (["kmeans", "twostep", "hierarchical"].includes(method)) {
        switchMethod(method);
      }
      if (typeof root.showView === "function") {
        root.showView("cluster-analysis");
      } else {
        const view = document.getElementById("cluster-analysis");
        document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === "cluster-analysis"));
        view?.scrollIntoView({ block: "start" });
      }
    } catch (_) { /* 非法参数回退默认页面 */ }
  }

  // ─── 控件联动 ─────────────────────────────────────────────

  function updateRunButtonState() {
    const runButton = $("clusterRunButton");
    const diagnoseButton = $("kmRunDiagnostics");
    const hasData = Boolean(state.parsed);
    const hasClusterVars = collectClusterVariables().length >= 2;
    if (runButton) runButton.disabled = !(hasData && hasClusterVars) || state.running;
    if (diagnoseButton) diagnoseButton.disabled = !(hasData && hasClusterVars && state.method === "kmeans") || state.running;
  }

  function bindOptionControls() {
    // K-Means 初始化模式联动
    $("kmInitMode")?.addEventListener("change", () => {
      const mode = $("kmInitMode").value;
      $("kmManualCentersField").classList.toggle("hidden", mode !== "manual");
      $("kmImportedCentersField").classList.toggle("hidden", mode !== "imported");
    });
    // 两步聚类群数选择联动
    $("tsAutoSelect")?.addEventListener("change", () => {
      const auto = $("tsAutoSelect").value === "auto";
      $("tsCriterionField").classList.toggle("hidden", !auto);
      $("tsMaxClustersField").classList.toggle("hidden", !auto);
      $("tsFixedKField").classList.toggle("hidden", auto);
    });
    // 系统聚类数据类型联动
    const syncHierarchicalOptions = () => {
      const dataType = $("hiDataType")?.value || "interval";
      const linkage = $("hiLinkage")?.value || "ward";
      const distanceSelect = $("hiDistance");
      if (!distanceSelect) return;
      const allowed = dataType === "interval"
        ? ["euclidean", "squared-euclidean", "cosine", "pearson", "chebyshev", "cityblock", "minkowski"]
        : dataType === "count"
          ? ["chi-square", "phi-square"]
          : ["simple-matching", "jaccard", "dice", "russell-rao", "phi", "yule-q", "rogers-tanimoto", "sokal-sneath"];
      Array.from(distanceSelect.options).forEach((option) => {
        option.disabled = !allowed.includes(option.value);
      });
      if (!allowed.includes(distanceSelect.value)) {
        distanceSelect.value = dataType === "interval" ? (linkage === "ward" ? "squared-euclidean" : "euclidean") : allowed[0];
      }
      $("hiMinkowskiField").classList.toggle("hidden", distanceSelect.value !== "minkowski");
      $("hiBinaryValueField").classList.toggle("hidden", dataType !== "binary");
      const note = $("hiDataTypeNote");
      if (note) {
        note.textContent = dataType === "count"
          ? "计数数据必须为非负数值；卡方/Phi-square 距离基于原始频数，不做数值标准化。"
          : dataType === "binary"
            ? "二元数据使用正/负值编码（如 1/0），不做数值标准化；可设置用户定义缺失码。"
            : "一个模型中原则上使用同类型变量；混合数据类型建议改用两步聚类。";
      }
      if (linkage === "ward" && !["euclidean", "squared-euclidean"].includes(distanceSelect.value)) {
        distanceSelect.value = "squared-euclidean";
      }
      if (["centroid", "median"].includes(linkage) && !["euclidean", "squared-euclidean", "cityblock", "chebyshev", "minkowski"].includes(distanceSelect.value)) {
        distanceSelect.value = "euclidean";
      }
      const hiSelectedK = $("hiSelectedK");
      const sampleN = state.parsed?.rows?.length || 0;
      if (hiSelectedK) {
        hiSelectedK.max = Math.max(2, sampleN);
        if (Number(hiSelectedK.value) > sampleN && sampleN > 1) hiSelectedK.value = sampleN;
      }
      const limitText = $("hiSampleLimitText");
      if (limitText && state.method === "hierarchical" && dataType === "interval") {
        if (sampleN > 1000) {
          limitText.textContent = `样本量 ${sampleN} 超过 1000，案例系统聚类默认阻止；请先在数据清洗中筛选样本或改用两步聚类。`;
          limitText.classList.add("warning-text");
        } else if (sampleN > 500) {
          limitText.textContent = `样本量 ${sampleN} 处于 501—1000 高风险区间，距离矩阵约 ${Math.round(sampleN * sampleN / 2)} 个值，浏览器可能卡顿。`;
          limitText.classList.add("warning-text");
        } else if (sampleN > 300) {
          limitText.textContent = `样本量 ${sampleN} 处于 301—500 区间，计算与内存开销较大，请确认继续。`;
          limitText.classList.remove("warning-text");
        } else {
          limitText.textContent = `样本量 ${sampleN}，正常运行。矩阵元素约 ${Math.round(sampleN * sampleN / 2)} 个，预计内存 ${(sampleN * sampleN * 8 / 1024 / 1024).toFixed(1)} MB。`;
          limitText.classList.remove("warning-text");
        }
      }
    };
    $("hiDataType")?.addEventListener("change", syncHierarchicalOptions);
    $("hiLinkage")?.addEventListener("change", syncHierarchicalOptions);
    $("hiDistance")?.addEventListener("change", syncHierarchicalOptions);
    $("hiObject")?.addEventListener("change", () => {
      syncHierarchicalOptions();
      if ($("hiObject").value === "variables") {
        $("hiSampleLimitNote")?.classList.add("hidden");
      } else {
        $("hiSampleLimitNote")?.classList.remove("hidden");
      }
    });
    // 距离方式联动（两步聚类欧氏限制）
    $("tsDistance")?.addEventListener("change", () => {
      if ($("tsDistance").value === "euclidean") {
        const hasCategorical = collectClusterVariables().some((name) => {
          const definition = findDefinition(name);
          return definition && ["nominal", "binary"].includes(definition.measurement);
        });
        if (hasCategorical) {
          showToast("欧氏距离仅在所有聚类变量均为连续变量时可用；当前包含分类变量，请改用对数似然距离。", "error", 4200);
          $("tsDistance").value = "loglikelihood";
        }
      }
    });
  }

  // ─── 初始化 ───────────────────────────────────────────────

  function init() {
    if (!core()) {
      // 算法核心缺失时保持页面可用但提示
      const runButton = $("clusterRunButton");
      if (runButton) runButton.disabled = true;
      showToast("聚类算法核心加载失败（cluster-core.js 缺失）。", "error", 5000);
      return;
    }
    document.querySelectorAll("[data-cluster-method]").forEach((tab) => {
      tab.addEventListener("click", () => switchMethod(tab.dataset.clusterMethod));
    });
    setupDropzone();
    $("clusterUseProjectData")?.addEventListener("click", useProjectData);
    $("clusterLoadExample")?.addEventListener("click", loadExampleData);
    $("clusterClearData")?.addEventListener("click", () => {
      state.parsed = null;
      state.definitions = [];
      state.results = {};
      state.diagnostics = null;
      renderDataPreview();
      renderVariableTable();
      renderMultiGroups();
      refreshMethodAdvice();
      renderResultsEmpty();
      $("clusterExportPanel")?.classList.add("hidden");
      $("clusterClearData")?.setAttribute("disabled", "disabled");
      $("clusterFileName").textContent = "未选择文件";
      $("clusterDataPreview").classList.add("hidden");
      updateRunButtonState();
    });
    $("clusterRoleSuggest")?.addEventListener("click", applyRoleSuggestions);
    $("clusterRunButton")?.addEventListener("click", runCluster);
    $("clusterCancelButton")?.addEventListener("click", cancelRun);
    $("kmRunDiagnostics")?.addEventListener("click", runKDiagnostics);
    $("clusterExportExcel")?.addEventListener("click", exportExcel);
    $("clusterExportCsv")?.addEventListener("click", exportCsv);
    $("clusterExportFullCsv")?.addEventListener("click", exportFullCsv);
    bindOptionControls();
    switchMethod("kmeans");
    applyDeepLink();
    // 数据总线回填后刷新运行按钮状态
    if (typeof root.projectDataBus?.onChange === "function") {
      root.projectDataBus.onChange(() => {
        updateRunButtonState();
        if (state.parsed && !state.results[state.method]) {
          const active = root.projectDataBus.get("modelResults.cluster.active");
          if (active?.method) {
            const saved = root.projectDataBus.get(`modelResults.cluster.${active.method}`);
            if (saved && !state.results[active.method]) {
              state.results[active.method] = saved;
              if (active.method === state.method) renderResults(saved);
            }
          }
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  root.ClusterAnalysis = {
    switchMethod,
    loadExampleData,
    useProjectData,
    runCluster,
    cancelRun,
    exportExcel,
    exportCsv,
    exportFullCsv,
    getState: () => state
  };

  function formatNum(value, digits = 2) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return Number(value.toFixed(digits));
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
