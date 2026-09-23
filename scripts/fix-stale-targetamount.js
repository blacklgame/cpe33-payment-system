/* ------------------------------------------------------------
   One-time fix script: correct stale targetAmount values in
   student payment subcollection records.

   Background:
     If a month was created with a test amount (e.g. 67 baht),
     then deleted and recreated with the correct amount (100 baht),
     any student payment records written during that test period
     still hold the old targetAmount. This script finds and fixes
     those records so remainingBalance is recalculated correctly.

   What it does:
     1. Reads every month from the master `months` collection
     2. For each month, scans all student payment subcollection docs
     3. If a doc's targetAmount doesn't match the master amount,
        corrects: targetAmount, remainingBalance, and paid flag
     4. Dry-run by default — pass --apply to actually write

   Usage:
     node scripts/fix-stale-targetamount.js              <- dry run (safe, no writes)
     node scripts/fix-stale-targetamount.js --apply      <- write fixes to Firestore

   Auth (same as other scripts):
     Place serviceAccountKey.json in project root, OR
     set FIREBASE_SERVICE_ACCOUNT_BASE64 env var
 ------------------------------------------------------------ */

const fs    = require("fs");
const path  = require("path");
const admin = require("firebase-admin");

// ── Firebase init ────────────────────────────────────────────
const keyPath = path.join(__dirname, "..", "serviceAccountKey.json");

if (fs.existsSync(keyPath)) {
  admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  const saJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
} else {
  admin.initializeApp(); // fallback: Google Application Default Credentials
}

const db      = admin.firestore();
const DRY_RUN = !process.argv.includes("--apply");

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log(DRY_RUN
    ? "DRY RUN — no changes will be written (pass --apply to commit)"
    : "APPLY MODE — changes WILL be written to Firestore");
  console.log("=".repeat(60));

  // 1. Load master months collection
  const monthsSnap = await db.collection("months").get();
  if (monthsSnap.empty) {
    console.log("No months found in master collection. Exiting.");
    process.exit(0);
  }

  const masterMonths = {};
  monthsSnap.docs.forEach((d) => {
    masterMonths[d.id] = d.data().amount || 0;
  });

  console.log(`\nMaster months loaded: ${Object.keys(masterMonths).length}`);
  Object.entries(masterMonths).forEach(([id, amt]) =>
    console.log(`  ${id}: ${amt} baht`)
  );

  // 2. Scan every student payment subcollection
  const paymentsSnap = await db.collection("payments").get();
  console.log(`\nScanning ${paymentsSnap.docs.length} student payment records...\n`);

  let totalScanned = 0;
  let totalStale   = 0;
  const fixes      = [];

  for (const paymentDoc of paymentsSnap.docs) {
    const nuid       = paymentDoc.id;
    const monthlySnap = await paymentDoc.ref.collection("months").get();

    for (const mDoc of monthlySnap.docs) {
      const monthId = mDoc.id;
      const data    = mDoc.data();
      totalScanned++;

      // Skip months not in master (orphaned test records, different issue)
      if (!(monthId in masterMonths)) {
        console.log(`  SKIP  ${nuid}/${monthId} — not in master months collection`);
        continue;
      }

      const masterAmount = masterMonths[monthId];
      const storedTarget = data.targetAmount ?? data.amount ?? null;

      // Nothing to fix if targetAmount already matches or was never written
      if (storedTarget === null || storedTarget === masterAmount) continue;

      const paidAmount   = data.paidAmount ?? (data.paid ? storedTarget : 0);
      const newTarget    = masterAmount;
      const newRemaining = Math.max(0, newTarget - paidAmount);
      const newPaid      = paidAmount >= newTarget;

      totalStale++;
      fixes.push({ nuid, monthId, storedTarget, masterAmount, paidAmount, newRemaining, newPaid, ref: mDoc.ref });

      console.log(`  FIX   ${nuid} / ${monthId}`);
      console.log(`        targetAmount:  ${storedTarget} -> ${newTarget}`);
      console.log(`        paidAmount:    ${paidAmount} (unchanged)`);
      console.log(`        remaining:     ${Math.max(0, storedTarget - paidAmount)} -> ${newRemaining}`);
      console.log(`        paid:          ${!!data.paid} -> ${newPaid}`);
    }
  }

  console.log("\n" + "-".repeat(60));
  console.log(`Scanned : ${totalScanned} student-month records`);
  console.log(`Stale   : ${totalStale} records need fixing`);

  if (totalStale === 0) {
    console.log("\nAll records are clean — nothing to fix.");
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN complete — no writes performed.");
    console.log("Run with --apply to commit the fixes listed above.");
    process.exit(0);
  }

  // 3. Apply fixes in batches of 400 (Firestore batch limit is 500)
  console.log(`\nApplying ${fixes.length} fix(es)...`);
  const BATCH_SIZE = 400;

  for (let i = 0; i < fixes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = fixes.slice(i, i + BATCH_SIZE);

    chunk.forEach(({ ref, masterAmount, newRemaining, newPaid }) => {
      batch.update(ref, {
        targetAmount:     masterAmount,
        remainingBalance: newRemaining,
        paid:             newPaid,
        // paidAmount intentionally NOT changed — it reflects real money received
      });
    });

    await batch.commit();
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} committed (${chunk.length} records)`);
  }

  console.log("\nAll stale records have been corrected.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nScript failed:", err);
  process.exit(1);
});
