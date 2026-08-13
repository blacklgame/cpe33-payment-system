# 💸 CPE33 Payment System

![Vercel](https://img.shields.io/badge/hosted%20on-Vercel-black?logo=vercel)
![Firebase](https://img.shields.io/badge/backend-Firebase-FFCA28?logo=firebase&logoColor=black)
![Cloudinary](https://img.shields.io/badge/images-Cloudinary-3448C5?logo=cloudinary)
![Node](https://img.shields.io/badge/runtime-Node.js-339933?logo=node.js&logoColor=white)

Payment-tracking site for **CPE33** students at Naresuan University.
Students upload a payment slip for a given month; admins review and approve it. There's also a small **event treasury** tool for admins to track income/expenses on club activities.

Built on **Vercel** (serverless functions + static frontend), **Firebase** (Auth + Firestore), and **Cloudinary** (slip image storage).

---

## 🙋 What the site does (for users)

There are three kinds of people who touch this site: **students** paying dues, **admins** reviewing payments, and **admins** running the event treasury.

### 🎓 If you're a student

| Step | What happens |
|---|---|
| 1️⃣ **Log in** | Go to the home page and type in your **Nu ID**. No password — your Nu ID *is* your login, as long as it's on the class roster. |
| 2️⃣ **See what you owe** | Your payment page lists every open billing month (e.g. "🗓️ กุมภาพันธ์ 2026 — 80 บาท") and whether you've already paid it. |
| 3️⃣ **Pay & upload proof** | Transfer the money the usual way (bank transfer, PromptPay, etc.), pick the month you're paying for, then attach a photo/screenshot of the slip. |
| 4️⃣ **Wait for approval** | 🟡 Your slip goes to **pending** the instant you upload it. It does **not** count as paid yet. |
| 5️⃣ **Check your status anytime** | The **"My Status"** (`/stats`) page shows a month-by-month breakdown — 🟡 pending / 🟢 approved / 🔴 rejected — plus your overall standing (normal / unpaid / withdrawn). Rejected? Just upload again for that month. |

> 🚫 A student marked **withdrawn ("พ้นสภาพ")** by an admin can't upload new slips at all.

### 🛡️ If you're an admin (payments)

| Step | What happens |
|---|---|
| 1️⃣ **Log in with Google** | A separate admin login page, Google sign-in only. Only whitelisted emails get past the door. |
| 2️⃣ **Create billing months** | On the **Months** page, set up each month (year + month + price). Prices can differ month to month, and changing a price later never rewrites what someone already paid. |
| 3️⃣ **Review slips** | The dashboard lists every student for the selected month with their uploaded slip. ✅ **Approve** marks that month paid. 🗑️ **Delete/reject** removes the slip + image and resets it to unpaid. |
| 4️⃣ **Set a student's overall status** | Flag a student as ✅ normal, 🟡 unpaid, or 🔴 withdrawn — independent of any single month. |
| 5️⃣ **Track totals** | The Months page shows, per month, how much's been collected, how many students are still pending, and a running grand total for the term. |

> 💡 Nothing is *ever* marked paid automatically — a human admin has to press Approve.

### 💰 If you're an admin (event treasury)

A separate little ledger, unrelated to student dues — for tracking money around one-off events (socials, trips, merch, etc.).

| Step | What happens |
|---|---|
| 1️⃣ **Create an event** | Give it a name and an emoji (🎉 by default) on the **Events** page ("คลังเงินกิจกรรม" — *event treasury*). |
| 2️⃣ **Log transactions** | Add 💵 income or 💸 expense entries — a label, an amount, an optional quantity, an optional note. |
| 3️⃣ **Watch the running balance** | Each event auto-tracks total income, total expense, and the net balance as you add/edit/delete entries. |
| 4️⃣ **Everything is audited** | Every create/edit/delete on an event or transaction is written to an internal audit log (who did what, when). |

---

## 🧠 How it works (technical)

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
        ├──► Firebase Admin SDK ──► Firestore (payments, roster, months, events, admins, audit log)
        │                      ──► Firebase Auth (ID token verification)
        └──► Cloudinary API    ──► Cloudinary (slip images)
```

Every mutating endpoint shares the same shape: **rate-limit → verify Firebase ID token → validate input → (re-check admin whitelist if admin route) → write via Admin SDK**. The Admin SDK bypasses Firestore rules entirely, so the *server-side* checks are what actually gate every write — client-side checks are UX only.

---

### 🎓 Student flow (technical)

1. **Login** — Student enters their Nu ID on `/`.
   `POST /api/mint-session` looks the Nu ID up in the Firestore `users` collection and mints a **Firebase custom token** with `uid = nuid`. The browser signs in with it, and returns the student's `name`/`email` (the client no longer ships a full roster copy — that used to leak every student's info to anyone loading the login page).
   ⚠️ **Important caveat**: this proves the ID exists on the roster, not that the *person typing it* is that student — there's no password, OTP, or SSO. It closes the "no session at all" hole cheaply; real identity verification would be a separate project.

2. **Upload slip** — `POST /api/sign-upload` returns a **Cloudinary signed-upload ticket**. The server (not the browser) picks the `public_id` — always `slips/{nuid}/{monthId}/{timestamp}_{random}` — and signs `overwrite:false` into the request, so Cloudinary itself refuses to clobber an existing asset. The browser uploads straight to Cloudinary; the server never sees the raw image bytes. This endpoint also blocks the upload if the student is `termination`-status, the month doesn't exist, or that month is already paid/pending.

3. **Submit slip** — `POST /api/submit-slip` writes the pending record to `payments/{nuid}/months/{monthId}`. It **always** writes `paid: false, reviewStatus: "pending"` — there is no code path in this file that can ever set `paid: true`. Before writing, it independently re-verifies the asset with the Cloudinary Admin API (so a fabricated URL that merely *matches a pattern* can't be submitted), snapshots the month's current price into `amount`, and clears any stale `approvedBy/approvedAt/rejectedBy/rejectedAt` left over from a previous cycle.

4. **Check status** — `/stats` reads `payments/{nuid}` and `payments/{nuid}/months/*` directly from Firestore under the owner-only rule (`request.auth.uid == nuid`).

### 🗓️ Monthly dues model

Payment is tracked **per month**, not as one lifetime paid/unpaid flag.

- 🧾 An admin creates billing months (`months/{YYYY-MM}`, e.g. `months/2026-02`) via `/admin/months.html` — `POST /api/admin/create-month`. Calling it again for an existing month just updates the price/label.
- 🎯 A student picks the month they're paying for in `/logined`. Their per-month record lives at `payments/{nuid}/months/{YYYY-MM}` with that month's own `paid` / `reviewStatus` / `slipUrl` / `amount`.
- 🧮 `amount` is **snapshotted** at submission time — editing a month's price later never changes what a past payment actually cost.
- 🗑️ Admins can delete a month definition (`/api/admin/delete-month`) without touching any already-submitted payment records for it — they just stop showing up in the "current month" picker, and can be recreated later.
- 📊 `/admin/dashboard.html` has a month picker at the top for approving/rejecting/deleting slips per month. `/admin/months.html` shows collected-so-far + pending-count per month, plus a running grand total.
- The old top-level `payments/{nuid}` doc still exists, but now only holds `studentStatus` (the admin's manual normal/termination/unpaid override) — an account-wide flag, not tied to any one month.

### 🛡️ Admin flow (technical) — payments

1. **Login** — `/admin/login.html`, Google `signInWithPopup`, then redirect to the dashboard.
2. **Who's an admin?** — `checkIsAdmin(email)` in `api/_lib/admins.js` checks, in order: (1) the Firestore `admins/{email}` collection (instant add/remove, no redeploy — a doc can also disable someone via `enabled: false`), (2) the `ADMIN_EMAILS` env var, (3) `config/admin-emails.json` as a local-dev fallback. `scripts/manage-admin.js add|remove|list <email>` manages the Firestore collection from the CLI.
3. **Dashboard gate** — `dashboard.js` calls `POST /api/admin/list-data` with the ID token; the server verifies + whitelist-checks, then bulk-reads every `users`/`payments`/`months` doc **plus every student's monthly record in one `collectionGroup('months')` query** (instead of 91+ individual subcollection reads) via the Admin SDK — this is required now that `payments/*` is locked to owner-only reads, so an admin's own Google `uid` can no longer read it via the client SDK directly.
4. **Approve slip** — `POST /api/admin/approve-slip` verifies token + whitelist, then sets `paid: true, reviewStatus: "approved"`. This is the **only place in the codebase** that ever writes `paid: true`.
5. **Delete/reject slip** — `POST /api/admin/delete-slip` verifies, deletes the Cloudinary asset (using the `slipPublicId` looked up server-side from Firestore, never trusted from the client), and resets that month to `paid: false, reviewStatus: "rejected"`.
6. **Set student status** — `POST /api/admin/set-status` (`normal` / `termination` / `unpaid`). A `termination` status blocks new slip submissions in both `sign-upload.js` and `submit-slip.js`.

### 💰 Admin flow (technical) — event treasury

One consolidated endpoint, `api/admin/events-api.js`, routes by HTTP method + `action`:

| Method | `action` | Does |
|---|---|---|
| `GET` | `list` | Lists all events with denormalized totals (income, expense, balance, tx counts) |
| `GET` | `get-transactions` | Lists all transactions for one event |
| `POST` | `create` | Creates an event (`name`, `emoji`), totals start at 0 |
| `POST` | `add-transaction` | Adds an income/expense line; **runs inside a Firestore transaction** that atomically updates the event's running totals |
| `PUT` | `update` | Renames an event / changes its emoji |
| `PUT` | `update-transaction` | Edits a transaction; the same Firestore transaction rolls back the old amount from the event totals and re-applies the new one, so totals never drift |
| `DELETE` | `delete` | Deletes an event and batch-deletes every transaction under it |
| `DELETE` | `delete-transaction` | Deletes one transaction and un-applies its amount from the event totals |

Every action here — like every other admin route — calls `writeAuditLog(db, action, adminEmail, details)`, which fire-and-forgets a record into `/auditLog/{autoId}` (non-blocking: a logging failure never breaks the real action).

### 🚧 Cross-cutting protections

- **Rate limiting** — every API route calls a shared `rateLimit(key, {limit, windowMs})` helper (`api/_lib/rate-limit.js`), keyed by IP + endpoint, before doing any real work.
- **Input validation** — `isValidNuid` enforces exactly 8 digits (Nu IDs get interpolated into Firestore doc paths and Cloudinary `public_id`s, so a malformed one is rejected with 400 up front rather than causing a confusing downstream failure); `isValidMonthId` enforces `YYYY-MM`.

### 🔒 Security model

| Threat | Mitigation |
|---|---|
| Client writes `paid: true` directly to Firestore | `firestore.rules` denies **all** client writes to `payments/*`, `users/*`, `admins/*`, `events/*`, `auditLog/*` |
| Fabricated Cloudinary URL submitted as a real slip | `submit-slip.js` calls the Cloudinary Admin API server-side to confirm the asset exists and its URL matches, before writing anything |
| Unsigned Cloudinary upload under another student's path | `sign-upload.js` requires a token with `uid == nuid`; the server chooses the `public_id`; `overwrite:false` is signed into the ticket |
| Admin whitelist bypass via client-side check | Every `api/admin/*` route independently re-verifies the Firebase ID token + admin whitelist server-side; any client-side check is a UX gate only |
| Admin reading student data via the client SDK | `payments/*` and `users/*` are locked to server-side (Admin SDK) reads only; the dashboard fetches everything through `list-data.js` instead |
| Brute-forcing Nu IDs / hammering endpoints | Per-IP, per-endpoint rate limiting on every route |
| Losing a paper trail on admin actions | Every event/transaction mutation is written to `/auditLog` |

---

## ⚙️ Setup

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

> ℹ️ `ADMIN_EMAILS` is only a **fallback** — the primary admin list lives in the Firestore `admins` collection and can be managed live with `node scripts/manage-admin.js add|remove|list <email>` (no redeploy needed). `config/admin-emails.json` is the last-resort fallback for a fresh local clone.

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

### 5. Add yourself as an admin

```bash
node scripts/manage-admin.js add you@nu.ac.th
node scripts/manage-admin.js list
```

### 6. Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

`vercel deploy` does **not** push `firestore.rules` — run this separately whenever that file changes.

### 7. Run locally

```bash
vercel dev
```

Serves both the static frontend and all `/api` routes locally (usually `http://localhost:3000`). Admin login, slip uploads, and Firestore reads/writes all behave the same as production.

### 8. Deploy to production

```bash
vercel --prod
```

---

## 🧪 Testing the flows

**🎓 Student flow**
Go to `/`, enter a Nu ID from your seeded roster, pick an open month, upload any image as a slip.

**🛡️ Admin flow**
Go to `/admin/login.html`, sign in with a Google account added via `manage-admin.js` (or listed in `ADMIN_EMAILS`). The dashboard should load the full roster for the selected month. Try approving and declining slips, then check `/admin/months.html` for the updated totals.

**💰 Event treasury**
From the dashboard, go to `/admin/events.html`, create a test event, open it, and add an income + an expense transaction. Confirm the balance updates correctly, then delete the transaction and confirm it rolls back.

---

## 📝 Notes

- 🪟 Admin sign-in uses a **popup** (not a redirect) because the app's Vercel domain differs from the Firebase `authDomain` — redirect sign-in requires reading the result back through the other domain's storage, which modern browsers block as third-party storage. Popups avoid this via a `postMessage` channel instead.
- 📱 If you open the admin login from inside LINE / Facebook / Instagram's in-app browser, Google Sign-In will refuse (`disallowed_useragent`) — that's a Google restriction, not a bug. Open the link in real Safari or Chrome.
- 🍏 Auth state is stored in `localStorage` (not IndexedDB) to avoid a long-standing Safari bug where IndexedDB intermittently hangs and causes Firebase to fire `onAuthStateChanged(null)` mid-session, which would bounce the admin to the login page.
- ✅ A slip is **never** marked paid just by uploading — an admin must explicitly approve it.
- 🚫 A student marked **terminated** cannot submit a new slip; enforced both client-side (UX) and server-side (the check that actually matters).
- 🪪 Logging in with just a Nu ID is intentionally lightweight auth, not full identity verification — see the caveat in the student login flow above.
