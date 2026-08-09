# cpe33-payment-system

A small Nu-ID-based payment tracker: students log in with their Nu ID,
upload a payment slip image, and admins can see who's paid on the
Stats page.

- **Login roster + payment status:** Firebase Firestore
- **Auth:** Firebase Anonymous Auth (gives each browser session a
  signed-in token so security rules can require "must be signed in"
  before writing -- there's no real password login)
- **Slip images:** Vercel Blob (Firebase Storage now requires the paid
  Blaze plan even for small usage, so images don't go through Firebase
  at all)
- **Hosting:** Vercel (static `public/` + one serverless function)

## One-time Firebase setup

1. In the Firebase Console for your project, enable:
   - **Firestore Database** (Build menu -> Create database)
   - **Authentication** -> Sign-in method -> **Anonymous**
2. Paste the contents of `firestore.rules` into Firestore -> Rules,
   and click **Publish**. (This is the step that's easy to forget --
   editing the file locally does nothing until it's published here.)
3. `public/firebase.js` already has this project's config wired up.

## Deploying (Vercel)

1. Push this repo to GitHub, then in Vercel: Add New -> Project ->
   import the repo. Framework preset: **Other** (the included
   `vercel.json` points it at `public/`).
2. After the first deploy: project -> **Storage** tab -> Create
   Database -> **Blob** (Public access). Linking it auto-sets the
   `BLOB_READ_WRITE_TOKEN` env var that `api/upload.js` needs.
3. Redeploy once more so the function picks up that env var.

## Data model
- `users/{nuid}` — `{ name, email, stat }`, one doc per Nu ID.
  Read-only from the client (`allow write: if false`).
- `payments/{nuid}` — `{ paid, fileName, slipUrl, uploadedAt }`,
  written when a student uploads a payment slip. Writable only by a
  signed-in (anonymous) session.
- Vercel Blob: `slips/{nuid}/{timestamp}_{filename}` — the uploaded
  slip images themselves.

## Updating the roster later
The `users` collection is locked to read-only from the browser on
purpose, so there's no in-app way to add/edit students. If the roster
changes, the simplest options are editing documents directly in the
Firebase Console's Firestore -> Data tab, or temporarily reopening
`allow write` in `firestore.rules` for a one-off script/page the same
way the initial roster was loaded.

## About the upload size limit
Slip uploads go through `/api/upload`, which forwards the file to
Vercel Blob with `put()`. Since the file passes through the serverless
function, uploads are capped at **4MB** (Vercel's function body limit
is ~4.5MB). The client checks file size before upload and shows a Thai
error message if it's too big. If larger, uncompressed phone photos
need to be supported later, switch to Vercel Blob's client-upload flow
(`@vercel/blob/client`'s `upload()` + `handleUpload()`), which sends
files directly from the browser to Blob and supports up to 500MB.

## Note on the pages
Every page is loaded with plain `<script src="...">` tags (no
bundler) -- `public/firebase.js` and the app scripts use Firebase's
modular Web SDK loaded straight from Google's CDN via `import`, which
is why `index.js` script tags are marked `type="module"`.
