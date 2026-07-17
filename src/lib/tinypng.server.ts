// TinyPNG compression helper. Server-only.
// Compresses PNG/JPEG/WebP bytes via the Tinify HTTP API.

export async function compressBytes(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const key = process.env.TINYPNG_API_KEY;
  if (!key) return { bytes, contentType };
  // TinyPNG only supports PNG/JPEG/WebP.
  if (!/^image\/(png|jpe?g|webp)$/i.test(contentType)) {
    return { bytes, contentType };
  }
  try {
    const auth = "Basic " + btoa(`api:${key}`);
    const shrink = await fetch("https://api.tinify.com/shrink", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": contentType },
      body: bytes,
    });
    if (!shrink.ok) {
      console.error("TinyPNG shrink failed", shrink.status, await shrink.text().catch(() => ""));
      return { bytes, contentType };
    }
    const location = shrink.headers.get("Location");
    if (!location) return { bytes, contentType };
    const out = await fetch(location, { headers: { Authorization: auth } });
    if (!out.ok) return { bytes, contentType };
    const buf = new Uint8Array(await out.arrayBuffer());
    const outType = out.headers.get("Content-Type") || contentType;
    return { bytes: buf, contentType: outType };
  } catch (err) {
    console.error("TinyPNG compression error:", err);
    return { bytes, contentType };
  }
}
