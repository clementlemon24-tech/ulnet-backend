/**
 * Google Cloud Vision Safe Search API
 * Used to detect: adult, violence, racy, spoof content in images.
 * Free tier: 1,000 units/month. Paid: $1.50/1000 after that.
 */

const VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';

/**
 * @param {string} imageUrl
 * @param {'adult'|'child'} profile
 * @returns {{ safe: boolean, reason: string|null, confidence: number }}
 */
export async function moderateImageWithGoogle(imageUrl, profile = 'adult') {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;

  if (!apiKey) {
    console.warn('[ULNet] GOOGLE_VISION_API_KEY not set — skipping image check');
    return { safe: true, reason: null, confidence: 0 };
  }

  try {
    const response = await fetch(`${VISION_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { source: { imageUri: imageUrl } },
          features: [{ type: 'SAFE_SEARCH_DETECTION' }]
        }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[ULNet] Vision API error:', errBody);
      return { safe: true, reason: null, confidence: 0 }; // fail open
    }

    const data = await response.json();
    const annotation = data.responses?.[0]?.safeSearchAnnotation;
    if (!annotation) return { safe: true, reason: null, confidence: 0 };

    return evaluateSafeSearch(annotation, profile);
  } catch (err) {
    console.error('[ULNet] Vision API network error:', err.message);
    return { safe: true, reason: null, confidence: 0 };
  }
}

/**
 * Converts Google's likelihood strings to block decisions.
 * Stricter thresholds for children.
 */
function evaluateSafeSearch(annotation, profile) {
  const { adult, violence, racy } = annotation;

  // Likelihood scale: UNKNOWN < VERY_UNLIKELY < UNLIKELY < POSSIBLE < LIKELY < VERY_LIKELY
  const ADULT_THRESHOLD_ADULT   = ['LIKELY', 'VERY_LIKELY'];
  const ADULT_THRESHOLD_CHILD   = ['POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
  const VIOLENCE_THRESHOLD_ADULT  = ['VERY_LIKELY'];
  const VIOLENCE_THRESHOLD_CHILD  = ['LIKELY', 'VERY_LIKELY'];
  const RACY_THRESHOLD_CHILD    = ['LIKELY', 'VERY_LIKELY'];

  const adultThreshold = profile === 'child'
    ? ADULT_THRESHOLD_CHILD : ADULT_THRESHOLD_ADULT;
  const violenceThreshold = profile === 'child'
    ? VIOLENCE_THRESHOLD_CHILD : VIOLENCE_THRESHOLD_ADULT;

  if (adultThreshold.includes(adult)) {
    return { safe: false, reason: 'adult', confidence: likelihoodToScore(adult) };
  }

  if (violenceThreshold.includes(violence)) {
    return { safe: false, reason: 'violence', confidence: likelihoodToScore(violence) };
  }

  if (profile === 'child' && RACY_THRESHOLD_CHILD.includes(racy)) {
    return { safe: false, reason: 'adult', confidence: likelihoodToScore(racy) };
  }

  return { safe: true, reason: null, confidence: 1.0 };
}

function likelihoodToScore(likelihood) {
  const scores = {
    'VERY_LIKELY': 0.97,
    'LIKELY': 0.85,
    'POSSIBLE': 0.65,
    'UNLIKELY': 0.3,
    'VERY_UNLIKELY': 0.1,
    'UNKNOWN': 0.5
  };
  return scores[likelihood] || 0.5;
}
