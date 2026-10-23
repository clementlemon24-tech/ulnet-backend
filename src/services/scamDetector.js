/**
 * ULNet Scam URL Detector
 */

// Inlined scam domains — no external file dependency
const NIGERIAN_SCAM_DOMAINS = [
  'nigeriaponzi.net','mmmnigeria.org','loomdonate.com','loomcircle.net',
  'doubleinvestment.com','doubleyournaira.com','getrichfast.ng',
  'nairawin.site','win50knaira.com','freecashtransfer.com',
  'fakegtbank.com','gtbank-verify.com','zenithbank-verify.com',
  'access-bank-update.com','firstbank-verify.com','uba-bank-alert.com',
  'cbn-verify.com','cbn-grant.com','efcc-clearance.com',
  'bvn-update.com','nin-verify.site','ng-verify.site',
  'nnpc-dividend.com','nddc-palliative.com','palliative-claim.ng',
];

const SUSPICIOUS_URL_PATTERNS = [
  { regex: /win.*naira/i, description: 'Fake naira giveaway' },
  { regex: /free.*money.*nigeria/i, description: 'Free money scam' },
  { regex: /bitcoin.*double/i, description: 'Bitcoin doubling scam' },
  { regex: /confirm.*bvn/i, description: 'BVN phishing' },
  { regex: /cbn.*grant.*apply/i, description: 'Fake CBN grant' },
  { regex: /efcc.*release.*fund/i, description: 'Fake EFCC fund' },
  { regex: /double.*your.*(money|investment)/i, description: 'Investment doubling scam' },
  { regex: /guaranteed.*profit/i, description: 'Guaranteed profit scam' },
];

const SAFE_BROWSING_URL = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

/**
 * @param {string} url
 * @returns {{ isScam: boolean, type?: string, detail?: string }}
 */
export async function checkUrlScam(url) {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const fullUrl = url.toLowerCase();

    // 1. Check known Nigerian scam domains
    for (const scamDomain of NIGERIAN_SCAM_DOMAINS) {
      if (domain === scamDomain || domain.endsWith(`.${scamDomain}`)) {
        return { isScam: true, type: 'domain', detail: `Blocked domain: ${scamDomain}` };
      }
    }

    // 2. Check suspicious URL patterns
    for (const pattern of SUSPICIOUS_URL_PATTERNS) {
      if (pattern.regex.test(fullUrl)) {
        return { isScam: true, type: 'pattern', detail: pattern.description };
      }
    }

    // 3. Heuristic domain checks
    const heuristic = heuristicDomainCheck(domain, parsed);
    if (heuristic.suspicious) {
      return { isScam: true, type: 'heuristic', detail: heuristic.reason };
    }

    // 4. Google Safe Browsing (if key available)
    const safeBrowsingResult = await checkGoogleSafeBrowsing(url);
    if (safeBrowsingResult.unsafe) {
      return { isScam: true, type: 'safe_browsing', detail: safeBrowsingResult.reason };
    }

    return { isScam: false };
  } catch (err) {
    return { isScam: false };
  }
}

function heuristicDomainCheck(domain, parsedUrl) {
  // Very long domains are suspicious
  if (domain.length > 50) {
    return { suspicious: true, reason: 'Unusually long domain name' };
  }

  // Domains mimicking Nigerian banks or government
  const sensitiveBrands = [
    'gtbank', 'firstbank', 'zenithbank', 'accessbank', 'uba',
    'sterlingbank', 'polaris', 'fidelitybank', 'fcmb', 'wema',
    'cbn', 'efcc', 'nitda', 'inec'
  ];
  for (const brand of sensitiveBrands) {
    // If domain CONTAINS the brand but ISN'T the real domain
    const realDomains = {
      'gtbank': 'gtbank.com',
      'zenithbank': 'zenithbank.com',
      'accessbank': 'accessbankplc.com',
      'cbn': 'cbn.gov.ng',
    };
    if (domain.includes(brand) && domain !== (realDomains[brand] || `${brand}.com`)) {
      return { suspicious: true, reason: `Domain impersonating ${brand.toUpperCase()}` };
    }
  }

  // Lots of hyphens in domain (common in scam sites)
  const hyphenCount = (domain.match(/-/g) || []).length;
  if (hyphenCount >= 3) {
    return { suspicious: true, reason: 'High hyphen count — typical of scam domains' };
  }

  // Free hosting with "earn" or "money" in path
  const freeHosts = ['000webhostapp.com', 'netlify.app', 'vercel.app', 'pages.dev',
    'firebaseapp.com', 'web.app'];
  const earningKeywords = /earn|money|invest|profit|withdraw|bitcoin|naira|reward/i;
  if (freeHosts.some(h => domain.endsWith(h)) && earningKeywords.test(parsedUrl.pathname)) {
    return { suspicious: true, reason: 'Free hosting with money-related content' };
  }

  return { suspicious: false };
}

async function checkGoogleSafeBrowsing(url) {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!apiKey) return { unsafe: false };

  try {
    const response = await fetch(`${SAFE_BROWSING_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'ulnet', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }]
        }
      })
    });

    if (!response.ok) return { unsafe: false };
    const data = await response.json();
    const match = data.matches?.[0];

    if (match) {
      return { unsafe: true, reason: `Google Safe Browsing: ${match.threatType}` };
    }

    return { unsafe: false };
  } catch {
    return { unsafe: false };
  }
}
