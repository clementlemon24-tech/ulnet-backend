/**
 * ULNet Auth Middleware
 * Validates JWT tokens on all protected routes.
 */

import jwt from 'jsonwebtoken';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;   // { userId, email, role, childId? }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    return res.status(403).json({ error: 'Invalid token.' });
  }
}

export function requireParent(req, res, next) {
  if (req.user.role !== 'parent' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Parent account required.' });
  }
  next();
}
