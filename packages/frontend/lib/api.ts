const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface Session {
  user: { id: string; email: string; name: string };
  organizations: Array<{ id: string; name: string; role: string }>;
}

/**
 * Server components can't rely on the browser to attach the httpOnly
 * session cookie to cross-origin fetches (frontend :3000 -> backend :4000)
 * — the incoming request's Cookie header has to be forwarded explicitly.
 */
export async function getSession(cookieHeader: string): Promise<Session | null> {
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export interface ContentWithAssets {
  id: string;
  title: string | null;
  hook: string | null;
  topic: string | null;
  status: string;
  type: string;
  updatedAt: string;
  assets: Array<{ id: string; type: string; url: string; provider: string | null }>;
}

export async function fetchContentList(
  cookieHeader: string,
  organizationId: string,
  brandId?: string,
): Promise<ContentWithAssets[]> {
  const url = new URL(`${API_URL}/api/content`);
  if (brandId) url.searchParams.set("brandId", brandId);
  const res = await fetch(url.toString(), {
    headers: { Cookie: cookieHeader, "X-Organization-Id": organizationId },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load content: ${res.status}`);
  return res.json();
}

export interface AnalyticsOverview {
  insufficientData: boolean;
  totals: { views: number; leads: number; sales: number; revenue: number } | null;
  topContent: Array<{
    contentId: string;
    title: string | null;
    hook: string | null;
    score: number;
    breakdown: Record<string, number>;
  }>;
}

/**
 * Every call requires the JWT + X-Organization-Id headers, mirroring the
 * backend's multi-tenant auth model (middleware/auth.ts + rbac.ts).
 */
export async function fetchAnalyticsOverview(
  token: string,
  organizationId: string,
  brandId?: string,
): Promise<AnalyticsOverview> {
  const url = new URL(`${API_URL}/api/analytics/overview`);
  if (brandId) url.searchParams.set("brandId", brandId);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-Id": organizationId,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to load analytics overview: ${res.status}`);
  }
  return res.json();
}
