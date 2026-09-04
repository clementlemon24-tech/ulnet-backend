/**
 * ULNet Nigerian Language NLP
 * Local rule-based detection for:
 * - Nigerian scam patterns (Yahoo-Yahoo, Ponzi, fake giveaways)
 * - Nigerian Pidgin, Yoruba, Igbo, Hausa hate speech
 * - Cyberbullying patterns common in Nigerian online spaces
 *
 * No API call needed — runs locally.
 * This file is the foundation; a trained ML model would be layered on top in production.
 */

// ─── Nigerian Scam Patterns ───────────────────────────────────────────────────

const SCAM_PATTERNS = [
  // Yahoo-Yahoo / 419 fraud
  { regex: /send\s+(your\s+)?(account|bank)\s+(number|details)/i, description: '419 scam — requesting bank account details' },
  { regex: /i\s+will\s+send\s+you\s+₦[\d,]+/i, description: 'Money transfer scam' },
  { regex: /claim\s+your\s+(free\s+)?prize/i, description: 'Fake prize scam' },
  { regex: /win\s+₦[\d,]+/i, description: 'Fake lottery / giveaway scam' },
  { regex: /bitcoin\s+investment\s+\d+%/i, description: 'Crypto investment scam' },
  { regex: /double\s+your\s+(money|investment|bitcoin)/i, description: 'Investment doubling scam' },
  { regex: /send\s+\d+k?\s+(naira|₦)/i, description: 'Money mule request' },
  { regex: /forex\s+(trading\s+)?guaranteed/i, description: 'Fake forex trading guarantee' },
  { regex: /make\s+₦[\d,]+\s+(daily|weekly|per\s+day)/i, description: 'Unrealistic income claim' },
  { regex: /i\s+need\s+your\s+help\s+to\s+transfer/i, description: 'Classic 419 transfer request' },
  { regex: /urgent\s+(business\s+)?proposal/i, description: 'Advance fee fraud' },
  { regex: /ponzi|mmm|loomdinate|loom\s+network/i, description: 'Known Ponzi scheme' },
  { regex: /refer\s+\d+\s+people.*earn/i, description: 'Pyramid / MLM scheme' },
  { regex: /oil\s+block\s+(deal|contract)/i, description: 'Oil block scam (Nigeria-specific)' },
  { regex: /EFCC|NDLEA|customs\s+(release|clearance)/i, description: 'Impersonation scam (EFCC/customs)' },
  { regex: /confirm\s+your\s+(BVN|NIN|account\s+number)/i, description: 'Identity phishing' },
  { regex: /your\s+account\s+(will\s+be\s+)?blocked/i, description: 'Account threat phishing' },
  { regex: /giveaway.*dm\s+me/i, description: 'Fake giveaway with DM request' },
  { regex: /free\s+data.*click\s+(here|link)/i, description: 'Fake free data scam' },
  { regex: /palliative.*register.*link/i, description: 'Government palliative phishing' },

  // Nigerian Pidgin scam phrases
  { regex: /na\s+scam\s+(be\s+)?this/i, description: 'Warning about scam (user report)' },
  { regex: /my\s+oga\s+(abroad|oversea)/i, description: 'Advance fee fraud pattern' },
  { regex: /money\s+dey\s+enter/i, description: 'Money scam solicitation (Pidgin)' },
  { regex: /e\s+go\s+enter\s+your\s+account/i, description: 'Money scam (Pidgin)' },
];

// ─── Nigerian Hate Speech Patterns ───────────────────────────────────────────
// These cover tribal/ethnic slurs and common online harassment patterns.
// Words intentionally not quoted in full — stored as regex fragments.

const HATE_SPEECH_PATTERNS = [
  // Ethnic/tribal hate — Nigeria-specific slurs (regex fragments, not full slurs)
  { regex: /fulani\s+(herd|killer|terrorist)/i, description: 'Ethnic incitement against Fulani' },
  { regex: /igbo\s+(dog|monkey|rat)/i, description: 'Ethnic slur against Igbo' },
  { regex: /yoruba\s+(demon|witch)/i, description: 'Tribal slur against Yoruba' },
  { regex: /hausa\s+(illiter|savage|animal)/i, description: 'Tribal slur against Hausa' },
  { regex: /kill\s+all\s+(christian|muslim|northerner|southerner)/i, description: 'Religious/regional incitement to violence' },

  // Religious hate
  { regex: /all\s+muslim(s)?\s+(should|must|deserve)\s+(die|hang|burn)/i, description: 'Religious hate — Islam' },
  { regex: /all\s+christian(s)?\s+(should|must|deserve)\s+(die|hang|burn)/i, description: 'Religious hate — Christianity' },

  // Cyberbullying patterns common in Nigerian social media
  { regex: /kys|kill\s+yourself/i, description: 'Cyberbullying — self-harm encouragement' },
  { regex: /you\s+(go|will)\s+(die|suffer)\s+(soon|forever)/i, description: 'Death threat' },
  { regex: /i\s+go\s+find\s+you\s+and/i, description: 'Physical threat (Pidgin)' },
];

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Check text for Nigerian scam patterns.
 * @param {string} text
 * @returns {{ isScam: boolean, detail?: string }}
 */
export function checkNigerianScamText(text) {
  if (!text || typeof text !== 'string') return { isScam: false };
  const normalized = text.toLowerCase();

  for (const pattern of SCAM_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return { isScam: true, detail: pattern.description };
    }
  }
  return { isScam: false };
}

/**
 * Check text for Nigerian-specific hate speech.
 * @param {string} text
 * @returns {{ detected: boolean, detail?: string }}
 */
export function checkNigerianHateSpeech(text) {
  if (!text || typeof text !== 'string') return { detected: false };

  for (const pattern of HATE_SPEECH_PATTERNS) {
    if (pattern.regex.test(text)) {
      return { detected: true, detail: pattern.description };
    }
  }
  return { detected: false };
}

export { SCAM_PATTERNS, HATE_SPEECH_PATTERNS };
