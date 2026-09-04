/**
 * ULNet Job Scheduler
 * Runs background jobs:
 * - Daily reports at 8 PM Nigeria time (UTC+1)
 * - Token cleanup weekly
 * - Screen time reset at midnight
 *
 * Uses node-cron (lightweight — no Redis needed for these simple tasks).
 */

import cron from 'node-cron';
import { db } from './database.js';
import {
  sendDailyReportPush,
  sendInstantBlockAlert,
} from './firebase.js';
import { sendDailyReportNotification } from './notifications.js';

export function startScheduler() {
  try {
    // ── Daily Report — every day at 8 PM Nigeria time ──────────────────────
    cron.schedule('0 19 * * *', async () => {
      console.log('[ULNet Scheduler] Running daily reports...');
      await sendAllDailyReports().catch(e =>
        console.error('[ULNet Scheduler] Daily report error:', e.message));
    }, { timezone: 'Africa/Lagos' });

    // ── Midnight screen time reset ─────────────────────────────────────────
    cron.schedule('0 0 * * *', async () => {
      await archiveScreenTime().catch(() => {});
    }, { timezone: 'Africa/Lagos' });

    // ── Weekly stale data cleanup ──────────────────────────────────────────
    cron.schedule('0 2 * * 0', async () => {
      await cleanupOldData().catch(() => {});
    }, { timezone: 'Africa/Lagos' });

    console.log('[ULNet Scheduler] ✅ Jobs scheduled (Africa/Lagos)');
  } catch (err) {
    console.warn('[ULNet Scheduler] Could not start scheduler:', err.message);
  }
}

// ─── Daily Reports ────────────────────────────────────────────────────────────

async function sendAllDailyReports() {
  try {
    // Get all active child–parent pairs that have activity today
    const result = await db.query(`
      SELECT
        c.id as child_id,
        c.name as child_name,
        c.parent_id,
        u_parent.email as parent_email,
        u_parent.name as parent_name,
        u_parent.fcm_token,
        COUNT(al.id) as blocked_total,
        COUNT(al.id) FILTER (WHERE al.reason = 'scam') as scams,
        COUNT(al.id) FILTER (WHERE al.reason IN ('adult', 'nudity')) as explicit_count,
        COUNT(al.id) FILTER (WHERE al.reason = 'violence') as violence_count
      FROM children c
      JOIN users u_parent ON u_parent.id = c.parent_id
      LEFT JOIN activity_log al
        ON al.user_id = c.child_user_id
        AND al.created_at::date = CURRENT_DATE
      WHERE c.is_active = true
      GROUP BY c.id, c.name, c.parent_id, u_parent.email, u_parent.name, u_parent.fcm_token
    `);

    for (const row of result.rows) {
      const stats = {
        total:    parseInt(row.blocked_total, 10),
        scams:    parseInt(row.scams, 10),
        explicit: parseInt(row.explicit_count, 10),
        violence: parseInt(row.violence_count, 10),
      };

      const date = new Date().toLocaleDateString('en-NG', {
        weekday: 'long', day: 'numeric', month: 'long'
      });

      // Push notification
      if (row.fcm_token) {
        await sendDailyReportPush(row.parent_id, {
          childName: row.child_name,
          stats,
          date,
        });
      }

      // Email report
      await sendDailyReportNotification(row.parent_email, {
        childName: row.child_name,
        stats,
        screenTime: await getScreenTimeForChild(row.child_id),
        date,
      });
    }

    console.log(`[ULNet Scheduler] Daily reports sent for ${result.rows.length} children`);
  } catch (err) {
    console.error('[ULNet Scheduler] Daily report error:', err.message);
  }
}

async function getScreenTimeForChild(childId) {
  try {
    const result = await db.query(
      `SELECT platform, minutes FROM screen_time
       WHERE child_id = $1 AND recorded_date = CURRENT_DATE`,
      [childId]
    );
    return Object.fromEntries(result.rows.map(r => [r.platform, r.minutes]));
  } catch {
    return {};
  }
}

// ─── Screen Time Archive ──────────────────────────────────────────────────────

async function archiveScreenTime() {
  // Screen time older than 90 days can be summarised — keep daily_reports, prune raw rows
  try {
    await db.query(
      `DELETE FROM screen_time WHERE recorded_date < CURRENT_DATE - INTERVAL '90 days'`
    );
  } catch (err) {
    console.error('[ULNet Scheduler] Screen time archive error:', err.message);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanupOldData() {
  try {
    // Remove expired refresh tokens
    await db.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
    // Remove expired password resets
    await db.query('DELETE FROM password_resets WHERE expires_at < NOW()');
    // Prune activity logs older than 180 days
    await db.query(
      `DELETE FROM activity_log WHERE created_at < NOW() - INTERVAL '180 days'`
    );
    console.log('[ULNet Scheduler] Cleanup done');
  } catch (err) {
    console.error('[ULNet Scheduler] Cleanup error:', err.message);
  }
}
