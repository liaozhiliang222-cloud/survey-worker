/** Pure template selection transactions shared by the preview UI and tests. */
const clone = (value) => JSON.parse(JSON.stringify(value));
const safeText = (value) => String(value || "").slice(0, 100);

export function normalizeLayoutBinding(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
  const choices = Object.fromEntries(Object.entries(value.template_choices || {}).slice(0, 8)
    .filter(([key, item]) => /^[a-z0-9_]+$/.test(key) && item && typeof item === "object")
    .map(([key, item]) => [key, { variant: safeText(item.variant), locked: item.locked === true }]));
  return { template_id: safeText(value.template_id), source_slide: Number.isInteger(value.source_slide) && value.source_slide > 0 ? value.source_slide : null,
    locked: value.locked === true, force_split: value.force_split === true, template_choices: choices };
}

export function selectPptTemplate(script, template) {
  if (!template?.template_id || !template?.version || !Array.isArray(template.layouts)) throw new Error("模板目录不完整，请重新加载。");
  const next = clone(script);
  const previousId = next.style_profile?.id || "qualitative_tech_blue_v2";
  next.style_profile = { ...(next.style_profile || {}), id: template.template_id, version: template.version };
  for (const page of next.pages || []) {
    const binding = normalizeLayoutBinding(page.layout_binding);
    const variant = page.layout_variant || page.variant || page.layout_spec?.variant || "";
    binding.template_choices[previousId] = { variant, locked: binding.locked };
    const saved = binding.template_choices[template.template_id];
    const allowed = [...template.layouts, ...(template.supported_layouts || [])].filter((layout) => layout.page_types?.includes(page.page_type));
    const selected = allowed.find((layout) => layout.id === saved?.variant);
    page.layout_variant = selected?.id || "";
    page.variant = page.layout_variant;
    page.layout_spec = { ...(page.layout_spec || {}), variant: page.layout_variant };
    page.layout_binding = { ...binding, template_id: template.template_id, source_slide: selected?.source_slide || null, locked: Boolean(selected && saved?.locked) };
  }
  return next;
}

export function setPptPageLayout(script, pageId, variant, template) {
  const next = clone(script);
  const page = next.pages?.find((item) => item.id === pageId);
  if (!page) throw new Error("找不到需要修改的源页面。");
  const layout = template?.layouts?.find((item) => item.id === variant && item.page_types?.includes(page.page_type));
  if (!layout) throw new Error("该版式不适用于当前页面。");
  const binding = normalizeLayoutBinding(page.layout_binding);
  if (binding.locked) throw new Error("请先解锁当前版式。");
  page.layout_variant = variant;
  page.layout_spec = { ...(page.layout_spec || {}), variant };
  page.layout_binding = { ...binding, template_id: template.template_id, source_slide: layout.source_slide || null,
    template_choices: { ...binding.template_choices, [template.template_id]: { variant, locked: false } } };
  return next;
}
