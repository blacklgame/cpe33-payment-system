# cpe33-payment-system

A small Nu-ID-based payment tracker: students log in with their Nu ID,
upload a payment slip image, and admins can see who's paid on the
Stats page.

- **Login roster + payment status:** Firebase Firestore
- **Auth:** Firebase Anonymous Auth for students (session identity
  only -- there's no real password login; see "Security model" below
  for why nothing security-critical can rely on it), Google Sign-In
  (restricted to whitelisted `@nu.ac.th` addresses) for admins
- **Slip images:** Cloudinary, uploaded directly from the browser
  (unsigned upload -- Firebase Storage requires the paid Blaze plan
  even for small usage, and Vercel Blob's free tier caps out at 1GB,
  so images go straight from the client to Cloudinary instead)
- **Hosting:** Vercel (`public/` static site + serverless functions
  in `api/` -- every write to `payments/{nuid}` goes through one of
  these, since `firestore.rules` denies client writes to that
  collection entirely)

## Security model

A student's "paid" status can **only** ever be set by
`api/admin/approve-slip.js`, after an admin has looked at the slip in
the dashboard and clicked Approve. The student-facing upload flow
(`public/logined/index.js` -> `api/submit-slip.js`) can only ever
create a *pending* record -- it has no code path that writes
`paid: true`. This closes a real hole in an earlier version of this
app: `firestore.rules` used to let a signed-in (including anonymous)
client write `payments/{nuid}` directly as long as the data matched a
couple of regexes, which only check the *shape* of a string, not
whether anyone reviewed the image. Since Cloudinary's unsigned upload
preset lets the client pick its own `public_id`, that meant anyone
could upload an unrelated image and self-approve as "paid" with zero
admin involvement. See `api/submit-slip.js` and `firestore.rules` for
the current design.

This still doesn't verify that whoever types a Nu ID into the login
page actually owns it -- there's no password login, by design. That's
a separate, known limitation; the fix above is specifically about
making sure a submitted slip can never mark itself paid.

## One-time Firebase setup

1. In the Firebase Console for your project, enable:
   - **Firestore Database** (Build menu -> Create database)
   - **Authentication** -> Sign-in method -> **Anonymous**
2. Paste the contents of `firestore.rules` into Firestore -> Rules,
   and click **Publish**. (This is the step that's easy to forget --
   editing the file locally does nothing until it's published here.)
3. `public/firebase.js` already has this project's config wired up.

## One-time Cloudinary setup

1. Sign up free at cloudinary.com -- no credit card needed.
2. On the Console home page, copy your **Cloud name** (top of the
   page).
3. Go to Settings (gear icon) -> **Upload** -> scroll to **Upload
   presets** -> **Add upload preset**:
   - Set **Signing Mode** to **Unsigned** (required -- this app
     uploads straight from the browser with no server in between).
   - Under **Upload Manipulations** -> **Incoming Transformation**,
     add `q_auto,f_auto` so Cloudinary auto-compresses every slip on
     the way in (a 3-5MB phone photo typically lands under 1MB with
     no visible quality loss).
   - Save, and copy the preset name.
4. Paste your Cloud name and preset name into
   `public/logined/index.js` (`CLOUDINARY_CLOUD_NAME` and
   `CLOUDINARY_UPLOAD_PRESET` near the top of the upload section).

Free plan gives 25 credits/month (storage + bandwidth + transforms
combined, roughly 25GB worth) -- comfortably more headroom than
Vercel Blob's 1GB cap for ~91 students' worth of slips.

## Deploying (Vercel)

1. Push this repo to GitHub, then in Vercel: Add New -> Project ->
   import the repo. Framework preset: **Other** (the included
   `vercel.json` points it at `public/`).
2. That's it -- no env vars or storage linking needed, since
   Cloudinary uploads happen entirely client-side.

## Data model
- `users/{nuid}` — `{ name, email, stat }`, one doc per Nu ID.
  Read-only from the client (`allow write: if false`).
- `payments/{nuid}` — `{ paid, reviewStatus, fileName, slipUrl,
  slipPublicId, submittedAt, studentStatus, approvedBy, approvedAt }`.
  NOT writable from any client session (`firestore.rules` is
  `allow write: if false`) -- every write goes through an Admin-SDK
  server endpoint:
  - `api/submit-slip.js` -- called by students after a Cloudinary
    upload. Always writes `paid: false, reviewStatus: "pending"`.
    It has no code path that can ever write `paid: true`.
  - `api/admin/approve-slip.js` -- the *only* place `paid: true` can
    be written. Admin-only (whitelist + verified ID token).
  - `api/admin/set-status.js` -- sets the `studentStatus` override
    (`"normal" | "termination" | "unpaid"`). Admin-only.
  - `api/admin/delete-slip.js` -- rejects/removes a slip, resets
    `paid: false`. Admin-only.
- Cloudinary: `slips/{nuid}/{timestamp}_{filename}` — the uploaded
  slip images themselves (public_id under the `slips/` folder).

## Updating the roster later
The `users` collection is locked to read-only from the browser on
purpose, so there's no in-app way to add/edit students. If the roster
changes, the simplest options are editing documents directly in the
Firebase Console's Firestore -> Data tab, or temporarily reopening
`allow write` in `firestore.rules` for a one-off script/page the same
way the initial roster was loaded.

## About the upload size limit
Slip uploads go straight from the browser to Cloudinary (no
serverless function in between, so no Vercel body-size cap to worry
about). The client still checks file size before upload and shows a
Thai error message above **10MB** as a sanity check -- comfortably
larger than any phone photo of a payment slip, and the upload
preset's `q_auto,f_auto` transformation compresses it further on
Cloudinary's end anyway.

## Note on the pages
Every page is loaded with plain `<script src="...">` tags (no
bundler) -- `public/firebase.js` and the app scripts use Firebase's
modular Web SDK loaded straight from Google's CDN via `import`, which
is why `index.js` script tags are marked `type="module"`.

## Admin dashboard setup

The admin dashboard (`public/admin/`) lets a whitelisted admin see
every user 1-91, view their uploaded slip, **approve a pending slip**
(the only way a student gets marked paid), delete a slip that turns
out to be fake (which also resets that student back to unpaid), and
set each student's status to **ปกติ/Normal** (green), **พ้นสภาพ/
Termination** (orange), or **ยังไม่จ่าย/Haven't paid** (red) from a
dropdown on their card. It's gated by Google Sign-In restricted to
specific `@nu.ac.th` addresses.

Two layers of checking happen:
- **Client-side** (`admin.js`, `dashboard.js`) -- decides whether the
  login/dashboard *pages* let someone in. This is just a UI gate and
  can be bypassed by anyone editing JS in devtools.
- **Server-side** (`api/admin/approve-slip.js`, `api/admin/delete-slip.js`,
  `api/admin/set-status.js`) -- the real security check for approving,
  deleting, and status-change actions, since each independently
  re-verifies the signed-in user's identity with Firebase's own
  servers. Every one of these fields has to go through here rather
  than a direct client write, because `firestore.rules` denies all
  client writes to `payments/{nuid}` outright -- students submit via
  `api/submit-slip.js`, which can only ever write `paid: false`.

**To add or remove an admin, edit only `public/admin/admin-emails.json`**
-- a plain JSON array of `@nu.ac.th` addresses. All four checks above
(both client pages, both server functions) read from this single
file, so there's nowhere else to update:

```json
[
  "admin@nu.ac.th",
  "another.admin@nu.ac.th"
]
```

Commit and redeploy after editing it.

### 1. Enable Google Sign-In in Firebase
Firebase Console -> Authentication -> Sign-in method -> enable
**Google**.

### 2. Authorize your Vercel domain
Firebase Console -> Authentication -> Settings -> Authorized domains
-> add your Vercel domain (e.g. `cpe33-payment.vercel.app`). Without
this step, Google Sign-In fails with an `auth/unauthorized-domain`
error -- easy to miss.

### 3. Get a Firebase service account key
Same credential used by `scripts/seed-users.js`:
1. Firebase Console -> Project settings -> Service accounts ->
   Generate new private key. Save the downloaded file somewhere
   local (never commit it).
2. Base64-encode it: `node -e "console.log(require('fs').readFileSync('serviceAccountKey.json').toString('base64'))"`
3. Copy the output.

### 4. Get Cloudinary API credentials
Different from the unsigned upload preset you set up earlier.
Cloudinary Console -> Settings (gear) -> **API Keys** -> copy the
**API Key** and **API Secret**.

### 5. Set Vercel environment variables
Vercel Project -> Settings -> Environment Variables, add:
- `FIREBASE_SERVICE_ACCOUNT_BASE64` = the base64 string from step 3
- `CLOUDINARY_API_KEY` = from step 4
- `CLOUDINARY_API_SECRET` = from step 4

Redeploy after adding these -- Vercel only picks up new env vars on
the next deploy.
