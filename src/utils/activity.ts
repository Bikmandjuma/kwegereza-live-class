import { prisma } from "./prisma.js";

export async function startSession(userId: string) {
  return prisma.session.create({ data: { userId } });
}

/**
 * Closes whichever session is currently open for this user (there should
 * only ever be one, but we defensively close all just in case a previous
 * logout was missed) and computes a REAL duration from the timestamps —
 * never an estimate, never a fabricated number.
 */
export async function endOpenSessions(userId: string) {
  const openSessions = await prisma.session.findMany({ where: { userId, endedAt: null } });
  const now = new Date();
  await Promise.all(
    openSessions.map((s) =>
      prisma.session.update({
        where: { id: s.id },
        data: {
          endedAt: now,
          durationSeconds: Math.max(0, Math.round((now.getTime() - s.startedAt.getTime()) / 1000)),
        },
      })
    )
  );
}

export async function heartbeatSession(userId: string) {
  const open = await prisma.session.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (open) {
    await prisma.session.update({ where: { id: open.id }, data: { lastHeartbeatAt: new Date() } });
    return true;
  }
  // No open session (e.g. server restarted mid-session) start a fresh one
  // rather than silently doing nothing, so time-tracking self-heals.
  await startSession(userId);
  return true;
}

export async function trackEvent(userId: string, type: string, meta: Record<string, unknown> = {}) {
  return prisma.activityEvent.create({ data: { userId, type, meta: JSON.stringify(meta) } });
}
