import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";

interface Props {
  image: string;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
  confirmLabel?: string;
  busy?: boolean;
}

// Standard trading card aspect ratio (2.5 x 3.5 inches).
const CARD_ASPECT = 2.5 / 3.5;
const MAX_CARD_IMAGE_WIDTH = 900;
const MAX_CARD_IMAGE_HEIGHT = 1260;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function getCroppedDataUrl(
  imageSrc: string,
  crop: Area,
  rotation: number,
): Promise<string> {
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
  const rctx = rotCanvas.getContext("2d")!;
  rctx.translate(bBoxW / 2, bBoxH / 2);
  rctx.rotate(rad);
  rctx.drawImage(image, -image.width / 2, -image.height / 2);

  const sourceWidth = Math.max(1, Math.round(crop.width));
  const sourceHeight = Math.max(1, Math.round(crop.height));
  const scale = Math.min(1, MAX_CARD_IMAGE_WIDTH / sourceWidth, MAX_CARD_IMAGE_HEIGHT / sourceHeight);
  const outWidth = Math.max(1, Math.round(sourceWidth * scale));
  const outHeight = Math.max(1, Math.round(sourceHeight * scale));

  const out = document.createElement("canvas");
  out.width = outWidth;
  out.height = outHeight;
  const octx = out.getContext("2d")!;
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
  return out.toDataURL("image/jpeg", 0.82);
}

export function CardCropDialog({ image, onCancel, onConfirm, confirmLabel = "Use photo", busy }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixels(areaPixels);
  }, []);

  async function confirm() {
    if (!pixels) return;
    setWorking(true);
    try {
      const url = await getCroppedDataUrl(image, pixels, rotation);
      onConfirm(url);
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
            <h3 className="font-extrabold text-lg tracking-tight">Crop & rotate</h3>
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
