import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { buildInvoicePdf } from "../lib/invoicePdf";

const router = Router();

/**
 * GET /api/invoice/order/:id
 * returns PDF
 */
router.get("/order/:id", auth, async (req: any, res: Response) => {
  const id = Number(req.params.id);
  const userId = req.user.userId;
  const isAdmin = req.user.role === "Admin";

  const order = await prisma.order.findUnique({
    where: { id },
    include: { orderItems: true },
  });

  if (!order) return res.status(404).json({ success: false, message: "Order not found" });

  // user can only access own orders (admin can access all)
  if (!isAdmin && order.userId !== userId) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=invoice-${id}.pdf`);

  const doc = buildInvoicePdf(order);
  doc.pipe(res);
  doc.end();
});

export default router;
