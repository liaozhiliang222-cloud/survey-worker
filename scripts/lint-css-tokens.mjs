// 样式规范检查（UI/UX 阶段 4）。
// 新样式必须使用 styles.css 顶部 :root 中的设计变量。存量写死值记在基线文件里，
// 只允许减少、不允许增加：改到哪页就顺手迁移哪页，不做一次性大改。
//   npm run lint:css            检查
//   npm run lint:css -- --update 迁移后下调基线
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cssFile = path.join(root, "styles.css");
const baselineFile = path.join(root, "scripts", "css-token-baseline.json");
const css = fs.readFileSync(cssFile, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

const BREAKPOINTS = new Set([1200, 900, 600]);
const RADII = new Set(["0", "50%", "inherit"]);
// 幻灯片缩略图里的文字按画面比例缩小，不是界面文字，允许小于 12px。
const MINIATURE = /\.proposal-(example|funnel-row|mini-bar|price-point|framework-placeholder|canvas|node)|\.pptx-page-mini/;
// 由脚本在元素上设置的变量。
const RUNTIME_VARS = new Set(["--bar-a", "--bar-b"]);

const lineOf = (index) => css.slice(0, index).split("\n").length;
const rootStart = css.indexOf(":root");
const rootEnd = css.indexOf("}", rootStart);
const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

const counts = { color: 0, "font-size": 0, radius: 0, breakpoint: 0 };
const errors = [];

for (const rule of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  const selector = rule[1].trim();
  const blockStart = rule.index + rule[1].length + 1;
  if (blockStart > rootStart && blockStart < rootEnd) continue;
  for (const decl of rule[2].matchAll(/([-\w]+)\s*:\s*([^;]+)/g)) {
    const [, prop, value] = decl;
    const at = () => `styles.css:${lineOf(blockStart + decl.index)} ${selector.split("\n").pop()} { ${prop}: ${value.trim()} }`;
    if (prop.startsWith("--")) continue;
    counts.color += (value.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi) || []).length;
    const size = prop === "font-size" ? value : prop === "font" ? (value.match(/\d[\d.]*(?:px|rem|em)\b/) || [""])[0] : "";
    if (size && !size.includes("var(") && !/^\s*(inherit|1em|100%)\s*$/.test(size)) {
      counts["font-size"] += 1;
      const px = size.match(/^\s*([\d.]+)px/);
      if (px && Number(px[1]) < 12 && !MINIATURE.test(selector)) errors.push(`字号小于 12px：${at()}`);
    }
    if (prop === "border-radius" && !value.includes("var(") && !RADII.has(value.trim())) counts.radius += 1;
    for (const ref of value.matchAll(/var\((--[\w-]+)\s*([,)])/g)) {
      if (ref[2] === ")" && !defined.has(ref[1]) && !RUNTIME_VARS.has(ref[1])) errors.push(`变量未定义且没有默认值 ${ref[1]}：${at()}`);
    }
  }
}
for (const media of css.matchAll(/@media[^{]*\(\s*(?:max|min)-width\s*:\s*(\d+)px/g)) {
  if (!BREAKPOINTS.has(Number(media[1]))) counts.breakpoint += 1;
}

if (process.argv.includes("--update")) {
  fs.writeFileSync(baselineFile, `${JSON.stringify(counts, null, 2)}\n`);
  console.log("lint:css baseline updated", counts);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
const labels = { color: "写死的颜色", "font-size": "写死的字号", radius: "非标准圆角", breakpoint: "非标准断点（标准为 1200 / 900 / 600）" };
for (const [key, value] of Object.entries(counts)) {
  if (value > baseline[key]) errors.push(`${labels[key]}从 ${baseline[key]} 处增加到 ${value} 处：请改用 styles.css 顶部的设计变量`);
  else if (value < baseline[key]) console.log(`${labels[key]}已从 ${baseline[key]} 减少到 ${value}，可运行 npm run lint:css -- --update 下调基线`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("lint:css: PASS", counts);
