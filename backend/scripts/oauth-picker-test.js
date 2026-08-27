/**
 * OAuth picker sanitization — tokens must never reach the client payload.
 */
import { sanitizeEligibleForClient } from "../src/services/oauthPicker.js";

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

const eligible = [
  {
    accountId: "page-a",
    accountName: "Page A",
    accountUrl: "https://facebook.com/a",
    accessToken: "SECRET_PAGE_TOKEN",
    refreshToken: "SECRET_REFRESH",
    metadata: { pageId: "page-a", accessToken: "NESTED_SECRET", address: "1 Main St" },
  },
  {
    accountId: "page-b",
    accountName: "Page B",
    accountUrl: "https://facebook.com/b",
    accessToken: "SECRET_B",
    metadata: { type: "page" },
  },
];

const items = sanitizeEligibleForClient(eligible, ["page-a"]);
assert(items.length === 2, "returns all eligible accounts");
assert(items[0].alreadyConnected === true, "Page A marked already connected");
assert(items[1].alreadyConnected === false, "Page B marked available");
assert(!("accessToken" in items[0]), "accessToken stripped from client item");
assert(!("refreshToken" in items[0]), "refreshToken stripped from client item");
assert(JSON.stringify(items).indexOf("SECRET") === -1, "no secret strings in client payload");
assert(items[0].metadata.address === "1 Main St", "safe location metadata preserved");
assert(items[0].metadata.accessToken == null, "nested accessToken not exposed");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
