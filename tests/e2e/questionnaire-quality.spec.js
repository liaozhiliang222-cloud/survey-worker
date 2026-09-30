const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixtures = require('../fixtures/questionnaire-quality-cases.cjs');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('surveykit_tour_done', '1'));
});

async function setup(page, responses) {
  const requests = [];
  await page.route('**/api/ai', async (route) => {
    requests.push(route.request().postDataJSON());
    const text = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (text === null) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: '测试：模型不可用' } }) });
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` });
  });
  await page.goto('/#ai-assistant');
  await page.locator('#aiInput').fill(fixtures.brief);
  await page.locator('#aiContext').fill('日常饮食研究');
  await page.locator('#aiAudience').fill(fixtures.audience);
  return requests;
}

test('generation displays internal findings but Word/Markdown contain only client content', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const requests = await setup(page, [fixtures.badDraft]);
  await page.locator('#generateAiBrief').click();
  const card = page.locator('[data-questionnaire-quality]');
  await expect(card).toContainText('时机题与多少量表不匹配');
  await expect(page.locator('[data-questionnaire-coverage]')).toContainText('需求—指标—题号核对');
  expect(JSON.stringify(requests[0])).toContain('measurements数组');
  await expect(card).toContainText('硬筛选缺少已确认的资格依据');
  await expect(page.locator('#aiResults')).not.toContainText('已补充随机显示');
  expect(JSON.stringify(requests[0])).toContain('只有客户明确的入组条件才可硬性终止');
  expect(JSON.stringify(requests[0])).toContain('questionnaire-rules');
  await expect(page.locator('#exportAiPlatformFormat')).toBeDisabled();
  const markdownDownload = page.waitForEvent('download');
  await page.locator('#exportAiPrompt').click();
  const markdown = fs.readFileSync(await (await markdownDownload).path(), 'utf8');
  expect(markdown).not.toContain('系统规则检查');
  expect(markdown).not.toContain('questionnaire-rules');
  expect(markdown).not.toContain('QC1.');
  expect(markdown).not.toContain('注意力检测');
  expect(markdown).toContain('D2.');
  const wordDownload = page.waitForEvent('download');
  await page.locator('#exportAiWord').click();
  const wordFile = await wordDownload;
  expect(wordFile.suggestedFilename()).toMatch(/\.docx$/);
  const xml = await page.evaluate(async (bytes) => readZipText(new Uint8Array(bytes).buffer, 'word/document.xml'), [...fs.readFileSync(await wordFile.path())]);
  expect(xml).not.toContain('系统规则检查');
  expect(xml).not.toContain('questionnaire-rules');
  expect(xml).not.toContain('注意力检测');
  expect(xml).toContain('D2.');
  await page.locator('#aiResults').screenshot({ path: 'test-results/questionnaire-quality-desktop.png' });
  expect(errors).toEqual([]);
});

test('revision rechecks and uses saved original sources, not edited form fields', async ({ page }) => {
  const requests = await setup(page, [fixtures.badDraft, fixtures.goodDraft]);
  await page.locator('#generateAiBrief').click();
  await expect(page.locator('[data-questionnaire-quality]')).toContainText('需修改');
  await page.locator('#aiAudience').fill('未提交的新目标人群');
  await page.locator('#aiReviseInput').fill('修正时机量表和分流，保留原始目标人群。');
  await page.locator('#reviseAiQuestionnaire').click();
  await expect(page.locator('[data-questionnaire-quality] .issue-tag')).toHaveText('待人工复核');
  await expect(page.locator('[data-questionnaire-quality]')).not.toContainText('时机题与多少量表不匹配');
  await expect(page.locator('#exportAiPlatformFormat')).toBeEnabled();
  const secondPrompt = JSON.stringify(requests[1]);
  expect(secondPrompt).toContain(fixtures.audience);
  expect(secondPrompt).not.toContain('未提交的新目标人群');
  expect(secondPrompt).toContain('SCALE_TIME_MISMATCH');
  const output = await page.locator('#aiResults textarea.prompt-box').inputValue();
  expect((output.match(/<!-- questionnaire-quality:start -->/g) || []).length).toBe(0);
  await page.locator('[data-questionnaire-quality] summary').filter({ hasText: '样本条件与原文依据' }).click();
  await expect(page.locator('[data-questionnaire-quality]')).toContainText(fixtures.audience);
  const platformDownload = page.waitForEvent('download');
  await page.locator('#exportAiPlatformFormat').click();
  const platformText = fs.readFileSync(await (await platformDownload).path(), 'utf8');
  expect(platformText).not.toContain('questionnaire-rules');
  expect(platformText).not.toContain('R_SALT');
  expect(platformText).not.toContain('系统规则检查');
});

test('model failure keeps fallback explicitly unverified on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, [null]);
  await page.locator('#generateAiBrief').click();
  const card = page.locator('[data-questionnaire-quality]');
  await expect(card).toContainText('入组条件尚未确认');
  const output = await page.locator('#aiResults textarea.prompt-box').inputValue();
  expect(output).not.toContain('本地备用骨架');
  expect(output).toContain('曾经进行，现在已停止');
  expect(output).not.toContain('通常终止');
  expect(output).not.toContain('✅');
  const size = await card.evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.width + 2);
  await card.screenshot({ path: 'test-results/questionnaire-quality-mobile.png' });
});

test('modular entry shares prompt and audit rules', async ({ page }) => {
  await setup(page, [fixtures.goodDraft]);
  const result = await page.evaluate(async (config) => {
    const module = await import('/src/modules/ai-questionnaire/index.js');
    const prompt = module.buildAiQuestionnairePrompt(config);
    const generated = await module.generateAiQuestionnaire(config);
    return { prompt, audit: generated.qualityAudit, output: generated.output };
  }, { brief: fixtures.brief, audience: fixtures.audience, project: '日常饮食研究', studyType: 'ua', lengthMode: 'short' });
  expect(JSON.stringify(result.prompt)).toContain('questionnaire-rules');
  expect(result.audit.summary.errors).toBe(0);
  expect(result.audit.status).toBe('待人工复核');
  expect(result.output).not.toContain('系统规则检查');
  expect(result.output).not.toContain('questionnaire-rules');
});
const measurement = { id: 'M_UI', source: { field: 'brief', quote: fixtures.brief }, metric: '行为强度核对', population: '全部合格者', role: 'segmentation', questionIds: ['S3'], analysis: '比较行为天数' };
test('measurement map remains visible in UI and refreshed exports', async ({ page }) => {
  const draft = fixtures.withContract(fixtures.baseGood, { ...fixtures.contract, measurements: [measurement] });
  await setup(page, [draft]);
  await page.locator('#generateAiBrief').click();
  const coverage = page.locator('[data-questionnaire-coverage]');
  await coverage.locator('summary').click();
  await expect(coverage).toContainText('行为强度核对');
  await expect(coverage).toContainText('待语义复核');
  await expect(coverage).toContainText('全部合格者');
  await expect(coverage).toContainText('S3');
  const download = page.waitForEvent('download');
  await page.locator('#exportAiPrompt').click();
  const markdown = fs.readFileSync(await (await download).path(), 'utf8');
  expect(markdown).not.toContain('行为强度核对｜待语义复核');
  expect(markdown).not.toContain('行为强度核对｜完整覆盖');
});
test('copy and project sync use the same clean client version while internal audit remains', async ({page}) => {
  const annotated=fixtures.goodDraft.replace('S2. 您减少', '> 设计思路：此处是内部解释。\n\nS2. 您减少');
  await setup(page,[annotated]);
  await page.locator('#generateAiBrief').click();
  const output=await page.locator('#aiResults textarea.prompt-box').inputValue();
  expect(output).not.toMatch(/设计思路|questionnaire-rules|系统规则检查|QC1\./);
  await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__clientClipboard=text;};});
  await page.locator('#copyAiPrompt').click();
  expect(await page.evaluate(()=>window.__clientClipboard)).toBe(output);
  await page.locator('#applyAiQuestionnaire').click();
  expect(await page.locator('#workspaceQuestionnaire').inputValue()).toBe(output);
  const internal=await page.evaluate(()=>lastAiQuestionnaireText);
  expect(internal).toContain('questionnaire-rules');
  expect(internal).toContain('系统规则检查');
  expect(internal).not.toContain('QC1.');
});
