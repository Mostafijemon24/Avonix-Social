/**
 * P3 — run the full backend test suite sequentially and summarize.
 * Each sub-suite exits non-zero on failure; this aggregates the results.
 *
 * Run: npm run test:all
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ["content-cta (P0)", "content-cta-test.mjs"],
  ["site-analyzer", "site-analyzer-test.mjs"],
  ["page-selection", "page-selection-test.mjs"],
  ["gbp-discovery", "gbp-discovery-test.mjs"],
  ["gmb-rules", "gmb-rules-test.js"],
  ["generation-pipeline", "generation-pipeline-test.mjs"],
  ["job-queue", "job-queue-test.mjs"],
  ["p1-content-quality", "p1-content-quality-test.mjs"],
  ["p2-policy", "p2-policy-test.mjs"],
  ["acceptance-matrix", "acceptance-matrix-test.mjs"],
];

const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "file:./test.db" };

let failedSuites = 0;
const summary = [];
for (const [name, file] of SUITES) {
  const res = spawnSync("node", [path.join(__dirname, file)], { env, encoding: "utf8" });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const m = out.match(/(\d+)(?:\/\d+)?\s+passed,\s+(\d+)\s+failed/);
  const passed = m ? Number(m[1]) : 0;
  const failed = m ? Number(m[2]) : (res.status ? "?" : 0);
  const ok = res.status === 0;
  if (!ok) failedSuites++;
  summary.push({ name, ok, passed, failed, status: res.status });
  console.log(`${ok ? "\u2713" : "\u2717"} ${name.padEnd(22)} ${m ? `${passed} passed, ${failed} failed` : `exit ${res.status}`}`);
}

console.log("\n" + "=".repeat(50));
const totalPassed = summary.reduce((a, s) => a + (typeof s.passed === "number" ? s.passed : 0), 0);
console.log(`${summary.length - failedSuites}/${summary.length} suites green — ${totalPassed} assertions passed`);
process.exit(failedSuites ? 1 : 0);
