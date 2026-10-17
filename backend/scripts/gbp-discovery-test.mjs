/**
 * Google Business Profile discovery + publish-location resolution test.
 *
 * Runs a local HTTP server that imitates the Google Business Profile REST
 * endpoints (accounts + per-account locations) WITH pagination and error
 * cases, then verifies the real discovery/resolution logic end-to-end without
 * any live Google credentials:
 *
 *   1. Pagination — every account and every location across pages is collected
 *      (no slice(0,8) / slice(0,20) truncation).
 *   2. Honest states — a 403 on one account's locations becomes a warning (not
 *      a silent drop); empty accounts are flagged non-publishable.
 *   3. Auth failure on the accounts call throws a classified error.
 *   4. Publish resolver — uses a selected location; auto-resolves a lone
 *      location; and REFUSES to guess when several exist with none selected.
 *
 * Run: npm run test:gbp
 */
import http from "http";

const {
  buildGbpEligible,
  resolvePublishableLocation,
  classifyGoogleError,
  fetchAllAccounts,
  isPublishableGbpItem,
} = await import("../src/services/gbpDiscovery.js");

/* ── Mock Google API ────────────────────────────────────────────────────
 * Accounts: acc-ok (3 locations across 2 pages), acc-empty (0 locations),
 * acc-forbidden (locations → 403), acc-single (1 location).
 */
let TOKEN_MODE = "ok"; // "ok" | "accounts401"

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const path = u.pathname;
  const pageToken = u.searchParams.get("pageToken");

  // ACCOUNTS (account-management host is proxied under /am/)
  if (path === "/am/v1/accounts") {
    if (TOKEN_MODE === "accounts401") return send(res, 401, { error: "invalid" });
    if (!pageToken) {
      return send(res, 200, {
        accounts: [
          { name: "accounts/acc-ok", accountName: "Acme Group" },
          { name: "accounts/acc-empty", accountName: "Empty Co" },
        ],
        nextPageToken: "p2",
      });
    }
    return send(res, 200, {
      accounts: [
        { name: "accounts/acc-forbidden", accountName: "No Access Co" },
        { name: "accounts/acc-single", accountName: "Solo Shop" },
      ],
    });
  }

  // LOCATIONS (business-information host proxied under /bi/)
  const locMatch = path.match(/^\/bi\/v1\/accounts\/([^/]+)\/locations$/);
  if (locMatch) {
    const acc = locMatch[1];
    if (acc === "acc-forbidden") return send(res, 403, { error: "permission" });
    if (acc === "acc-empty") return send(res, 200, { locations: [] });
    if (acc === "acc-single") {
      return send(res, 200, {
        locations: [{ name: "locations/solo-1", title: "Solo Shop Downtown",
          storefrontAddress: { addressLines: ["1 Main St"], locality: "Austin", administrativeArea: "TX" } }],
      });
    }
    if (acc === "acc-ok") {
      if (!pageToken) {
        return send(res, 200, {
          locations: [
            { name: "locations/ok-1", title: "Acme North", phoneNumbers: { primaryPhone: "+1-555-0001" },
              storefrontAddress: { addressLines: ["10 North Rd"], locality: "Dallas", administrativeArea: "TX" } },
            { name: "locations/ok-2", title: "Acme South" },
          ],
          nextPageToken: "lp2",
        });
      }
      return send(res, 200, { locations: [{ name: "locations/ok-3", title: "Acme East" }] });
    }
    return send(res, 200, { locations: [] });
  }

  send(res, 404, { error: "not-found" });
});

/* A fetch shim that rewrites the real Google hosts to our local server. */
function makeFetchImpl(origin) {
  return (url, opts) => {
    const rewritten = url
      .replace("https://mybusinessaccountmanagement.googleapis.com", `${origin}/am`)
      .replace("https://mybusinessbusinessinformation.googleapis.com", `${origin}/bi`);
    return fetch(rewritten, opts);
  };
}

let passed = 0, failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = makeFetchImpl(origin);

  /* 0. error classifier */
  console.log("Error classification:");
  assert(classifyGoogleError(401) === "expired", "401 → expired");
  assert(classifyGoogleError(403) === "permission", "403 → permission");
  assert(classifyGoogleError(429) === "quota", "429 → quota");
  assert(classifyGoogleError(503) === "google-down", "5xx → google-down");

  /* 1. pagination across accounts + locations */
  console.log("\nDiscovery (pagination + warnings):");
  TOKEN_MODE = "ok";
  const { eligible, warnings } = await buildGbpEligible("tok", { fetchImpl });

  const accPage = await fetchAllAccounts("tok", fetchImpl);
  assert(accPage.items.length === 4, "all 4 accounts paginated", `got ${accPage.items.length}`);

  const locItems = eligible.filter((e) => e.metadata.type === "location");
  const okLocs = locItems.filter((e) => e.metadata.googleAccount === "accounts/acc-ok");
  assert(okLocs.length === 3, "acc-ok: all 3 locations across 2 pages", `got ${okLocs.length}`);
  assert(locItems.length === 4, "4 publishable locations total (acc-ok 3 + solo 1)", `got ${locItems.length}`);
  assert(locItems.every((e) => e.metadata.publishable === true), "locations marked publishable");

  const soloLoc = eligible.find((e) => e.accountId === "locations/solo-1");
  assert(soloLoc?.metadata.address === "1 Main St, Austin, TX", "address formatted from storefrontAddress");

  const emptyItem = eligible.find((e) => e.metadata.googleAccount === "accounts/acc-empty");
  assert(emptyItem && emptyItem.metadata.publishable === false, "empty account → non-publishable item");

  const forbiddenWarn = warnings.find((w) => w.account === "accounts/acc-forbidden");
  assert(forbiddenWarn?.reason === "permission", "forbidden account → permission warning (not dropped)");
  const forbiddenItem = eligible.find((e) => e.metadata.googleAccount === "accounts/acc-forbidden");
  assert(forbiddenItem && forbiddenItem.metadata.publishable === false, "forbidden account surfaced as non-publishable");

  /* 2. accounts-call auth failure throws classified error */
  console.log("\nAuth failure:");
  TOKEN_MODE = "accounts401";
  let threw = null;
  try { await buildGbpEligible("tok", { fetchImpl }); } catch (e) { threw = e; }
  assert(threw && threw.reason === "expired", "accounts 401 throws reason=expired");
  TOKEN_MODE = "ok";

  /* 3. publish-location resolution safety */
  console.log("\nPublish-location resolution:");
  const sel = await resolvePublishableLocation(
    { locationName: "locations/ok-2", googleAccount: "accounts/acc-ok" }, "tok", fetchImpl
  );
  assert(sel.locationName === "locations/ok-2" && !sel.resolvedByFallback, "uses explicitly selected location");

  const solo = await resolvePublishableLocation(
    { googleAccount: "accounts/acc-single" }, "tok", fetchImpl
  );
  assert(solo.locationName === "locations/solo-1" && solo.resolvedByFallback, "auto-resolves the lone location");

  let ambErr = null;
  try {
    await resolvePublishableLocation({ googleAccount: "accounts/acc-ok" }, "tok", fetchImpl);
  } catch (e) { ambErr = e; }
  assert(ambErr && ambErr.reason === "ambiguous-location", "REFUSES to guess among multiple locations");

  // Finding 1 fix: no account pinned + multiple Google accounts → ambiguous-account.
  let acctErr = null;
  try {
    await resolvePublishableLocation({}, "tok", fetchImpl);
  } catch (e) { acctErr = e; }
  assert(acctErr && acctErr.reason === "ambiguous-account", "REFUSES to guess among multiple ACCOUNTS");

  /* 4. publishable guard (Finding 2 defense-in-depth) */
  console.log("\nPublishable guard:");
  assert(
    isPublishableGbpItem({ metadata: { publishable: true, locationName: "locations/x" } }),
    "real location is connectable"
  );
  assert(!isPublishableGbpItem(soloLoc && { metadata: { publishable: true } }), "publishable without locationName rejected");
  assert(!isPublishableGbpItem(emptyItem), "empty-account stub is NOT connectable");
  assert(!isPublishableGbpItem({ accountId: "google-user", metadata: { type: "none", publishable: false } }), "google-user stub is NOT connectable");

  server.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); server.close(); process.exit(1); });
