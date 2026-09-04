/**
 * ULNet Firebase Service
 * Handles all push notification delivery to parent devices.
 *
 * Notification types:
 * 1. instant_alert  — fired immediately when child's content is blocked
 * 2. daily_report   — sent every evening summarising the day
 * 3. bedtime_breach — child tried to access social media after bedtime
 * 4. vpn_disabled   — child removed the ULNet app / VPN permission
 * 5. screen_time    — child reached their daily screen time limit
 */

import { db } from './database.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let admin = null;

function getAdmin() {
  if (!admin) {
    try {
      admin = require('firebase-admin');
    } catch {
      admin = null;
    }
  }
  return admin;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

let initialized = false;

export function initFirebase() {
  if (initialized) return;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson || serviceAccountJson.trim() === '') {
    console.log('[ULNet Firebase] ℹ️  No service account — push notifications disabled (add FIREBASE_SERVICE_ACCOUNT_JSON to .env to enable)');
    return;
  }
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    const a = getAdmin();
    if (!a) { console.warn('[ULNet Firebase] firebase-admin not installed'); return; }
    a.initializeApp({ credential: a.credential.cert(serviceAccount) });
    initialized = true;
    console.log('[ULNet Firebase] ✅ Initialized');
  } catch (err) {
    console.warn('[ULNet Firebase] Init skipped:', err.message);
  }
}

// ─── Core Send ────────────────────────────────────────────────────────────────

/**
 * Send a push notification to a single device token.
 * @param {string} fcmToken
 * @param {{ title: string, body: string, data?: Record<string,string> }} payload
 */
export async function sendPush(fcmToken, { title, body, data = {} }) {
  if (!initialized || !fcmToken) return;
  const a = getAdmin();
  if (!a) return;

  const message = {
    token: fcmToken,
    notification: { title, body },
    data: sanitizeData(data),
    android: {
      priority: 'high',
      notification: {
        channelId: 'ulnet_alerts',
        sound: 'default',
        icon: 'ic_ulnet_shield',
        color: '#1d4ed8',
        clickAction: 'OPEN_DASHBOARD',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          'content-available': 1,
        },
      },
    },
  };

  try {
    const response = await a.messaging().send(message);
    return { success: true, messageId: response };
  } catch (err) {
    console.error('[ULNet Firebase] Send error:', err.code, err.message);
    // If token is invalid, remove it from DB
    if (err.code === 'messaging/invalid-registration-token' ||
        err.code === 'messaging/registration-token-not-registered') {
      await invalidateToken(fcmToken);
    }
    return { success: false, error: err.message };
  }
}

/**
 * Send to multiple tokens (for multi-device parents).
 */
export async function sendPushMulticast(fcmTokens, payload) {
  if (!initialized || !fcmTokens?.length) return;
  const a = getAdmin();
  if (!a) return;

  const validTokens = fcmTokens.filter(t => t && t.length > 10);
  if (validTokens.length === 0) return;

  const message = {
    tokens: validTokens,
    notification: { title: payload.title, body: payload.body },
    data: sanitizeData(payload.data || {}),
    android: { priority: 'high' },
  };

  try {
    const response = await a.messaging().sendEachForMulticast(message);
    // Clean up invalid tokens
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code;
        if (code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered') {
          invalidateToken(validTokens[idx]);
        }
      }
    });
    return response;
  } catch (err) {
    console.error('[ULNet Firebase] Multicast error:', err.message);
  }
}

// ─── Notification Templates ───────────────────────────────────────────────────

/**
 * Fired when the child's content is blocked.
 * Parents get this as an immediate alert (if enabled).
 */
export async function sendInstantBlockAlert(parentUserId, { childName, reason, platform }) {
  const tokens = await getParentFcmTokens(parentUserId);
  if (!tokens.length) return;

  const reasonLabels = {
    adult:       '🔞 Adult content blocked',
    violence:    '⚠️ Violent content blocked',
    scam:        '🚨 Scam link blocked',
    hate_speech: '🚫 Hate speech blocked',
    cyberbullying: '😢 Bullying content blocked',
    fake_news:   '📰 Possible misinformation flagged',
  };

  const label = reasonLabels[reason] || '🛡️ Content blocked';

  await sendPushMulticast(tokens, {
    title: `ULNet Alert — ${childName}`,
    body: `${label} on ${platform || 'social media'}`,
    data: { type: 'instant_alert', childName, reason, platform: platform || '' },
  });
}

/**
 * Daily report notification — sent at 8 PM each day.
 */
export async function sendDailyReportPush(parentUserId, { childName, stats, date }) {
  const tokens = await getParentFcmTokens(parentUserId);
  if (!tokens.length) return;

  const body = stats.total > 0
    ? `${stats.total} items blocked · ${stats.scams} scams · ${stats.explicit} adult content`
    : 'All clear today — nothing blocked ✅';

  await sendPushMulticast(tokens, {
    title: `📊 ULNet Daily Report — ${childName}`,
    body,
    data: { type: 'daily_report', childName, date, blocked: String(stats.total) },
  });
}

/**
 * Bedtime breach — child tried to open social media after bedtime.
 */
export async function sendBedtimeBreachAlert(parentUserId, { childName, platform }) {
  const tokens = await getParentFcmTokens(parentUserId);
  if (!tokens.length) return;

  await sendPushMulticast(tokens, {
    title: `🌙 Bedtime Alert — ${childName}`,
    body: `${childName} tried to open ${platform} after bedtime`,
    data: { type: 'bedtime_breach', childName, platform: platform || '' },
  });
}

/**
 * Alert when child disables VPN / uninstalls app.
 */
export async function sendVpnDisabledAlert(parentUserId, { childName }) {
  const tokens = await getParentFcmTokens(parentUserId);
  if (!tokens.length) return;

  await sendPushMulticast(tokens, {
    title: `⚠️ Protection Disabled — ${childName}`,
    body: `ULNet VPN was turned off on ${childName}'s phone. Check immediately.`,
    data: { type: 'vpn_disabled', childName },
  });
}

/**
 * Screen time limit reached.
 */
export async function sendScreenTimeLimitAlert(parentUserId, { childName, platform, limit }) {
  const tokens = await getParentFcmTokens(parentUserId);
  if (!tokens.length) return;

  await sendPushMulticast(tokens, {
    title: `⏰ Screen Time — ${childName}`,
    body: `${childName} reached their ${limit}-minute limit on ${platform}`,
    data: { type: 'screen_time', childName, platform: platform || '', limit: String(limit) },
  });
}

// ─── FCM Token Management ─────────────────────────────────────────────────────

/**
 * Save/update a user's FCM token when they log in.
 */
export async function saveFcmToken(userId, token) {
  if (!token) return;
  try {
    await db.query(
      'UPDATE users SET fcm_token = $1 WHERE id = $2',
      [token, userId]
    );
  } catch (err) {
    console.error('[ULNet Firebase] Token save error:', err.message);
  }
}

/**
 * Get all FCM tokens for a parent (they may have multiple devices).
 */
async function getParentFcmTokens(parentUserId) {
  try {
    const result = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1 AND fcm_token IS NOT NULL',
      [parentUserId]
    );
    return result.rows.map(r => r.fcm_token).filter(Boolean);
  } catch {
    return [];
  }
}

async function invalidateToken(token) {
  try {
    await db.query(
      'UPDATE users SET fcm_token = NULL WHERE fcm_token = $1',
      [token]
    );
  } catch { /* silent */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeData(data) {
  // FCM data payload values must all be strings
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
  );
}
