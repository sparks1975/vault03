// TinyPNG compression helper. Server-only.
// Compresses PNG/JPEG/WebP bytes via the Tinify HTTP API.

export async function compressBytes(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const TARGET_IMAGE_BYTES = 220_000;
  const MAX_IMAGE_WIDTH = 640;
  const MAX_IMAGE_HEIGHT = 896;
  const key = process.env.TINYPNG_API_KEY;
  if (!key) return { bytes, contentType };
  // Locally resized card JPEGs that are already below target do not need a
  // remote round-trip. Anything larger gets recompressed and resized.
  if (bytes.byteLength <= TARGET_IMAGE_BYTES) return { bytes, contentType };
  // TinyPNG only supports PNG/JPEG/WebP.
  if (!/^image\/(png|jpe?g|webp)$/i.test(contentType)) {
    return { bytes, contentType };
  }
  try {
    const auth = "Basic " + btoa(`api:${key}`);
    const shrink = await fetch("https://api.tinify.com/shrink", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": contentType },
      body: new Blob([bytes as BlobPart], { type: contentType }),
    });
    if (!shrink.ok) {
      console.error("TinyPNG shrink failed", shrink.status, await shrink.text().catch(() => ""));
      return { bytes, contentType };
    }
    const location = shrink.headers.get("Location");
    if (!location) return { bytes, contentType };
    const resized = await fetch(location, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resize: { method: "fit", width: MAX_IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT } }),
    });
    const out = resized.ok ? resized : await fetch(location, { headers: { Authorization: auth } });
    if (!out.ok) return { bytes, contentType };
    const buf = new Uint8Array(await out.arrayBuffer());
    const outType = out.headers.get("Content-Type") || contentType;
    if (buf.byteLength >= bytes.byteLength) return { bytes, contentType };
    return { bytes: buf, contentType: outType };
  } catch (err) {
    console.error("TinyPNG compression error:", err);
    return { bytes, contentType };
  }
}
