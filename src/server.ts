import "dotenv/config";
import { createServer } from "http";
import { createApp } from "./app.js";
import { initSocket } from "./socket.js";
import { initMediasoupWorkers } from "./realtime/mediasoup/workers.js";
import { prisma } from "./utils/prisma.js";

const PORT = Number(process.env.PORT) || 4001;
const HOST = "0.0.0.0";

const app = createApp();
const httpServer = createServer(app);

initSocket(httpServer);

async function start() {
  // Mediasoup workers must exist before any "classroom:join"/"media:*"
  // socket event can be handled -- do this before accepting traffic. This
  // native module load (and the workers it spawns) is EXACTLY what the
  // main API's shared/cPanel hosting can't run, which is the entire
  // reason this is its own service on its own VPS.
  await initMediasoupWorkers();

  const server = httpServer.listen(PORT, HOST, () => {
    console.log(`Kwegereza Live Class API listening on port ${PORT}`);
    console.log("Socket.IO realtime (live-class media signaling) live on the same port");
  });

  async function shutdown(): Promise<void> {
    await prisma.$disconnect();
    server.close(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("[live-class server] fatal startup error:", err);
  process.exit(1);
});
