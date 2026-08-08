"# cpe33-payment-system"

## Firebase setup (continuing from your cpe33-7f8f5 project)

You already created the Firebase project and web app — `public/firebase.js`
now has your real config wired up to Firestore, Storage, and anonymous Auth.
What's left:

1. In the Firebase Console for **cpe33-7f8f5**, make sure these are enabled
   (Build menu in the sidebar):
   - **Firestore Database** — Create database if you haven't yet.
   - **Storage** — Get started if you haven't yet.
   - **Authentication** -> Sign-in method -> enable **Anonymous**.
2. Open `public/admin-seed.html` in a browser (just double-click it, or
   serve the folder) and click **Seed Users** — this copies every entry
   from `public/user.js` into the Firestore `users` collection. Delete
   or block this page once you're done with it.
3. In the Firebase Console, paste `firestore.rules` into
   Firestore > Rules, and `storage.rules` into Storage > Rules.
4. Test it: log in with any Nu ID from `public/user.js` (e.g. `69360303`),
   upload any image as a slip, then check the Stats page.

### Data model
- `users/{nuid}` — `{ name, email, stat }`, one doc per Nu ID.
- `payments/{nuid}` — `{ paid, fileName, slipUrl, uploadedAt }`,
  written when a student uploads a payment slip.
- Storage: `slips/{nuid}/{timestamp}_{filename}` — the uploaded
  slip images themselves.

### Note on the pages
Every page is loaded with plain `<script src="...">` tags (no bundler),
so `public/firebase.js` and the app scripts use Firebase's **modular Web
SDK loaded straight from Google's CDN via `import`** — that's why the
`<script>` tags for `index.js` are marked `type="module"`. The
`firebase` npm package in `package.json` isn't actually used by the
site (there's no bundler to consume it) — it's safe to ignore or
remove.
