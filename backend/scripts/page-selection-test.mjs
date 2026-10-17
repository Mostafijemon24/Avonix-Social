/**
 * Persistent Sitemap / Pages Selection — REAL database round-trip test.
 *
 * Exercises pageSelectionService against a throwaway SQLite DB (test.db):
 *   1. persistInventory stores the full inventory, auto-selects top N.
 *   2. getSelection reads it back (survives a fresh client → "refresh").
 *   3. saveSelection toggles individual + bulk and REJECTS unknown URLs.
 *   4. Duplicate prevention: re-running analysis does not duplicate rows and
 *      preserves prior user choices.
 *   5. Isolation: different user / workspace / website never bleed together.
 *   6. getSelectedForGeneration returns only selected, eligible pages and is
 *      null when no inventory exists (legacy flow left untouched).
 *   7. Failed / excluded pages are never selectable.
 *
 * Requires: DATABASE_URL=file:./test.db (schema already pushed).
 * Run: npm run test:selection
 */
import {
  persistInventory,
  getSelection,
  saveSelection,
  getSelectedForGeneration,
} from "../src/services/pageSelectionService.js";
import prisma from "../src/db.js";

const ORIGIN = "https://acme-plumbing.test";
const USER_A = "user-a";
const USER_B = "user-b";
const WS1 = "ws-1";
const WS2 = "ws-2";

let passed = 0;
let failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}

function makePages(n) {
  return Array.from({ length: n }, (_, i) => ({
    url: `${ORIGIN}/page-${i + 1}`,
    title: `Page ${i + 1}`,
    pageType: i % 5 === 0 ? "Services" : "Blog",
    writingIntent: "Awareness",
    areaCoverage: "Austin, TX",
    reachable: true,
    keywords: { primary: `service ${i + 1}`, secondary: [`kw-${i}a`, `kw-${i}b`] },
  }));
}

async function cleanup() {
  await prisma.websitePage.deleteMany({});
  await prisma.websiteService.deleteMany({});
}

async function main() {
  await cleanup();

  const PAGES = 143;
  const pages = makePages(PAGES);
  const failedPages = [{ url: `${ORIGIN}/broken`, reason: "http-500" }];
  const excludedPages = [{ url: `${ORIGIN}/private`, reason: "out-of-scope" }];
  const services = [
    { name: "Drain Cleaning", pages: [`${ORIGIN}/page-1`, `${ORIGIN}/page-6`], pageCount: 2 },
    { name: "Water Heater Repair", pages: [`${ORIGIN}/page-11`], pageCount: 1 },
  ];

  /* 1. persistInventory + auto-select top N (STUDIO_MAX_GENERATE_PAGES=15). */
  console.log("Persist inventory:");
  const snap1 = await persistInventory({
    userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN,
    pages, services, failed: failedPages, excluded: excludedPages,
  });
  assert(snap1.counts.analyzed === PAGES, "all 143 analyzed pages persisted", `got ${snap1.counts.analyzed}`);
  assert(snap1.counts.failed === 1, "failed page recorded");
  assert(snap1.counts.excluded === 1, "excluded page recorded");
  assert(snap1.counts.selected === 15, "auto-selected top 15 on first analysis", `got ${snap1.counts.selected}`);
  assert(snap1.services.length === 2 && snap1.services.every((s) => s.selected), "services persisted + selected");

  /* 2. Read back with a cold query (simulated refresh). */
  console.log("\nRead back (refresh):");
  const snap2 = await getSelection({ userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN });
  assert(snap2.counts.selected === 15, "selection survives read-back");
  assert(snap2.pages.length === PAGES + 2, "inventory includes failed + excluded rows", `got ${snap2.pages.length}`);

  /* 3. saveSelection — bulk + individual + reject unknown. */
  console.log("\nSave selection (validated):");
  const wanted = [`${ORIGIN}/page-2`, `${ORIGIN}/page-3`, `${ORIGIN}/page-99`];
  const unknown = ["https://evil.test/haxx", `${ORIGIN}/broken`]; // broken=failed→not eligible
  const save1 = await saveSelection({
    userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN,
    selectedUrls: [...wanted, ...unknown],
    selectedServices: ["Drain Cleaning", "Nonexistent Service"],
  });
  assert(save1.ok, "saveSelection ok");
  assert(save1.pagesUpdated === 3, "only the 3 eligible URLs selected", `got ${save1.pagesUpdated}`);
  assert(save1.rejected.includes("https://evil.test/haxx"), "rejects foreign-origin URL");
  assert(save1.rejected.includes(`${ORIGIN}/broken`), "rejects failed (ineligible) URL");
  assert(save1.rejected.includes("Nonexistent Service"), "rejects unknown service");
  assert(save1.selection.counts.selected === 3, "selection replaced (not appended)", `got ${save1.selection.counts.selected}`);
  assert(save1.servicesUpdated === 1, "one service selected");

  /* 4. Duplicate prevention + preservation on re-analysis. */
  console.log("\nRe-analyze (duplicate prevention + preserve choices):");
  const snap3 = await persistInventory({
    userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN,
    pages, services, failed: failedPages, excluded: excludedPages,
  });
  const rowCount = await prisma.websitePage.count({
    where: { userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN },
  });
  assert(rowCount === PAGES + 2, "no duplicate rows after re-analysis", `got ${rowCount}`);
  assert(snap3.counts.selected === 3, "user's 3-page choice preserved (no re-auto-select)", `got ${snap3.counts.selected}`);

  /* 4b. Stale pages pruned when the site shrinks. */
  const shrunk = await persistInventory({
    userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN,
    pages: makePages(10), services, failed: [], excluded: [],
  });
  assert(shrunk.counts.analyzed === 10, "shrunk inventory pruned to 10", `got ${shrunk.counts.analyzed}`);
  // page-2 and page-3 still exist (<=10) so remain selected; page-99 pruned.
  assert(shrunk.counts.selected === 2, "selection intersected with surviving pages", `got ${shrunk.counts.selected}`);

  /* 5. Isolation across user / workspace / website. */
  console.log("\nIsolation:");
  await persistInventory({ userId: USER_B, workspaceId: WS1, websiteOrigin: ORIGIN, pages: makePages(5), services: [] });
  await persistInventory({ userId: USER_A, workspaceId: WS2, websiteOrigin: ORIGIN, pages: makePages(7), services: [] });
  const aWs1 = await getSelection({ userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN });
  const bWs1 = await getSelection({ userId: USER_B, workspaceId: WS1, websiteOrigin: ORIGIN });
  const aWs2 = await getSelection({ userId: USER_A, workspaceId: WS2, websiteOrigin: ORIGIN });
  assert(aWs1.counts.analyzed === 10, "user A / ws1 unaffected by others", `got ${aWs1.counts.analyzed}`);
  assert(bWs1.counts.analyzed === 5, "user B / ws1 isolated", `got ${bWs1.counts.analyzed}`);
  assert(aWs2.counts.analyzed === 7, "user A / ws2 isolated", `got ${aWs2.counts.analyzed}`);

  /* 6. getSelectedForGeneration contract. */
  console.log("\nDownstream enforcement contract:");
  const gen = await getSelectedForGeneration({ userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN });
  assert(gen && gen.urls.size === 2, "returns only selected eligible URLs", `got ${gen && gen.urls.size}`);
  assert(gen.urls.has(`${ORIGIN}/page-2`), "includes a selected page");
  assert(!gen.urls.has(`${ORIGIN}/page-1`), "excludes an unselected page");
  const none = await getSelectedForGeneration({ userId: "nobody", workspaceId: "x", websiteOrigin: "https://unknown.test" });
  assert(none === null, "null when no inventory (legacy flow untouched)");

  /* 7. Failed/excluded never selectable even if requested. */
  console.log("\nIneligible pages:");
  const trySelectBad = await saveSelection({
    userId: USER_A, workspaceId: WS1, websiteOrigin: ORIGIN,
    selectedUrls: [`${ORIGIN}/page-1`, `${ORIGIN}/broken`, `${ORIGIN}/private`],
  });
  assert(trySelectBad.selection.counts.selected === 1, "only the eligible page selected", `got ${trySelectBad.selection.counts.selected}`);
  assert(trySelectBad.rejected.length === 2, "failed + excluded rejected", `got ${trySelectBad.rejected.length}`);

  await cleanup();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
