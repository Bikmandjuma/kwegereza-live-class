import os from "os";
import type * as mediasoupTypes from "mediasoup/types";

/**
 * Central mediasoup configuration. Every value that differs between a
 * developer's laptop and a real production box is read from the
 * environment nothing network-specific is hardcoded here (that hardcoding
 * 127.0.0.1 / 192.168.x.x is exactly what made the standalone demo
 * unusable across the internet).
 *
 * Required in production:
 *   MEDIASOUP_ANNOUNCED_IP = the server's public IP address.
 *   Without it, mediasoup tells remote peers to reach it on its LOCAL
 *   interface address, which is unreachable from outside that network.
 *   Two students on the same wifi as the server would still connect; a
 *   student in another country never would, and it would look like a
 *   generic "connecting..." hang with no obvious error.
 *
 * Also required for a real deployment:
 *   - Firewall/security-group must allow inbound UDP+TCP on the
 *     MEDIASOUP_MIN_PORT..MEDIASOUP_MAX_PORT range (default 40000-49999),
 *     not just the usual 80/443.
 *   - That range should be kept reasonably small (a few thousand ports)
 *     since mediasoup opens one per transport.
 */

const numCpus = os.cpus().length;

export const mediasoupConfig = {
  numWorkers: Number(process.env.MEDIASOUP_NUM_WORKERS ?? Math.max(1, numCpus - 1)),

  worker: {
    rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT ?? 40000),
    rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT ?? 49999),
    logLevel: (process.env.MEDIASOUP_LOG_LEVEL as mediasoupTypes.WorkerLogLevel) ?? "warn",
    logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"] as mediasoupTypes.WorkerLogTag[],
  } satisfies mediasoupTypes.WorkerSettings,

  router: {
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: { "x-google-start-bitrate": 1000 },
      },
      {
        kind: "video",
        mimeType: "video/H264",
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f",
          "level-asymmetry-allowed": 1,
        },
      },
    ] as mediasoupTypes.RtpCodecCapability[],
  },

  webRtcTransport: {
    listenIps: [
      {
        ip: process.env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0",
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
      },
    ] as mediasoupTypes.TransportListenIp[],
    // Both UDP and TCP: UDP is preferred (lower overhead), TCP is the
    // fallback for the (common, especially on institutional/mobile
    // networks) case where UDP is blocked outright. This is the direct
    // fix for the old peer.js comment about connections dying after a
    // few minutes STUN alone only helps discover a path; it does nothing
    // once that path is blocked or the NAT binding expires.
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  },
};

export function assertProductionReady() {
  if (process.env.NODE_ENV === "production" && !process.env.MEDIASOUP_ANNOUNCED_IP) {
    console.warn(
      "\n[mediasoup] WARNING: MEDIASOUP_ANNOUNCED_IP is not set in a production environment.\n" +
        "Live audio/video will only work between participants on the SAME local network as this\n" +
        "server. Set MEDIASOUP_ANNOUNCED_IP to this machine's public IP address to fix\n" +
        "cross-network / cross-country classes.\n"
    );
  }
}
