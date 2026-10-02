import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { sendError, sendResponse } from "../utils/apiResponse.js";
import { endLiveClass } from "../realtime/liveClass.js";
import { getIo } from "../realtime/ioInstance.js";
import {
  createLiveClassRemote,
  deleteLiveClassRemote,
  getActiveUserEmailsExcept,
  getLiveClassRemote,
  listLiveClassesRemote,
  notifyAllActiveExcept,
  updateLiveClassRemote,
} from "../utils/internalApi.js";
import { isAdminTier } from "../utils/permissions.js";
import { sendEmailBatch, getFrontendUrl } from "../utils/email.js";
import { liveClassEmail } from "../utils/emailTemplates.js";

// The internal API already returns this exact shape (hostName included
// directly, not nested under a host object) -- this wrapper exists so
// every call site here stays stable if that shape ever needs to change,
// not because any remapping happens today.
function publicClass(c: any) {
  return {
    id: c.id,
    title: c.title,
    hostId: c.hostId,
    hostName: c.hostName,
    status: c.status,
    locked: c.locked,
    scheduledFor: c.scheduledFor,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
  };
}

// Broadcasting "it's live" is identical whether the class went live
// immediately or was a scheduled one just started one shared code path so
// the realtime emit + notification fan-out can never drift between the two.
async function announceLive(liveClass: any, hostId: string) {
  getIo()?.emit("liveclass:started", publicClass(liveClass));
  await notifyAllActiveExcept({
    excludeUserId: hostId,
    type: "liveclass.started",
    title: "Isomo riri live!",
    body: liveClass.title,
    url: `/live-class/${liveClass.id}`,
    eventKey: `liveclass-started-${liveClass.id}`,
  });

  // Same "every active user except the host, and status=ACTIVE already
  // excludes blocked/pending/suspended/rejected accounts" audience as the
  // in-app/push notification above email is a separate channel, not a
  // separate audience rule. Fire-and-forget: a slow or failed email batch
  // must never delay the class actually going live for everyone already
  // connected via the realtime event.
  getActiveUserEmailsExcept(hostId)
    .then((emails) => {
      const hostName = liveClass.hostName ?? "Umuyobozi";
      const joinUrl = `${getFrontendUrl()}/live-class/${liveClass.id}`;
      return sendEmailBatch(emails, (to) => ({ to, ...liveClassEmail(liveClass.title, hostName, joinUrl) }));
    })
    .catch((err) => console.error("[liveClassController] live-class email batch failed:", err));
}

export const createLiveClass = asyncHandler(async (req: Request, res: Response) => {
  const { title, scheduledFor } = req.body ?? {};
  if (!title?.trim()) {
    sendError(res, 422, "Uzuza umutwe w'isomo.");
    return;
  }

  let scheduledDate: Date | null = null;
  if (scheduledFor) {
    scheduledDate = new Date(scheduledFor);
    if (Number.isNaN(scheduledDate.getTime())) {
      sendError(res, 422, "Itariki/igihe cyatanzwe ntibisobanutse.");
      return;
    }
  }

  // A schedule time in the past (or omitted) means "start right now" —
  // exactly today's existing behavior. A future time books it instead.
  const isImmediate = !scheduledDate || scheduledDate.getTime() <= Date.now();

  const liveClass = await createLiveClassRemote({
    title: title.trim(),
    hostId: req.user!.id,
    status: isImmediate ? "LIVE" : "SCHEDULED",
    scheduledFor: isImmediate ? null : scheduledDate!.toISOString(),
    startedAt: isImmediate ? new Date().toISOString() : null,
  });

  if (isImmediate) {
    await announceLive(liveClass, req.user!.id);
    sendResponse(res, 201, { liveClass: publicClass(liveClass) }, "Isomo ritangiye.");
  } else {
    // A newly SCHEDULED (not yet live) class gets its own, separate
    // notification -- "a class has been booked for you" is a genuinely
    // different event from "it's live right now", and someone who missed
    // the booking announcement should still get the liveclass.started
    // one later when it actually starts.
    await notifyAllActiveExcept({
      excludeUserId: req.user!.id,
      type: "liveclass.scheduled",
      title: "Isomo rishya ryateganyijwe",
      body: `${liveClass.title} — ${scheduledDate!.toLocaleString("rw-RW")}`,
      url: `/live-class/${liveClass.id}`,
      eventKey: `liveclass-scheduled-${liveClass.id}`,
    });
    sendResponse(res, 201, { liveClass: publicClass(liveClass) }, "Isomo ryateganyijwe.");
  }
});

// Host manually flips a SCHEDULED class to LIVE when its time comes (or
// early, if they want to start ahead of schedule) the class can't truly
// go live without the host's own browser/mic present, so this is a
// deliberate action rather than an automatic server-side timer.
export const startScheduledLiveClass = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const liveClass = await getLiveClassRemote(id);
  if (!liveClass) {
    sendError(res, 404, "Isomo ntaboneka.");
    return;
  }
  if (liveClass.hostId !== req.user!.id && !isAdminTier(req.user!.role)) {
    sendError(res, 403, "Gusa uwateganyije isomo cyangwa admin ni bo bashobora kuritangira.");
    return;
  }
  if (liveClass.status !== "SCHEDULED") {
    sendError(res, 422, "Iri somo ntabwo riri gutegereza gutangira.");
    return;
  }

  const updated = await updateLiveClassRemote(id, { status: "LIVE", startedAt: new Date().toISOString() });

  await announceLive(updated, liveClass.hostId);
  sendResponse(res, 200, { liveClass: publicClass(updated) }, "Isomo ritangiye.");
});

export const listActiveLiveClasses = asyncHandler(async (_req: Request, res: Response) => {
  const classes = await listLiveClassesRemote({ status: "LIVE" });
  sendResponse(res, 200, classes.map(publicClass));
});

/**
 * A deliberately minimal, genuinely PUBLIC (no authenticate) endpoint --
 * just "is anything live right now", no title/host/join-link. Backs the
 * guest-facing alert icon on the public navbar: a guest has no
 * authenticated socket to receive the realtime "a class started" push
 * the way a logged-in user does, so this is a lightweight poll instead.
 * Full class details stay behind login, same as before this never
 * leaks more than a boolean/count.
 */
export const getPublicLiveClassStatus = asyncHandler(async (_req: Request, res: Response) => {
  const classes = await listLiveClassesRemote({ status: "LIVE" });
  sendResponse(res, 200, { active: classes.length > 0, count: classes.length });
});

// Upcoming = booked for a future time and not started yet. Ordered soonest
// first so "starts in 3h" always sits above "starts in 2 days".
export const listUpcomingLiveClasses = asyncHandler(async (_req: Request, res: Response) => {
  const classes = await listLiveClassesRemote({ status: "SCHEDULED" });
  sendResponse(res, 200, classes.slice(0, 50).map(publicClass));
});

// Backs the shareable class link (/live-class/:id): lets someone who opens
// that link see what the class is and when it starts, whether or not
// they're already a participant read-only, no join side effects.
export const getLiveClass = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const liveClass = await getLiveClassRemote(id);
  if (!liveClass) {
    sendError(res, 404, "Isomo ntaboneka.");
    return;
  }
  sendResponse(res, 200, { liveClass: publicClass(liveClass) });
});

export const endLiveClassRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const liveClass = await getLiveClassRemote(id);
  if (!liveClass) {
    sendError(res, 404, "Isomo ntaboneka.");
    return;
  }
  if (liveClass.hostId !== req.user!.id && !isAdminTier(req.user!.role)) {
    sendError(res, 403, "Gusa uwatangiye isomo cyangwa admin ni bo bashobora kurihagarika.");
    return;
  }
  if (liveClass.status !== "LIVE") {
    sendError(res, 422, "Iri somo ntabwo ririmo gukorwa (live) ubu.");
    return;
  }

  const io = getIo();
  const updated = await endLiveClass(io, id);
  sendResponse(res, 200, { liveClass: publicClass(updated) }, "Isomo ryarangiye.");
});

/**
 * Removes a class that's no longer needed a SCHEDULED booking that
 * won't happen after all, or an ENDED one someone wants off their list.
 * Deliberately excludes LIVE: a class currently in progress should be
 * ended (endLiveClassRoute above), never deleted out from under whoever's
 * still in it. Same host-or-admin ownership rule as ending a class.
 * Attendance cleanup happens on the main API's side of this call (see
 * deleteLiveClassInternal), in the same transaction as the class delete
 * itself, so this never fails on a foreign-key constraint for any class
 * that ever had a single attendee.
 */
export const deleteLiveClassRoute = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const liveClass = await getLiveClassRemote(id);
  if (!liveClass) {
    sendError(res, 404, "Isomo ntaboneka.");
    return;
  }
  if (liveClass.hostId !== req.user!.id && !isAdminTier(req.user!.role)) {
    sendError(res, 403, "Gusa uwatangiye isomo cyangwa admin ni bo bashobora kuriviraho.");
    return;
  }
  if (liveClass.status === "LIVE") {
    sendError(res, 422, "Ntushobora gusiba isomo riri kuba (live) ubu rihagarike mbere.");
    return;
  }

  await deleteLiveClassRemote(id);

  sendResponse(res, 200, null, "Isomo ryavanyweho.");
});
