import crypto from "crypto";

export type ShippingProviderName = "Shiprocket" | "Delhivery";
export type ShipmentStatus =
  | "NotCreated"
  | "Created"
  | "PickedUp"
  | "InTransit"
  | "OutForDelivery"
  | "Delivered"
  | "Failed"
  | "Cancelled";

export type ShippingMethod = "Standard" | "Express";

export type RateRequest = {
  toPincode: string;
  totalWeightKg: number;
  cod: boolean;
};

export type RateResponse = {
  provider: ShippingProviderName;
  method: ShippingMethod;
  charge: number;
  etdDays: number;
};

export type CreateShipmentRequest = {
  orderId: number;

  toName: string;
  toPhone: string;
  toAddress: string;
  toCity: string;
  toPincode: string;
  toCountry: string;

  amount: number;
  cod: boolean;

  totalWeightKg: number;

  items: Array<{
    name: string;
    qty: number;
    price: number;
  }>;
};

export type CreateShipmentResponse = {
  provider: ShippingProviderName;
  shipmentId: string;
  awbNumber: string;
  trackingUrl: string;
  trackingCode?: string | null;
  shippingFee: number;
  meta?: any;
  shipmentStatus: "Created";
};

function fakeAwb() {
  return "AWB" + crypto.randomBytes(6).toString("hex").toUpperCase();
}
function fakeShipmentId(provider: string) {
  return provider.toUpperCase() + "_" + crypto.randomBytes(6).toString("hex");
}

export const ShiprocketProvider = {
  async getRates(req: RateRequest): Promise<RateResponse[]> {
    // TODO: replace with real Shiprocket rate API
    const base = req.totalWeightKg <= 0.5 ? 60 : 95;
    return [
      { provider: "Shiprocket", method: "Standard", charge: base, etdDays: 4 },
      { provider: "Shiprocket", method: "Express", charge: base + 45, etdDays: 2 },
    ];
  },

  async createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResponse> {
    // TODO: replace with real Shiprocket shipment API
    const awbNumber = fakeAwb();
    const shipmentId = fakeShipmentId("shiprocket");
    const shippingFee = req.totalWeightKg <= 0.5 ? 60 : 95;

    return {
      provider: "Shiprocket",
      shipmentId,
      awbNumber,
      trackingUrl: `https://track.shiprocket.in/${awbNumber}`,
      trackingCode: awbNumber,
      shippingFee,
      shipmentStatus: "Created",
      meta: {
        mock: true,
        totalWeightKg: req.totalWeightKg,
      },
    };
  },
};

export const DelhiveryProvider = {
  async getRates(req: RateRequest): Promise<RateResponse[]> {
    // TODO: replace with real Delhivery rate API
    const base = req.totalWeightKg <= 0.5 ? 55 : 90;
    return [
      { provider: "Delhivery", method: "Standard", charge: base, etdDays: 5 },
      { provider: "Delhivery", method: "Express", charge: base + 35, etdDays: 3 },
    ];
  },

  async createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResponse> {
    // TODO: replace with real Delhivery shipment API
    const awbNumber = fakeAwb();
    const shipmentId = fakeShipmentId("delhivery");
    const shippingFee = req.totalWeightKg <= 0.5 ? 55 : 90;

    return {
      provider: "Delhivery",
      shipmentId,
      awbNumber,
      trackingUrl: `https://www.delhivery.com/track/package/${awbNumber}`,
      trackingCode: awbNumber,
      shippingFee,
      shipmentStatus: "Created",
      meta: {
        mock: true,
        totalWeightKg: req.totalWeightKg,
      },
    };
  },
};
