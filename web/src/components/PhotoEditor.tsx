import { useEffect, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Modal } from './Modal';

type Spot = { x: number; y: number; r: number }; // fractions of the image width/height

// Lets people hide faces and number plates before a photo is shared publicly.
// Pixelation is used instead of CSS blur because it works in every browser and cannot be undone.
export function PhotoEditor({ file, open, onClose, onSave }: { file: Blob | null; open: boolean; onClose: () => void; onSave: (b: Blob) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m');

  useEffect(() => {
    if (!open || !file) return;
    let alive = true;
    setSpots([]);
    createImageBitmap(file).then((b) => { if (alive) setImg(b); });
    return () => { alive = false; };
  }, [open, file]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const s of spots) pixelate(ctx, s.x * c.width, s.y * c.height, s.r * c.width);
  }, [img, spots]);

  function tap(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const radius = { s: 0.05, m: 0.09, l: 0.15 }[size];
    setSpots((cur) => [...cur, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r: radius }]);
  }

  function save() {
    canvas.current?.toBlob((b) => { if (b) onSave(b); }, 'image/jpeg', 0.9);
  }

  return (
    <Modal open={open} title="Hide faces and number plates" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted">Tap each face or number plate to blur it. The blurring cannot be undone after upload.</p>
        <canvas ref={canvas} onPointerDown={tap} className="w-full cursor-crosshair touch-none rounded-lg bg-sand" aria-label="Photo. Tap to blur an area." />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Blur size</span>
          {(['s', 'm', 'l'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={size === k} onClick={() => setSize(k)} className={`chip ${size === k ? 'chip-on' : ''}`}>{{ s: 'Small', m: 'Medium', l: 'Large' }[k]}</button>
          ))}
          <button type="button" className="ml-auto inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-primary disabled:opacity-40"
            disabled={spots.length === 0} onClick={() => setSpots((cur) => cur.slice(0, -1))}><Undo2 size={14} /> Undo</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save}>Use this photo</button>
        </div>
      </div>
    </Modal>
  );
}

function pixelate(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const x = Math.max(0, Math.round(cx - r)), y = Math.max(0, Math.round(cy - r));
  const w = Math.min(ctx.canvas.width - x, Math.round(r * 2)), h = Math.min(ctx.canvas.height - y, Math.round(r * 2));
  if (w <= 0 || h <= 0) return;
  const block = Math.max(6, Math.round(r / 5));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / block));
  small.height = Math.max(1, Math.round(h / block));
  small.getContext('2d')!.drawImage(ctx.canvas, x, y, w, h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
  ctx.restore();
}
