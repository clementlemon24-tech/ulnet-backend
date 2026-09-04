/**
 * ULNet Moderation Routes
 * POST /v1/moderate/image   — scan an image URL
 * POST /v1/moderate/text    — scan text content
 * POST /v1/moderate/url     — check if a URL is a scam
 */

import { Router } from 'express';
import { moderateImageWithGoogle } from '../services/googleVision.js';
import { moderateTextWithPerspective } from '../services/perspective.js';
import { checkUrlScam } from '../services/scamDetector.js';

const router = Router();

// Cache simple results in memory to avoid hitting APIs repeatedly
const imageCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Image Moderation ─────────────────────────────────────────────────────────

router.post('/image', async (req, res, next) => {
  try {
    const { imageUrl, profile } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required.' });
    }

    // Basic URL validation
    try { new URL(imageUrl); } catch {
      return res.status(400).json({ error: 'Invalid imageUrl.' });
    }

    // Check cache
    const cacheKey = `${imageUrl}:${profile}`;
    const cached = imageCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return res.json(cached.result);
    }

    const result = await moderateImageWithGoogle(imageUrl, profile);
    imageCache.set(cacheKey, { result, ts: Date.now() });

    // Prune cache if too large
    if (imageCache.size > 10000) {
      const oldestKey = imageCache.keys().next().value;
      imageCache.delete(oldestKey);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Text Moderation ──────────────────────────────────────────────────────────

router.post('/text', async (req, res, next) => {
  try {
    const { text, platform, profile } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required.' });
    }

    const trimmed = text.trim().slice(0, 5000); // limit input size
    const result = await moderateTextWithPerspective(trimmed, profile, platform);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── URL / Scam Check ─────────────────────────────────────────────────────────

router.post('/url', async (req, res, next) => {
  try {
    const { url } = req.body;

    if (!url) return res.status(400).json({ error: 'url is required.' });

    try { new URL(url); } catch {
      return res.status(400).json({ error: 'Invalid URL.' });
    }

    const result = await checkUrlScam(url);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
