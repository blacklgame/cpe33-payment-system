# CPE33 Payment System

Payment-tracking site for CPE33 students at Naresuan University.  
Students upload a payment slip; admins review and approve it. Built on **Vercel** (serverless functions + static frontend), **Firebase** (Auth + Firestore), and **Cloudinary** (slip image storage).

---

## How it works

### Overview

```
Browser (student / admin)
        │
        │  HTTPS
        ▼
Vercel Edge (static files from /public)
        │
        │  /api/* routes
        ▼
Vercel Serverless Functions (Node.js, /api)
        │
        ├──► Firebase Admin SDK ──► Firestore (payment records, user roster)
        │                      ──► Firebase Auth (token verification)
        └──► Cloudinary API    ──► Cloudinary (slip images)
```

---

### Student flow

1. **Login** — Student enters their Nu ID on the home page (`/`).  
   `POST /api/mint-session` checks the Nu ID against the Firestore `users` collection and returns a **Firebase custom token** with `uid = nuid`. The browser signs in with that token so all subsequent requests are authenticated as that student.

2. **Upload slip** — Student picks an image file.  
   `POST /api/sign-upload` returns a **Cloudinary signed-upload ticket** (server-chosen `public_id` under `slips/{nuid}/...`, with `overwrite:false` baked into the signature). The browser uploads directly to Cloudinary using that ticket — the server never touches the raw image bytes.

3. **Submit slip** — After the upload succeeds, `POST /api/submit-slip` records the slip in Firestore (`payments/{nuid}`) with `paid: false` and `reviewStatus: "pending"`. The server independently re-verifies the Cloudinary asset before writing, so a fabricated URL can't be submitted.

4. **Check status** — Student's stats page (`/stats`) reads `payments/{nuid}` from Firestore directly (owner-only Firestore rule: `request.auth.uid == nuid`). It shows `paid`, `reviewStatus`, and `studentStatus`.

### Admin flow

1. **Login** — Admin goes to `/admin/login.html` and signs in with Google (`signInWithPopup`). After a successful sign-in the browser is redirected to the dashboard.

2. **Dashboard gate** — On every dashboard load, `dashboard.js` calls `POST /api/admin/list-data` with the admin's Firebase ID token. The server verifies the token and checks the email against the admin whitelist (`ADMIN_EMAILS` env var). If this check fails (returns 401/403), the page redirects the user back to the login page. If it succeeds, the dashboard renders the student list. This consolidates data fetching and authorization into a single, reliable request.

3. **Approve slip** — Admin clicks "อนุมัติ (Approve)".  
   `POST /api/admin/approve-slip` verifies the token, re-checks the whitelist, then sets `paid: true`, `reviewStatus: "approved"` in Firestore. This is the **only place in the entire codebase that can write `paid: true`**.

4. **Decline (delete) slip** — Admin clicks "ลบ".  
   `POST /api/admin/delete-slip` verifies the token, re-checks the whitelist, deletes the image from Cloudinary (using the `slipPublicId` looked up from Firestore — not trusted from the client), and resets the payment record to `paid: false`, `reviewStatus: "rejected"`.

5. **Set student status** — Admin changes the status dropdown (ปกติ / ยังไม่จ่าย / พ้นสภาพ).  
   `POST /api/admin/set-status` verifies and applies the change. A student with `studentStatus: "termination"` cannot submit new slips.

### Security model

| Threat | Mitigation |
|---|---|
| Client writes `paid: true` directly to Firestore | Firestore rules deny **all** client writes to `payments/*` |
| Fabricated Cloudinary URL submitted as a real slip | `submit-slip.js` calls the Cloudinary Admin API server-side to verify the asset exists and the URL matches before writing |
| Unsigned Cloudinary upload under another student's path | `sign-upload.js` requires a token with `uid == nuid`; the server, not the browser, chooses the `public_id`; `overwrite:false` is signed into the ticket |
| Admin whitelist bypass via client-side check | Every admin API endpoint independently verifies the Firebase ID token + whitelist server-side; the dashboard's client-side check is a UX gate only |
| Admin session lost on token refresh / mid-action auth event | `dashboard.js` utilizes server-side list-data verification with local session caching so token refreshes never trigger redundant network verifications that could cause logout loops |

---

## Setup

### 1. Requirements

- [Node.js](https://nodejs.org/) (LTS)
- [Vercel CLI](https://vercel.com/docs/cli): `npm install -g vercel`
- A Firebase project with **Firestore** and **Authentication → Google sign-in** enabled
- A [Cloudinary](https://cloudinary.com/) account

### 2. Install dependencies

```bash
npm install
```

### 3. Environment variables

Create a `.env` file in the project root (already in `.gitignore`):

```env
ADMIN_EMAILS=admin1@nu.ac.th,admin2@nu.ac.th
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64-encoded Firebase service account JSON>
CLOUDINARY_API_KEY=<from Cloudinary dashboard>
CLOUDINARY_API_SECRET=<from Cloudinary dashboard>
```

**Getting `FIREBASE_SERVICE_ACCOUNT_BASE64`:**  
Firebase Console → Project settings → Service accounts → Generate new private key → base64-encode the downloaded JSON:
- Windows: `certutil -encode key.json key.b64` (then remove the header/footer lines and line breaks)
- Mac/Linux: `base64 -i key.json | tr -d '\n'`

Set the same variables in **Vercel → Project → Settings → Environment Variables** for Production, Preview, and Development environments.

> `public/firebase.js` holds the Firebase **web** config (`apiKey`, `authDomain`, etc.) — that's intentionally public and doesn't need to change unless you're switching Firebase projects.

### 4. Seed the student roster

The roster (Nu ID / name / email for all students) lives in `scripts/roster-data.json`, which is gitignored — you'll need your own copy locally. Then run:

```bash
node scripts/seed-users.js
```

This writes every student record into the Firestore `users` collection. See the comments at the top of `scripts/seed-users.js` for authentication options if it can't connect.

### 5. Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

`vercel deploy` does **not** push `firestore.rules` — run this separately whenever that file changes.

### 6. Run locally

```bash
vercel dev
```

Serves both the static frontend and all `/api` routes locally (usually `http://localhost:3000`). Admin login, slip uploads, and Firestore reads/writes all behave the same as production.

### 7. Deploy to production

```bash
vercel --prod
```

---

## Testing the flows

**Student flow**  
Go to `/`, enter a Nu ID from your seeded roster, upload any image as a slip.

**Admin flow**  
Go to `/admin/login.html`, sign in with a Google account listed in `ADMIN_EMAILS`. The dashboard should load the full roster. Try approving and declining slips.

---

## Notes

- Admin sign-in uses a **popup** (not a redirect) because the app's Vercel domain differs from the Firebase `authDomain` — redirect sign-in requires reading the result back through the other domain's storage, which modern browsers block as third-party storage. Popups avoid this by using a `postMessage` channel instead.
- If you open the admin login from inside LINE / Facebook / Instagram's in-app browser, Google Sign-In will refuse (`disallowed_useragent`) — that's a Google restriction, not a bug. Open the link in real Safari or Chrome.
- Auth state is stored in `localStorage` (not IndexedDB) to avoid a long-standing Safari bug where IndexedDB intermittently hangs and causes Firebase to fire `onAuthStateChanged(null)` mid-session, which would bounce the admin to the login page.
- A slip is **never** marked paid just by uploading — an admin must explicitly approve it.
- A student marked **terminated** cannot submit a new slip; this is enforced both client-side (UX) and server-side (real check).
