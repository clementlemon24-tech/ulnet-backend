/**
 * ULNet Backend — Express API Server
 * Handles auth, content moderation, activity logs, family management, reports
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import moderationRoutes from './routes/moderation.js';
import activityRoutes from './routes/activity.js';
import familyRoutes from './routes/family.js';
import reportsRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import notificationRoutes from './routes/notifications.js';

import { errorHandler } from './middleware/errorHandler.js';
import { authenticateToken } from './middleware/auth.js';
import { initFirebase } from './services/firebase.js';
import { startScheduler } from './services/scheduler.js';
import { connectDB } from './services/database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Security Middleware ──────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: true, // Allow all origins in dev — restrict in production
  credentials: true,
}));

// Rate limiting — tighter on auth endpoints
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

app.use(globalLimiter);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ULNet API', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/v1/auth', authLimiter, authRoutes);
app.use('/v1/moderate', authenticateToken, moderationRoutes);
app.use('/v1/activity', authenticateToken, activityRoutes);
app.use('/v1/family', authenticateToken, familyRoutes);
app.use('/v1/reports', authenticateToken, reportsRoutes);
app.use('/v1/settings', authenticateToken, settingsRoutes);
app.use('/v1/notifications', authenticateToken, notificationRoutes);

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  await connectDB();
  initFirebase();
  startScheduler();
  console.log(`\n🛡️  ULNet API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

export default app;
