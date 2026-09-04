/**
 * ULNet Auth Routes
 * POST /v1/auth/register
 * POST /v1/auth/login
 * POST /v1/auth/refresh
 * POST /v1/auth/forgot-password
 * POST /v1/auth/reset-password
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../services/database.js';

const router = Router();
const NOW = () => new Date().toISOString();

// ─── Register ─────────────────────────────────────────────────────────────────

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role = 'parent' } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const now = NOW();

    await db.query(
      'INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, name.trim(), normalizedEmail, passwordHash, role, now, now]
    );

    await db.query(
      'INSERT INTO user_settings (user_id, settings, created_at, updated_at) VALUES ($1,$2,$3,$4)',
      [userId, JSON.stringify(defaultSettings()), now, now]
    );

    const token = generateToken({ userId, email: normalizedEmail, role });
    const refreshToken = generateRefreshToken(userId);
    await saveRefreshToken(userId, refreshToken);

    // Send welcome email — don't crash if SMTP not configured
    try {
      const { sendWelcomeEmail } = await import('../services/email.js');
      await sendWelcomeEmail(normalizedEmail, name.trim());
    } catch { /* SMTP not configured in dev — that's fine */ }

    res.status(201).json({
      token,
      refreshToken,
      user: { id: userId, name: name.trim(), email: normalizedEmail, role },
      profile: role === 'child' ? 'child' : 'adult',
      settings: defaultSettings(),
    });
  } catch (err) { next(err); }
});

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const normalizedEmail = email.toLowerCase().trim();

    // SQLite-compatible — no complex JOIN on children yet
    const userResult = await db.query(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = $1 LIMIT 1',
      [normalizedEmail]
    );
    if (userResult.rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const user = userResult.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch)
      return res.status(401).json({ error: 'Invalid email or password.' });

    // Get settings
    const settingsResult = await db.query(
      'SELECT settings FROM user_settings WHERE user_id = $1', [user.id]);
    const settings = settingsResult.rows[0]?.settings
      ? JSON.parse(settingsResult.rows[0].settings)
      : defaultSettings();

    // Get first child id if parent
    const childResult = await db.query(
      'SELECT id FROM children WHERE parent_id = $1 LIMIT 1', [user.id]);
    const childId = childResult.rows[0]?.id || null;

    const token = generateToken({ userId: user.id, email: user.email, role: user.role, childId });
    const refreshToken = generateRefreshToken(user.id);
    await saveRefreshToken(user.id, refreshToken);

    res.json({
      token,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      profile: user.role === 'child' ? 'child' : 'adult',
      childId,
      settings,
    });
  } catch (err) { next(err); }
});

// ─── Refresh Token ────────────────────────────────────────────────────────────

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ error: 'Refresh token required.' });

    const stored = await db.query(
      'SELECT user_id FROM refresh_tokens WHERE token = $1', [refreshToken]);
    if (stored.rows.length === 0)
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });

    const userId = stored.rows[0].user_id;
    const user = await db.query(
      'SELECT id, email, role FROM users WHERE id = $1', [userId]);
    if (user.rows.length === 0)
      return res.status(401).json({ error: 'User not found.' });

    const newToken = generateToken({
      userId: user.rows[0].id,
      email: user.rows[0].email,
      role: user.rows[0].role,
    });
    res.json({ token: newToken });
  } catch (err) { next(err); }
});

// ─── Forgot Password ──────────────────────────────────────────────────────────

router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const normalizedEmail = email.toLowerCase().trim();
    const result = await db.query(
      'SELECT id FROM users WHERE email = $1', [normalizedEmail]);

    if (result.rows.length > 0) {
      const resetToken = uuidv4();
      const expires = new Date(Date.now() + 3600000).toISOString();
      await db.query('DELETE FROM password_resets WHERE user_id = $1', [result.rows[0].id]);
      await db.query(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1,$2,$3)',
        [result.rows[0].id, resetToken, expires]
      );
      try {
        const { sendPasswordResetEmail } = await import('../services/email.js');
        await sendPasswordResetEmail(normalizedEmail, resetToken);
      } catch { /* SMTP not configured — skip */ }
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) { next(err); }
});

// ─── Reset Password ───────────────────────────────────────────────────────────

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ error: 'Token and new password are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const result = await db.query(
      'SELECT user_id FROM password_resets WHERE token = $1', [token]);
    if (result.rows.length === 0)
      return res.status(400).json({ error: 'Invalid or expired reset link.' });

    const passwordHash = await bcrypt.hash(password, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, result.rows[0].user_id]);
    await db.query('DELETE FROM password_resets WHERE user_id = $1',
      [result.rows[0].user_id]);

    res.json({ message: 'Password updated successfully.' });
  } catch (err) { next(err); }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function generateRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

async function saveRefreshToken(userId, token) {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
    [userId, token, expires]
  );
}

function defaultSettings() {
  return {
    filterImages: true,
    filterText: true,
    detectScams: true,
    advancedModeration: false,
    bedtimeEnabled: false,
    bedtimeHour: 21,
    wakeHour: 7,
    screenTimeLimits: { 'tiktok.com': 120, 'instagram.com': 60, 'default': 180 },
    parentPin: null,
    notifications: { dailyReport: true, instantAlert: true, whatsapp: false },
  };
}

export default router;
