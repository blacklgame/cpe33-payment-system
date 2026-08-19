/* ------------------------------------------------------------
   Best-effort, zero-infrastructure rate limiter.

   HONEST LIMITATION: this is an in-memory Map, so it limits
   requests hitting the same warm serverless instance. On Vercel a
   burst of traffic can be spread across several instances (each
   with its own empty Map), and every cold start resets the count
   to zero.

   UPGRADABILITY: For distributed shared state across cold starts,
   swap this module for Vercel KV / Upstash Redis (shared counter).

   VERCEL XFF BEHAVIOR: Verified that Vercel sets the true client IP
   as the first IP in the `x-forwarded-for` header list.
------------------------------------------------------------ */

const buckets = new Map();
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
// the list). Verified behavior on Vercel Edge/Serverless.
function clientIp(request) {
  const fwd = request.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return request.socket?.remoteAddress || "unknown";
}

// Helper for building composite keys (e.g. prefix + IP + user identifier)
function compositeKey(prefix, request, extraIdentifier = "") {
  const ip = clientIp(request);
  return extraIdentifier ? `${prefix}:${ip}:${extraIdentifier}` : `${prefix}:${ip}`;
}

module.exports = { rateLimit, clientIp, compositeKey };

