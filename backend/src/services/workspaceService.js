/**
 * Multi-client workspaces for agency accounts
 */
import prisma from "../db.js";
import { isFullyVerified } from "./verifyService.js";

const PLAN_WORKSPACE_LIMITS = {
  free: 1,
  pro: 10,
  agency: 100,
};

async function requireVerifiedUser(email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized) return { ok: false, status: 400, error: "Email is required" };
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: { package: true },
  });
  if (!user) return { ok: false, status: 404, error: "User not found" };
  if (!isFullyVerified(user)) {
    return { ok: false, status: 403, error: "Verification required" };
  }
  return { ok: true, user };
}

function workspaceLimit(user) {
  if (user.unlimitedCredits) return 100;
  const slug = user.package?.slug || "free";
  return PLAN_WORKSPACE_LIMITS[slug] ?? 1;
}

function parseSecondary(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export function publicWorkspace(row, activeId) {
  const secondary = parseSecondary(row.secondaryKeywords);
  const hasSitemap = !!(row.primaryKeyword && row.sitemapParsedAt);
  return {
    id: row.id,
    name: row.name,
    websiteUrl: row.websiteUrl,
    domain: row.domain,
    notes: row.notes,
    isActive: row.id === activeId,
    sitemap: hasSitemap
      ? {
          url: row.sitemapUrl || row.websiteUrl || "",
          primaryKeyword: row.primaryKeyword || "",
          secondaryKeywords: secondary,
          location: row.location || "",
          address: row.address || "",
          urlCount: row.sitemapUrlCount || 0,
          parsedAt: row.sitemapParsedAt?.toISOString?.() || String(row.sitemapParsedAt),
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Ensure every user has at least one workspace; migrate orphan connections */
export async function ensureDefaultWorkspace(userId, fallbackName) {
  let workspaces = await prisma.clientWorkspace.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  if (!workspaces.length) {
    const name =
      String(fallbackName || "").trim() ||
      "My Business";
    const created = await prisma.clientWorkspace.create({
      data: { userId, name },
    });
    workspaces = [created];
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  let activeId = user?.activeWorkspaceId;
  if (!activeId || !workspaces.some((w) => w.id === activeId)) {
    activeId = workspaces[0].id;
    await prisma.user.update({
      where: { id: userId },
      data: { activeWorkspaceId: activeId },
    });
  }

  // Attach orphan connections (pre-workspace era) to active workspace
  await prisma.connectedAccount.updateMany({
    where: { userId, workspaceId: null },
    data: { workspaceId: activeId },
  });

  return { workspaces, activeId };
}

export async function listWorkspaces(email) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const { workspaces, activeId } = await ensureDefaultWorkspace(
    gate.user.id,
    gate.user.company || gate.user.name
  );

  return {
    ok: true,
    activeWorkspaceId: activeId,
    limit: workspaceLimit(gate.user),
    workspaces: workspaces.map((w) => publicWorkspace(w, activeId)),
  };
}

export async function createWorkspace({ email, name, websiteUrl, notes }) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const limit = workspaceLimit(gate.user);
  const count = await prisma.clientWorkspace.count({ where: { userId: gate.user.id } });
  if (count >= limit) {
    return {
      ok: false,
      status: 403,
      error: `Workspace limit reached (${limit}). Upgrade your plan to add more clients.`,
      limit,
      count,
    };
  }

  const cleanName = String(name || "").trim();
  if (!cleanName) return { ok: false, status: 400, error: "Client name is required" };

  let domain = null;
  let site = String(websiteUrl || "").trim() || null;
  if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`;
  if (site) {
    try {
      domain = new URL(site).hostname.replace(/^www\./, "");
    } catch {
      domain = null;
    }
  }

  const row = await prisma.clientWorkspace.create({
    data: {
      userId: gate.user.id,
      name: cleanName,
      websiteUrl: site,
      domain,
      notes: String(notes || "").trim() || null,
    },
  });

  await prisma.user.update({
    where: { id: gate.user.id },
    data: { activeWorkspaceId: row.id },
  });

  return {
    ok: true,
    workspace: publicWorkspace(row, row.id),
    activeWorkspaceId: row.id,
  };
}

export async function updateWorkspace({ email, workspaceId, name, websiteUrl, notes }) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const row = await prisma.clientWorkspace.findFirst({
    where: { id: workspaceId, userId: gate.user.id },
  });
  if (!row) return { ok: false, status: 404, error: "Workspace not found" };

  const data = {};
  if (name !== undefined) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return { ok: false, status: 400, error: "Client name is required" };
    data.name = cleanName;
  }
  if (websiteUrl !== undefined) {
    let site = String(websiteUrl || "").trim() || null;
    if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`;
    data.websiteUrl = site;
    data.domain = null;
    if (site) {
      try {
        data.domain = new URL(site).hostname.replace(/^www\./, "");
      } catch {
        data.domain = null;
      }
    }
  }
  if (notes !== undefined) data.notes = String(notes || "").trim() || null;

  const updated = await prisma.clientWorkspace.update({
    where: { id: row.id },
    data,
  });

  return {
    ok: true,
    workspace: publicWorkspace(updated, gate.user.activeWorkspaceId),
  };
}

export async function deleteWorkspace({ email, workspaceId }) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const count = await prisma.clientWorkspace.count({ where: { userId: gate.user.id } });
  if (count <= 1) {
    return { ok: false, status: 400, error: "You must keep at least one client workspace" };
  }

  const row = await prisma.clientWorkspace.findFirst({
    where: { id: workspaceId, userId: gate.user.id },
  });
  if (!row) return { ok: false, status: 404, error: "Workspace not found" };

  await prisma.clientWorkspace.delete({ where: { id: row.id } });

  let activeId = gate.user.activeWorkspaceId;
  if (activeId === row.id) {
    const next = await prisma.clientWorkspace.findFirst({
      where: { userId: gate.user.id },
      orderBy: { createdAt: "asc" },
    });
    activeId = next?.id || null;
    await prisma.user.update({
      where: { id: gate.user.id },
      data: { activeWorkspaceId: activeId },
    });
  }

  return { ok: true, activeWorkspaceId: activeId };
}

export async function activateWorkspace({ email, workspaceId }) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const row = await prisma.clientWorkspace.findFirst({
    where: { id: workspaceId, userId: gate.user.id },
  });
  if (!row) return { ok: false, status: 404, error: "Workspace not found" };

  await prisma.user.update({
    where: { id: gate.user.id },
    data: { activeWorkspaceId: row.id },
  });

  return { ok: true, workspace: publicWorkspace(row, row.id), activeWorkspaceId: row.id };
}

export async function saveWorkspaceSitemap({ email, workspaceId, sitemap }) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const id = workspaceId || gate.user.activeWorkspaceId;
  let row = id
    ? await prisma.clientWorkspace.findFirst({ where: { id, userId: gate.user.id } })
    : null;

  if (!row) {
    const ensured = await ensureDefaultWorkspace(
      gate.user.id,
      gate.user.company || gate.user.name
    );
    row = ensured.workspaces.find((w) => w.id === ensured.activeId);
  }
  if (!row) return { ok: false, status: 404, error: "Workspace not found" };

  const secondary = Array.isArray(sitemap?.secondaryKeywords)
    ? sitemap.secondaryKeywords
    : String(sitemap?.secondaryKeywords || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  const updated = await prisma.clientWorkspace.update({
    where: { id: row.id },
    data: {
      primaryKeyword: sitemap?.primaryKeyword || null,
      secondaryKeywords: JSON.stringify(secondary),
      location: sitemap?.location || null,
      address: sitemap?.address || null,
      sitemapUrl: sitemap?.url || null,
      sitemapUrlCount: Number(sitemap?.urlCount) || 0,
      sitemapParsedAt: sitemap?.parsedAt ? new Date(sitemap.parsedAt) : new Date(),
      websiteUrl: sitemap?.url || row.websiteUrl,
      domain: (() => {
        try {
          return sitemap?.url
            ? new URL(sitemap.url.startsWith("http") ? sitemap.url : `https://${sitemap.url}`)
                .hostname.replace(/^www\./, "")
            : row.domain;
        } catch {
          return row.domain;
        }
      })(),
    },
  });

  // Make this workspace active when sitemap is saved
  await prisma.user.update({
    where: { id: gate.user.id },
    data: { activeWorkspaceId: updated.id },
  });

  return {
    ok: true,
    workspace: publicWorkspace(updated, updated.id),
    activeWorkspaceId: updated.id,
  };
}

export async function resolveActiveWorkspace(user) {
  const { workspaces, activeId } = await ensureDefaultWorkspace(
    user.id,
    user.company || user.name
  );
  const active = workspaces.find((w) => w.id === activeId) || workspaces[0];
  return { workspace: active, activeId };
}
