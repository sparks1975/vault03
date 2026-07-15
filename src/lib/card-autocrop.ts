// Client-side card auto-crop & perspective straighten using OpenCV.js.
// Loads OpenCV.js lazily from a CDN, detects the largest 4-sided contour
// (assumed to be the card), and warps it flat. Falls back to the original
// photo if detection fails.

let cvLoader: Promise<any> | null = null;

const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js",
  "https://docs.opencv.org/4.10.0/opencv.js",
];

function loadOpenCV(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const w = window as any;
  if (w.cv && w.cv.Mat) return Promise.resolve(w.cv);
  if (cvLoader) return cvLoader;

  cvLoader = new Promise((resolve, reject) => {
    const waitForRuntime = () => {
      const cv = w.cv;
      if (!cv) return reject(new Error("cv global missing"));
      if (cv.Mat) return resolve(cv);
      if (typeof cv.then === "function") {
        // Newer builds expose a promise-like Module.
        cv.then((ready: any) => resolve(ready)).catch(reject);
        return;
      }
      cv["onRuntimeInitialized"] = () => resolve(cv);
    };

    const tryLoad = (i: number) => {
      if (i >= CDN_URLS.length) return reject(new Error("Failed to load OpenCV"));
      const s = document.createElement("script");
      s.src = CDN_URLS[i];
      s.async = true;
      s.onload = () => waitForRuntime();
      s.onerror = () => {
        s.remove();
        tryLoad(i + 1);
      };
      document.head.appendChild(s);
    };
    tryLoad(0);
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

function orderCorners(pts: { x: number; y: number }[]) {
  // TL, TR, BR, BL by sum/diff heuristic
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.x - p.y);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.max(...diff))];
  const bl = pts[diff.indexOf(Math.min(...diff))];
  return [tl, tr, br, bl];
}

/**
 * Attempt to auto-crop and straighten a card in a photo.
 * Returns a JPEG data URL. Falls back to the original if detection fails.
 */
export async function autoCropCard(inputDataUrl: string): Promise<string> {
  let cv: any;
  try {
    cv = await loadOpenCV();
  } catch (err) {
    console.warn("[autoCropCard] OpenCV unavailable, using original", err);
    return inputDataUrl;
  }

  const img = await loadImage(inputDataUrl);

  // Downscale for contour detection speed; preserve aspect.
  const MAX = 1200;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w;
  srcCanvas.height = h;
  const sctx = srcCanvas.getContext("2d")!;
  sctx.drawImage(img, 0, 0, w, h);

  const src = cv.imread(srcCanvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edged = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edged, 60, 180);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.dilate(edged, edged, kernel);
    kernel.delete();

    cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let best: { pts: { x: number; y: number }[]; area: number } | null = null;
    const imgArea = w * h;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const peri = cv.arcLength(c, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      if (approx.rows === 4) {
        const area = Math.abs(cv.contourArea(approx));
        if (area > imgArea * 0.15 && (!best || area > best.area)) {
          const pts: { x: number; y: number }[] = [];
          for (let j = 0; j < 4; j++) {
            pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
          }
          best = { pts, area };
        }
      }
      approx.delete();
      c.delete();
    }

    if (!best) {
      console.info("[autoCropCard] no card contour found, using original");
      return inputDataUrl;
    }

    const [tl, tr, br, bl] = orderCorners(best.pts);
    const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const widthBot = Math.hypot(br.x - bl.x, br.y - bl.y);
    const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);
    let outW = Math.round(Math.max(widthTop, widthBot));
    let outH = Math.round(Math.max(heightLeft, heightRight));
    // Normalize to portrait card ratio if it looks landscape (photo taken sideways).
    if (outW > outH) {
      // keep as-is; warp preserves orientation of source quad
    }

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y,
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, outW, 0, outW, outH, 0, outH,
    ]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    const outCanvas = document.createElement("canvas");
    cv.imshow(outCanvas, dst);

    srcTri.delete();
    dstTri.delete();
    M.delete();
    dst.delete();

    return outCanvas.toDataURL("image/jpeg", 0.92);
  } catch (err) {
    console.warn("[autoCropCard] processing failed, using original", err);
    return inputDataUrl;
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edged.delete();
    contours.delete();
    hierarchy.delete();
  }
}
