/* ------------------------------------------------------------
   Signs the browser into Firebase Auth with uid == nuid, via
   /api/mint-session (see that file for what this does and doesn't
   guarantee). Every student-facing page that reads or writes
   payments/{nuid} needs to call this first, since firestore.rules
   now requires request.auth.uid == nuid to read that doc.
------------------------------------------------------------ */
import {
  onAuthStateChanged,
  signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "./firebase.js";

export async function signInAsNuid(nuid) {
  const res = await fetch("/api/mint-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nuid })
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Sign-in failed");
  }

  const { token, name, email } = await res.json();
  await signInWithCustomToken(auth, token);
  return { name, email };
}

// Use on protected pages (logined/, stats/) that load after login
// already happened. Avoids re-minting a session on every page load
// if the existing Firebase Auth session already matches this nuid.
export function ensureSignedInAsNuid(nuid) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (user && user.uid === nuid) {
        resolve();
        return;
      }
      try {
        await signInAsNuid(nuid);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}
