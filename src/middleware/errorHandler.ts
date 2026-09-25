import type { NextFunction, Request, Response } from "express";
import { sendError } from "../utils/apiResponse.js";

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  console.error("[error]", err);
  const status = err.statusCode ?? 500;
  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Habaye ikibazo kuri seriveri. Ongera ugerageze."
      : err.message ?? "Server error";
  sendError(res, status, message);
}

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
