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
- **Admin emails now come from an `ADMIN_EMAILS` env var**, not the committed `config/admin-emails.json`. Set it in Vercel → Project → Settings → Environment Variables, comma-separated: `a@nu.ac.th,b@nu.ac.th,c@nu.ac.th`. See `api/_lib/admins.js`. `config/admin-emails.json` is now gitignored and only used as a local-dev fallback if you don't want to export the env var on your own machine — commit `config/admin-emails.example.json` (placeholder values) instead if you need something in source control. **This does not retroactively scrub any commit that already has the real file in its history** — see "Known leak" below.
- **Firebase Auth persistence was switched from IndexedDB to `browserLocalPersistence` (plain localStorage)**, in `public/firebase.js`. Safari has a long-standing, still-open bug where its IndexedDB implementation intermittently hangs/aborts when the Firebase JS SDK reads or writes the auth session (firebase/firebase-js-sdk issues #7888, #8860, #9802). This was the root cause of two separate symptoms: (1) the admin dashboard bouncing back to the login page a few seconds after an action, even though the admin never actually signed out, and (2) Google Sign-In on the admin login page being unreliable specifically on iOS Safari (the SDK does an IndexedDB round-trip while preparing the popup, and Safari kills a popup that doesn't open perfectly in sync with the click). `public/admin/dashboard.js` also now gives a spurious `onAuthStateChanged(null)` one grace check (waits ~1.2s and re-checks `auth.currentUser`) before bouncing an already-confirmed admin to login, and no longer treats a network error from `/api/admin/check-admin` the same as a confirmed "not an admin."
- If the login problem shows up in a browser opened **from inside the LINE/Facebook/Instagram app** rather than actual Safari, that's a different, unfixable-from-our-side issue: Google blocks Google Sign-In entirely inside embedded in-app webviews (`disallowed_useragent`) as an anti-phishing measure. The fix there is opening the link in real Safari/Chrome via the app's own "Open in browser" option, not a code change.
- Baseline security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) and a `Content-Security-Policy` were added in `vercel.json`. The CSP was built by actually auditing every external resource this app loads (Firebase's `gstatic.com` SDK, Google Fonts, `identitytoolkit`/`securetoken`/`firestore.googleapis.com` for Auth/Firestore, and `api.cloudinary.com` for uploads) rather than a generic template — no `unsafe-inline` on `script-src` (there are no inline `<script>` tags anywhere in this app), only on `style-src` (the two admin pages have an inline `<style>` block). **Test this in a Vercel preview deployment before trusting it in production** — I can't click through the app in a real browser from here, and a CSP is exactly the kind of thing that looks right on paper but silently blocks something at runtime (in the browser console, as a `Refused to ...` error) if a domain was missed.
