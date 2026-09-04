/**
 * ULNet Family Management Routes
 * POST /v1/family/children         — add a child profile
 * GET  /v1/family/children         — list all children
 * GET  /v1/family/children/:id     — get one child
 * PUT  /v1/family/children/:id     — update child settings
 * DELETE /v1/family/children/:id   — remove child
 * POST /v1/family/children/:id/pin — update parent PIN
 */

import { Router } from 'express';
import { db } from '../services/database.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const router = Router();

// ─── List children ────────────────────────────────────────────────────────────

router.get('/children', async (req, res, next) => {
  try {
    const parentId = req.user.userId;

    const result = await db.query(
      `SELECT c.id, c.name, c.age, c.avatar, c.is_active, c.created_at,
              s.settings,
              (SELECT MAX(created_at) FROM activity_log al
               WHERE al.user_id = c.child_user_id) as last_active
       FROM children c
       LEFT JOIN user_settings s ON s.user_id = c.child_user_id
       WHERE c.parent_id = $1
       ORDER BY c.created_at`,
      [parentId]
    );

    const children = result.rows.map(row => ({
      ...row,
      settings: row.settings ? JSON.parse(row.settings) : null
    }));

    res.json({ children });
  } catch (err) {
    next(err);
  }
});

// ─── Add child profile ────────────────────────────────────────────────────────

router.post('/children', async (req, res, next) => {
  try {
    const parentId = req.user.userId;
    const { name, age, pin, settings } = req.body;

    if (!name || !age || !pin) {
      return res.status(400).json({ error: 'Name, age, and PIN are required.' });
    }

    if (pin.toString().length !== 4 || isNaN(pin)) {
      return res.status(400).json({ error: 'PIN must be a 4-digit number.' });
    }

    // Check limit — max 5 children per parent
    const count = await db.query(
      'SELECT COUNT(*) FROM children WHERE parent_id = $1', [parentId]
    );
    if (parseInt(count.rows[0]['count(*)'] ?? count.rows[0].count ?? 0, 10) >= 5) {
      return res.status(400).json({ error: 'Maximum 5 child profiles allowed.' });
    }

    const childUserId = uuidv4();
    const childId = uuidv4();
    const pinHash = await bcrypt.hash(pin.toString(), 10);

    const childSettings = {
      filterImages: true,
      filterText: true,
      detectScams: true,
      bedtimeEnabled: true,
      bedtimeHour: 21,
      wakeHour: 7,
      parentPin: pin.toString(), // stored in plain for quick client-side check
      pinHash,
      screenTimeLimits: {
        'tiktok.com': 60,
        'instagram.com': 60,
        'youtube.com': 90,
        'default': 120,
      },
      blockedKeywords: [],
      blockedAccounts: [],
      ...settings
    };

    // Create a pseudo user record for the child
    const now = new Date().toISOString();
    await db.query(
      'INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [childUserId, name.trim(), `child_${childId}@ulnet.internal`, await bcrypt.hash(uuidv4(), 10), 'child', now, now]
    );

    await db.query(
      'INSERT INTO user_settings (user_id, settings, created_at, updated_at) VALUES ($1,$2,$3,$4)',
      [childUserId, JSON.stringify(childSettings), now, now]
    );

    await db.query(
      'INSERT INTO children (id, parent_id, child_user_id, name, age, avatar, is_active, created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7)',
      [childId, parentId, childUserId, name.trim(), parseInt(age, 10), defaultAvatar(parseInt(age, 10)), now]
    );

    res.status(201).json({
      child: {
        id: childId,
        name: name.trim(),
        age: parseInt(age, 10),
        settings: childSettings,
        is_active: true
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── Update child settings ────────────────────────────────────────────────────

router.put('/children/:id', async (req, res, next) => {
  try {
    const parentId = req.user.userId;
    const { id } = req.params;
    const updates = req.body;

    // Verify ownership
    const child = await db.query(
      'SELECT child_user_id FROM children WHERE id = $1 AND parent_id = $2',
      [id, parentId]
    );
    if (child.rows.length === 0) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    const childUserId = child.rows[0].child_user_id;

    // Merge settings
    const existing = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = $1', [childUserId]
    );
    const current = existing.rows[0]?.settings
      ? JSON.parse(existing.rows[0].settings) : {};
    const merged = { ...current, ...updates.settings };

    await db.query(
      'UPDATE user_settings SET settings = $1 WHERE user_id = $2',
      [JSON.stringify(merged), childUserId]
    );

    // Update child name/age if provided
    if (updates.name || updates.age) {
      await db.query(
        'UPDATE children SET name = COALESCE($1, name), age = COALESCE($2, age) WHERE id = $3',
        [updates.name, updates.age, id]
      );
    }

    res.json({ success: true, settings: merged });
  } catch (err) {
    next(err);
  }
});

// ─── Delete child profile ─────────────────────────────────────────────────────

router.delete('/children/:id', async (req, res, next) => {
  try {
    const parentId = req.user.userId;
    const { id } = req.params;

    const child = await db.query(
      'SELECT child_user_id FROM children WHERE id = $1 AND parent_id = $2',
      [id, parentId]
    );
    if (child.rows.length === 0) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    const childUserId = child.rows[0].child_user_id;

    // Soft-delete: mark inactive
    await db.query('UPDATE children SET is_active = false WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Verify parent PIN ────────────────────────────────────────────────────────

router.post('/children/:id/verify-pin', async (req, res, next) => {
  try {
    const parentId = req.user.userId;
    const { id } = req.params;
    const { pin } = req.body;

    const child = await db.query(
      `SELECT s.settings FROM children c
       JOIN user_settings s ON s.user_id = c.child_user_id
       WHERE c.id = $1 AND c.parent_id = $2`,
      [id, parentId]
    );
    if (child.rows.length === 0) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    const settings = JSON.parse(child.rows[0].settings);
    const valid = settings.parentPin === pin.toString() ||
      await bcrypt.compare(pin.toString(), settings.pinHash || '');

    res.json({ valid });
  } catch (err) {
    next(err);
  }
});

// ─── Update blocked keywords / accounts ──────────────────────────────────────

router.post('/children/:id/blocklist', async (req, res, next) => {
  try {
    const parentId = req.user.userId;
    const { id } = req.params;
    const { keywords = [], accounts = [] } = req.body;

    const child = await db.query(
      'SELECT child_user_id FROM children WHERE id = $1 AND parent_id = $2',
      [id, parentId]
    );
    if (child.rows.length === 0) {
      return res.status(404).json({ error: 'Child not found.' });
    }

    const childUserId = child.rows[0].child_user_id;
    const existing = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = $1', [childUserId]
    );
    const settings = existing.rows[0]?.settings
      ? JSON.parse(existing.rows[0].settings) : {};

    settings.blockedKeywords = keywords.map(k => k.toLowerCase().trim());
    settings.blockedAccounts = accounts.map(a => a.toLowerCase().trim());

    await db.query(
      'UPDATE user_settings SET settings = $1 WHERE user_id = $2',
      [JSON.stringify(settings), childUserId]
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultAvatar(age) {
  if (age < 10) return '🧒';
  if (age < 14) return '👦';
  if (age < 18) return '🧑';
  return '👤';
}

export default router;
