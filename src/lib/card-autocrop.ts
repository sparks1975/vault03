// Client-side card auto-crop & perspective straighten.
// Loads OpenCV.js lazily from CDN, then uses jscanify to detect the largest
// quadrilateral (the card) and warp it flat.

let cvLoader: Promise<any> | null = null;

function loadOpenCV(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const w = window as any;
  if (w.cv && w.cv.Mat) return Promise.resolve(w.cv);
  if (cvLoader) return cvLoader;
  cvLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-opencv]");
    const attach = () => {
      const check = () => {
        if (w.cv && w.cv.Mat) return resolve(w.cv);
        if (w.cv && typeof w.cv["onRuntimeInitialized"] !== "undefined") {
          w.cv["onRuntimeInitialized"] = () => resolve(w.cv);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    };
    if (existing) {
      attach();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://docs.opencv.org/4.10.0/opencv.js";
    s.async = true;
    s.dataset.opencv = "1";
    s.onload = attach;
    s.onerror = () => reject(new Error("Failed to load OpenCV"));
    document.head.appendChild(s);
  });
  return cvLoader;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = dataUrl;
  });
}

/**
 * Attempt to auto-crop and straighten a card in a photo.
 * Returns a JPEG data URL. Falls back to the original if detection fails.
 */
export async function autoCropCard(inputDataUrl: string): Promise<string> {
  try {
    await loadOpenCV();
    const { default: jscanify } = await import("jscanify");
    const img = await loadImage(inputDataUrl);

    const scanner = new (jscanify as any)();

    // Standard trading card ratio 2.5 x 3.5 inches → use 750 x 1050.
    // jscanify decides orientation from the detected contour; give it a
    // portrait target and it warps accordingly.
    const OUT_W = 750;
    const OUT_H = 1050;

    // extractPaper accepts an HTMLImageElement or canvas.
    const canvas: HTMLCanvasElement = scanner.extractPaper(img, OUT_W, OUT_H);
    if (!canvas) return inputDataUrl;
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (err) {
    console.warn("[autoCropCard] falling back to original", err);
    return inputDataUrl;
  }
}
