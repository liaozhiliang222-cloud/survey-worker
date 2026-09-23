# AI研究员蓝色商务模板：第一期

新增模板 `research_business_blue_v1`，版本 `1.0.0`。基于用户提供的 202 页蓝色商务图表库，已接入规划中的 24 种研究版式。发布候选编号：`v0.10.0-20260923.blue1`；线上状态以部署记录及实际验收为准。

## 使用

在 AI研究员项目的 PPT 脚本中点击“生成定性报告PPT”，选择“蓝色商务研究报告”，检查逐页预览后生成可编辑文件。可逐页换版式、锁定版式、主动拆分内容。模板选择及锁定状态保存到新脚本版本，导出工件记录模板 ID、名称、版本和上游脚本 ID。

原有 Tech Blue V2 继续可用，默认值不变。模板切换会保留每套模板的版式选择；预览失败会恢复上一次成功状态。定量数据图表不在本期范围，仍由现有定量报告流程处理。

## 模板资产和渲染

- `pptx_report/templates/research-business-blue-v1/layout_catalog.json`：24 版式目录、来源页码、适用页型、容量、预览及必填槽位。
- 同目录 `reference.pptx`：用户原稿，SHA-256 写入目录；仅作设计参考，不在运行时复制示例文案。
- `templates/research-business-blue-v1/`：6 张由实际 OfficeCLI 渲染产生的版式示例 PNG，画面标注演示内容，随前端构建复制。
- `business_blue_layouts.py`：按语义匹配和检查兼容性。
- `business_blue_content.py`：内容槽位、逐字引语、续页、目录页码及来源备注。
- `business_blue_renderer.py`：24 版式的 OfficeCLI 原生对象实现，复用现有批处理构建器与质量门槛。

适配保留蓝色、橙色强调、浅底色及参考页的主要表达方式，为研究长文本重新安排字号与容量。它是参数化的研究报告适配，并非逐像素复制原页。标准数据图、自动更新扇形/条长等列入第二期，不能用模板示例数值替代研究数据。

正式输出由文本、形状和连接线组成，未使用整页图片。长内容和附加原声生成续页；完整原始页面、Evidence ID 和来源保存在演讲者备注中。定位图仅使用脚本给出的相对位置并标注定性性质；缺少坐标/轴定义时自动选用画像表达，显式要求定位图却缺少数据则返回错误。

## 接口兼容

沿用 `/pptx-api/qualitative-templates`、`qualitative-preview`、`qualitative-report`。后端接受注册模板白名单，预览和正式导出均注入同一模板版本；旧模板调用保持兼容。

新增 `style_profile.version` 和页面 `layout_binding`。后者保存模板 ID、来源页、锁定状态、主动拆页设置和每套模板的版式选择。模板元数据不参与研究结论生成。蓝色商务不允许静默回退到旧 Python 版式。

设置后端 `SURVEYKIT_BUSINESS_BLUE_ENABLED=0` 可从目录中隐藏并禁止生成新模板。已有报告文件不受影响。

## 验证

```powershell
npm run test:business-blue
npm run test:ppt-script
python tests/qualitative_ppt_smoke.py
npm run build
```

`test:business-blue` 要求本机具备项目 Python 依赖、OfficeCLI 和 Chrome。它包含：

- 24 个版式与来源文件校验、内容续页和原声完整性、最终目录页码。
- 非法版式、定量数据、缺失原声、模板禁用和旧版本请求明确拒绝。
- 实际 OfficeCLI 可编辑 PPTX 生成及问题扫描、真实 PNG 预览、项目范围检查。
- 浏览器端模板切换、失败回退、锁定、保存导出、再次打开恢复及前端错误检查。

浏览器测试模拟项目 API 与预览返回，验证交互和提交合同；Python 接口测试调用真实本机 OfficeCLI。两者不代表线上服务已经验证。全版式样例和完整研究样例另经 PowerPoint 导出图片进行目视检查。

## 发布范围

发布时需同时更新前端构建产物、Python 模板注册/内容/渲染模块、目录 JSON。沿用现有 OfficeCLI 安装和字体配置，没有新增数据库迁移和模型依赖。先验证服务器上的六类样页，再开放完整模板入口。回退可恢复上一发布版本，或关闭上述模板开关。
