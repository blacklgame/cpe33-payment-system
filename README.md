# 💸 CPE33 Payment & Treasury System

![Vercel](https://img.shields.io/badge/hosted%20on-Vercel-black?logo=vercel)
![Firebase](https://img.shields.io/badge/backend-Firebase-FFCA28?logo=firebase&logoColor=black)
![Cloudinary](https://img.shields.io/badge/images-Cloudinary-3448C5?logo=cloudinary)
![Node](https://img.shields.io/badge/runtime-Node.js-339933?logo=node.js&logoColor=white)
![Vercel Limits](https://img.shields.io/badge/Vercel%20Functions-11%2F12-brightgreen)

A modern, high-security **Class Dues (ค่าสาขา) Ledger & Event Treasury System** built for **CPE33** computer engineering students at Naresuan University.

The system allows students to manage monthly dues with flexible payment modes (Full, Installment, Multi-Month Payoff), and provides admins with a **Fast-Approval Slip Review Engine**, multi-receipt event treasury tracking, interactive lightbox tools (zoom & 90° rotation), and immutable server-side audit logging.

Built for maximum efficiency on **Vercel** (strictly 11 Serverless Functions under the 12-function Hobby limit), **Firebase** (Auth + Firestore), and **Cloudinary** (Signed Image Storage).

---

## ✨ Key Features

### 💳 1. Monthly Dues & Flexible Student Payments ("ค่าสาขา")
- 🔵 **Option 1: จ่ายเต็มเดือนนี้ (Pay Full for This Month)** — Pay the exact dues for the selected month.
- 🟠 **Option 2: ผ่อนจ่ายเดือนนี้ (Installment for This Month)** — Enter a custom partial payment amount (e.g. 30.00 THB out of 60.00 THB) with dynamic remaining balance calculation.
- 🟣 **Option 3: จ่ายเหมาทุกเดือน (Pay All Unpaid Months at Once)** — Automatically sums all unpaid/remaining balances across all open months (e.g. 60 + 60 + 30 = 150.00 THB) for single-slip debt payoff.
- 📊 **Auto-Cascading Ledger**: When an admin approves a slip, backend transactions sequentially allocate funds to close out the **oldest unpaid balances first**.

### ⚡ 2. Fast-Approval Mode for Admins (⚡ โหมดตรวจสลิปด่วน)
- **Sequential Review Modal**: Rapidly review pending student payment slips one-by-one without page reloads.
- **Top Action Area**: Verified amount input, Approve (`Enter`), Reject (`Del`), and Next/Previous navigation (`←`/`→`) placed prominently at the top of the review card.
- **Desktop & Mobile Optimized**:
  - **Keyboard Shortcuts**: <kbd>Enter</kbd> to Approve, <kbd>Del</kbd> to Reject, <kbd>←</kbd> / <kbd>→</kbd> to navigate, <kbd>R</kbd> to rotate slip, and <kbd>Esc</kbd> to close.
  - **Mobile Touch Gestures**: Swipe left/right on the slip canvas to flip between pending slips.
- **Real-Time Queue Management**: Approving or rejecting instantly removes the item from the queue and advances to the next student with quiet background database synchronization.

### 🧾 3. Multi-Photo Receipts for Event Treasury
- **Income & Expense Receipt Attachments**: Admins can attach multiple receipts per transaction (e.g., store tax receipt + bank transfer slip).
- **Drag & Drop Upload Zone**: Client-side preview grid with instant image removal (`✕`) and file validation (JPG/PNG/WEBP up to 10MB).
- **Cloudinary Lifecycle Management**: Deleted/updated receipts are automatically purged from Cloudinary storage to prevent orphaned files.
- **100% Backward Compatible**: Seamlessly supports legacy transactions with single `receiptUrl` attributes.

### 🔍 4. Interactive Lightbox Viewer (Zoom & Rotate)
- **Badged Transactions**: Items with attached receipts display interactive `🧾 ใบเสร็จ (X)` badges.
- **Full Control Toolbar**:
  - **Rotation**: ↺ Rotate Left (90°) & ↻ Rotate Right (90°) for sideways receipt photos.
  - **Zoom**: ➕ Zoom In, ➖ Zoom Out, `100%` Reset.
  - **Gallery Strip**: Interactive thumbnail carousel at the bottom for instant photo switching.
  - **Full-Screen Link**: Direct link to inspect original high-resolution images in a new tab.
  - **Mobile Swipe & Shortcuts**: Swipe left/right to navigate images, or use <kbd>←</kbd>/<kbd>→</kbd>, <kbd>R</kbd>, <kbd>+</kbd>/<kbd>-</kbd>, and <kbd>Esc</kbd>.

### 🛡️ 5. Admin Dashboard & Ledger Filters
- **"จ่ายทุกเดือน (รวมทุกเดือน)" View**: View all student ledger summaries across all months at once.
- **Live Filter Buttons**: Instant client-side filtering by **All (ทั้งหมด)**, **Pending (รอตรวจสอบ)**, **Paid (จ่ายแล้ว)**, **Installment (ผ่อนจ่าย)**, and **Unpaid (ยังไม่จ่าย)**.
- **Audited Status Overrides**: Manual status adjustments and note changes immutably logged to Firestore `/auditLog`.

### ⚡ 6. Vercel Serverless Architecture
- Strictly optimized to **11 Serverless Functions** (safely below Vercel's 12-function Hobby tier threshold).

---

## ⌨️ Keyboard & Gesture Shortcuts Guide

### ⚡ Fast-Approval Mode (`/admin/dashboard.html`)
| Input | Action |
|---|---|
| <kbd>Enter</kbd> | **Approve** current slip (using the amount in the verified amount input) |
| <kbd>Del</kbd> | **Reject** current slip (prompts confirmation, deletes slip, and notifies student) |
| <kbd>←</kbd> / <kbd>→</kbd> | **Navigate** to previous / next pending slip |
| <kbd>R</kbd> | **Rotate** slip 90° clockwise |
| <kbd>Esc</kbd> | **Close** Fast Review mode |
| **Swipe Left / Right** | *(Mobile)* Flip between pending slips |

### 🖼️ Receipt Lightbox Viewer (`/admin/event-detail.html` & `/logined/events.html`)
| Input | Action |
|---|---|
| <kbd>←</kbd> / <kbd>→</kbd> | **Previous / Next** receipt photo |
| <kbd>R</kbd> | **Rotate** 90° clockwise |
| <kbd>+</kbd> / <kbd>-</kbd> | **Zoom in / out** (50% – 300%) |
| <kbd>Esc</kbd> | **Close** Lightbox viewer |
| **Swipe Left / Right** | *(Mobile)* Cycle between receipt photos |

---

## 🙋 User Workflows

### 🎓 Student Workflow
```
[Google Sign In (@nu.ac.th)] ──▶ [Roster Verification] ──▶ [Choose Payment Option]
                                                                  │
                                 ┌────────────────────────────────┴────────────────────────────────┐
                                 ▼                                 ▼                               ▼
                          [Option 1: Full]              [Option 2: Installment]          [Option 3: Pay All]
                                 │                                 │                               │
                                 └─────────────────────────────────┬───────────────────────────────┘
                                                                   ▼
                                                       [Signed Cloudinary Upload]
                                                                   ▼
                                                       [Submit Pending Slip]
                                                                   ▼
                                                       [Track Status on /stats]
```

### 🛡️ Admin Workflow
```
[Admin Authentication] ──▶ [Dues Month Management] ──▶ [⚡ Fast Review Mode (Enter/Del/Swipe)]
                                                                │
                                                                ├─▶ [Auto-Cascading Ledger Allocation]
                                                                │
                                                                └─▶ [Event Treasury (Multi-Receipts)]
```

---

## 🧠 System Architecture

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
│  (Firestore + Custom Token Auth)│  │ (Signed Slips & Receipts)  │
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
| `/api/admin/delete-slip` | `POST` | Admin | Deletes Cloudinary slip and resets student ledger balances across months |
| `/api/admin/list-data` | `POST` | Admin | Fetches roster, billing months, per-student monthly ledgers, and audit logs |
| `/api/admin/set-status` | `POST` | Admin | Overrides student status (`normal`, `unpaid`, `termination`) |
| `/api/admin/create-month` | `POST` | Admin | Creates or updates a billing month definition |
| `/api/admin/check-admin` | `POST` | Admin | Verifies if authenticated email is in approved admin list |
| `/api/admin/events-api` | `POST` | Admin | Manages events, transactions, signed upload tickets, and receipt attachments |
| `/api/events/list` | `GET` | Public | Returns public event treasury summaries with attached receipts |

---

## 🔒 Security & Threat Model

| Threat | Security Mitigation |
|---|---|
| **Student Impersonation** | Google OAuth (`@nu.ac.th`) strictly enforced; Firebase Auth custom token binds `auth.uid == nuid`. |
| **Direct Firestore Exploits** | `firestore.rules` blocks **all** client-side writes to `payments/*`, `users/*`, `admins/*`, `events/*`. |
| **Fake Slip Uploads** | `submit-slip.js` validates asset existence directly via Cloudinary Admin API server-side. |
| **Unsigned Asset Overwrites** | `sign-upload.js` and `events-api.js` sign `overwrite:false` and scope paths strictly. |
| **Admin Route Bypass** | Every `/api/admin/*` endpoint independently verifies Firebase ID Token + Admin Whitelist server-side. |
| **XSS Prevention** | User inputs and filenames sanitized (`replace(/[<>"'&]/g, "")`) before Firestore persistence. |
| **Audit Loss** | Immutable audit log written to `/auditLog` for all administrative actions. |

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
