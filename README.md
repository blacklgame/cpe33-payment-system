# 💸 CPE33 Payment System

![Vercel](https://img.shields.io/badge/hosted%20on-Vercel-black?logo=vercel)
![Firebase](https://img.shields.io/badge/backend-Firebase-FFCA28?logo=firebase&logoColor=black)
![Cloudinary](https://img.shields.io/badge/images-Cloudinary-3448C5?logo=cloudinary)
![Node](https://img.shields.io/badge/runtime-Node.js-339933?logo=node.js&logoColor=white)
![Vercel Limits](https://img.shields.io/badge/Vercel%20Functions-11%2F12-brightgreen)

A modern, high-security **Payment Tracking & Dues Ledger System** for **CPE33** students at Naresuan University.

Students can pay their monthly dues or activity fees using 3 flexible payment options (Full, Installment, or Pay All), while admins manage approvals with an **Auto-Cascading Ledger Engine**, multi-month review views, quick status filter buttons, and a complete event treasury with immutable server-side audit logging.

Built for maximum efficiency on **Vercel** (strictly 11 Serverless Functions under the 12-function Hobby limit), **Firebase** (Auth + Firestore), and **Cloudinary** (Signed Slip Storage).

---

## ✨ Key Features

### 💳 1. Three Student Payment Options
When paying monthly dues or fees, students select from 3 payment options:
- 🔵 **Option 1: จ่ายเต็มเดือนนี้ (Pay Full for This Month)** — Pay the full remaining amount for 1 month.
- 🟠 **Option 2: ผ่อนจ่ายเดือนนี้ (Installment for This Month)** — Enter a custom partial payment amount (e.g. 30.00 THB out of 60.00 THB) with dynamic remaining balance calculation.
- 🟣 **Option 3: จ่ายเหมาทุกเดือน (Pay All Unpaid Months at Once)** — Automatically sums all unpaid/remaining balances across all months (e.g. 60 + 60 + 30 = 150.00 THB) for single-slip debt payoff.

### 📊 2. Outstanding Balance Ledger System ("ผ่อนจ่าย")
- **Per-Month Ledger**: Tracks `targetAmount`, `paidAmount`, and `remainingBalance` per month for every student.
- **Auto-Cascading Approval**: When an admin approves a slip, backend transactions sequentially allocate funds to close out the **oldest unpaid balances first**.
- **Single-Slip Multi-Month Payoff**: Upload 1 slip to pay for multi-month or installment balances.
- **Clear Partial Status Badges**: Displays clear `ผ่อนจ่าย (30/60 บาท)` status pills on student and admin views.

### 🛡️ 3. Admin Dashboard & Quick Status Filters
- **"จ่ายทุกเดือน (รวมทุกเดือน)" View**: View overall student balances across all months with a single dropdown selection.
- **Quick Status Filter Buttons**: Filter students instantly with live count badges:
  - **ทั้งหมด (All)** — Full roster list
  - **รอตรวจสอบ (Pending)** — Slips awaiting approval
  - **จ่ายแล้ว (Paid)** — Students fully paid
  - **ยังไม่จ่าย (Unpaid)** — Students with open debt
- **Universal Slip Actions**: View slip URLs, Approve, Reject, or Delete slips from any month view or the "จ่ายทุกเดือน" view.
- **Full Slip Deletion / Reset**: Deleting/rejecting a slip safely rolls back all allocated funds across months.

### 💰 4. Event Treasury & Audit Trail
- Track club activity income/expenses with atomic running balance calculations in Firestore.
- Every admin action is immutably recorded to `/auditLog`.

### ⚡ 5. Vercel Hobby Limit Compliance
- Strictly maintained at **11 Serverless Functions** (0 new function files added to stay safely below Vercel's 12-function limit).

---

## 🙋 User Workflows

### 🎓 Student Workflow

| Step | Action | Description |
|---|---|---|
| 1️⃣ | **Google OAuth Sign In** | Authenticate at `/` using your official `@nu.ac.th` Google account. |
| 2️⃣ | **Roster Verification** | The system matches your email against the Firestore roster and mints a secure student session. |
| 3️⃣ | **Choose Payment Option** | Select **Pay Full**, **Installment** (custom amount), or **Pay All Unpaid Months**. |
| 4️⃣ | **Upload Payment Slip** | Upload a photo of your bank transfer slip (signed upload to Cloudinary). |
| 5️⃣ | **Track Dues & Ledger** | Check `/stats` to view overall status, installment badges (`ผ่อนจ่าย 30/60 บาท`), and remaining balance. |

### 🛡️ Admin Workflow

| Step | Action | Description |
|---|---|---|
| 1️⃣ | **Admin Authentication** | Access `/admin/login.html` and sign in with an approved admin email. |
| 2️⃣ | **Create Dues Periods** | Create billing months (Year, Month, Target Amount) on the **Months** page. |
| 3️⃣ | **Review Slips & Allocate** | Filter pending slips, review uploads, and click **Approve** (funds auto-cascade to oldest unpaid months first). |
| 4️⃣ | **Manage & Filter Roster** | Filter by **Paid**, **Unpaid**, or **Pending**, or select **"จ่ายทุกเดือน"** for multi-month tracking. |
| 5️⃣ | **Event Treasury** | Log income/expense items for CPE33 activities with real-time balance calculations. |

---

## 🧠 System Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser (Student / Admin)                    │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              Vercel Edge (Static HTML/CSS/JS Assets)            │
└────────────────────────────────┬────────────────────────────────┘
                                 │ /api/*
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│            Vercel Serverless Functions (Node.js - 11/12)        │
│                                                                 │
│  - submit-slip.js      - sign-upload.js      - mint-session.js │
│  - approve-slip.js     - delete-slip.js     - list-data.js    │
│  - create-month.js     - set-status.js      - check-admin.js  │
│  - events-api.js       - events/list.js                         │
└────────────────┬────────────────────────────────┬───────────────┘
                 │                                │
                 ▼                                ▼
┌─────────────────────────────────┐  ┌────────────────────────────┐
│      Firebase Admin SDK         │  │     Cloudinary API         │
│  (Firestore + Custom Token Auth)│  │   (Signed Slip Uploads)    │
└─────────────────────────────────┘  └────────────────────────────┘
```

---

## 📂 API Reference (Serverless Functions)

All endpoints reside in `/api` and strictly comply with Vercel serverless bounds:

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/api/mint-session` | `POST` | Public | Validates `@nu.ac.th` Google token & mints custom Firebase auth session |
| `/api/sign-upload` | `POST` | Student | Issues signed Cloudinary upload ticket for `slips/{nuid}/{monthId}/...` |
| `/api/submit-slip` | `POST` | Student | Submits pending slip with `paymentMode` (`full`, `installment`, `all`) & `amountPaid` |
| `/api/admin/approve-slip` | `POST` | Admin | Approves slip and executes **Auto-Cascading Fund Allocation** across months |
| `/api/admin/delete-slip` | `POST` | Admin | Deletes Cloudinary slip and resets student's ledger balances across months |
| `/api/admin/list-data` | `POST` | Admin | Fetches roster, billing months, per-student monthly ledgers, and audit logs |
| `/api/admin/set-status` | `POST` | Admin | Overrides student status (`normal`, `unpaid`, `termination`) |
| `/api/admin/create-month` | `POST` | Admin | Creates or updates a billing month definition |
| `/api/admin/check-admin` | `POST` | Admin | Verifies if authenticated email is in approved admin list |
| `/api/admin/events-api` | `POST` | Admin | Manages events and income/expense treasury transactions |
| `/api/events/list` | `GET` | Public | Returns public event treasury summaries |

---

## 🔒 Security & Threat Model

| Threat | Security Mitigation |
|---|---|
| **Student Impersonation** | Google OAuth (`@nu.ac.th`) strictly enforced; Firebase Auth custom token binds `auth.uid == nuid`. |
| **Direct Firestore Exploits** | `firestore.rules` blocks **all** client-side writes to `payments/*`, `users/*`, `admins/*`, `events/*`. |
| **Fake Slip Uploads** | `submit-slip.js` validates asset existence directly via Cloudinary Admin API server-side. |
| **Unsigned Asset Overwrites** | `sign-upload.js` signs `overwrite:false` and restricts `public_id` path strictly to `slips/{nuid}/...`. |
| **Admin Route Bypass** | Every `/api/admin/*` function independently verifies Firebase ID Token + Admin Whitelist server-side. |
| **XSS Prevention** | User inputs and filenames sanitized (`replace(/[<>"'&]/g, "")`) before Firestore persistence. |
| **Paper Trail Loss** | Immutable audit log written to `/auditLog` for all administrative actions. |

---

## ⚙️ Setup & Deployment

### 1. Prerequisites
- Node.js (v18+ LTS)
- Vercel CLI (`npm install -g vercel`)
- Firebase Project with Firestore and Google Sign-In enabled
- Cloudinary Account

### 2. Environment Variables (`.env`)
```env
ADMIN_EMAILS=admin1@nu.ac.th,admin2@nu.ac.th
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64-encoded Firebase service account JSON>
CLOUDINARY_API_KEY=<Cloudinary API key>
CLOUDINARY_API_SECRET=<Cloudinary API secret>
```

### 3. Deploy Firestore Security Rules
```bash
firebase deploy --only firestore:rules
```

### 4. Local Development & Production Deployment
```bash
# Run locally with Vercel CLI
vercel dev

# Deploy to production
vercel --prod
```

---

## 📄 License

Developed for **CPE33 Class Dues & Treasury Management** at Naresuan University.
