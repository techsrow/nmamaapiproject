import { Router, Response } from "express";
import { auth, AuthRequest } from "../middleware/auth";
import {
  createShiprocketShipmentForOrder,
  syncShiprocketShipmentStatusForOrder,
} from "../services/shiprocketAdmin";

const router = Router();
router.use(auth);

// Admin guard
router.use((req: AuthRequest, res: Response, next) => {
  if (req.user?.role !== "Admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
});

// POST /api/admin/shipments/:orderId/sync
router.post("/:orderId/sync", async (req: AuthRequest, res: Response) => {
  const orderId = Number(req.params.orderId);
  if (!orderId) return res.status(400).json({ message: "Invalid orderId" });

  const result = await syncShiprocketShipmentStatusForOrder(orderId);
  return res.json(result);
});

// POST /api/admin/shipments/:orderId/retry
router.post("/:orderId/retry", async (req: AuthRequest, res: Response) => {
  const orderId = Number(req.params.orderId);
  if (!orderId) return res.status(400).json({ message: "Invalid orderId" });

  const result = await createShiprocketShipmentForOrder(orderId, { force: false });
  return res.json(result);
});

// POST /api/admin/shipments/:orderId/force-retry
router.post("/:orderId/force-retry", async (req: AuthRequest, res: Response) => {
  const orderId = Number(req.params.orderId);
  if (!orderId) return res.status(400).json({ message: "Invalid orderId" });

  const result = await createShiprocketShipmentForOrder(orderId, { force: true });
  return res.json(result);
});

export default router;
