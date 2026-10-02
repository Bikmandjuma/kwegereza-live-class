import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import liveClassRoutes from "./routes/liveClassRoutes.js";
import { sendResponse } from "./utils/apiResponse.js";

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
