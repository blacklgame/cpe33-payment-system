/* ------------------------------------------------------------
   Best-effort, zero-infrastructure rate limiter.

   HONEST LIMITATION: this is an in-memory Map, so it only limits
   requests hitting the same warm serverless instance. On Vercel a
   burst of traffic can be spread across several instances (each
   with its own empty Map), and every cold start resets the count
   to zero. It will NOT stop a determined, distributed attacker.

   What it DOES do, for free, with no new services to pay for or
   configure:
   - Stops a single script/browser tab from hammering an endpoint
     in a tight loop (the overwhelmingly common case for this app).
   - Adds real friction to casual abuse (e.g. someone mashing the
     "approve" button, or a broken client retrying in a loop).

   If this app ever needs real protection against a distributed
   attacker, swap this module for Vercel KV / Upstash Redis (a
   proper shared counter) -- the call sites (`rateLimit(key, opts)`)
   won't need to change, only this file's internals.
------------------------------------------------------------ */

const buckets = new Map();

// Periodically forget old buckets so this Map doesn't grow forever
// on a long-lived warm instance. Cheap and approximate is fine here.
const MAX_BUCKETS = 5000;

function rateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    buckets.clear();
  }

  const entry = buckets.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { limited: false };
  }

  entry.count += 1;
  return { limited: entry.count > limit };
}

// Vercel puts the real client IP in x-forwarded-for (first entry in
// the list). Falls back to the socket address for local/dev.
function clientIp(request) {
  const fwd = request.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return request.socket?.remoteAddress || "unknown";
}

module.exports = { rateLimit, clientIp };
