/**
 * ULNet Reports Routes
 * POST /v1/reports/daily     — submit daily report from extension/app
 * GET  /v1/reports/:childId  — get historical reports
 */

import { Router } from 'express';
import { db } from '../services/database.js';
import { v4 as uuidv4 } from 'uuid';
import { sendDailyReportNotification } from '../services/notifications.js';

const router = Router();

// ─── Receive daily report from client ────────────────────────────────────────

router.post('/daily', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { activityLog, screenTime, date } = req.body;

    const stats = summarizeLog(activityLog || []);
    const reportId = uuidv4();

    await db.query(
      `INSERT INTO daily_reports
         (id, user_id, report_date, blocked_total, scams_blocked,
          explicit_blocked, screen_time_data, raw_summary, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id, report_date) DO UPDATE SET
         blocked_total = $4, scams_blocked = $5,
         explicit_blocked = $6, screen_time_data = $7, raw_summary = $8`,
      [
        reportId, userId,
        date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        stats.total, stats.scams, stats.explicit,
        JSON.stringify(screenTime || {}),
        JSON.stringify(stats)
      ]
    );

    // Find parent and send them a notification
    const childInfo = await db.query(
      `SELECT c.parent_id, c.name as child_name, u.name as parent_name,
              pu.email as parent_email
       FROM children c
       JOIN users pu ON pu.id = c.parent_id
       JOIN users u ON u.id = $1
       WHERE c.child_user_id = $1`,
      [userId]
    );

    if (childInfo.rows.length > 0) {
      const { parent_id, child_name, parent_email } = childInfo.rows[0];
      await sendDailyReportNotification(parent_email, {
        childName: child_name,
        stats,
        screenTime,
        date: date || new Date().toDateString()
      });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Get reports for a child ──────────────────────────────────────────────────

router.get('/:childId', async (req, res, next) => {
  try {
    const parentId = req.user.userId;
    const { childId } = req.params;
    const { days = 30 } = req.query;

    const ownership = await db.query(
      'SELECT child_user_id FROM children WHERE id = $1 AND parent_id = $2',
      [childId, parentId]
    );
    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const childUserId = ownership.rows[0].child_user_id;

    const result = await db.query(
      `SELECT report_date, blocked_total, scams_blocked, explicit_blocked,
              screen_time_data, raw_summary
       FROM daily_reports
       WHERE user_id = $1
         AND report_date > CURRENT_DATE - INTERVAL '${parseInt(days, 10)} days'
       ORDER BY report_date DESC`,
      [childUserId]
    );

    res.json({
      reports: result.rows.map(r => ({
        ...r,
        screenTime: r.screen_time_data ? JSON.parse(r.screen_time_data) : {},
        summary: r.raw_summary ? JSON.parse(r.raw_summary) : {}
      }))
    });
  } catch (err) {
    next(err);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function summarizeLog(log) {
  const summary = {
    total: log.length,
    scams: 0,
    explicit: 0,
    violence: 0,
    hateSpeech: 0,
    byPlatform: {}
  };

  for (const entry of log) {
    const reason = entry.reason || '';
    if (reason === 'scam') summary.scams++;
    if (['adult', 'nudity'].includes(reason)) summary.explicit++;
    if (reason === 'violence') summary.violence++;
    if (reason === 'hate_speech') summary.hateSpeech++;

    const platform = entry.platform || 'Unknown';
    summary.byPlatform[platform] = (summary.byPlatform[platform] || 0) + 1;
  }

  return summary;
}

export default router;
