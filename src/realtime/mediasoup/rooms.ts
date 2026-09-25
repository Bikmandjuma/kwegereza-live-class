import type * as mediasoupTypes from "mediasoup/types";
import { getNextWorker } from "./workers.js";
import { mediasoupConfig } from "./config.js";

/** What kind of stream a producer represents, for UI labeling on the client. */
export type MediaTag = "hostMic" | "hostCam" | "screen" | "mic" | "cam";

export interface PeerMedia {
  sendTransport?: mediasoupTypes.WebRtcTransport;
  recvTransport?: mediasoupTypes.WebRtcTransport;
  producers: Map<MediaTag, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>; // key: consumer.id
}

export interface RoomMedia {
  router: mediasoupTypes.Router;
  peers: Map<string, PeerMedia>; // key: userId
}

const rooms = new Map<string, RoomMedia>();

export async function getOrCreateRoom(liveClassId: string): Promise<RoomMedia> {
  let room = rooms.get(liveClassId);
  if (room) return room;

  const worker = getNextWorker();
  const router = await worker.createRouter({ mediaCodecs: mediasoupConfig.router.mediaCodecs });
  room = { router, peers: new Map() };
  rooms.set(liveClassId, room);
  return room;
}

export function getRoom(liveClassId: string): RoomMedia | undefined {
  return rooms.get(liveClassId);
}

export function getOrCreatePeerMedia(room: RoomMedia, userId: string): PeerMedia {
  let peer = room.peers.get(userId);
  if (!peer) {
    peer = { producers: new Map(), consumers: new Map() };
    room.peers.set(userId, peer);
  }
  return peer;
}

export async function createWebRtcTransport(router: mediasoupTypes.Router) {
  const transport = await router.createWebRtcTransport({
    listenIps: mediasoupConfig.webRtcTransport.listenIps,
    enableUdp: mediasoupConfig.webRtcTransport.enableUdp,
    enableTcp: mediasoupConfig.webRtcTransport.enableTcp,
    preferUdp: mediasoupConfig.webRtcTransport.preferUdp,
    initialAvailableOutgoingBitrate: mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
  });

  // If a transport goes quiet (network dropped, NAT hole closed and TCP
  // fallback also failed) close it rather than leaking it forever.
  transport.on("icestatechange", (state) => {
    if (state === "disconnected" || state === "closed") {
      // handled by whoever owns cleanup on socket disconnect; this log
      // just makes the failure mode visible in server logs instead of
      // silently vanishing.
      console.warn(`[mediasoup] transport ${transport.id} ICE state -> ${state}`);
    }
  });

  return transport;
}

/** Every existing producer in a room, e.g. for a just-joined participant to consume. */
export function listRoomProducers(room: RoomMedia): Array<{ userId: string; producerId: string; mediaTag: MediaTag }> {
  const out: Array<{ userId: string; producerId: string; mediaTag: MediaTag }> = [];
  for (const [userId, peer] of room.peers.entries()) {
    for (const [mediaTag, producer] of peer.producers.entries()) {
      if (!producer.closed) out.push({ userId, producerId: producer.id, mediaTag });
    }
  }
  return out;
}

export function closePeerMedia(peer: PeerMedia | undefined) {
  if (!peer) return;
  peer.producers.forEach((p) => !p.closed && p.close());
  peer.consumers.forEach((c) => !c.closed && c.close());
  peer.sendTransport && !peer.sendTransport.closed && peer.sendTransport.close();
  peer.recvTransport && !peer.recvTransport.closed && peer.recvTransport.close();
  peer.producers.clear();
  peer.consumers.clear();
}

export function removePeer(liveClassId: string, userId: string) {
  const room = rooms.get(liveClassId);
  if (!room) return;
  const peer = room.peers.get(userId);
  closePeerMedia(peer);
  room.peers.delete(userId);
}

export function closeRoom(liveClassId: string) {
  const room = rooms.get(liveClassId);
  if (!room) return;
  room.peers.forEach((peer) => closePeerMedia(peer));
  if (!room.router.closed) room.router.close();
  rooms.delete(liveClassId);
}
