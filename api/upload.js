/* ------------------------------------------------------------
   Simple, direct-to-server upload for payment slip images.

   The browser sends the raw image bytes straight to this
   function (POST /api/upload?filename=...), and this function
   forwards them to Vercel Blob with put().

   Trade-off vs. the client-token pattern: this is simpler, but
   the file passes through this function, so it's capped at
   Vercel's serverless function body limit (~4.5MB). Fine for
   compressed/screenshot slips; a full-res phone camera photo can
   exceed it. See the size check in public/logined/index.js.

   Requires the BLOB_READ_WRITE_TOKEN env var, which Vercel sets
   automatically once you create a Blob store and link it to this
   project (Storage tab in the dashboard).
------------------------------------------------------------ */
const { put } = require("@vercel/blob");

// Turn off Vercel's automatic body parsing so we get the raw image
// bytes untouched, regardless of content-type -- otherwise a
// non-JSON/text/form body isn't guaranteed to come through cleanly.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 4 * 1024 * 1024; // stay safely under the ~4.5MB function limit

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const filename = request.query.filename;
  if (!filename || typeof filename !== "string") {
    response.status(400).json({ error: "Missing filename query param" });
    return;
  }
  // Only allow uploads under slips/ -- mirrors the old storage.rules restriction.
  if (!filename.startsWith("slips/")) {
    response.status(400).json({ error: "Uploads are only allowed under slips/" });
    return;
  }

  const contentType = request.headers["content-type"] || "";
  if (!ALLOWED_TYPES.includes(contentType)) {
    response.status(400).json({ error: "Only image uploads are allowed" });
    return;
  }

  try {
    const fileBuffer = await readRawBody(request);

    if (fileBuffer.length > MAX_BYTES) {
      response.status(413).json({ error: "File too large (max 4MB)" });
      return;
    }

    const blob = await put(filename, fileBuffer, {
      access: "public",
      addRandomSuffix: false, // filename already includes a timestamp
      contentType,
    });

    response.status(200).json(blob);
  } catch (error) {
    console.error("Blob upload failed:", error);
    response.status(500).json({ error: error.message });
  }
};
