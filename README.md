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
- `payments/{nuid}` — `{ paid, fileName, slipUrl, uploadedAt }`,
  written when a student uploads a payment slip. Writable only by a
  signed-in (anonymous) session.
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
