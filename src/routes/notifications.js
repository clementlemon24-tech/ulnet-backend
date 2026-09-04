/**
 * ULNet Notification Routes
 * POST /v1/notifications/token   — register/update FCM token
 * POST /v1/notifications/test    — send test notification to self
 */

import { Router } from 'express';
import { saveFcmToken, sendPush } from '../services/firebase.js';

const router = Router();

// Save FCM token after login (called by mobile app)
router.post('/token', async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken is required.' });

    await saveFcmToken(req.user.userId, fcmToken);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Send test notification to verify setup
router.post('/test', async (req, res, next) => {
  try {
    const { db } = await import('../services/database.js');
    const result = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [req.user.userId]
    );

    const token = result.rows[0]?.fcm_token;
    if (!token) {
      return res.status(400).json({ error: 'No FCM token registered for this account.' });
    }

    await sendPush(token, {
      title: '🛡️ ULNet Test Notification',
      body: 'Your notifications are working! ULNet is protecting your family.',
      data: { type: 'test' },
    });

    res.json({ success: true, message: 'Test notification sent.' });
  } catch (err) {
    next(err);
  }
});

export default router;
