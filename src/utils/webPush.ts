import webpush from "web-push";
import { prisma } from "./prisma.js";

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  console.warn("[push] VAPID keys not set browser push notifications are disabled.");
}

export function getVapidPublicKey(): string | null {
  return publicKey ?? null;
}

/**
 * Sends a real Web Push message to every device this user has subscribed
 * from. Never fakes success if VAPID isn't configured, or the user has no
 * subscriptions, it does nothing and says so. Expired/invalid subscriptions
 * (the push service returns 404/410) are cleaned up automatically so they
 * don't keep failing silently forever.
 */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<{ sent: number; removed: number }> {
  if (!publicKey || !privateKey) return { sent: 0, removed: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  let removed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          removed++;
        } else {
          console.error("[push] send failed:", err.statusCode, err.body);
        }
      }
    })
  );

  return { sent, removed };
}
