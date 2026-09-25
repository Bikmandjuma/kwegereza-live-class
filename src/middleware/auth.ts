import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../utils/jwt.js";
import { prisma } from "../utils/prisma.js";
import { sendError } from "../utils/apiResponse.js";
import { hasPermission } from "../utils/permissions.js";
import { asyncHandler } from "./asyncHandler.js";

// Kinyarwanda messages the frontend shows verbatim for blocked/inactive accounts.
const STATUS_MESSAGES: Record<string, string> = {
  PENDING: "Konti yawe iri gutegereza kwemezwa n'ubuyobozi.",
  INACTIVE: "Konti yawe ntikiri ingana. Hamagara ubuyobozi bwa Kwegereza niba ukeneye ubufasha.",
  SUSPENDED: "Konti yawe yahagaritswe by'agateganyo. Hamagara ubuyobozi bwa Kwegereza.",
  BLOCKED: "Konti yawe yahagaritswe. Hamagara ubuyobozi bwa Kwegereza niba ukeneye ubufasha.",
  REJECTED: "Ubusabe bwawe bwo kwiyandikisha ntibwemejwe. Hamagara ubuyobozi bwa Kwegereza.",
};

/**
 * Verifies the JWT AND re-reads the user from the database on every request.
 * This is deliberate: if an admin blocks a user mid-session, that user's very
 * next request must be rejected trusting only the token would let a blocked
 * user keep working until the token naturally expires.
 */
export const authenticate = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const token = bearer ?? req.cookies?.kiu_token ?? null;

  if (!token) {
    sendError(res, 401, "Ntabwo winjiye. Injira kugira ngo ukomeze.");
    return;
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    sendError(res, 401, "Igihe cyo kwinjira cyarangiye. Ongera winjire.");
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user) {
    sendError(res, 401, "Konti ntiboneka.");
    return;
  }
  if (user.tokenVersion !== payload.tokenVersion) {
    // Session was revoked (block/suspend/password change) since this token was issued.
    sendError(res, 401, STATUS_MESSAGES[user.status] ?? "Igihe cyo kwinjira ntikiri cyemewe.");
    return;
  }
  if (user.status !== "ACTIVE") {
    sendError(res, 403, STATUS_MESSAGES[user.status] ?? "Konti yawe ntiyemerewe kwinjira.");
    return;
  }

  req.user = user;
  next();
});

/**
 * Same JWT/DB checks as authenticate, but never rejects the request --
 * sets req.user when a valid, active session is present and just calls
 * next() otherwise. For endpoints that must stay reachable by anonymous
 * visitors (e.g. the one free preview video/audio per teacher) but still
 * want to know WHO is calling when they happen to be logged in, such as
 * recording a per-user watch event alongside the anonymous play counter.
 */
export const optionalAuthenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const token = bearer ?? req.cookies?.kiu_token ?? null;
  if (!token) {
    next();
    return;
  }
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (user && user.tokenVersion === payload.tokenVersion && user.status === "ACTIVE") {
      req.user = user;
    }
  } catch {
    // Invalid/expired token on an endpoint that doesn't require one --
    // just proceed anonymously rather than erroring.
  }
  next();
});

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      sendError(res, 403, "Ntabwo wemerewe gukora iki gikorwa.");
      return;
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !hasPermission(req.user.role, req.user.permissions, permission)) {
      sendError(res, 403, "Ntabwo ufite uburenganzira bwo gukora iki gikorwa.");
      return;
    }
    next();
  };
}

export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !permissions.some((p) => hasPermission(req.user!.role, req.user!.permissions, p))) {
      sendError(res, 403, "Ntabwo ufite uburenganzira bwo gukora iki gikorwa.");
      return;
    }
    next();
  };
}
