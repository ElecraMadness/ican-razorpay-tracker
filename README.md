# Razorpay Tracker

A small self-hosted page that shows the **exact net amounts Razorpay has credited
to your bank** — no estimates, no gross figures. Uses your standard Razorpay
account (no RazorpayX needed).

## What it shows

Every settlement Razorpay makes to your bank carries three numbers: the gross
`amount`, the `fees` Razorpay charged, and the `tax` on those fees. The exact
amount that actually lands in your bank is:

```
net = amount - fees - tax
```

The tracker reads your full settlement history and shows three **exact** numbers:

- **Credited to Bank** — total net credited, all time.
- **This Month** — net credited since the 1st of the month (IST).
- **Last Settlement** — net of the most recent settlement.

Money still pending settlement is **not** shown: Razorpay only finalizes fees on
settlement day, so a "pending" figure would have to be an estimate. This tracker
deliberately shows only exact numbers.

## Who can see it

- Viewing requires **Firebase login — the same account system as the ICAN app**
  (email/password or Google).
- The server verifies your login with the Firebase Admin SDK and only serves the
  numbers to the two UIDs in `ALLOWED_UIDS` in `server.js`. Everyone else gets
  `403 Access denied`.

## Security

- Your Razorpay key + secret live only in `.env` on the server — never sent to
  the browser.
- The page calls `/api/balance` with a Firebase ID token; the server verifies it
  before responding.
- `.env` is excluded from git by the included `.gitignore`.

## Setup

### 1. Get credentials

- **Razorpay keys** — Dashboard → Settings → API Keys → Generate Key (use
  **Live** mode keys for real numbers; Test mode only shows test payments).
- **Firebase Admin credentials** — Firebase Console → Project Settings →
  Service Accounts → **Generate new private key**. You need `project_id`,
  `client_email`, and the `private_key` from that file (the key must stay inside
  quotes in `.env`).

### 2. Local run

```bash
cd razorpay-tracker
npm install
cp .env.example .env
# edit .env: put in your real RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
# and the three FIREBASE_* values from the service account file
npm start
```

Visit `http://localhost:3000`, log in with an allowed Firebase account.

### 3. Deploy it 24/7 on Railway (same host as your ICAN proxy)

This is the recommended way — the tracker follows the exact same pattern as your
ICAN proxy (`server (7).js`): keys live in **Railway environment variables**,
never in code and never in a `.env` file on the server.

1. Push this folder to a GitHub repo (`.gitignore` already excludes `.env`).
2. In Railway, create a new service from that repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add the environment variables below to that service
   (Railway → Variables). Use the **same values already configured on your ICAN
   proxy service** — no new keys needed:

   | Variable | Where the value comes from |
   |----------|----------------------------|
   | `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings → API Keys (LIVE key id) |
   | `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Settings → API Keys (LIVE secret) |
   | `FIREBASE_PROJECT_ID` | `ican-242af` (Firebase Console → Project Settings) |
   | `FIREBASE_CLIENT_EMAIL` | Firebase Console → Project Settings → Service Accounts → Generate new private key |
   | `FIREBASE_PRIVATE_KEY` | Same private-key JSON — paste the full key; Railway stores multiline values fine |
   | `FIREBASE_DATABASE_URL` | `https://ican-242af-default-rtdb.firebaseio.com` (optional) |
   | `PORT` | Railway sets this automatically — no need to add it |

   > Tip: If your ICAN proxy service already has these exact variable names,
   > just copy the values across. You are not creating a second set of keys —
   > the tracker reads the same ones Railway already holds.
4. Deploy, then open your `https://<service>.up.railway.app` URL. Anyone can
   log in with the ICAN app's Firebase accounts, but only the two UIDs in
   `ALLOWED_UIDS` (in `server.js`) can see the numbers.

> **What about `.env`?** It's only for local testing (step 2 below). On Railway
> the `.env` file is ignored — Railway injects the variables from the table
> above at deploy time. That is how "retrieve from Railway, no hardcoded keys"
> works.

## Notes

- Refreshes from Razorpay every 5 minutes (set `REFRESH_INTERVAL_MS` to change).
- If your account has very many settlements (>100 per page, paginated up to 100
  pages), raise `maxPages` in `fetchAllSettlements()` in `server.js`.
- The headline number is *net credited to your bank* — the money is already
  there, so it matches your bank statement rather than the Razorpay dashboard's
  gross totals.
