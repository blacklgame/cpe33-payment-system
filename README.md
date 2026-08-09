# cpe33-payment-system

A small Nu-ID-based payment tracker: students log in with their Nu ID,
upload a payment slip image, and admins can see who's paid on the
Stats page.

- **Login roster + payment status:** Firebase Firestore
- **Auth:** Firebase Anonymous Auth (gives each browser session a
  signed-in token so security rules can require "must be signed in"
  before writing -- there's no real password login)
- **Slip images:** Cloudinary, uploaded directly from the browser
  (unsigned upload -- Firebase Storage requires the paid Blaze plan
  even for small usage, and Vercel Blob's free tier caps out at 1GB,
  so images go straight from the client to Cloudinary instead)
- **Hosting:** Vercel (static `public/` only -- no serverless
  functions needed anymore)

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
- `payments/{nuid}` — `{ paid, fileName, slipUrl, uploadedAt, studentStatus }`,
  written when a student uploads a payment slip. Writable only by a
  signed-in (anonymous) session. `studentStatus` (`"normal" |
  "termination" | "unpaid"`) is a separate admin-only override, set
  via `api/admin/set-status.js` -- not written by the student upload
  flow.
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
every user 1-91, view their uploaded slip, delete a slip that turns
out to be fake (which also resets that student back to unpaid), and
set each student's status to **ปกติ/Normal** (green), **พ้นสภาพ/
Termination** (orange), or **ยังไม่จ่าย/Haven't paid** (red) from a
dropdown on their card. It's gated by Google Sign-In restricted to
specific `@nu.ac.th` addresses.

Two layers of checking happen:
- **Client-side** (`admin.js`, `dashboard.js`) -- decides whether the
  login/dashboard *pages* let someone in. This is just a UI gate and
  can be bypassed by anyone editing JS in devtools.
- **Server-side** (`api/admin/delete-slip.js`, `api/admin/set-status.js`)
  -- the real security check for the delete and status-change actions,
  since each independently re-verifies the signed-in user's identity
  with Firebase's own servers. The status field specifically has to
  go through here rather than a direct client write, because
  `firestore.rules` lets any signed-in session (including an
  anonymous student session) write to `payments/{nuid}` -- a field
  that can mark someone "terminated" can't be left open to that.

**You must edit the same `ADMIN_EMAILS` list in all four files**
(`public/admin/admin.js`, `public/admin/dashboard.js`,
`api/admin/delete-slip.js`, `api/admin/set-status.js`) with your real
`@nu.ac.th` address(es).

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
