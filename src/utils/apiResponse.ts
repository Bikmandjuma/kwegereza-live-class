import type { Response } from "express";

// Every endpoint in the system replies with this exact shape so the frontend
// never has to guess the response format.
export function sendResponse<T>(
  res: Response,
  statusCode: number,
  data: T | null = null,
  message: string | null = null,
  meta: Record<string, unknown> = {}
): Response {
  return res.status(statusCode).json({
    success: statusCode < 400,
    data,
    message,
    meta,
  });
}

export function sendError(res: Response, statusCode: number, message: string): Response {
  return res.status(statusCode).json({
    success: false,
    data: null,
    message,
    meta: {},
  });
}
