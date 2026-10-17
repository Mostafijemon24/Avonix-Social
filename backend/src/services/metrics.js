/**
 * P2 — Lightweight generation latency metrics.
 *
 * A dependency-free, high-resolution stage timer used to measure where time is
 * actually spent during content generation (website intelligence → brand voice
 * → per-platform AI text → similarity check → persistence → images). Reporting
 * ACTUAL measured milliseconds — never estimates — is a P2/P3 requirement.
 *
 * Usage:
 *   const t = createTimer("generate");
 *   t.mark("voice");            // time since start (or previous mark)
 *   ... work ...
 *   t.mark("text");
 *   const summary = t.end();    // { totalMs, stages:[{stage, ms}], ... }
 */

const now = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

export function createTimer(label = "timer") {
  const startedAt = now();
  let last = startedAt;
  const stages = [];
  let ended = false;
  let endedAt = null;

  function mark(stage) {
    const t = now();
    stages.push({
      stage: String(stage || `stage_${stages.length + 1}`),
      ms: round(t - last),
      atMs: round(t - startedAt),
    });
    last = t;
    return stages[stages.length - 1];
  }

  function summary() {
    const total = round((endedAt ?? now()) - startedAt);
    return {
      label,
      totalMs: total,
      stages: stages.slice(),
      // Convenience: slowest stage for quick bottleneck spotting.
      slowest: stages.reduce(
        (max, s) => (s.ms > (max?.ms ?? -1) ? s : max),
        null
      ),
    };
  }

  function end(stage) {
    if (stage) mark(stage);
    if (!ended) {
      ended = true;
      endedAt = now();
    }
    return summary();
  }

  return { mark, end, summary, get label() { return label; } };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Aggregate several timer summaries (e.g. per-post) into totals per stage.
 * Returns { count, totalMs, byStage: { [stage]: { totalMs, count, avgMs } } }.
 */
export function aggregateSummaries(summaries = []) {
  const byStage = {};
  let totalMs = 0;
  for (const s of summaries) {
    totalMs += s.totalMs || 0;
    for (const st of s.stages || []) {
      const row = (byStage[st.stage] = byStage[st.stage] || { totalMs: 0, count: 0, avgMs: 0 });
      row.totalMs = round(row.totalMs + st.ms);
      row.count += 1;
    }
  }
  for (const k of Object.keys(byStage)) {
    byStage[k].avgMs = round(byStage[k].totalMs / byStage[k].count);
  }
  return { count: summaries.length, totalMs: round(totalMs), byStage };
}
