import { photoUrl } from '../lib/supabase';

const TONES = ['#0b5cad', '#18794e', '#8a3ffc', '#a15c07', '#0e7490', '#b4236c'];

// Profile pictures are a verified-only feature, so most people are shown as a coloured initial.
export function Avatar({ name, path, size = 36, ring = false }: { name: string; path?: string | null; size?: number; ring?: boolean }) {
  const url = photoUrl(path);
  const tone = TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length];
  const style = { width: size, height: size, fontSize: size * 0.42 };
  const cls = `shrink-0 rounded-full object-cover ${ring ? 'ring-2 ring-white/80' : ''}`;
  if (url) return <img src={url} alt="" className={cls} style={style} />;
  return (
    <span aria-hidden className={`${cls} flex items-center justify-center font-bold text-white`} style={{ ...style, backgroundColor: tone }}>
      {name.trim().charAt(0).toUpperCase() || 'C'}
    </span>
  );
}
