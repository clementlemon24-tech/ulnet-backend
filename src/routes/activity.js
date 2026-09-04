/**
 * ULNet Activity Routes
 * POST /v1/activity/log       — log a blocked event from extension/app
 * GET  /v1/activity           — get activity for current user's children
 * GET  /v1/activity/:childId  — get activity for specific child
 */

import { Router } from 'express';
import { db } from '../services/database.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ─── Log an activity event ────────────────────────────────────────────────────

router.post('/log', async (req, res, next) => {
  try {
    const { type, reason, url, platform, content, timestamp } = req.body;
    const userId = req.user.userId;

    await db.query(
      `INSERT INTO activity_log
         (id, user_id, type, reason, url, platform, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        uuidv4(),
        userId,
        type || 'unknown',
        reason || null,
        url ? url.slice(0, 2000) : null,
        platform || null,
        content ? content.slice(0, 500) : null,
        timestamp ? new Date(timestamp).toISOString() : new Date().toISOString()
      ]
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Get activity for parent's children ───────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { days = 7, limit = 100 } = req.query;

    const result = await db.query(
      `SELECT al.id, al.type, al.reason, al.url, al.platform,
              al.created_at, u.name as child_name
       FROM activity_log al
       JOIN users u ON u.id = al.user_id
       JOIN children c ON c.child_user_id = al.user_id
       WHERE c.parent_id = $1
         AND al.created_at >= datetime('now', $2)
       ORDER BY al.created_at DESC
       LIMIT $3`,
      [userId, `-${parseInt(days, 10)} days`, Math.min(parseInt(limit, 10), 500)]
    );

    res.json({ activity: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── Get activity for a specific child ────────────────────────────────────────

router.get('/:childId', async (req, res, next) => {
  try {
    const parentId = req.user.userId;
    const { childId } = req.params;
    const { days = 7, limit = 100, page = 1 } = req.query;

    // Verify parent owns this child
    const ownership = await db.query(
      'SELECT id FROM children WHERE parent_id = $1 AND id = $2',
      [parentId, childId]
    );
    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const result = await db.query(
      `SELECT al.id, al.type, al.reason, al.url, al.platform, al.created_at
       FROM activity_log al
       JOIN children c ON c.child_user_id = al.user_id
       WHERE c.id = $1
         AND al.created_at >= datetime('now', $2)
       ORDER BY al.created_at DESC
       LIMIT $3 OFFSET $4`,
      [childId, `-${parseInt(days, 10)} days`, Math.min(parseInt(limit, 10), 500), offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) as cnt FROM activity_log al
       JOIN children c ON c.child_user_id = al.user_id
       WHERE c.id = $1
         AND al.created_at >= datetime('now', $2)`,
      [childId, `-${parseInt(days, 10)} days`]
    );

    res.json({
      activity: result.rows,
      total: parseInt(countResult.rows[0]?.cnt ?? countResult.rows[0]?.['count(*)'] ?? 0, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Get today's summary stats ────────────────────────────────────────────────

router.get('/:childId/summary', async (req, res, next) => {
  try {
    const parentId = req.user.userId;
    const { childId } = req.params;

    // Verify ownership
    const ownership = await db.query(
      'SELECT id FROM children WHERE parent_id = $1 AND id = $2',
      [parentId, childId]
    );
    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Get summary by pulling raw rows and computing in JS (SQLite-safe)
    const logRows = await db.query(
      `SELECT al.type, al.reason, al.created_at
       FROM activity_log al
       JOIN children c ON c.child_user_id = al.user_id
       WHERE c.id = $1
         AND date(al.created_at) = date('now')`,
      [childId]
    );

    const today = new Date().toDateString();
    const todayRows = logRows.rows.filter(r => new Date(r.created_at).toDateString() === today);

    const stats = {
      blocked_today: todayRows.length,
      scams_today: todayRows.filter(r => r.reason === 'scam').length,
      explicit_today: todayRows.filter(r => ['adult','nudity'].includes(r.reason)).length,
      blocked_week: logRows.rows.length,
    };

    // Screen time today
    const screenTime = await db.query(
      `SELECT platform, minutes FROM screen_time
       WHERE child_id = $1 AND recorded_date = date('now')`,
      [childId]
    );

    res.json({
      stats,
      screenTime: screenTime.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
