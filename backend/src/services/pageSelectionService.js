/**
 * Persistent Sitemap / Pages Selection.
 *
 * Stores the analysed page inventory and the user's page/service selection so
 * it survives refreshes, re-login and worker restarts, and so downstream
 * content generation can be enforced server-side against real, authorised
 * pages — never arbitrary client-supplied URLs.
 *
 * Scope key for every row: (userId, workspaceId, websiteOrigin). workspaceId
 * is coalesced to "" so the DB uniqueness constraint always applies.
 */
import prisma from "../db.js";

const DEFAULT_SELECT_LIMIT = Number(process.env.STUDIO_MAX_GENERATE_PAGES || 15);

/** Normalise a scope so reads and writes always target the same partition. */
export function selectionScope({ userId, workspaceId, websiteOrigin }) {
  return {
    userId: String(userId),
    workspaceId: workspaceId ? String(workspaceId) : "",
    websiteOrigin: String(websiteOrigin),
  };
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Upsert the full inventory for one website after analysis. Existing selection
 * is PRESERVED for pages/services that still exist. Pages that disappeared from
 * the site are removed. Brand-new inventories auto-select the top N pages (same
 * convenience the UI used) and all detected services.
 *
 * @returns the persisted selection snapshot (same shape as getSelection).
 */
export async function persistInventory({
  userId,
  workspaceId,
  websiteOrigin,
  pages = [],
  services = [],
  failed = [],
  excluded = [],
}) {
  const scope = selectionScope({ userId, workspaceId, websiteOrigin });

  // Does a prior inventory exist? If so we must preserve the user's choices.
  const priorCount = await prisma.websitePage.count({ where: scope });
  const isFirstAnalysis = priorCount === 0;

  // Build the new page set (analysed successes + failed + excluded) keyed by url.
  const pageRows = new Map();
  pages.forEach((p, idx) => {
    const url = p.url;
    if (!url || pageRows.has(url)) return;
    pageRows.set(url, {
      url,
      title: p.title || "",
      pageType: p.pageType || "",
      writingIntent: p.writingIntent || "",
      areaCoverage: p.areaCoverage || "",
      primaryKeyword: p.keywords?.primary || "",
      secondaryKeywords: JSON.stringify(
        Array.isArray(p.keywords?.secondary) ? p.keywords.secondary : []
      ),
      reachable: p.reachable !== false,
      status: "analyzed",
      // auto-select the top N on first analysis only
      autoSelect: isFirstAnalysis && idx < DEFAULT_SELECT_LIMIT,
    });
  });
  for (const f of failed) {
    if (f?.url && !pageRows.has(f.url)) {
      pageRows.set(f.url, {
        url: f.url,
        title: "",
        pageType: "",
        writingIntent: "",
        areaCoverage: "",
        primaryKeyword: "",
        secondaryKeywords: "[]",
        reachable: false,
        status: "failed",
        autoSelect: false,
      });
    }
  }
  for (const e of excluded) {
    if (e?.url && !pageRows.has(e.url)) {
      pageRows.set(e.url, {
        url: e.url,
        title: "",
        pageType: "",
        writingIntent: "",
        areaCoverage: "",
        primaryKeyword: "",
        secondaryKeywords: "[]",
        reachable: false,
        status: "excluded",
        autoSelect: false,
      });
    }
  }

  const existing = await prisma.websitePage.findMany({
    where: scope,
    select: { url: true, selected: true },
  });
  const prevSelected = new Map(existing.map((r) => [r.url, r.selected]));
  const newUrls = new Set(pageRows.keys());

  const serviceRows = services
    .filter((s) => s?.name)
    .map((s) => ({
      name: s.name,
      pages: JSON.stringify(Array.isArray(s.pages) ? s.pages : []),
      pageCount: Number(s.pageCount) || (Array.isArray(s.pages) ? s.pages.length : 0),
    }));
  const existingServices = await prisma.websiteService.findMany({
    where: scope,
    select: { name: true, selected: true },
  });
  const prevServiceSel = new Map(existingServices.map((r) => [r.name, r.selected]));
  const newServiceNames = new Set(serviceRows.map((s) => s.name));

  await prisma.$transaction(async (tx) => {
    // Remove pages/services that no longer exist on the site.
    const staleUrls = existing.map((r) => r.url).filter((u) => !newUrls.has(u));
    if (staleUrls.length) {
      await tx.websitePage.deleteMany({ where: { ...scope, url: { in: staleUrls } } });
    }
    const staleServices = existingServices
      .map((r) => r.name)
      .filter((n) => !newServiceNames.has(n));
    if (staleServices.length) {
      await tx.websiteService.deleteMany({ where: { ...scope, name: { in: staleServices } } });
    }

    for (const row of pageRows.values()) {
      const keepSelected = prevSelected.has(row.url)
        ? prevSelected.get(row.url)
        : row.autoSelect;
      const selectable = row.status === "analyzed" && row.reachable;
      const selected = selectable ? keepSelected : false;
      await tx.websitePage.upsert({
        where: {
          userId_workspaceId_websiteOrigin_url: { ...scope, url: row.url },
        },
        create: {
          ...scope,
          url: row.url,
          title: row.title,
          pageType: row.pageType,
          writingIntent: row.writingIntent,
          areaCoverage: row.areaCoverage,
          primaryKeyword: row.primaryKeyword,
          secondaryKeywords: row.secondaryKeywords,
          reachable: row.reachable,
          status: row.status,
          selected,
          selectedAt: selected ? new Date() : null,
          analyzedAt: new Date(),
        },
        update: {
          title: row.title,
          pageType: row.pageType,
          writingIntent: row.writingIntent,
          areaCoverage: row.areaCoverage,
          primaryKeyword: row.primaryKeyword,
          secondaryKeywords: row.secondaryKeywords,
          reachable: row.reachable,
          status: row.status,
          selected,
          analyzedAt: new Date(),
        },
      });
    }

    for (const svc of serviceRows) {
      const keep = prevServiceSel.has(svc.name) ? prevServiceSel.get(svc.name) : true;
      await tx.websiteService.upsert({
        where: {
          userId_workspaceId_websiteOrigin_name: { ...scope, name: svc.name },
        },
        create: {
          ...scope,
          name: svc.name,
          pages: svc.pages,
          pageCount: svc.pageCount,
          selected: keep,
          selectedAt: keep ? new Date() : null,
        },
        update: { pages: svc.pages, pageCount: svc.pageCount, selected: keep },
      });
    }
  });

  return getSelection(scope);
}

/** Read the persisted inventory + selection snapshot for one website. */
export async function getSelection({ userId, workspaceId, websiteOrigin }) {
  const scope = selectionScope({ userId, workspaceId, websiteOrigin });
  const [pages, services] = await Promise.all([
    prisma.websitePage.findMany({ where: scope, orderBy: { createdAt: "asc" } }),
    prisma.websiteService.findMany({ where: scope, orderBy: { pageCount: "desc" } }),
  ]);

  const analyzed = pages.filter((p) => p.status === "analyzed");
  const selectedPages = analyzed.filter((p) => p.selected);
  return {
    ok: true,
    websiteOrigin: scope.websiteOrigin,
    workspaceId: scope.workspaceId,
    counts: {
      total: pages.length,
      analyzed: analyzed.length,
      failed: pages.filter((p) => p.status === "failed").length,
      excluded: pages.filter((p) => p.status === "excluded").length,
      selected: selectedPages.length,
    },
    pages: pages.map(publicPage),
    services: services.map(publicService),
  };
}

function publicPage(p) {
  return {
    id: p.id,
    url: p.url,
    title: p.title,
    pageType: p.pageType,
    writingIntent: p.writingIntent,
    areaCoverage: p.areaCoverage,
    reachable: p.reachable,
    status: p.status,
    selected: p.selected,
    keywords: {
      primary: p.primaryKeyword,
      secondary: parseJsonArray(p.secondaryKeywords),
    },
  };
}

function publicService(s) {
  return {
    id: s.id,
    name: s.name,
    pages: parseJsonArray(s.pages),
    pageCount: s.pageCount,
    selected: s.selected,
  };
}

/**
 * Persist a user's page/service selection. Validates every supplied URL/name
 * against the stored inventory and rejects anything that is not a real,
 * eligible page for this scope (defeats stale state / manipulated requests).
 *
 * @param {string[]} [opts.selectedUrls] desired selected page URLs
 * @param {string[]} [opts.selectedServices] desired selected service names
 */
export async function saveSelection({
  userId,
  workspaceId,
  websiteOrigin,
  selectedUrls,
  selectedServices,
}) {
  const scope = selectionScope({ userId, workspaceId, websiteOrigin });

  const inventory = await prisma.websitePage.findMany({
    where: scope,
    select: { url: true, status: true, reachable: true },
  });
  if (!inventory.length) {
    return { ok: false, status: 404, error: "No analyzed inventory for this website yet." };
  }

  const eligible = new Set(
    inventory.filter((p) => p.status === "analyzed" && p.reachable).map((p) => p.url)
  );

  let result = { pagesUpdated: 0, servicesUpdated: 0, rejected: [] };

  await prisma.$transaction(async (tx) => {
    if (Array.isArray(selectedUrls)) {
      const want = new Set();
      for (const raw of selectedUrls) {
        const u = String(raw || "");
        if (eligible.has(u)) want.add(u);
        else result.rejected.push(u);
      }
      // Select the wanted pages, deselect everything else — one scope-wide pass.
      await tx.websitePage.updateMany({
        where: { ...scope, url: { in: [...want] } },
        data: { selected: true, selectedAt: new Date() },
      });
      await tx.websitePage.updateMany({
        where: { ...scope, url: { notIn: [...want] } },
        data: { selected: false, selectedAt: null },
      });
      result.pagesUpdated = want.size;
    }

    if (Array.isArray(selectedServices)) {
      const names = await tx.websiteService.findMany({
        where: scope,
        select: { name: true },
      });
      const known = new Set(names.map((n) => n.name));
      const want = new Set();
      for (const raw of selectedServices) {
        const n = String(raw || "");
        if (known.has(n)) want.add(n);
        else result.rejected.push(n);
      }
      await tx.websiteService.updateMany({
        where: { ...scope, name: { in: [...want] } },
        data: { selected: true, selectedAt: new Date() },
      });
      await tx.websiteService.updateMany({
        where: { ...scope, name: { notIn: [...want] } },
        data: { selected: false, selectedAt: null },
      });
      result.servicesUpdated = want.size;
    }
  });

  const snapshot = await getSelection(scope);
  return { ok: true, ...result, selection: snapshot };
}

/**
 * Downstream enforcement helper. Returns the authoritative set of selected,
 * eligible page URLs + selected service names for a scope, or null when no
 * inventory exists (legacy / manual-URL flows are left untouched).
 */
export async function getSelectedForGeneration({ userId, workspaceId, websiteOrigin }) {
  const scope = selectionScope({ userId, workspaceId, websiteOrigin });
  const count = await prisma.websitePage.count({ where: scope });
  if (count === 0) return null; // no persisted inventory — do not enforce

  const [pages, services] = await Promise.all([
    prisma.websitePage.findMany({
      where: { ...scope, selected: true, status: "analyzed", reachable: true },
      select: { url: true },
    }),
    prisma.websiteService.findMany({
      where: { ...scope, selected: true },
      select: { name: true },
    }),
  ]);
  return {
    urls: new Set(pages.map((p) => p.url)),
    serviceNames: new Set(services.map((s) => s.name.toLowerCase())),
  };
}
