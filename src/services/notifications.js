/**
 * ULNet Notification Service
 * Handles: Firebase push notifications, email reports, WhatsApp summaries (via Twilio)
 */

import admin from 'firebase-admin';

// ─── Firebase Admin Init ──────────────────────────────────────────────────────

let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return;

  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log('[ULNet] ✅ Firebase Admin initialized');
  } catch (err) {
    console.error('[ULNet] Firebase init error:', err.message);
  }
}

// ─── Push Notification to Parent ─────────────────────────────────────────────

/**
 * Send a push notification to a parent's device.
 * @param {string} fcmToken  — parent's Firebase Cloud Messaging token
 * @param {{ title: string, body: string, data?: object }} notification
 */
export async function sendPushNotification(fcmToken, { title, body, data = {} }) {
  initFirebase();
  if (!firebaseInitialized || !fcmToken) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: {
          channelId: 'ulnet_alerts',
          sound: 'default',
        }
      },
    });
  } catch (err) {
    console.error('[ULNet] Push notification error:', err.message);
  }
}

// ─── Daily Report Notification ────────────────────────────────────────────────

/**
 * @param {string} parentEmail
 * @param {{ childName, stats, screenTime, date }} reportData
 */
export async function sendDailyReportNotification(parentEmail, reportData) {
  const { childName, stats, screenTime, date } = reportData;

  // Build summary text
  const totalTime = Object.values(screenTime || {}).reduce((a, b) => a + (b || 0), 0);
  const topPlatform = Object.entries(screenTime || {})
    .sort((a, b) => b[1] - a[1])[0];

  const summary = [
    `🛡️ ULNet Daily Report — ${childName}`,
    `Date: ${date}`,
    ``,
    `📊 Today's Activity:`,
    `• ${stats.total} items blocked`,
    `• ${stats.scams} scam links blocked`,
    `• ${stats.explicit} adult content blocked`,
    `• ${stats.violence} violent content blocked`,
    ``,
    `⏰ Screen Time: ${totalTime} minutes total`,
    topPlatform ? `• Most time on ${topPlatform[0]}: ${topPlatform[1]} min` : '',
    ``,
    `View full details: https://ulnet.ng/dashboard`,
  ].filter(Boolean).join('\n');

  // Send email (handled by email service)
  const { sendEmail } = await import('./email.js');
  await sendEmail({
    to: parentEmail,
    subject: `ULNet Daily Report — ${childName} (${date})`,
    text: summary,
    html: buildReportEmailHtml(childName, stats, screenTime, date)
  });
}

// ─── Instant Alert (e.g., child tried to access blocked content) ──────────────

export async function sendInstantAlert(fcmToken, { childName, reason, platform }) {
  const reasonLabels = {
    scam: '🚨 Scam link blocked',
    adult: '🔞 Adult content blocked',
    violence: '⚠️ Violent content blocked',
    hate_speech: '⚠️ Hate speech blocked',
  };

  await sendPushNotification(fcmToken, {
    title: `ULNet Alert — ${childName}`,
    body: `${reasonLabels[reason] || '🛡️ Content blocked'} on ${platform}`,
    data: { childName, reason, platform, type: 'instant_alert' }
  });
}

// ─── Email HTML Builder ───────────────────────────────────────────────────────

function buildReportEmailHtml(childName, stats, screenTime, date) {
  const totalTime = Object.values(screenTime || {}).reduce((a, b) => a + (b || 0), 0);

  const platformRows = Object.entries(screenTime || {})
    .map(([platform, mins]) =>
      `<tr><td style="padding:6px 12px">${platform}</td><td style="padding:6px 12px">${mins} min</td></tr>`
    ).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
    <div style="background:#1d4ed8;padding:24px 32px;color:#fff">
      <h1 style="margin:0;font-size:20px">🛡️ ULNet Daily Report</h1>
      <p style="margin:4px 0 0;opacity:0.8;font-size:14px">${childName} · ${date}</p>
    </div>
    <div style="padding:24px 32px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
        ${statCard('🚫 Total Blocked', stats.total)}
        ${statCard('🔗 Scams Blocked', stats.scams)}
        ${statCard('🔞 Adult Blocked', stats.explicit)}
        ${statCard('⏰ Screen Time', `${totalTime} min`)}
      </div>

      ${platformRows ? `
      <h3 style="margin:0 0 8px;font-size:14px;color:#374151">Platform Breakdown</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:6px 12px;text-align:left">Platform</th>
            <th style="padding:6px 12px;text-align:left">Time</th>
          </tr>
        </thead>
        <tbody>${platformRows}</tbody>
      </table>
      ` : ''}

      <div style="margin-top:24px;text-align:center">
        <a href="https://ulnet.ng/dashboard"
           style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
          View Full Dashboard →
        </a>
      </div>
    </div>
    <div style="padding:16px 32px;background:#f8fafc;text-align:center;font-size:12px;color:#94a3b8">
      ULNet · Nigeria's Safety Layer · <a href="https://ulnet.ng" style="color:#1d4ed8">ulnet.ng</a>
    </div>
  </div>
</body>
</html>`;
}

function statCard(label, value) {
  return `
    <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#1d4ed8">${value}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">${label}</div>
    </div>`;
}
