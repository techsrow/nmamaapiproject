import { Router } from "express";
import { razorpayWebhook } from "./paymentWebhooks";
const router = Router();
// Keep the old dashboard webhook URL, using the same verified payment service.
router.post("/", razorpayWebhook);
export default router;
