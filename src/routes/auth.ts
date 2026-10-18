import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import crypto from "crypto";

import { auth, AuthRequest } from "../middleware/auth";
import { sendMail } from "../lib/mailer";

import {
  verifyEmailTemplate,
  welcomeEmailTemplate,
  resetPasswordTemplate,
} from "../lib/emailTemplates";

const router = Router();

const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required");
}

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3000";

/* ============================================================
   REGISTER
============================================================ */

const RegisterSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(8).max(20).optional(),
  password: z.string().min(6),
});

router.post("/register", async (req: Request, res: Response) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
    } = RegisterSchema.parse(req.body);

    const normalizedEmail = email.toLowerCase().trim();

    const exists = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    if (phone && !INDIAN_PHONE_REGEX.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Indian mobile number",
      });
    }

    if (phone) {
      const phoneExists = await prisma.user.findFirst({
        where: {
          phone,
        },
      });

      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: "Phone already registered",
        });
      }
    }

    const hashed = await bcrypt.hash(password, 10);

    // Verification token valid for 1 hour
    const token = crypto.randomBytes(32).toString("hex");

    const expiry = new Date(
      Date.now() + 60 * 60 * 1000
    );

    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: normalizedEmail,
        phone: phone ?? null,

        passwordHash: hashed,

        emailVerified: false,

        emailVerifyToken: token,
        emailVerifyTokenExpiry: expiry,
      },
    });

    const verifyUrl =
      `${FRONTEND_URL}/verify-email?token=${token}`;

    await sendMail({
      to: user.email,
      subject: "Verify your email - Namama",

      html: verifyEmailTemplate({
        name: user.firstName,
        verifyUrl,
      }),

      text: `Verify your email: ${verifyUrl}`,
    });

    return res.status(201).json({
      success: true,
      message:
        "Registration successful. Please verify your email to activate your account.",
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

/* ============================================================
   VERIFY EMAIL
============================================================ */

const VerifySchema = z.object({
  token: z.string().min(10),
});

router.get(
  "/verify-email",
  async (req: Request, res: Response) => {
    try {
      const { token } = VerifySchema.parse(req.query);

      const user = await prisma.user.findFirst({
        where: {
          emailVerifyToken: token,
        },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid verification token",
        });
      }

      if (
        !user.emailVerifyTokenExpiry ||
        user.emailVerifyTokenExpiry < new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: "Verification token expired",
        });
      }

      await prisma.user.update({
        where: {
          id: user.id,
        },

        data: {
          emailVerified: true,
          emailVerifiedAt: new Date(),

          emailVerifyToken: null,
          emailVerifyTokenExpiry: null,
        },
      });

      await sendMail({
        to: user.email,
        subject: "Welcome to Namama ✨",

        html: welcomeEmailTemplate({
          name: user.firstName,
        }),

        text: `Welcome to Namama, ${user.firstName}!`,
      });

      return res.json({
        success: true,
        message:
          "Email verified successfully. You can login now.",
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/* ============================================================
   RESEND EMAIL VERIFICATION
============================================================ */

const ResendSchema = z.object({
  email: z.string().email(),
});

router.post(
  "/resend-verification",
  async (req: Request, res: Response) => {
    try {
      const { email } = ResendSchema.parse(req.body);

      const normalizedEmail =
        email.toLowerCase().trim();

      const user = await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

      // Avoid account enumeration
      if (!user) {
        return res.json({
          success: true,
          message:
            "If the email exists, a link was sent.",
        });
      }

      if (user.emailVerified) {
        return res.json({
          success: true,
          message: "Email already verified.",
        });
      }

      const token =
        crypto.randomBytes(32).toString("hex");

      const expiry = new Date(
        Date.now() + 60 * 60 * 1000
      );

      await prisma.user.update({
        where: {
          id: user.id,
        },

        data: {
          emailVerifyToken: token,
          emailVerifyTokenExpiry: expiry,
        },
      });

      const verifyUrl =
        `${FRONTEND_URL}/verify-email?token=${token}`;

      await sendMail({
        to: user.email,
        subject: "Verify your email - Namama",

        html: verifyEmailTemplate({
          name: user.firstName,
          verifyUrl,
        }),

        text: `Verify your email: ${verifyUrl}`,
      });

      return res.json({
        success: true,
        message:
          "If the email exists, a link was sent.",
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/* ============================================================
   LOGIN
============================================================ */

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  async (req: Request, res: Response) => {
    try {
      const { email, password } =
        LoginSchema.parse(req.body);

      const normalizedEmail =
        email.toLowerCase().trim();

      const user = await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

      if (!user || !user.isActive) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      if (!user.emailVerified) {
        return res.status(403).json({
          success: false,
          message:
            "Please verify your email before logging in.",
        });
      }

      if (!user.passwordHash) {
        return res.status(400).json({
          success: false,
          message:
            "Use OTP or social login for this account",
        });
      }

      const match = await bcrypt.compare(
        password,
        user.passwordHash
      );

      if (!match) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion,
        },
        JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );

      return res.json({
        success: true,

        data: {
          token,

          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            role: user.role,
          tokenVersion: user.tokenVersion,
          },
        },
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/* ============================================================
   LOGOUT
============================================================ */

router.post(
  "/logout",
  async (_req: Request, res: Response) => {
    return res.json({
      success: true,
      message: "Logged out successfully",
    });
  }
);

/* ============================================================
   PROFILE
============================================================ */

router.get(
  "/profile",
  auth,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },

        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          role: true,
          emailVerified: true,
          createdAt: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.json({
        success: true,
        data: user,
      });
    } catch {
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

/* ============================================================
   FORGOT PASSWORD
============================================================ */

const ForgotSchema = z.object({
  email: z.string().email(),
});

router.post(
  "/password/forgot",
  async (req: Request, res: Response) => {
    try {
      const { email } = ForgotSchema.parse(req.body);

      const normalizedEmail =
        email.toLowerCase().trim();

      const user = await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

      // Prevent email enumeration
      if (!user) {
        return res.json({
          success: true,
          message:
            "If the email exists, a reset link was sent.",
        });
      }

      const token =
        crypto.randomBytes(32).toString("hex");

      const expiry = new Date(
        Date.now() + 30 * 60 * 1000
      );

      await prisma.user.update({
        where: {
          id: user.id,
        },

        data: {
          resetPasswordToken: token,
          resetPasswordTokenExpiry: expiry,
        },
      });

      const resetUrl =
        `${FRONTEND_URL}/reset-password?token=${token}`;

      await sendMail({
        to: user.email,
        subject: "Reset your password - Namama",

        html: resetPasswordTemplate({
          name: user.firstName,
          resetUrl,
        }),

        text: `Reset your password: ${resetUrl}`,
      });

      return res.json({
        success: true,
        message:
          "If the email exists, a reset link was sent.",
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/* ============================================================
   RESET PASSWORD
============================================================ */

const ResetSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(6),
});

router.post(
  "/password/reset",
  async (req: Request, res: Response) => {
    try {
      const { token, newPassword } =
        ResetSchema.parse(req.body);

      const user = await prisma.user.findFirst({
        where: {
          resetPasswordToken: token,
        },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid reset token",
        });
      }

      if (
        !user.resetPasswordTokenExpiry ||
        user.resetPasswordTokenExpiry <
          new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: "Reset token expired",
        });
      }

      const hashed = await bcrypt.hash(
        newPassword,
        10
      );

      await prisma.user.update({
        where: {
          id: user.id,
        },

        data: {
          passwordHash: hashed,
          tokenVersion: { increment: 1 },
          resetPasswordToken: null,
          resetPasswordTokenExpiry: null,
        },
      });

      return res.json({
        success: true,
        message: "Password updated successfully",
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/* ============================================================
   OTP LOGIN - REQUEST
============================================================ */

const OtpRequestSchema = z.object({
  email: z.string().email(),
});

router.post(
  "/otp/request",
  async (req: Request, res: Response) => {
    try {
      const { email } =
        OtpRequestSchema.parse(req.body);

      const normalizedEmail =
        email.toLowerCase().trim();

      const code = String(
        crypto.randomInt(100000, 1000000)
      );

      const codeHash = await bcrypt.hash(
        code,
        10
      );

      await prisma.otpCode.create({
        data: {
          target: normalizedEmail,
          channel: "EMAIL",
          purpose: "LOGIN",
          codeHash,

          expiresAt: new Date(
            Date.now() + 10 * 60 * 1000
          ),
        },
      });

      await sendMail({
        to: normalizedEmail,

        subject: "Your Namama login code",

        html: `
          <p>
            Your Namama verification code is
            <strong>${code}</strong>.
            It expires in 10 minutes.
          </p>
        `,

        text:
          `Your Namama verification code is ${code}. ` +
          `It expires in 10 minutes.`,
      });

      return res.json({
        success: true,
        message: "OTP sent",
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/* ============================================================
   OTP LOGIN - VERIFY
============================================================ */

const OtpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),

  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

router.post(
  "/otp/verify",
  async (req: Request, res: Response) => {
    try {
      const {
        email,
        code,
        firstName,
        lastName,
      } = OtpVerifySchema.parse(req.body);

      const normalizedEmail =
        email.toLowerCase().trim();

      const row = await prisma.otpCode.findFirst({
        where: {
          target: normalizedEmail,
          purpose: "LOGIN",
          consumedAt: null,

          expiresAt: {
            gt: new Date(),
          },
        },

        orderBy: {
          createdAt: "desc",
        },
      });

      if (!row || row.attempts >= 5) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP",
        });
      }

      const validCode = await bcrypt.compare(
        code,
        row.codeHash
      );

      if (!validCode) {
        await prisma.otpCode.update({
          where: {
            id: row.id,
          },

          data: {
            attempts: {
              increment: 1,
            },
          },
        });

        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP",
        });
      }

      await prisma.otpCode.update({
        where: {
          id: row.id,
        },

        data: {
          consumedAt: new Date(),
        },
      });

      let user = await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: normalizedEmail,

            firstName:
              firstName || "Namama",

            lastName:
              lastName || "Customer",

            passwordHash: null,

            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });
      }

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "Account disabled",
        });
      }

      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion,
        },
        JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );

      return res.json({
        success: true,

        data: {
          token,

          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            role: user.role,
          tokenVersion: user.tokenVersion,
          },
        },
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/* ============================================================
   SOCIAL LOGIN
   Google / Facebook access token
============================================================ */

const SocialLoginSchema = z.object({
  provider: z.enum([
    "google",
    "facebook",
  ]),

  accessToken: z.string().min(10),
});

router.post(
  "/social",
  async (req: Request, res: Response) => {
    try {
      const {
        provider,
        accessToken,
      } = SocialLoginSchema.parse(req.body);

      let url: string;

      if (provider === "google") {
        url =
          "https://www.googleapis.com/oauth2/v3/userinfo";
      } else {
        url =
          "https://graph.facebook.com/me" +
          "?fields=id,email,first_name,last_name" +
          `&access_token=${encodeURIComponent(
            accessToken
          )}`;
      }

      const response = await fetch(url, {
        headers:
          provider === "google"
            ? {
                Authorization:
                  `Bearer ${accessToken}`,
              }
            : {},
      });

      if (!response.ok) {
        return res.status(401).json({
          success: false,
          message: "Invalid social token",
        });
      }

      const profile: any =
        await response.json();

      const providerUserId = String(
        profile.sub || profile.id || ""
      );

      const email = String(
        profile.email || ""
      )
        .toLowerCase()
        .trim();

      if (!providerUserId || !email) {
        return res.status(400).json({
          success: false,
          message:
            "Provider did not return an email",
        });
      }

      /*
       * First look for existing social identity.
       */
      const identity =
        await prisma.authIdentity.findUnique({
          where: {
            provider_providerUserId: {
              provider,
              providerUserId,
            },
          },

          include: {
            user: true,
          },
        });

      /*
       * Explicitly use User | null instead of
       * identity?.user which produces User | undefined.
       *
       * Prisma findUnique returns User | null, so this
       * prevents the null/undefined TypeScript mismatch.
       */
      let user =
        identity?.user ?? null;

      if (!user) {
        /*
         * User may already have registered with email/password
         * or OTP using the same email.
         */
        const existingUser =
          await prisma.user.findUnique({
            where: {
              email,
            },
          });

        if (existingUser) {
          user = existingUser;
        } else {
          user = await prisma.user.create({
            data: {
              email,

              firstName:
                profile.given_name ||
                profile.first_name ||
                "Namama",

              lastName:
                profile.family_name ||
                profile.last_name ||
                "Customer",

              passwordHash: null,

              emailVerified: true,
              emailVerifiedAt: new Date(),
            },
          });
        }

        /*
         * Link provider identity to user.
         */
        await prisma.authIdentity.create({
          data: {
            userId: user.id,
            provider,
            providerUserId,
            email,
          },
        });
      }

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "Account disabled",
        });
      }

      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion,
        },
        JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );

      return res.json({
        success: true,

        data: {
          token,

          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            role: user.role,
          tokenVersion: user.tokenVersion,
          },
        },
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

export default router;