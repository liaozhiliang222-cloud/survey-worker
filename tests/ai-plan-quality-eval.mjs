import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../ai-plan-quality.js", import.meta.url), "utf8");
const cases = JSON.parse(readFileSync(new URL("./fixtures/ai-plan-quality-cases.json", import.meta.url), "utf8"));
const context = vm.createContext({ console });
vm.runInContext(source, context);
const quality = context.AiPlanQuality;

const results = cases.map((item) => {
  const brief = quality.buildPlanBrief(item.config, item.context);
  const audit = quality.auditPlan(item.plan, brief, item.config);
  assert.equal(audit.passed, item.expectedPass, `${item.id}: unexpected pass result at score ${audit.score}`);
  assert.ok(audit.score >= item.minScore, `${item.id}: ${audit.score} is below ${item.minScore}`);
  assert.ok(audit.score <= item.maxScore, `${item.id}: ${audit.score} is above ${item.maxScore}`);
  return `${item.id}=${audit.score}`;
});

console.log(`AI plan quality golden eval passed: ${results.join(", ")}`);
