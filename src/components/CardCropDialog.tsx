import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";

interface Props {
  image: string;
  onCancel: () => void;
  // displayDataUrl is a small, storage-optimized crop; identifyDataUrl is a
  // separate, higher-resolution/quality encode of the same crop meant for
  // card identification (small print like card numbers and serials survives
  // better at higher quality than what's worth storing/downloading for display).
  onConfirm: (displayDataUrl: string, identifyDataUrl: string) => void;
  confirmLabel?: string;
  busy?: boolean;
}

// Standard trading card aspect ratio (2.5 x 3.5 inches).
const CARD_ASPECT = 2.5 / 3.5;
const TARGET_CARD_IMAGE_BYTES = 180_000;
const OUTPUT_ATTEMPTS = [
  { width: 640, height: 896, quality: 0.72 },
  { width: 640, height: 896, quality: 0.64 },
  { width: 580, height: 812, quality: 0.64 },
  { width: 520, height: 728, quality: 0.6 },
  { width: 480, height: 672, quality: 0.56 },
];
// Identification only happens once per card (not in a loop like valuation),
// so it's worth spending more bytes on legibility: bigger frame, higher
// quality, no iterative shrink-to-fit — small printed text (card number,
// subset name, serial) is the first casualty of the aggressive display-size
// compression above.
const IDENTIFY_OUTPUT = { width: 1400, height: 1960, quality: 0.88 };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// Brightness/contrast are applied once to the rotated source canvas via a
// 256-entry lookup table, so the exported display and identify encodes share
// exactly the adjustments previewed in the dialog.
function applyAdjustments(canvas: HTMLCanvasElement, brightness: number, contrast: number) {
  if (brightness === 0 && contrast === 0) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const c = (100 + contrast) / 100;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.max(0, Math.min(255, (i - 128) * c + 128 + brightness * 1.28));
  }
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = frame.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]!;
    d[i + 1] = lut[d[i + 1]]!;
    d[i + 2] = lut[d[i + 2]]!;
  }
  ctx.putImageData(frame, 0, 0);
}

async function buildCroppedCanvas(
  imageSrc: string,
  crop: Area,
  rotation: number,
  brightness = 0,
  contrast = 0,
): Promise<{ rotCanvas: HTMLCanvasElement; sourceWidth: number; sourceHeight: number }> {
  const image = await loadImage(imageSrc);
  const rad = (rotation * Math.PI) / 180;

  // Bounding box of the rotated source image.
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const bBoxW = image.width * cos + image.height * sin;
  const bBoxH = image.width * sin + image.height * cos;

  const rotCanvas = document.createElement("canvas");
  rotCanvas.width = bBoxW;
  rotCanvas.height = bBoxH;
  const rctx = rotCanvas.getContext("2d");
  if (!rctx) throw new Error("Couldn't prepare image canvas");
  rctx.translate(bBoxW / 2, bBoxH / 2);
  rctx.rotate(rad);
  rctx.drawImage(image, -image.width / 2, -image.height / 2);
  rctx.setTransform(1, 0, 0, 1, 0, 0);
  applyAdjustments(rotCanvas, brightness, contrast);

  return {
    rotCanvas,
    sourceWidth: Math.max(1, Math.round(crop.width)),
    sourceHeight: Math.max(1, Math.round(crop.height)),
  };
}


function drawCropAtSize(
  rotCanvas: HTMLCanvasElement,
  crop: Area,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const scale = Math.min(1, targetWidth / sourceWidth, targetHeight / sourceHeight);
  const outWidth = Math.max(1, Math.round(sourceWidth * scale));
  const outHeight = Math.max(1, Math.round(sourceHeight * scale));
  const out = document.createElement("canvas");
  out.width = outWidth;
  out.height = outHeight;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("Couldn't prepare image canvas");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(
    rotCanvas,
    Math.round(crop.x),
    Math.round(crop.y),
    sourceWidth,
    sourceHeight,
    0,
    0,
    outWidth,
    outHeight,
  );
  return out;
}

async function getCroppedDataUrl(
  rotCanvas: HTMLCanvasElement,
  crop: Area,
  sourceWidth: number,
  sourceHeight: number,
): Promise<string> {
  let best: { dataUrl: string; bytes: number } | null = null;
  for (const attempt of OUTPUT_ATTEMPTS) {
    const out = drawCropAtSize(rotCanvas, crop, sourceWidth, sourceHeight, attempt.width, attempt.height);
    const dataUrl = await canvasToJpegDataUrl(out, attempt.quality);
    const bytes = dataUrlBytes(dataUrl);
    best = !best || bytes < best.bytes ? { dataUrl, bytes } : best;
    if (bytes <= TARGET_CARD_IMAGE_BYTES) return dataUrl;
  }
  if (!best) throw new Error("Couldn't compress image");
  return best.dataUrl;
}

async function getIdentifyDataUrl(
  rotCanvas: HTMLCanvasElement,
  crop: Area,
  sourceWidth: number,
  sourceHeight: number,
): Promise<string> {
  const out = drawCropAtSize(rotCanvas, crop, sourceWidth, sourceHeight, IDENTIFY_OUTPUT.width, IDENTIFY_OUTPUT.height);
  return canvasToJpegDataUrl(out, IDENTIFY_OUTPUT.quality);
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Couldn't encode image"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Couldn't read compressed image"));
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((base64.length * 3) / 4);
}

export function CardCropDialog({ image, onCancel, onConfirm, confirmLabel = "Use photo", busy }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixels(areaPixels);
  }, []);

  // CSS preview approximation of the same LUT applied on export.
  const previewFilter = `brightness(${1 + brightness / 100}) contrast(${(100 + contrast) / 100})`;

  async function confirm() {
    if (!pixels) return;
    setWorking(true);
    try {
      const { rotCanvas, sourceWidth, sourceHeight } = await buildCroppedCanvas(
        image,
        pixels,
        rotation,
        brightness,
        contrast,
      );
      const [displayUrl, identifyUrl] = await Promise.all([
        getCroppedDataUrl(rotCanvas, pixels, sourceWidth, sourceHeight),
        getIdentifyDataUrl(rotCanvas, pixels, sourceWidth, sourceHeight),
      ]);
      onConfirm(displayUrl, identifyUrl);
    } finally {
      setWorking(false);
    }
  }

  const isBusy = working || busy;

  return (
    <div className="fixed inset-0 bg-background/95 z-[60] flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-background border border-border w-full max-w-3xl max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Adjust photo</p>
            <h3 className="font-extrabold text-lg tracking-tight">Crop, rotate & light</h3>
          </div>
          <button
            onClick={onCancel}
            className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>

        <div className="relative bg-secondary" style={{ height: 420 }}>
          <Cropper
            image={image}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={CARD_ASPECT}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            objectFit="contain"
            restrictPosition={false}
            style={{ mediaStyle: { filter: previewFilter } }}
            showGrid
          />
        </div>

        <div className="px-6 py-4 space-y-4 border-t border-border">
          <ControlRow label="Zoom">
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-accent"
            />
          </ControlRow>
          <ControlRow label="Rotate">
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="flex-1 accent-accent"
            />
            <div className="flex gap-1 ml-2">
              <button
                type="button"
                onClick={() => setRotation((r) => r - 90)}
                className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary"
              >
                -90°
              </button>
              <button
                type="button"
                onClick={() => setRotation((r) => r + 90)}
                className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary"
              >
                +90°
              </button>
              <button
                type="button"
                onClick={() => setRotation(0)}
                className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 hover:bg-secondary"
              >
                Reset
              </button>
            </div>
          </ControlRow>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isBusy}
            className="text-xs font-mono uppercase tracking-widest border border-border px-4 py-2 hover:bg-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={isBusy || !pixels}
            className="text-xs font-mono uppercase tracking-widest bg-foreground text-background px-4 py-2 hover:bg-accent disabled:opacity-50 inline-flex items-center gap-2"
          >
            {isBusy && <Loader2 className="size-3 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground w-16">{label}</span>
      {children}
    </div>
  );
}
