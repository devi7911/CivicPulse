import { Construction, Droplets, Lightbulb, Trash2, Trees, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { IssueCategory } from '../lib/types';

export const CATEGORY_ICON: Record<IssueCategory, { icon: LucideIcon; from: string; to: string; fg: string }> = {
  roads: { icon: Construction, from: '#fff4e0', to: '#fde3b4', fg: '#a15c07' },
  water: { icon: Droplets, from: '#e6f3fd', to: '#c6e2f8', fg: '#0b5cad' },
  lighting: { icon: Lightbulb, from: '#fff9db', to: '#fdeea6', fg: '#8a6a00' },
  waste: { icon: Trash2, from: '#e9f7ef', to: '#c9ead7', fg: '#18794e' },
  parks: { icon: Trees, from: '#ecf8e6', to: '#d0eec2', fg: '#2f7a1f' },
  other: { icon: TriangleAlert, from: '#eff2f6', to: '#dde3ec', fg: '#5d6b7e' },
};

// Shown in place of a photo, so every report still gets a calm, recognisable header.
export function CategoryArt({ category, tall = false }: { category: IssueCategory; tall?: boolean }) {
  const { icon: Icon, from, to, fg } = CATEGORY_ICON[category];
  return (
    <div aria-hidden className={`flex items-center justify-center ${tall ? 'h-56' : 'h-44'}`} style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}>
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/85 shadow-sm" style={{ color: fg }}>
        <Icon size={30} strokeWidth={1.9} />
      </span>
    </div>
  );
}
