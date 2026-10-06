export function verifyEmailTemplate(params: { name: string; verifyUrl: string }) {
  const { name, verifyUrl } = params;

  return `
  <div style="font-family:Arial,sans-serif;line-height:1.6">
    <h2>Verify your email</h2>
    <p>Hi ${name},</p>
    <p>Thanks for registering. Please verify your email to activate your account:</p>
    <p>
      <a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">
        Verify Email
      </a>
    </p>
    <p>If the button doesn't work, copy this link:</p>
    <p>${verifyUrl}</p>
  </div>`;
}

export function welcomeEmailTemplate(params: { name: string }) {
  const { name } = params;

  return `
  <div style="font-family:Arial,sans-serif;line-height:1.6">
    <h2>Welcome to Crescent Healthcare ✨</h2>
    <p>Hi ${name},</p>
    <p>Your account has been verified successfully. 🎉</p>
    <p>Now you can login and start shopping.</p>
    <p>Thank you,<br/>Crescent Healthcare Team</p>
  </div>`;
}

export function resetPasswordTemplate(params: { name: string; resetUrl: string }) {
  const { name, resetUrl } = params;

  return `
  <div style="font-family:Arial,sans-serif;line-height:1.6">
    <h2>Reset your password</h2>
    <p>Hi ${name},</p>
    <p>We received a request to reset your password.</p>
    <p>
      <a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">
        Reset Password
      </a>
    </p>
    <p>This link will expire soon. If you didn’t request this, ignore this email.</p>
    <p>${resetUrl}</p>
  </div>`;
}
