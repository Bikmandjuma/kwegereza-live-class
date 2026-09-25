import * as mediasoup from "mediasoup";
import type * as mediasoupTypes from "mediasoup/types";
import { mediasoupConfig, assertProductionReady } from "./config.js";

const workers: mediasoupTypes.Worker[] = [];
let nextWorkerIndex = 0;
let initialized = false;

/**
 * Call once at process startup (see server.ts). Creates one mediasoup
 * Worker per configured CPU slot. Each Worker is a separate OS process
 * (the mediasoup-worker C++ binary) rooms are spread across them via
 * getNextWorker() so one busy classroom doesn't starve another.
 */
export async function initMediasoupWorkers(): Promise<void> {
  if (initialized) return;
  assertProductionReady();

  for (let i = 0; i < mediasoupConfig.numWorkers; i++) {
    const worker = await mediasoup.createWorker(mediasoupConfig.worker);

    worker.on("died", (error) => {
      console.error(
        `[mediasoup] worker pid=${worker.pid} died unexpectedly (${error.message}). ` +
          "Exiting process so the host's process manager (pm2/systemd/docker) restarts it clean " +
          "rather than continuing with a half-broken media server."
      );
      // Give logs a moment to flush, then exit hard. Never try to "heal"
      // a dead mediasoup worker in place restart the whole node process.
      setTimeout(() => process.exit(1), 500);
    });

    workers.push(worker);
  }

  initialized = true;
  console.log(`[mediasoup] ${workers.length} worker(s) ready (ports ${mediasoupConfig.worker.rtcMinPort}-${mediasoupConfig.worker.rtcMaxPort})`);
}

export function getNextWorker(): mediasoupTypes.Worker {
  if (workers.length === 0) {
    throw new Error("mediasoup workers not initialized call initMediasoupWorkers() at startup");
  }
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}

export function getWorkerCount(): number {
  return workers.length;
}
