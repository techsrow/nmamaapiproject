// src/services/shiprocket.service.ts
import axios, { AxiosRequestConfig } from "axios";

const SR_BASE = "https://apiv2.shiprocket.in/v1/external";

type AnyObj = Record<string, any>;

let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null;

function getEnv() {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;

  if (!email || !password) {
    throw new Error("Missing SHIPROCKET_EMAIL or SHIPROCKET_PASSWORD in .env");
  }
  return { email, password };
}

async function loginAndGetToken(): Promise<string> {
  const { email, password } = getEnv();

  const res = await axios.post(`${SR_BASE}/auth/login`, { email, password });

  const token = res?.data?.token;
  if (!token) throw new Error("Shiprocket login failed: token not received");

  // Token usually valid ~10 days; keep safe cache for 6 days
  cachedToken = token;
  tokenExpiresAt = Date.now() + 6 * 24 * 60 * 60 * 1000;

  return token;
}

async function getToken(): Promise<string> {
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  return loginAndGetToken();
}

// ✅ Exported token getter for other modules
export async function getShiprocketToken(): Promise<string> {
  return getToken();
}

/**
 * ✅ Single request helper (CONFIG-BASED)
 * Returns the JSON body directly (res.data)
 * Retries once on 401 by refreshing token
 */
export async function shiprocketRequest<T = any>(
  config: AxiosRequestConfig
): Promise<T> {
  if(String(config.method||'GET').toUpperCase()!=='GET'&&/orders\/create|courier\/assign\/awb/.test(String(config.url)))throw Error('Use Shipping fulfilment or automatic booking; legacy booking is disabled to prevent duplicates.');
  const doRequest = async (token: string) => {
    const res = await axios.request({
      baseURL: SR_BASE,
      ...config,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(config.headers || {}),
      },
    });
    return res.data as T;
  };

  try {
    const token = await getToken();
    return await doRequest(token);
  } catch (e: any) {
    // ✅ token might be expired; refresh once
    if (e?.response?.status === 401) {
      cachedToken = null;
      tokenExpiresAt = null;
      const fresh = await loginAndGetToken();
      return await doRequest(fresh);
    }
    throw e;
  }
}

export const shiprocketService = {
  // ✅ Create order in Shiprocket (adhoc)
  async createOrderAdhoc(payload: AnyObj) {
    return shiprocketRequest({
      method: "POST",
      url: "/orders/create/adhoc",
      data: payload,
    });
  },

  // ✅ Track by AWB
  async trackByAwb(awb: string) {
    return shiprocketRequest({
      method: "GET",
      url: `/courier/track/awb/${encodeURIComponent(awb)}`,
    });
  },

  // ✅ Track by shipmentId
  async trackByShipmentId(shipmentId: string) {
    return shiprocketRequest({
      method: "GET",
      url: `/courier/track/shipment/${encodeURIComponent(shipmentId)}`,
    });
  },
};

// ✅ Convenience exports (keep your existing API)
export async function shiprocketCreateOrder(payload: AnyObj) {
  return shiprocketService.createOrderAdhoc(payload);
}

export async function shiprocketGetOrderDetailsByAwb(awb: string) {
  return shiprocketService.trackByAwb(awb);
}

export async function createShipmentOnShiprocket(payload: AnyObj) {
  return shiprocketCreateOrder(payload);
}

export async function trackShipmentOnShiprocket(args: { awb?: string | null }) {
  if (!args.awb) throw new Error("AWB is required to track shipment");
  return shiprocketGetOrderDetailsByAwb(args.awb);
}
