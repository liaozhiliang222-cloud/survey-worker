/**
 * 全局类型定义 — JSDoc Typedef
 * 为核心模块提供类型标注支持
 * @module types
 */

// ─── 数据结构 ───────────────────────────────────────────────

/**
 * @typedef {Object} CrosstabAnalysis
 * @property {string[]} rowLabels - 行标签
 * @property {string[]} colLabels - 列标签
 * @property {number[][]} matrix - 频数矩阵
 * @property {number[]} rowTotals - 行合计
 * @property {number[]} colTotals - 列合计
 * @property {number} total - 总样本量
 * @property {number} chiSquare - 卡方值
 * @property {number} degreesOfFreedom - 自由度
 * @property {number|null} pValue - p 值
 * @property {number} lowExpectedCells - 期望频数<5的单元格数
 */

/**
 * @typedef {Object} SignificanceResult
 * @property {boolean} significant - 是否显著
 * @property {string} level - 显著性水平 (0.001/0.01/0.05/ns/na)
 * @property {string} label - 显示标签
 */

/**
 * @typedef {Object} PostHocResult
 * @property {number} col1 - 列1索引
 * @property {number} col2 - 列2索引
 * @property {string} col1Label - 列1标签
 * @property {string} col2Label - 列2标签
 * @property {number} p1 - 列1比例
 * @property {number} p2 - 列2比例
 * @property {number} diff - 比例差
 * @property {number} z - z 统计量
 * @property {boolean} significant - 是否显著
 */

/**
 * @typedef {Object} PsmAnalysis
 * @property {Array<{price: number, tooCheap: number, cheap: number, expensive: number, tooExpensive: number}>} curve - PSM 曲线
 * @property {Object} keyPoints - 关键价格点
 * @property {number|null} keyPoints.opp - 最优价格点
 * @property {number|null} keyPoints.idp - 无差异价格点
 * @property {number|null} keyPoints.pmc - 边际便宜点
 * @property {number|null} keyPoints.pme - 边际贵点
 */

/**
 * @typedef {Object} KanoCategory
 * @property {string} feature - 功能名称
 * @property {string} category - KANO 分类 (A/O/M/I/R/Q)
 * @property {string} categoryLabel - 分类中文名
 * @property {number} betterCoefficient - Better 系数
 * @property {number} worseCoefficient - Worse 系数
 */

/**
 * @typedef {Object} MaxDiffDesign
 * @property {number} itemCount - 选项总数
 * @property {number} setSize - 每组展示数
 * @property {number} setCount - 题组数
 * @property {Array<number[]>} sets - 题组组合
 */

// ─── AI 相关 ────────────────────────────────────────────────

/**
 * @typedef {Object} AiSettings
 * @property {string} provider - 供应商 ID
 * @property {string} mode - 模式 (api/local)
 * @property {string} model - 模型名称
 * @property {string} url - 接口地址
 * @property {string} apiKey - API 密钥
 */

/**
 * @typedef {Object} AiMessage
 * @property {string} role - 角色 (system/user/assistant)
 * @property {string} content - 消息内容
 */

/**
 * @typedef {Object} AiCallOptions
 * @property {number} [temperature=0.35] - 温度
 * @property {number} [maxTokens=3500] - 最大 token
 * @property {boolean} [stream=true] - 是否流式
 * @property {string} [responseFormat] - 响应格式
 * @property {number} [timeoutMs=360000] - 超时毫秒
 * @property {Function} [onProgress] - 进度回调
 */

// ─── 工作台 ─────────────────────────────────────────────────

/**
 * @typedef {Object} WorkspaceProject
 * @property {string} id - 项目 ID
 * @property {string} projectName - 项目名称
 * @property {string} studyType - 研究类型
 * @property {string} stage - 项目阶段
 * @property {number} sampleTarget - 目标样本量
 * @property {string} quotaDimensions - 配额维度
 * @property {string} questionnaireText - 问卷文本
 * @property {string} createdAt - 创建时间
 * @property {string} updatedAt - 更新时间
 * @property {string|null} archivedAt - 归档时间
 * @property {Object} status - 各步骤完成状态
 * @property {Object} assets - 项目资产
 * @property {Array} reportPlans - 报告方案
 * @property {Array} proposalDecks - PPT 方案
 * @property {Array} activities - 操作记录
 */

/**
 * @typedef {Object} WorkspaceLibrary
 * @property {number} version - 版本号
 * @property {string|null} activeProjectId - 当前活跃项目 ID
 * @property {WorkspaceProject[]} projects - 项目列表
 */

// ─── 数据清洗 ───────────────────────────────────────────────

/**
 * @typedef {Object} CleaningRule
 * @property {string} level - 严重级别 (high/medium/low)
 * @property {string} title - 规则标题
 * @property {string} detail - 规则描述
 * @property {string} [evidence] - 证据
 */

/**
 * @typedef {Object} CleaningResult
 * @property {number} totalRows - 总行数
 * @property {number} removedRows - 移除行数
 * @property {number} keptRows - 保留行数
 * @property {Array<{row: number, rules: string[]}>} removedDetails - 移除明细
 */

// ─── 文件解析 ───────────────────────────────────────────────

/**
 * @typedef {Object} ParsedData
 * @property {string[]} headers - 列头
 * @property {Array<Object>} rows - 数据行（对象数组）
 * @property {string} [fileName] - 文件名
 * @property {string} [source] - 来源格式
 */

/**
 * @typedef {Object} CodebookEntry
 * @property {string} variable - 变量名
 * @property {string} label - 变量标签
 * @property {string} type - 变量类型
 * @property {string} [values] - 值域说明
 */
