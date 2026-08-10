# CPE33 Payment System

A payment-tracking site for CPE33 students at Naresuan University.

- **Students** log in with their Nu ID, upload a payment slip, and check whether it's been approved.
- **Admins** sign in with a whitelisted `@nu.ac.th` Google account and approve/reject slips, or manually set a student's status (normal / unpaid / terminated).

---

## 1. Requirements

- [Node.js](https://nodejs.org/) (LTS version)
- [Vercel CLI](https://vercel.com/docs/cli): `npm install -g vercel`
- A Firebase project (Firestore + Authentication → Google sign-in enabled)
- A Cloudinary account (for slip image uploads)

## 2. Install dependencies

```
npm install
```

## 3. Environment variables

Create a `.env` file in the project root (already gitignored) with:

```
ADMIN_EMAILS=your-admin1@nu.ac.th,your-admin2@nu.ac.th
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64-encoded Firebase service account JSON>
CLOUDINARY_API_KEY=<from Cloudinary dashboard>
CLOUDINARY_API_SECRET=<from Cloudinary dashboard>
```

- `FIREBASE_SERVICE_ACCOUNT_BASE64`: Firebase Console → Project settings → Service accounts → Generate new private key, then base64-encode the downloaded JSON file (e.g. `certutil -encode key.json key.b64` on Windows, or `base64 -i key.json` on Mac/Linux — strip line breaks/headers if using `certutil`).
- Same variables need to be set in **Vercel → Project → Settings → Environment Variables** before deploying (for all environments you use: Production, Preview, Development).
- `public/firebase.js` has its own Firebase **web** config (`apiKey`, `authDomain`, etc.) — that one is meant to be public, no changes needed unless you're pointing at a different Firebase project.

## 4. Seed the student roster

The roster (Nu ID / name / email for all 91 students) lives in `scripts/roster-data.json`, which is gitignored — you'll need your own copy of that file locally. Then run:

```
node scripts/seed-users.js
```

This writes the roster into Firestore. See the comments at the top of `scripts/seed-users.js` for two auth options (service account key file, or `gcloud auth application-default login`) if the script can't authenticate.

## 5. Deploy Firestore rules

```
firebase deploy --only firestore:rules
```

(Running `vercel deploy` alone does **not** push `firestore.rules` — do this separately whenever you change that file.)

## 6. Run it locally

```
vercel dev
```

This serves both the static frontend and the `/api` routes locally, so admin login, slip uploads, and Firestore reads/writes all work the same as production. It'll print a local URL (usually `http://localhost:3000`).

## 7. Test the two flows

**Student flow** — go to `/`, enter a Nu ID that exists in your seeded roster, upload a slip image.

**Admin flow** — go to `/admin/login.html`, sign in with a Google account listed in your `ADMIN_EMAILS`. You should land on the dashboard and see the roster with pending/paid status, and be able to approve, delete, or change a student's status.

## 8. Deploy

```
vercel --prod
```

---

## Notes while testing

- Admin sign-in uses a popup window (not a redirect) — make sure your browser isn't blocking popups for the test URL.
- If you open the admin login link from inside LINE/Facebook/Instagram's in-app browser, Google Sign-In will refuse to work there (`disallowed_useragent`) — this is a Google restriction, not a bug. Open the link in Safari/Chrome directly.
- A student marked **terminated** cannot submit a new slip — that's expected behavior, not an error.
- A slip only counts as "paid" after an admin explicitly approves it — uploading alone doesn't mark someone as paid.
