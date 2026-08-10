# CPE33 Payment System

A web-based payment tracking system for **CPE33 students at Naresuan University**.

---

## What this site does

### For Students
Students log in using their **Nu ID** (student ID number). Once logged in, they can:
- **Upload a payment slip** — take a photo or select an image of their payment receipt and submit it through the site.
- **Check their payment status** — see whether their slip has been approved, is still pending review, or has been rejected.

### For Admins
Admins sign in with a whitelisted **@nu.ac.th Google account**. Through the admin dashboard, they can:
- **View all 91 students** in the class roster with their current payment status at a glance.
- **Review uploaded slips** — view the slip image a student submitted.
- **Approve a slip** — the only action that marks a student as officially paid.
- **Reject / delete a slip** — removes the slip and resets the student back to unpaid.
- **Set a student's status** manually:
  - 🟢 **ปกติ / Normal** — active student, paid
  - 🔴 **ยังไม่จ่าย / Unpaid** — has not paid yet
  - 🟠 **พ้นสภาพ / Terminated** — no longer an active student; blocked from uploading

---

## Key rules

- A student is **never automatically marked as paid** just by uploading a slip. An admin must review and approve it.
- Terminated students **cannot submit new slips**.
- All payment write operations are **admin-only and verified server-side** — they cannot be bypassed from the browser.

---

## Security notes

- **Login binds a real Firebase Auth session to the typed Nu ID** (`/api/mint-session` → `signInWithCustomToken`), so Firestore rules and API routes can check `request.auth.uid == nuid` instead of trusting the browser. This does **not** verify that the person typing a Nu ID actually owns it — there's no password, OTP, or SSO check. Anyone who knows a valid Nu ID can still log in as it. If that gap ever needs closing, the natural next step is restricting the admin Google Sign-In pattern (already in `admin.js`) to students too, mapped by their `nu.ac.th` email in the roster.
- **`firestore.rules`** denies all client reads/writes on `users`, and only allows a client to read `payments/{nuid}` when signed in as that exact `nuid`. The admin dashboard reads both collections in bulk through `/api/admin/list-data` (Admin SDK) instead, since an admin's own uid never matches a student's.
- **Slip uploads are signed** (`/api/sign-upload`): the server — not the browser — picks the Cloudinary `public_id` and signs `overwrite:false`, after checking the caller's ID token matches the `nuid` they're uploading for.
- **Rate limiting** on every API route is a best-effort, in-memory limiter (see `api/_lib/rate-limit.js`) — it adds real friction against a single abusive client but won't stop a distributed attacker. Swap in Vercel KV / Upstash Redis there if that's ever needed.
- Remember to **redeploy `firestore.rules`** (`firebase deploy --only firestore:rules`, or paste into the Firebase console) — pushing the app code alone does not update Firestore's rules.
- **The roster moved out of `public/`.** `public/user.js` used to ship every student's name/email/Nu ID to any browser that loaded the login page — no login required, just view-source. The login page now validates the Nu ID and fetches the student's name/email through `/api/mint-session` (Firestore, via the Admin SDK) instead. The same data now lives at `scripts/roster-data.json`, used only by `scripts/seed-users.js` to (re-)seed Firestore; it's gitignored, so keep your own local copy and don't commit it. `serviceAccountKey.json` is now actually gitignored too — it was referenced as "already in .gitignore" in a comment but wasn't, so if you'd generated one locally before, double check it never got committed.
