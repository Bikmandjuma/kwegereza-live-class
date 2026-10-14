import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import liveClassRoutes from "./routes/liveClassRoutes.js";
import { sendResponse } from "./utils/apiResponse.js";
import { handleLiveKitWebhook } from "./controllers/webhookController.js";

export function createApp() {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(morgan("dev"));

  // Mounted BEFORE express.json() and with its own raw-body parser,
  // deliberately -- LiveKit's webhook signature covers the exact raw
  // bytes it sent, and verifying against a reserialized JSON.parse'd
  // copy could fail even with byte-for-byte identical field values (key
  // order, whitespace). Every other route below still gets ordinary
  // JSON parsing; this is the one path that needs the untouched body.
  app.post("/webhooks/livekit", express.raw({ type: "*/*" }), handleLiveKitWebhook);

  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    sendResponse(res, 200, { status: "ok" }, "Kwegereza Live Class API is healthy");
  });

  app.use("/api/live-classes", liveClassRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
