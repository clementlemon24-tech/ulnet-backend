/**
 * Google Perspective API — text toxicity detection
 * Detects: hate speech, toxicity, threats, cyberbullying, profanity
 * Free to use with API key. https://perspectiveapi.com
 *
 * Also layers in local Nigerian language checks before calling the API.
 */

import { checkNigerianScamText, checkNigerianHateSpeech } from './nigerianNLP.js';

const PERSPECTIVE_API_URL =
  'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze';

/**
 * @param {string} text
 * @param {'adult'|'child'} profile
 * @param {string} platform
 */
export async function moderateTextWithPerspective(text, profile = 'adult', platform = 'unknown') {
  // 1. Fast local Nigerian NLP check first (no API call)
  const localScamResult = checkNigerianScamText(text);
  if (localScamResult.isScam) {
    return {
      safe: false,
      reason: 'scam',
      confidence: 0.95,
      detail: localScamResult.detail,
      source: 'local'
    };
  }

  const localHateResult = checkNigerianHateSpeech(text);
  if (localHateResult.detected) {
    return {
      safe: false,
      reason: 'hate_speech',
      confidence: 0.9,
      detail: localHateResult.detail,
      source: 'local'
    };
  }

  // 2. Perspective API for general toxicity
  const apiKey = process.env.PERSPECTIVE_API_KEY;
  if (!apiKey) {
    console.warn('[ULNet] PERSPECTIVE_API_KEY not set — skipping Perspective check');
    return { safe: true, reason: null, confidence: 0 };
  }

  try {
    const response = await fetch(`${PERSPECTIVE_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment: { text },
        requestedAttributes: {
          TOXICITY: {},
          SEVERE_TOXICITY: {},
          THREAT: {},
          IDENTITY_ATTACK: {},
          INSULT: {},
        },
        languages: ['en'],  // Perspective handles English best; Nigerian Pidgin partially covered
        doNotStore: true,
      })
    });

    if (!response.ok) {
      console.error('[ULNet] Perspective API error:', response.status);
      return { safe: true, reason: null, confidence: 0 };
    }

    const data = await response.json();
    return evaluatePerspective(data, profile);
  } catch (err) {
    console.error('[ULNet] Perspective API network error:', err.message);
    return { safe: true, reason: null, confidence: 0 };
  }
}

function evaluatePerspective(data, profile) {
  const attrs = data.attributeScores || {};
  const get = (key) => attrs[key]?.summaryScore?.value || 0;

  const toxicity      = get('TOXICITY');
  const severeToxicity = get('SEVERE_TOXICITY');
  const threat        = get('THREAT');
  const identityAttack = get('IDENTITY_ATTACK');
  const insult        = get('INSULT');

  // Stricter thresholds for child profiles
  const TOXICITY_THRESHOLD = profile === 'child' ? 0.6 : 0.8;
  const SEVERE_THRESHOLD   = profile === 'child' ? 0.4 : 0.6;
  const THREAT_THRESHOLD   = 0.5;
  const HATE_THRESHOLD     = profile === 'child' ? 0.5 : 0.7;

  if (severeToxicity >= SEVERE_THRESHOLD) {
    return { safe: false, reason: 'hate_speech', confidence: severeToxicity };
  }
  if (threat >= THREAT_THRESHOLD) {
    return { safe: false, reason: 'violence', confidence: threat };
  }
  if (identityAttack >= HATE_THRESHOLD) {
    return { safe: false, reason: 'hate_speech', confidence: identityAttack };
  }
  if (toxicity >= TOXICITY_THRESHOLD) {
    return { safe: false, reason: 'cyberbullying', confidence: toxicity };
  }

  return { safe: true, reason: null, confidence: 1 - toxicity };
}
