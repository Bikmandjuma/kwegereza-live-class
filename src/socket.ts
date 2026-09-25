import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { verifyToken } from "./utils/jwt.js";
import { prisma } from "./utils/prisma.js";
import { registerLiveClassHandlers } from "./realtime/liveClass.js";
import { setIo } from "./realtime/ioInstance.js";

/**
 * A deliberately narrow slice of the main API's socket.ts -- same JWT
 * verification pattern (re-checks the DB on every connection, never
 * trusts the token signature alone, so a user blocked mid-session can't
 * keep an existing socket open), but this service only ever needs
 * registerLiveClassHandlers. Presence, chat, guest-chat, and everything
 * else stay on the main API's own socket server; a live-class socket
 * connection here is a SEPARATE connection from the main API's, so this
 * intentionally does NOT track "online" presence -- that's the main
 * API's job for the rest of the app.
 */
export function initSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN ?? " https://kwegereza.org",
      credentials: true,
    },
  });

  setIo(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("unauthenticated"));

      const payload = verifyToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });

      if (!user || user.tokenVersion !== payload.tokenVersion || user.status !== "ACTIVE") {
        return next(new Error("unauthenticated"));
      }

      socket.data.userId = user.id;
      socket.data.fullName = user.fullName;
      socket.data.accountRole = user.role;
      next();
    } catch {
      next(new Error("unauthenticated"));
    }
  });

  io.on("connection", (socket: Socket) => {
    registerLiveClassHandlers(io, socket);
  });

  return io;
}
