import { Router } from "express";
import {
  createLiveClass,
  deleteLiveClassRoute,
  endLiveClassRoute,
  getLiveClass,
  getPublicLiveClassStatus,
  listActiveLiveClasses,
  listUpcomingLiveClasses,
  startScheduledLiveClass,
} from "../controllers/liveClassController.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

const router = Router();

// Genuinely public, no authenticate a guest's alert icon polls this.
router.get("/public-status", getPublicLiveClassStatus);

router.use(authenticate);

router.get("/active", listActiveLiveClasses); // any active user can see what's live
router.get("/upcoming", listUpcomingLiveClasses); // any active user can see what's scheduled
router.get("/:id", getLiveClass); // backs the shareable link read-only, any active user
router.post("/", requirePermission("classroom.host"), createLiveClass);
router.post("/:id/start", requirePermission("classroom.host"), startScheduledLiveClass);
router.post("/:id/end", requirePermission("classroom.host"), endLiveClassRoute);
router.delete("/:id", requirePermission("classroom.delete"), deleteLiveClassRoute);

export default router;
