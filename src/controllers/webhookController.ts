import type { Request, Response } from "express";
import { webhookReceiver } from "../utils/livekit.js";
import { updateRecordingRemote } from "../utils/internalApi.js";

/**
 * The ONE place a recording's fileKey/size/duration ever get written.
 * This fires from LiveKit's OWN infrastructure once the egress worker
 * has actually finished uploading -- independent of whether this
 * service, or the host's device, were even still running at that point.
 * That independence is what makes "the host stopped the class abruptly"
 * safe: the egress job keeps running on LiveKit's side regardless, and
 * this webhook still arrives once it's genuinely done, updating the
 * same row classroom:start-recording created.
 *
 * Mounted with express.raw() in app.ts, BEFORE the global express.json()
 * -- signature verification needs the exact raw bytes LiveKit signed,
 * not a reserialized copy of a JSON-parsed object, which could differ
 * byte-for-byte even with identical field values.
 */
export async function handleLiveKitWebhook(req: Request, res: Response) {
  try {
    const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
    const authHeader = req.header("Authorization");
    const event = await webhookReceiver.receive(body, authHeader);

    if (event.event === "egress_ended" && event.egressInfo) {
      const info = event.egressInfo;
      const file = info.fileResults?.[0];
      const succeeded = info.status === 3; // EGRESS_COMPLETE, see livekit.ts's AUDIO_FILETYPE_OGG comment on why this is numeric
      await updateRecordingRemote(info.egressId, {
        status: succeeded ? "COMPLETE" : "FAILED",
        fileKey: file?.location ?? null,
        fileSizeBytes: file?.size != null ? file.size.toString() : undefined,
        // LiveKit's own int64 timestamp/duration fields across this
        // protocol package are Unix NANOSECONDS (confirmed convention
        // from LiveKit's own API docs, consistent across started_at/
        // ended_at/duration) -- not verified against a live payload in
        // this environment, since nothing here can actually run an
        // Egress job, so this is the best-grounded conversion available
        // rather than a runtime-confirmed one. Worth a real spot-check
        // against an actual webhook payload on first live use.
        durationSeconds: file?.duration != null ? Math.round(Number(file.duration) / 1_000_000_000) : undefined,
        endedAt: new Date().toISOString(),
      }).catch((err) => console.error("[webhook] failed to persist recording completion:", err));
    }

    res.status(200).json({ received: true });
  } catch (err) {
    // A bad signature or malformed payload is logged, not thrown back as
    // a 500 -- LiveKit retries failed webhooks, and a real verification
    // failure isn't something retrying fixes, it would just repeat the
    // same log line a few more times.
    console.error("[webhook] LiveKit webhook rejected:", err);
    res.status(200).json({ received: false });
  }
}
