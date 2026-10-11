import { AccessToken, EgressClient, RoomServiceClient, WebhookReceiver } from "livekit-server-sdk";
import type { ParticipantPermission, TrackSource } from "livekit-server-sdk";
import { EncodedFileOutput, S3Upload } from "@livekit/protocol";

const apiKey = process.env.LIVEKIT_API_KEY ?? "";
const apiSecret = process.env.LIVEKIT_API_SECRET ?? "";
// The LiveKit SERVER's own URL (http/https, not the wss:// one the
// BROWSER connects to) -- RoomServiceClient talks to LiveKit's REST API
// directly, server-to-server, completely separately from any client
// ever connecting. Falls back to deriving it from LIVEKIT_URL (the
// wss:// one) if a dedicated host isn't set, since that's the common
// case: same LiveKit server, same host, different scheme.
const livekitHost =
  process.env.LIVEKIT_API_HOST ?? (process.env.LIVEKIT_URL ?? "").replace(/^wss:/, "https:").replace(/^ws:/, "http:");

if (!apiKey || !apiSecret || !livekitHost) {
  // Fails loudly at import time (i.e. at boot) rather than on the first
  // real request -- a misconfigured LiveKit connection should never be
  // discovered only when a student's class fails to load.
  console.error(
    "[livekit] LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_API_HOST (or LIVEKIT_URL) must all be set."
  );
}

export const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);
export const webhookReceiver = new WebhookReceiver(apiKey, apiSecret);
export const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

export type { ParticipantPermission };

// Deliberately hardcoded numbers instead of referencing the SDK's own
// TrackSource.MICROPHONE/SCREEN_SHARE/SCREEN_SHARE_AUDIO constants at
// runtime: on at least one real deployment, those named properties
// resolved to undefined even though the installed package version
// matched exactly (almost certainly a partial/corrupted npm install on
// that machine, where the protobuf-generated enum binding came up
// incomplete without npm ever reporting an error) -- and when that
// happens, it doesn't fail here where it'd be easy to diagnose; it
// crashes deep inside the SDK's own JWT-signing code with a cryptic
// "Cannot convert TrackSource undefined to string". These numbers are
// LiveKit's own wire-format values for this enum (confirmed directly
// against the installed package: CAMERA=1, MICROPHONE=2,
// SCREEN_SHARE=3, SCREEN_SHARE_AUDIO=4) and have no dependency on any
// object's property lookup succeeding -- immune to whatever caused that
// failure. The `as TrackSource` casts keep everything downstream
// correctly typed against the SDK's own type (a type-only import, which
// -- unlike the value import above -- has no runtime existence at all,
// so it can't be the thing that was undefined).
const SOURCE_MICROPHONE = 2 as TrackSource;
const SOURCE_SCREEN_SHARE = 3 as TrackSource;
const SOURCE_SCREEN_SHARE_AUDIO = 4 as TrackSource;

/**
 * Every grant decision happens HERE, server-side, never trusting
 * whatever the frontend claims about its own role -- the one place a
 * LiveKit access token gets minted for this app. `permission` controls
 * what the token holder can do the MOMENT they connect; a host/teacher
 * always gets full publish rights (mic, camera -- camera is unused by
 * this app's UI but left ungated at the token level since nothing in
 * the frontend ever requests it, so there's nothing for an unused grant
 * to expose) and screen-share immediately, while a student starts able
 * to subscribe and send data (for raise-hand, chat signaling if ever
 * routed through LiveKit data messages) but NOT publish any audio/video
 * at all until the host explicitly approves -- see
 * grantMicrophone/grantScreenShare in liveClass.ts, which call
 * roomService.updateParticipant to change this AFTER a token already
 * exists, which is how an approval takes effect without the student
 * needing a new token or a fresh page load.
 */
export async function createClassAccessToken(options: {
  identity: string;
  name: string;
  roomName: string;
  isHost: boolean;
}) {
  const { identity, name, roomName, isHost } = options;
  const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: "4h" });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canSubscribe: true,
    canPublishData: true,
    canPublish: isHost,
    canPublishSources: isHost ? [SOURCE_MICROPHONE, SOURCE_SCREEN_SHARE, SOURCE_SCREEN_SHARE_AUDIO] : [],
  });
  return at.toJwt();
}

/** Grants (or revokes) microphone publish rights for one participant
 * already connected to a room -- independent of screen-share, per spec.
 * LiveKit itself enforces this the moment it's called; a client that
 * tries to publish audio without this grant is rejected by LiveKit's own
 * server, not just hidden by frontend UI. */
export async function setMicrophoneGranted(roomName: string, identity: string, granted: boolean) {
  const current = await roomService.getParticipant(roomName, identity).catch(() => null);
  const existingSources = (current?.permission?.canPublishSources ?? []) as TrackSource[];
  const withoutMic = existingSources.filter((s) => s !== SOURCE_MICROPHONE);
  const nextSources = granted ? [...withoutMic, SOURCE_MICROPHONE] : withoutMic;
  await roomService.updateParticipant(roomName, identity, {
    permission: {
      canSubscribe: true,
      canPublishData: true,
      canPublish: nextSources.length > 0,
      canPublishSources: nextSources,
    },
  });
  // Revoking the grant alone stops FUTURE publishes; an ALREADY-live mic
  // track needs an explicit mute to go silent immediately rather than
  // whenever the client next renegotiates.
  if (!granted && current) {
    const micTrack = current.tracks.find((t) => t.source === SOURCE_MICROPHONE);
    if (micTrack) await roomService.mutePublishedTrack(roomName, identity, micTrack.sid, true).catch(() => {});
  }
}

/** Same pattern as setMicrophoneGranted, but for screen-share -- a
 * separate grant entirely, since being allowed to speak says nothing
 * about being allowed to share a screen. */
export async function setScreenShareGranted(roomName: string, identity: string, granted: boolean) {
  const current = await roomService.getParticipant(roomName, identity).catch(() => null);
  const existingSources = (current?.permission?.canPublishSources ?? []) as TrackSource[];
  const withoutScreen = existingSources.filter((s) => s !== SOURCE_SCREEN_SHARE && s !== SOURCE_SCREEN_SHARE_AUDIO);
  const nextSources = granted ? [...withoutScreen, SOURCE_SCREEN_SHARE, SOURCE_SCREEN_SHARE_AUDIO] : withoutScreen;
  await roomService.updateParticipant(roomName, identity, {
    permission: {
      canSubscribe: true,
      canPublishData: true,
      canPublish: nextSources.length > 0,
      canPublishSources: nextSources,
    },
  });
  if (!granted && current) {
    const screenTrack = current.tracks.find((t) => t.source === SOURCE_SCREEN_SHARE);
    if (screenTrack) await roomService.mutePublishedTrack(roomName, identity, screenTrack.sid, true).catch(() => {});
  }
}

// OGG = 2, hardcoded for the same reason as the TrackSource constants
// above: this is a value from the exact same protobuf-generated package
// that has already shown undefined-named-property failures on at least
// one real install, and an audio-only recording's file type is not
// something worth re-risking that on. This whole app is audio-only (no
// camera use anywhere in its UI), so every recording is audio-only too
// -- there is no video track to composite in the first place.
const AUDIO_FILETYPE_OGG = 2;

const egressS3Config = {
  accessKey: process.env.EGRESS_S3_ACCESS_KEY ?? "",
  secret: process.env.EGRESS_S3_SECRET ?? "",
  bucket: process.env.EGRESS_S3_BUCKET ?? "",
  region: process.env.EGRESS_S3_REGION ?? "auto",
  endpoint: process.env.EGRESS_S3_ENDPOINT ?? "",
};

/**
 * Starts a room-composite (whole-room, every speaking participant mixed
 * together) audio recording and returns the egressId immediately --
 * LiveKit hands this back synchronously, well before the file itself is
 * anywhere close to done. The actual file only becomes known once the
 * `egress_ended` webhook arrives (see webhookController.ts), which is
 * also the ONLY place fileKey/size/duration ever get written -- this
 * function's caller (liveClass.ts's classroom:start-recording handler)
 * only ever sees "it started", never a finished file.
 *
 * Output goes to S3(-compatible) storage, not a local path on the
 * egress worker's own disk -- a local filepath would only be reachable
 * if this service and the egress worker happened to share a volume,
 * which isn't something to assume about someone else's deployment. See
 * this project's README for the required EGRESS_S3_* env vars and why
 * MinIO is the realistic free option if there's no existing cloud
 * storage account.
 */
export async function startClassRecording(roomName: string) {
  if (!egressS3Config.bucket) {
    throw new Error("EGRESS_S3_BUCKET is not configured -- recording storage has not been set up on this server.");
  }
  const output = new EncodedFileOutput({
    fileType: AUDIO_FILETYPE_OGG,
    filepath: `${roomName}/{room_name}-{time}`,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: egressS3Config.accessKey,
        secret: egressS3Config.secret,
        bucket: egressS3Config.bucket,
        region: egressS3Config.region,
        endpoint: egressS3Config.endpoint,
      }),
    },
  });
  const info = await egressClient.startRoomCompositeEgress(roomName, { file: output }, { audioOnly: true });
  return { egressId: info.egressId };
}

/** Explicit stop, called when a host presses "stop recording" or when a
 * class ends normally while one is still running. NOT the only way a
 * recording finishes, by design -- if this service crashes or the host
 * just closes their device without stopping it first, LiveKit's own
 * egress worker keeps running independently and stops itself once the
 * room it's attached to actually closes, still firing the same
 * `egress_ended` webhook either way. Swallows errors on an egressId
 * that's already stopped/gone, since by the time this is called from
 * the room-end path, stopping twice is an expected race, not a bug. */
export async function stopClassRecording(egressId: string) {
  await egressClient.stopEgress(egressId).catch(() => {});
}
