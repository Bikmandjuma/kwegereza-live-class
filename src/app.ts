import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import liveClassRoutes from "./routes/liveClassRoutes.js";
import { sendResponse } from "./utils/apiResponse.js";

/**
 * This is a deliberately small app -- ONLY live-class REST endpoints live
 * here. Everything else (auth, books, dars, chat, etc.) stays on the
 * main API at api.kwegereza.org; this service exists purely because
 * mediasoup needs a compiled native worker that the main API's shared
 * hosting can't build, so live class runs on its own VPS instead. See
 * this repo's README for the full split rationale and deployment notes.
 */
export function createApp() {
  const app = express();

  app.use(
    helmet({
      // Same reasoning as the main API's app.ts: video thumbnails and
      // any static assets this service might ever serve need to be
      // embeddable cross-origin from the main frontend's domain.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? " https://kwegereza.org",
      credentials: true,
    })
  );
  app.use(morgan("dev"));
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
