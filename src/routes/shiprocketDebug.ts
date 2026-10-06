import { Router } from "express";
import { getShiprocketToken, shiprocketRequest } from "../services/shiprocket.service";

const router = Router();

router.get("/shiprocket/ping", async (_req, res) => {
  try {
    const token = await getShiprocketToken();

    // small harmless call
    const account = await shiprocketRequest({
      method: "GET",
      url: "/settings/company",
    });

    return res.json({ success: true, tokenPreview: token.slice(0, 20) + "…", account });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.response?.data || e.message,
      status: e?.response?.status,
    });
  }
});

export default router;
