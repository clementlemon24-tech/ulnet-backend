/**
 * ULNet Email Service — uses Nodemailer with any SMTP provider.
 * Works with: Gmail, Zoho, SendGrid, AWS SES.
 */

import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

/**
 * Send a generic email.
 */
export async function sendEmail({ to, subject, text, html }) {
  const mailer = getTransporter();
  if (!process.env.SMTP_USER) {
    console.warn('[ULNet] SMTP not configured — email skipped:', subject);
    return;
  }

  try {
    await mailer.sendMail({
      from: `"ULNet Safety" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.error('[ULNet] Email send error:', err.message);
  }
}

/**
 * Welcome email sent after registration.
 */
export async function sendWelcomeEmail(to, name) {
  await sendEmail({
    to,
    subject: 'Welcome to ULNet — Your Safety Layer is Active',
    text: `Hi ${name},\n\nWelcome to ULNet! Your account is ready.\n\nInstall the Chrome extension and set up your family profiles at https://ulnet.ng/dashboard\n\nStay safe,\nThe ULNet Team`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <div style="background:#1d4ed8;padding:24px;border-radius:12px 12px 0 0;color:#fff;text-align:center">
          <h1 style="margin:0;font-size:24px">🛡️ Welcome to ULNet</h1>
          <p style="margin:8px 0 0;opacity:0.8">Nigeria's Safety Layer</p>
        </div>
        <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
          <p>Hi <strong>${name}</strong>,</p>
          <p>Your ULNet account is ready. Here's how to get started:</p>
          <ol style="color:#374151;line-height:1.8">
            <li>Install the <a href="https://ulnet.ng/extension">Chrome extension</a></li>
            <li>Open <a href="https://ulnet.ng/dashboard">your dashboard</a></li>
            <li>Add your children's profiles</li>
            <li>You're protected 🛡️</li>
          </ol>
          <div style="text-align:center;margin-top:24px">
            <a href="https://ulnet.ng/dashboard"
               style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">
              Open Dashboard →
            </a>
          </div>
        </div>
      </div>
    `
  });
}

/**
 * Password reset email.
 */
export async function sendPasswordResetEmail(to, resetToken) {
  const resetUrl = `https://ulnet.ng/reset-password?token=${resetToken}`;

  await sendEmail({
    to,
    subject: 'ULNet — Reset Your Password',
    text: `Reset your ULNet password here:\n${resetUrl}\n\nThis link expires in 1 hour.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2>🔑 Reset Your ULNet Password</h2>
        <p>Click below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${resetUrl}"
             style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">
            Reset Password
          </a>
        </div>
        <p style="color:#94a3b8;font-size:12px">If you didn't request this, ignore this email.</p>
      </div>
    `
  });
}
