/* ------------------------------------------------------------
   Signs the browser into Firebase Auth with uid == nuid, via
   /api/mint-session after verifying the user's Google ID token
   against the Firestore "users" roster whitelist.

   Every student-facing page that reads or writes payments/{nuid}
   needs request.auth.uid == nuid for firestore.rules checks.
------------------------------------------------------------ */
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "./firebase.js";

const ACTIVITY_KEY = "cpe33_last_activity";
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

export function touchActivity() {
  try {
    localStorage.setItem(ACTIVITY_KEY, Date.now().toString());
  } catch (_) { /* ignore */ }
}

export function checkIsInactive(limitMs = INACTIVITY_LIMIT_MS) {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return false;
    const last = Number(raw);
    if (!Number.isFinite(last) || last <= 0) return false;
    return Date.now() - last > limitMs;
  } catch (_) {
    return false;
  }
}

export function clearActivity() {
  try {
    localStorage.removeItem(ACTIVITY_KEY);
  } catch (_) { /* ignore */ }
}

// Automatically attach activity listeners on user interaction
if (typeof window !== "undefined") {
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, () => touchActivity(), { passive: true });
  });
}

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
  touchActivity();
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
  touchActivity();
  return { name, email };
}

// Use on protected pages (logined/, stats/) that load after login
// already happened. Awaits auth.authStateReady() so page refresh
// or tab switching never triggers a false logout.
export async function ensureSignedInAsNuid(nuid) {
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }

  if (checkIsInactive()) {
    clearActivity();
    await signOut(auth).catch(() => {});
    throw new Error("Session expired due to inactivity");
  }

  touchActivity();

  if (auth.currentUser && auth.currentUser.uid === nuid) {
    return auth.currentUser;
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user && user.uid === nuid) {
        resolve(user);
      } else {
        reject(new Error("User not signed in"));
      }
    });
  });
}


