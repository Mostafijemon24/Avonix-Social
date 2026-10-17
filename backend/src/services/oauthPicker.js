/** Client-safe OAuth eligible-account projection (no tokens). */

export function publicEligibleMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  return {
    type: meta.type || null,
    // Whether this item is a real, publishable business location.
    publishable: meta.publishable === true,
    address: meta.address || null,
    phone: meta.phone || null,
    hours: meta.hours || null,
    locationName: meta.locationName || null,
    locationId: meta.locationId || meta.locationName || null,
    locationTitle: meta.locationTitle || null,
    storeCode: meta.storeCode || null,
    googleAccount: meta.googleAccount || null,
    googleAccountName: meta.googleAccountName || null,
    note: meta.note || null,
  };
}

export function sanitizeEligibleForClient(eligible, connectedIds) {
  const connected = new Set((connectedIds || []).map(String));
  return (eligible || []).map((item) => ({
    accountId: item.accountId,
    accountName: item.accountName,
    accountUrl: item.accountUrl || null,
    alreadyConnected: connected.has(String(item.accountId)),
    metadata: publicEligibleMeta(item.metadata),
  }));
}
