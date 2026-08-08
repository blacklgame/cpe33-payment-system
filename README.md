"# cpe33-payment-system"

## Firebase (Firestore + Auth only)

`public/firebase.js` has your real config wired up to Firestore and
anonymous Auth. Firebase **Storage is not used** -- Google now requires
the paid Blaze plan for Storage even at tiny volumes, so payment slip
images go to **Vercel Blob** instead (see below).

1. In the Firebase Console for **cpe33-7f8f5**, make sure these are
   enabled (Build menu in the sidebar):
   - **Firestore Database** — Create database if you haven't yet.
   - **Authentication** -> Sign-in method -> enable **Anonymous**.
2. Open `public/admin-seed.html` in a browser (just double-click it, or
   serve the folder) and click **Seed Users** — this copies every entry
   from `public/user.js` into the Firestore `users` collection. Delete
   or block this page once you're done with it.
3. In the Firebase Console, paste `firestore.rules` into
   Firestore > Rules.
4. Test it: log in with any Nu ID from `public/user.js` (e.g. `69360303`),
   upload any image as a slip, then check the Stats page.

`storage.rules` is no longer used and can be ignored/deleted -- it's
left in the repo only for reference.

## Image storage: Vercel Blob

Slip images upload from the browser to `/api/upload` (a Vercel
serverless function), which forwards them to Vercel Blob with `put()`
and returns the resulting URL. That URL is then saved on the
`payments/{nuid}` Firestore doc, same as before.

This is the simple version of the integration: since the file passes
through the serverless function, uploads are capped at **4MB**
(Vercel's function body limit is ~4.5MB, so 4MB leaves headroom). The
client checks file size before upload and shows a Thai error message
if it's too big. If you need to support larger, uncompressed phone
photos later, switch to Vercel Blob's client-upload flow instead
(`@vercel/blob/client`'s `upload()` + `handleUpload()`), which sends
files directly from the browser to Blob and supports up to 500MB.

This needs the site deployed on Vercel with a Blob store created and
linked (Storage tab in the Vercel dashboard) — that automatically sets
the `BLOB_READ_WRITE_TOKEN` env var that `api/upload.js` needs.

### Data model
- `users/{nuid}` — `{ name, email, stat }`, one doc per Nu ID.
- `payments/{nuid}` — `{ paid, fileName, slipUrl, uploadedAt }`,
  written when a student uploads a payment slip.
- Vercel Blob: `slips/{nuid}/{timestamp}_{filename}` — the uploaded
  slip images themselves.

### Note on the pages
Every page is loaded with plain `<script src="...">` tags (no bundler),
so `public/firebase.js` and the app scripts use Firebase's **modular Web
SDK loaded straight from Google's CDN via `import`** — that's why the
`<script>` tags for `index.js` are marked `type="module"`. The
`firebase` npm package in `package.json` isn't actually used by the
site (there's no bundler to consume it) — it's safe to ignore or
remove.
