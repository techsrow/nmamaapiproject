import axios from "axios";
import { prisma } from "../../lib/prisma";
import { ShippingProvider } from "@prisma/client";
import {
  decryptShippingJson,
  encryptShippingJson,
  maskShippingSecrets,
} from "./encryption.service";

/* =========================================================
   SHIPPING PROVIDER CATALOG
========================================================= */

export const SHIPPING_CATALOG = [
  {
    provider: "Shadowfax360",
    name: "Shadowfax 360",
    kind: "DIRECT",
    fields: ["token"],
    capabilities: { rulePricing: true, tracking: true, automaticBooking: false },
  },
  {
    provider: "Shiprocket",
    name: "Shiprocket",
    kind: "AGGREGATOR",
    fields: ["email", "password"],
  },
  {
    provider: "Delhivery",
    name: "Delhivery",
    kind: "DIRECT",
    fields: ["token", "clientName"],
    capabilities: { automaticBooking: true, labels: true, tracking: true },
  },
  {
    provider: "BlueDart",
    name: "Blue Dart",
    kind: "DIRECT",
    fields: ["loginId", "licenseKey", "customerCode"],
  },
  {
    provider: "Xpressbees",
    name: "Xpressbees",
    kind: "DIRECT",
    fields: ["email", "password"],
  },
  {
    provider: "EcomExpress",
    name: "Ecom Express",
    kind: "DIRECT",
    fields: ["username", "password"],
  },
  {
    provider: "DTDC",
    name: "DTDC",
    kind: "DIRECT",
    fields: ["apiKey", "customerCode"],
  },
  {
    provider: "IndiaPost",
    name: "India Post",
    kind: "DIRECT",
    fields: [],
  },
  {
    provider: "Local",
    name: "Local Delivery",
    kind: "LOCAL",
    fields: [],
  },
  {
    provider: "Custom",
    name: "Custom Courier",
    kind: "CUSTOM",
    fields: [],
  },
] as const;

/* =========================================================
   LIST PROVIDERS
========================================================= */

export async function listProviderConfigs() {
  const rows = await prisma.shippingProviderConfig.findMany({
    orderBy: {
      id: "asc",
    },
  });

  return rows.map(safeConfig);
}

/* =========================================================
   SAFE CONFIG
   Never return encrypted credentials to Admin
========================================================= */

export function safeConfig(x: any) {
  let credentials: any = {};

  try {
    if (x.encryptedCredentials) {
      credentials = maskShippingSecrets(
        decryptShippingJson(x.encryptedCredentials)
      );
    }
  } catch {
    credentials = {
      configured: !!x.encryptedCredentials,
    };
  }

  return {
    ...x,
    encryptedCredentials: undefined,
    credentials,
  };
}

/* =========================================================
   SAVE / UPDATE PROVIDER
========================================================= */

export async function saveProviderConfig(
  provider: ShippingProvider,
  input: any
) {
  const old = await prisma.shippingProviderConfig.findUnique({
    where: {
      provider,
    },
  });

  let credentials: Record<string, any> = {};

  /*
   * Preserve previously stored credentials.
   * This allows Admin to update one credential without
   * overwriting all existing secrets.
   */
  if (old?.encryptedCredentials) {
    try {
      credentials = decryptShippingJson<Record<string, any>>(
        old.encryptedCredentials
      );
    } catch {
      credentials = {};
    }
  }

  /*
   * Merge only non-empty credentials.
   * Masked/blank Admin values therefore won't overwrite
   * the real stored credentials.
   */
  for (const [key, value] of Object.entries(
    input?.credentials || {}
  )) {
    if (
      value !== "" &&
      value !== null &&
      value !== undefined
    ) {
      credentials[key] = value;
    }
  }

  const encryptedCredentials =
    Object.keys(credentials).length > 0
      ? encryptShippingJson(credentials)
      : old?.encryptedCredentials ?? null;

  const row = await prisma.shippingProviderConfig.upsert({
    where: {
      provider,
    },

    create: {
      provider,

      displayName:
        input?.displayName ||
        getProviderDisplayName(provider),

      isEnabled:
        input?.isEnabled ?? false,

      mode:
        input?.mode || "TEST",

      encryptedCredentials,

      publicConfig:
        input?.publicConfig || {},
    },

    update: {
      displayName:
        input?.displayName ||
        old?.displayName ||
        getProviderDisplayName(provider),

      isEnabled:
        input?.isEnabled ??
        old?.isEnabled ??
        false,

      mode:
        input?.mode ||
        old?.mode ||
        "TEST",

      encryptedCredentials,

      publicConfig:
        input?.publicConfig ??
        old?.publicConfig ??
        {},
    },
  });

  return safeConfig(row);
}

/* =========================================================
   GET PROVIDER CREDENTIALS
========================================================= */

export async function credentialsFor(
  provider: ShippingProvider,
  existingShipment = false
) {
  const config =
    await prisma.shippingProviderConfig.findUnique({
      where: {
        provider,
      },
    });

  if (!config) {
    throw new Error(
      `${getProviderDisplayName(provider)} is not configured`
    );
  }

  if (!config.isEnabled && !existingShipment) {
    throw new Error(
      `${getProviderDisplayName(provider)} is not enabled`
    );
  }

  let credentials: Record<string, any> = {};

  if (config.encryptedCredentials) {
    try {
      credentials =
        decryptShippingJson<Record<string, any>>(
          config.encryptedCredentials
        );
    } catch {
      throw new Error(
        `Unable to decrypt ${getProviderDisplayName(
          provider
        )} credentials`
      );
    }
  }

  return {
    config,
    credentials,
  };
}

/* =========================================================
   TEST PROVIDER
========================================================= */

export async function testProvider(
  provider: ShippingProvider
) {
  try {
    /*
     * Local/Custom do not require API credentials.
     *
     * Importantly, don't call credentialsFor() first,
     * because a fresh DB may not yet contain their row.
     */
    if (
      provider === ShippingProvider.Local ||
      provider === ShippingProvider.Custom
    ) {
      return await record(
        provider,
        true,
        `${getProviderDisplayName(provider)} provider ready`
      );
    }

    if(provider === "Delhivery"){const {testDelhivery}=await import("./delhivery.service");const result=await testDelhivery();return await record(provider,result.ok,result.message);}
    if (provider === "Shadowfax360") {
      const { testShadowfax } = await import("./shadowfax.service");
      const result = await testShadowfax();
      return await record(provider, result.ok, result.message);
    }
    const { credentials } =
      await credentialsFor(provider);

    /* -----------------------------------------------------
       SHIPROCKET
    ----------------------------------------------------- */

    if (provider === ShippingProvider.Shiprocket) {
      if (!credentials.email) {
        throw new Error(
          "Shiprocket email is required"
        );
      }

      if (!credentials.password) {
        throw new Error(
          "Shiprocket password is required"
        );
      }

      await axios.post(
        "https://apiv2.shiprocket.in/v1/external/auth/login",
        {
          email: credentials.email,
          password: credentials.password,
        },
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      return await record(
        provider,
        true,
        "Shiprocket connection successful"
      );
    }

    /* -----------------------------------------------------
       OTHER PROVIDERS
    ----------------------------------------------------- */

    const meta = SHIPPING_CATALOG.find(
      (x) => x.provider === provider
    );

    if (!meta) {
      throw new Error(
        `Unsupported shipping provider: ${provider}`
      );
    }

    /*
     * Direct carrier integrations currently validate that
     * credentials are configured.
     *
     * Actual carrier API execution can be added when the
     * merchant's carrier API contract/account is available.
     */
    for (const field of meta.fields) {
      const value =
        credentials[
          field as keyof typeof credentials
        ];

      if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
      ) {
        throw new Error(
          `${field} is required`
        );
      }
    }

    return await record(
      provider,
      true,
      "Credentials saved. Direct carrier activation depends on your carrier contract/API account."
    );
  } catch (error: any) {
    const message =
      extractProviderError(error);

    return await record(
      provider,
      false,
      message
    );
  }
}

/* =========================================================
   RECORD CONNECTION TEST RESULT

   IMPORTANT:
   Uses UPSERT instead of UPDATE.

   Fresh/reset databases may not contain provider rows yet.
========================================================= */

async function record(
  provider: ShippingProvider,
  ok: boolean,
  message: string
) {
  const existing =
    await prisma.shippingProviderConfig.findUnique({
      where: {
        provider,
      },
    });

  const row =
    await prisma.shippingProviderConfig.upsert({
      where: {
        provider,
      },

      create: {
        provider,

        displayName:
          getProviderDisplayName(provider),

        /*
         * Do NOT automatically enable a provider simply
         * because Test Connection was clicked.
         */
        isEnabled: false,

        mode: "TEST",

        encryptedCredentials: null,

        publicConfig: {},

        lastTestedAt: new Date(),

        lastTestOk: ok,

        lastError:
          ok ? null : message,
      },

      update: {
        lastTestedAt: new Date(),

        lastTestOk: ok,

        lastError:
          ok ? null : message,
      },
    });

  return {
    ok,
    message,
    provider,
    testedAt: row.lastTestedAt,
    isEnabled:
      existing?.isEnabled ??
      row.isEnabled,
  };
}

/* =========================================================
   PROVIDER DISPLAY NAME
========================================================= */

function getProviderDisplayName(
  provider: ShippingProvider
) {
  const meta = SHIPPING_CATALOG.find(
    (x) => x.provider === provider
  );

  return meta?.name || provider;
}

/* =========================================================
   PROVIDER ERROR NORMALIZER
========================================================= */

function extractProviderError(
  error: any
): string {
  const responseData =
    error?.response?.data;

  if (typeof responseData === "string") {
    return responseData;
  }

  if (responseData?.message) {
    if (
      typeof responseData.message === "string"
    ) {
      return responseData.message;
    }

    try {
      return JSON.stringify(
        responseData.message
      );
    } catch {
      // continue
    }
  }

  if (responseData?.error) {
    if (
      typeof responseData.error === "string"
    ) {
      return responseData.error;
    }

    try {
      return JSON.stringify(
        responseData.error
      );
    } catch {
      // continue
    }
  }

  return (
    error?.message ||
    "Shipping provider connection test failed"
  );
}