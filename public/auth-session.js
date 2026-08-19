/* ------------------------------------------------------------
   Signs the browser into Firebase Auth with uid == nuid, via
   /api/mint-session after verifying the user's Google ID token
   against the Firestore "users" roster whitelist.

   Every student-facing page that reads or writes payments/{nuid}
   needs request.auth.uid == nuid for firestore.rules checks.
------------------------------------------------------------ */
import {
  onAuthStateChanged,
  signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "./firebase.js";

export async function signInWithGoogleToken(idToken) {
  const res = await fetch("/api/mint-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || "Sign-in failed");
    err.status = res.status;
    throw err;
  }

  const { token, nuid, name, email } = await res.json();
  await signInWithCustomToken(auth, token);
  return { nuid, name, email };
}

// Fallback for legacy calls if any remain
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
// already happened.
export function ensureSignedInAsNuid(nuid) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (user && user.uid === nuid) {
        resolve();
        return;
      }
      reject(new Error("User not signed in"));
    });
  });
}

