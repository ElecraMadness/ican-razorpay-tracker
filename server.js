// ═══════════════════════════════════════════════════════════
// RAZORPAY TRACKER — SERVER
// Same key-handling logic as the ICAN Railway proxy
// (server (7).js): NO hardcoded keys anywhere.
//
// Keys come from environment variables that RAILWAY injects
// at deploy time (or from .env when running locally). The
// tracker never stores a key in code or in the browser.
//
// It shows EXACT net amounts credited to your bank:
// every settlement record has gross `amount`, `fees`, `tax`,
// so net that landed in your bank = amount - fees - tax.
// Pending money is NOT shown — fees are only finalized on
// settlement day, so a "pending" figure would be an estimate,
// and this tracker shows only exact numbers.
//
// Viewing requires Firebase login (same account system as the
// ICAN app); only the UIDs in ALLOWED_UIDS below can see it.
// ═══════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const path    = require('path');
const Razorpay = require('razorpay');
const admin   = require('firebase-admin');
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Validation: keys come from env (Railway) / .env (local) ──
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error('Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET — set them in Railway env vars (or .env locally). See README.md');
  process.exit(1);
}
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('Missing Firebase Admin credentials (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) — set them in Railway env vars (or .env locally). See README.md');
  process.exit(1);
}

// ── Razorpay SDK — keys injected from Railway env, same as the proxy ──
const rzp = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Firebase Admin — verifies the viewer's login (same as the proxy) ──
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // \n replacement fixes how Railway stores multiline env vars
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://ican-242af-default-rtdb.firebaseio.com',
});

// Only these Firebase accounts may view the tracker.
const ALLOWED_UIDS = [
  'XGuCdtlXnghzaq4EOZ1UdSUqiPj2',
  'i5CYHK6bd6b2CstKLBdFrbsYI5N2',
];

const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS) || 5 * 60 * 1000; // default 5 min

// ── In-memory cache ─────────────────────────────────────────
let cache = {
  totalNetRupees: null,
  thisMonthNetRupees: null,
  lastSettlementNetRupees: null,
  updatedAt: null,
  error: null,
};

// ── Helpers ─────────────────────────────────────────────────
// Fetch ALL settlements (paginated, 100 per page).
async function fetchAllSettlements(maxPages = 100) {
  let skip = 0;
  const items = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await rzp.settlements.all({ count: 100, skip });
    const batch = (data && data.items) || [];
    items.push(...batch);
    if (batch.length < 100) break; // last page
    skip += 100;
  }
  return items;
}

// Exact net of one settlement: gross amount minus Razorpay fees and tax.
function settlementNet(s) {
  return (Number(s.amount) || 0) - (Number(s.fees) || 0) - (Number(s.tax) || 0);
}

function startOfMonthIST() {
  // IST = UTC+5:30, no DST
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  istNow.setUTCDate(1);
  istNow.setUTCHours(0, 0, 0, 0);
  const istMonthStartUtcMs = istNow.getTime() - 5.5 * 60 * 60 * 1000;
  return Math.floor(istMonthStartUtcMs / 1000);
}

// ── Main refresh ─────────────────────────────────────────────
async function refresh() {
  try {
    const settlements = await fetchAllSettlements();

    // Only 'processed' settlements have actually been credited to your bank.
    const processed = settlements.filter(s => s.status === 'processed');

    let totalNet = 0;
    let thisMonthNet = 0;
    let last = null;
    const monthStart = startOfMonthIST();

    for (const s of processed) {
      const net = settlementNet(s);
      totalNet += net;
      if (s.created_at >= monthStart) thisMonthNet += net;
      if (!last || s.created_at > last.created_at) last = s;
    }
    const lastNet = last ? settlementNet(last) : 0;

    cache = {
      totalNetRupees: totalNet / 100,
      thisMonthNetRupees: thisMonthNet / 100,
      lastSettlementNetRupees: lastNet / 100,
      updatedAt: new Date().toISOString(),
      error: null,
    };
    console.log(
      `[${cache.updatedAt}] Credited to bank ₹${cache.totalNetRupees.toFixed(2)}, ` +
      `this month ₹${cache.thisMonthNetRupees.toFixed(2)}`
    );
  } catch (err) {
    cache.error = err.message;
    console.error('Refresh failed:', err.message);
  }
}

refresh();
setInterval(refresh, REFRESH_INTERVAL_MS);

// ── Firebase auth gate (same login system as the ICAN app) ──
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (!ALLOWED_UIDS.includes(decoded.uid)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Routes ───────────────────────────────────────────────────
app.get('/api/balance', requireAuth, (req, res) => {
  if (cache.updatedAt === null && cache.error) {
    return res.status(502).json({ error: cache.error });
  }
  res.json(cache);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`✅ Razorpay tracker running on port ${PORT}`);
});
