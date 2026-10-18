import PDFDocument from "pdfkit";

export function buildInvoicePdf(order: any) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });

  // Header
  doc.fontSize(18).text("INVOICE", { align: "right" });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Invoice #: ${order.invoiceNumber || `INV-${order.id}`}`);
  doc.text(`Date: ${new Date(order.orderDate).toLocaleString()}`);
  doc.moveDown();

  // Customer
  doc.fontSize(12).text("Bill To:");
  doc.fontSize(10).text(order.customerName || "Customer");
  doc.text(order.customerEmail || "");
  doc.text(order.guestPhone || "");
  doc.moveDown();

  doc.fontSize(12).text("Shipping Address:");
  doc.fontSize(10).text(order.shippingAddress || "");
  doc.text(`${order.shippingCity || ""} ${order.shippingPostalCode || ""}`);
  doc.text(order.shippingCountry || "");
  doc.moveDown();

  // Items table
  doc.fontSize(12).text("Items:");
  doc.moveDown(0.5);

  order.orderItems.forEach((it: any) => {
    const lineTotal = Number(it.unitPrice) * it.quantity;
    doc.fontSize(10).text(
      `${it.productName} (${it.variantLabel || ""})  x${it.quantity}  @ ${it.unitPrice}  = ${lineTotal.toFixed(2)}`
    );
  });

  doc.moveDown();

  // Totals
  doc.fontSize(10).text(`Subtotal: ${Number(order.subtotal ?? order.orderItems.reduce((s: number, i: any) => s + Number(i.unitPrice) * i.quantity, 0)).toFixed(2)}`, { align: "right" });
  if (Number(order.discountAmount ?? order.couponDiscount) > 0) {
    doc.text(`Discount: -${Number(order.discountAmount ?? order.couponDiscount).toFixed(2)}`, { align: "right" });
  }
  if (order.shippingFee) {
    doc.text(`Shipping: ${Number(order.shippingFee).toFixed(2)}`, { align: "right" });
  }
  if (Array.isArray(order.taxBreakdown)) for (const tax of order.taxBreakdown) {
    doc.text(`${tax.name} ${tax.rate}% (${tax.inclusive ? "included" : "additional"}): ${Number(tax.taxAmount).toFixed(2)}`, {align:"right"});
  }
  doc.fontSize(12).text(`Total: ${Number(order.totalAmount).toFixed(2)}`, { align: "right" });

  doc.moveDown();
  doc.fontSize(9).text("Thank you for your order!", { align: "center" });

  return doc;
}
