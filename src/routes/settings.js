/**
 * ULNet Settings Routes
 * GET  /v1/settings        — get current user's settings
 * PUT  /v1/settings        — update settings
 */

import { Router } from 'express';
import { db } from '../services/database.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.json({ settings: {} });
    }

    res.json(JSON.parse(result.rows[0].settings));
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object is required.' });
    }

    const existing = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = $1',
      [req.user.userId]
    );

    const current = existing.rows[0]?.settings
      ? JSON.parse(existing.rows[0].settings) : {};
    const merged = { ...current, ...settings };

    await db.query(
      `INSERT INTO user_settings (user_id, settings, created_at)
       VALUES ($1, $2, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET settings = $2`,
      [req.user.userId, JSON.stringify(merged)]
    );

    res.json({ success: true, settings: merged });
  } catch (err) {
    next(err);
  }
});

export default router;
