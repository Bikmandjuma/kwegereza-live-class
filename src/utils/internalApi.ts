const BASE_URL = process.env.MAIN_API_INTERNAL_URL ?? "";
const SECRET = process.env.INTERNAL_API_SECRET ?? "";

if (!BASE_URL || !SECRET) {
  console.error(
    "[internalApi] MAIN_API_INTERNAL_URL and INTERNAL_API_SECRET must both be set -- this service has no database of its own and cannot function without them."
  );
}

class InternalApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/internal${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": SECRET,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new InternalApiError(res.status, json?.message ?? `Internal API call failed (${res.status})`);
  }
  return json?.data;
}

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  permissions: string;
  tokenVersion: number;
  gender: string | null;
}

/** Returns null for a 404 (user genuinely doesn't exist) so callers can
 * tell that apart from a transient network/5xx failure, which instead
 * throws -- an auth check that silently treated "the main API is
 * unreachable" the same as "this user doesn't exist" would be a real
 * security regression (every request would then just... let people in,
 * or lock everyone out, depending which way the catch defaulted). */
export async function getUserForAuth(userId: string): Promise<AuthUser | null> {
  try {
    return await call("GET", `/users/${userId}`);
  } catch (err) {
    if (err instanceof InternalApiError && err.status === 404) return null;
    throw err;
  }
}

// This service has no database of its own -- every "is this user still
// active" check (REST auth middleware AND the Socket.IO connection
// handler both need it) is now a network call to the main API. Shared
// here so both call paths hit the SAME cache rather than each keeping
// their own. Re-checking on literally every request/connection attempt
// would add real latency and load for no real security benefit beyond
// what a short cache already gives. 20 seconds is the trade-off: a
// block/suspend takes up to that long to actually take effect here
// instead of being instant, which is a real, deliberate change from how
// this worked with a direct database connection -- but still fast
// enough that it's not a meaningful window for someone to exploit a
// session that's actively being revoked.
const CACHE_TTL_MS = 20_000;
const userCache = new Map<string, { user: AuthUser; expiresAt: number }>();

export async function getUserForAuthCached(userId: string): Promise<AuthUser | null> {
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const user = await getUserForAuth(userId);
  if (user) userCache.set(userId, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  else userCache.delete(userId);
  return user;
}

export async function getActiveUserEmailsExcept(excludeUserId: string): Promise<string[]> {
  const result = await call("GET", `/active-user-emails?except=${encodeURIComponent(excludeUserId)}`);
  return result.emails;
}

export async function notifyAllActiveExcept(input: {
  excludeUserId: string;
  type: string;
  title: string;
  body: string;
  url?: string;
  eventKey: string;
}): Promise<{ createdCount: number }> {
  return call("POST", "/notify-all-active-except", input);
}

export async function trackActivity(userId: string, type: string, meta: Record<string, unknown> = {}): Promise<void> {
  await call("POST", "/activity/track", { userId, type, meta });
}

export async function createLiveClassRemote(input: {
  title: string;
  hostId: string;
  status: string;
  scheduledFor?: string | null;
  startedAt?: string | null;
}) {
  return call("POST", "/live-classes", input);
}

export async function getLiveClassRemote(id: string) {
  try {
    return await call("GET", `/live-classes/${id}`);
  } catch (err) {
    if (err instanceof InternalApiError && err.status === 404) return null;
    throw err;
  }
}

export async function listLiveClassesRemote(params: {
  status?: string;
  scheduledBefore?: string;
  scheduledAfter?: string;
}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.scheduledBefore) qs.set("scheduledBefore", params.scheduledBefore);
  if (params.scheduledAfter) qs.set("scheduledAfter", params.scheduledAfter);
  const query = qs.toString();
  return call("GET", `/live-classes${query ? `?${query}` : ""}`);
}

export async function updateLiveClassRemote(
  id: string,
  data: Partial<{ status: string; locked: boolean; scheduledFor: string | null; startedAt: string | null; endedAt: string | null }>
) {
  return call("PATCH", `/live-classes/${id}`, data);
}

export async function deleteLiveClassRemote(id: string): Promise<void> {
  await call("DELETE", `/live-classes/${id}`);
}

export async function createAttendanceRemote(liveClassId: string, userId: string): Promise<void> {
  await call("POST", "/live-class-attendance", { liveClassId, userId });
}

export async function closeAttendanceRemote(input: {
  liveClassId: string;
  userId?: string;
  userIds?: string[];
}): Promise<{ count: number }> {
  return call("PATCH", "/live-class-attendance/close", input);
}
