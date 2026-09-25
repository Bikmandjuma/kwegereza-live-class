import { prisma } from "./prisma.js";
import { sendPushToUser } from "./webPush.js";
import { getIo } from "../realtime/ioInstance.js";

// The configurable categories a user can silence from Notification Center
// preferences. ACCOUNT and SYSTEM notification types are NOT in this map on
// purpose categoryForType() returns null for them, and null always fires,
// which is exactly how "critical account/security notifications can't be
// disabled" is enforced.
const TYPE_CATEGORY_PREFIXES: Array<[string, string]> = [
  ["chat.", "CHAT"],
  ["dars.", "DARS"],
  ["ifaida.", "ifaida"],
  ["liveclass.", "LIVE_CLASS"],
  ["book.", "BOOKS"],
  ["exam.", "EXAMS"],
  ["announcement.", "ANNOUNCEMENTS"],
];

export function categoryForType(type: string): string | null {
  const hit = TYPE_CATEGORY_PREFIXES.find(([prefix]) => type.startsWith(prefix));
  return hit ? hit[1] : null; // null = ACCOUNT/SYSTEM/uncategorized = always on
}

export const CONFIGURABLE_CATEGORIES = TYPE_CATEGORY_PREFIXES.map(([, c]) => c);

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  url?: string;
  // Unique per real-world event. Reusing the same key for the same user is
  // exactly how "one event = one notification" is enforced see the DB's
  // @@unique([userId, eventKey]) constraint on the Notification model.
  eventKey: string;
}

/**
 * The one and only path that creates a notification anywhere in the system.
 * Every feature (approval, chat, live class) calls this instead of writing
 * its own ad-hoc "create + emit + push" logic, so the dedup guarantee and
 * the in-app/push fan-out only need to be correct in one place.
 */
export async function notifyUser(input: NotifyInput): Promise<{ created: boolean }> {
  const category = categoryForType(input.type);

  // Category null (ACCOUNT/SYSTEM) always fires no preference lookup, no
  // way to opt out, per spec. Otherwise, respect the user's saved choice;
  // absence of a row means "on" (default subscribed).
  let enabled = true;
  let pushAllowed = true;
  if (category) {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_category: { userId: input.userId, category } },
    });
    if (pref) {
      enabled = pref.enabled;
      pushAllowed = pref.push;
    }
  }
  if (!enabled) return { created: false };

  let notification;
  let created = true;

  try {
    notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        url: input.url ?? null,
        eventKey: input.eventKey,
      },
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      // Same event already notified this user this is a duplicate dispatch
      // attempt (retry, duplicate call site), not a new occurrence. Return
      // the existing row and do NOT re-broadcast or re-push.
      created = false;
      notification = await prisma.notification.findUnique({
        where: { userId_eventKey: { userId: input.userId, eventKey: input.eventKey } },
      });
    } else {
      throw err;
    }
  }

  if (created && notification) {
    // In-app realtime delivery (drives the top banner + bell badge live).
    getIo()?.to(`user:${input.userId}`).emit("notification:new", notification);
    // Real browser push reaches the user even if the app/tab isn't open.
    // Fire-and-forget: a slow/failed push should never block the request
    // that triggered the notification (e.g. an approval action).
    if (pushAllowed) {
      sendPushToUser(input.userId, {
        title: input.title,
        body: input.body,
        url: input.url,
      }).catch((err) => console.error("[notify] push dispatch failed:", err));
    }
  }

  return { created };
}

/**
 * Convenience for events that should reach every currently-ACTIVE user
 * except one (e.g. everyone except the host when a class goes live).
 */
export async function notifyAllActiveUsersExcept(
  excludeUserId: string,
  build: (userId: string) => NotifyInput
) {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", id: { not: excludeUserId } },
    select: { id: true },
  });
  await Promise.all(users.map((u) => notifyUser(build(u.id))));
}
