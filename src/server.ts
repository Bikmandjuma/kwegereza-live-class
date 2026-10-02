import "dotenv/config";
import { createServer } from "http";
import { createApp } from "./app.js";
import { initSocket } from "./socket.js";

const PORT = Number(process.env.PORT) || 4001;
const HOST = "0.0.0.0";

const app = createApp();
const httpServer = createServer(app);

initSocket(httpServer);

async function start() {
  // No native worker to spawn here anymore: the actual WebRTC media
  // (audio, screen share) is handled entirely by the separately-hosted
  // LiveKit server, reached over the network via livekit-server-sdk
  // (see src/utils/livekit.ts). This service also has no database of
  // its own at all anymore -- everything that needs persistence goes
  // through the main API's internal API (see src/utils/internalApi.ts)
  // instead of a direct connection to the shared database. Nothing
  // here needs anything heavier than a normal Node process.
  const server = httpServer.listen(PORT, HOST, () => {
    console.log(`Kwegereza Live Class API listening on port ${PORT}`);
    console.log("Socket.IO realtime (live-class control plane) live on the same port");
  });

  function shutdown(): void {
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
