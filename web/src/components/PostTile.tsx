import { Link } from 'react-router-dom';
import { Ban, CircleCheck, CircleDashed, ExternalLink, MessageCircle, Play, TriangleAlert, Wrench, X, type LucideIcon } from 'lucide-react';
import { CardActions } from './CardActions';
import { STATUS_CLASS, STATUS_LABEL, isOverdue, safeHttps } from '../lib/constants';
import { photoUrl } from '../lib/supabase';
import { formatDistance } from '../hooks/useLocation';
import type { Issue, IssueStatus, SponsoredPost } from '../lib/types';
import { AdMedia } from './AdMedia';
import { CATEGORY_ICON } from './CategoryArt';

// Each status has its own icon as well as its own colour, so it never depends on colour alone.
const STATUS_ICON: Record<IssueStatus, LucideIcon> = { pending: CircleDashed, progress: Wrench, resolved: CircleCheck, closed: Ban };
const STATUS_EDGE: Record<IssueStatus, string> = { pending: 'border-t-[#b45309]', progress: 'border-t-primary', resolved: 'border-t-leaf', closed: 'border-t-[#475467]' };

// A post is "featured" (drawn as a 2x2 block) when it has a photo and was triaged as high priority.
export function isFeatured(issue: Issue): boolean {
  return Boolean(issue.photo_path) && issue.severity === 'high';
}

// Grid tile: a clean photo on top and a solid caption bar underneath. Nothing is printed over the
// photo, because labels on top of a busy picture are hard to read.
export function IssueTile({ issue, featured = false }: { issue: Issue; featured?: boolean }) {
  const img = photoUrl(issue.photo_path);
  const { icon: CatIcon, from, to, fg } = CATEGORY_ICON[issue.category];
  const StatusIcon = STATUS_ICON[issue.status];
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-hard-sm transition-shadow hover:shadow-lg ${featured ? 'col-span-2 row-span-2' : ''}`}
    >
      {/* Featured tiles span two rows, so their photo stretches to fill; normal tiles stay square. */}
      <div className={`relative overflow-hidden bg-sand ${featured ? 'min-h-0 flex-1' : 'aspect-square'}`}>
        {img ? (
          <img src={img} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center" style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})`, color: fg }}>
            <CatIcon size={featured ? 72 : 44} strokeWidth={1.6} />
          </span>
        )}
        {issue.video_path && (
          <span className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-white" aria-label="Has a video"><Play size={15} className="fill-white" /></span>
        )}
      </div>

      <div className={`border-t-[3px] ${STATUS_EDGE[issue.status]} px-2.5 pt-2 pb-2.5 sm:px-3`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={STATUS_CLASS[issue.status]}><StatusIcon size={12} strokeWidth={2.6} />{STATUS_LABEL[issue.status]}</span>
          {isOverdue(issue) && <span className="pill-overdue">Overdue</span>}
          {issue.reopen_count > 0 && issue.status !== 'resolved' && <span className="pill-overdue">Disputed fix</span>}
          {issue.severity === 'high' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blush px-2 py-[.22rem] text-[.7rem] font-bold text-brick"><TriangleAlert size={11} strokeWidth={2.6} />High priority</span>
          )}
        </div>
        <p className={`mt-1.5 line-clamp-2 leading-snug font-bold ${featured ? 'text-base sm:text-lg' : 'min-h-[2.2rem] text-[13px]'}`}>
          <Link to={`/issues/${issue.id}`} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-primary">{issue.title}</Link>
        </p>
        <p className="mt-1 truncate text-[11px] font-medium text-muted">{issue.distance_m != null && <b className="text-primary">{formatDistance(issue.distance_m)} · </b>}{issue.location_text}</p>
        <div className="-mx-1.5 mt-1 flex items-center gap-1">
          <CardActions issue={issue} size="sm" />
          <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-ink"><MessageCircle size={13} />{issue.comment_count}</span>
        </div>
      </div>
    </article>
  );
}

// Sponsored tile for the grid: always a single 1x1 cell (never featured) and gold instead of blue,
// so it sits in the grid like any other tile but cannot be mistaken for a citizen report.
export function SponsoredTile({ post, onDismiss, onClick }: { post: SponsoredPost; onDismiss: (id: string) => void; onClick?: () => void }) {
  const donate = safeHttps(post.ngo?.donate_url);
  if (!post.ngo || !donate) return null;
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-xl border border-gold-line bg-gold-soft shadow-hard-sm">
      <button type="button" onClick={() => onDismiss(post.id)} aria-label={`Close sponsored post from ${post.ngo.name}`}
        className="absolute top-1.5 right-1.5 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white text-ink shadow-md transition hover:bg-gold-soft">
        <X size={17} strokeWidth={2.4} />
      </button>
      {/* 16:9 keeps the ad small; flex-1 lets it fill the cell when its row is taller. */}
      <div className="relative aspect-[16/9] flex-1 overflow-hidden bg-gold/10">
        <AdMedia post={post} className="absolute inset-0 h-full w-full" />
      </div>
      <div className="border-t-[3px] border-t-gold px-2.5 pt-2 pb-2.5 sm:px-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center rounded-full bg-gold px-2 py-[.22rem] text-[.7rem] font-bold text-white">Sponsored ad</span>
          <span className="min-w-0 truncate text-[11px] font-semibold text-gold">{post.ngo.name}</span>
        </div>
        <p className="mt-1.5 line-clamp-2 min-h-[2.2rem] text-[13px] leading-snug font-bold text-ink">{post.title}</p>
        <a href={donate} target="_blank" rel="noopener noreferrer sponsored" onClick={onClick}
          className="mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-gold text-xs font-bold text-white transition hover:brightness-110">
          {post.cta_label ?? 'Donate'} <ExternalLink size={13} />
        </a>
        <p className="mt-1 truncate text-center text-[10px] text-muted">Opens {new URL(donate).hostname}</p>
      </div>
    </article>
  );
}
