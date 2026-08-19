# 💸 CPE33 Payment System

![Vercel](https://img.shields.io/badge/hosted%20on-Vercel-black?logo=vercel)
![Firebase](https://img.shields.io/badge/backend-Firebase-FFCA28?logo=firebase&logoColor=black)
![Cloudinary](https://img.shields.io/badge/images-Cloudinary-3448C5?logo=cloudinary)
![Node](https://img.shields.io/badge/runtime-Node.js-339933?logo=node.js&logoColor=white)

Payment-tracking site for **CPE33** students at Naresuan University.
Students upload payment slips for given billing months; admins review and approve them. Includes an **event treasury** tool for admins to track income/expenses on club activities, complete with server-side audit logging.

Built on **Vercel** (serverless functions + static frontend), **Firebase** (Auth + Firestore), and **Cloudinary** (slip image storage).

---

## 🙋 What the site does (for users)

There are three main user workflows: **students** paying dues via Google `@nu.ac.th` SSO, **admins** reviewing payments, and **admins** running the event treasury.

### 🎓 If you're a student

| Step | What happens |
|---|---|
| 1️⃣ **Log in with Google** | Go to the home page (`/`) and click **"Sign in with NU Account"**. Authenticate with your official `@nu.ac.th` Google Workspace account. |
| 2️⃣ **Whitelist & Roster Verification** | The system verifies your `@nu.ac.th` email against the Firestore roster. If matched, it logs you in under your student Nu ID. |
| 3️⃣ **See what you owe** | Your payment page lists every open billing month (e.g. "🗓️ กุมภาพันธ์ 2026 — 80 บาท") and whether you've already paid it. |
| 4️⃣ **Pay & upload proof** | Transfer the money, select the month, and attach a photo/screenshot of your payment slip. |
| 5️⃣ **Wait for approval** | 🟡 Your slip goes to **pending** instantly. It does **not** count as paid until reviewed by an admin. |
| 6️⃣ **Check your status anytime** | The **"My Status"** (`/stats`) page shows a month-by-month breakdown — 🟡 pending / 🟢 approved / 🔴 rejected — plus your overall standing (normal / unpaid / terminated). |

> 🚫 Students marked **terminated ("พ้นสภาพ")** by an admin are blocked from uploading new slips.

### 🛡️ If you're an admin (payments)

| Step | What happens |
|---|---|
| 1️⃣ **Log in with Google** | Access `/admin/login.html` and sign in with an approved `@nu.ac.th` admin Google account. |
| 2️⃣ **Create billing months** | On the **Months** page, set up billing periods (year + month + price). Prices are snapshotted on slip submission. |
| 3️⃣ **Review slips** | The dashboard lists uploaded slips per month. ✅ **Approve** marks the month paid; 🗑️ **Delete/reject** removes the image and resets the record to rejected. |
| 4️⃣ **Set student status** | Flag a student as ✅ normal, 🟡 unpaid, or 🔴 terminated — independent of single months. |
| 5️⃣ **Track totals** | Review collected totals, pending counts, and running grand totals for the term. |

> 💡 Nothing is ever marked paid automatically — a human admin must explicitly approve each slip. All admin mutations are recorded to an immutable `/auditLog`.

### 💰 If you're an admin (event treasury)

| Step | What happens |
|---|---|
| 1️⃣ **Create an event** | Provide a name and an emoji (🎉 by default) on the **Events** page. |
| 2️⃣ **Log transactions** | Add 💵 income or 💸 expense entries — label, amount, optional quantity, optional note. |
| 3️⃣ **Watch the running balance** | Running totals (income, expense, balance) update atomically inside Firestore transactions. |
| 4️⃣ **Audit Logging** | Every create, edit, or delete action on an event or transaction writes an entry to `/auditLog`. |

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
        │                      ──► Firebase Auth (ID token verification & custom token minting)
        └──► Cloudinary API    ──► Cloudinary (slip images)
```

Every mutating endpoint follows a strict pipeline: **rate-limit → verify Firebase ID token → validate input bounds → admin whitelist check (if admin route) → execute transaction / mutation via Admin SDK → write audit log**.

---

### 🎓 Student flow (technical)

1. **Google OAuth & Whitelist Lookup** — Student signs in with Google (`@nu.ac.th`) on `/`. The client sends the Google ID Token to `POST /api/mint-session`.
   - The server verifies the Google ID token.
   - Enforces `@nu.ac.th` email domain.
   - Queries `db.collection("users").where("email", "==", googleEmail)`.
   - Extracts the student's document ID (`nuid`, e.g. `69360013`) and mints a **Firebase custom token** with `uid = nuid`.
   - The browser signs into Firebase Auth with this custom token, binding `request.auth.uid` to `nuid`.

2. **Upload slip** — `POST /api/sign-upload` returns a **Cloudinary signed-upload ticket**. The server specifies `public_id` (`slips/{nuid}/{monthId}/{timestamp}_{random}`) and `overwrite:false`. The browser uploads directly to Cloudinary.

3. **Submit slip** — `POST /api/submit-slip` writes `paid: false, reviewStatus: "pending"` to `payments/{nuid}/months/{monthId}`. Confirms asset existence via Cloudinary Admin API and snapshots the month's price into `amount`.

4. **Check status** — `/stats` reads `payments/{nuid}` and `payments/{nuid}/months/*` under owner-only rules (`request.auth.uid == nuid`).

---

### 🛡️ Admin flow & Audit Trail (technical)

1. **Admin Verification** — `checkIsAdmin(email)` checks the Firestore `admins/{email}` collection (managed live via `node scripts/manage-admin.js add|remove|list <email>`), falling back to `ADMIN_EMAILS` env var.
2. **Mutations & Audit Logging** — Every admin endpoint (`approve-slip`, `delete-slip`, `set-status`, `create-month`, `delete-month`, `events-api`) invokes `writeAuditLog(db, action, adminEmail, details)` which records an audit entry to `/auditLog/{autoId}`.
3. **Audit Trail API** — `GET /api/admin/audit-list` allows verified admins to query recent entries from `/auditLog`.

---

### 🔒 Security & Threat Model

| Threat | Mitigation |
|---|---|
| Student Identity Impersonation | Student login requires Google OAuth (`@nu.ac.th`). Accounts are strictly bound to verified email addresses in the roster. |
| Client writes `paid: true` directly to Firestore | `firestore.rules` denies **all** client writes to `payments/*`, `users/*`, `admins/*`, `events/*`, `auditLog/*`. |
| Fabricated Cloudinary URL submitted as slip | `submit-slip.js` verifies asset existence via Cloudinary Admin API server-side before writing. |
| Unsigned Cloudinary upload under another student's path | `sign-upload.js` enforces `uid == nuid` token matching; server sets `public_id` and signs `overwrite:false`. |
| Admin whitelist bypass via client JS | Every `api/admin/*` route independently verifies Firebase ID token + admin whitelist server-side. |
| XSS via URL parameters | URL parameters on admin login (`?email=`) are rendered safely using DOM text nodes (`textContent`). |
| Session retention on shared devices | Student logout executes `await signOut(auth)` to invalidate auth tokens. |
| Over-sized inputs or negative values | Strict server-side bounds on amounts ($\le 10,000,000$), quantities ($\le 1,000$), labels ($\le 200$ chars), and emojis ($\le 10$ chars). |
| Clickjacking & Protocol Downgrades | Enforced `Strict-Transport-Security` and `Content-Security-Policy: frame-ancestors 'none'` in `vercel.json`. |
| Losing paper trail on admin actions | Every admin action writes to `/auditLog`. |

---

## ⚙️ Setup & Deployment

### 1. Requirements
- Node.js (LTS)
- Vercel CLI (`npm install -g vercel`)
- Firebase project with **Firestore** and **Authentication (Google Sign-In)** enabled
- Cloudinary account

### 2. Environment Variables (`.env`)
```env
ADMIN_EMAILS=admin1@nu.ac.th,admin2@nu.ac.th
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64-encoded Firebase service account JSON>
CLOUDINARY_API_KEY=<from Cloudinary dashboard>
CLOUDINARY_API_SECRET=<from Cloudinary dashboard>
```

### 3. Deploy Firestore Rules
```bash
firebase deploy --only firestore:rules
```

### 4. Local Development & Deployment
```bash
# Run locally
vercel dev

# Deploy to production
vercel --prod
```
