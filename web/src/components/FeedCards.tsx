import { Link } from 'react-router-dom';
import { BadgeCheck, ExternalLink, MessageCircle, Video, X } from 'lucide-react';
import { CardActions } from './CardActions';
import { ISSUE_CATEGORIES, STATUS_CLASS, STATUS_LABEL, isOverdue, safeHttps, timeAgo } from '../lib/constants';
import { photoUrl } from '../lib/supabase';
import { formatDistance } from '../hooks/useLocation';
import type { Issue, SponsoredPost } from '../lib/types';
import { AdMedia } from './AdMedia';
import { Avatar } from './Avatar';
import { CATEGORY_ICON } from './CategoryArt';

// A report is laid out like a social post: who and where, the picture, the actions, then the words.
// React escapes every interpolated value, so user text can never run as HTML.
export function IssueCard({ issue }: { issue: Issue }) {
  const img = photoUrl(issue.photo_path);
  const name = issue.anonymous ? 'Anonymous citizen' : issue.author?.display_name ?? 'Citizen';
  const { icon: CatIcon, from, to, fg } = CATEGORY_ICON[issue.category];
  return (
    <article className={`card group relative grid grid-cols-[minmax(0,1fr)] overflow-hidden transition-shadow hover:shadow-lg ${img ? 'md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-[auto_1fr] lg:grid-cols-[20rem_minmax(0,1fr)]' : ''}`}>
      <div className={`flex items-center gap-3 px-4 py-2.5 ${img ? 'md:col-start-2 md:row-start-1' : ''}`}>
        <Avatar name={name} path={issue.anonymous ? null : issue.author?.avatar_path} size={38} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-bold">
            <span className="truncate">{name}</span>
            {!issue.anonymous && issue.author?.verified && <BadgeCheck size={15} className="shrink-0 fill-primary text-white" aria-label="Verified" />}
          </p>
          <p className="truncate text-xs text-muted">{issue.distance_m != null && <b className="text-primary">{formatDistance(issue.distance_m)} away · </b>}{issue.location_text}</p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={`whitespace-nowrap ${STATUS_CLASS[issue.status]}`}>{STATUS_LABEL[issue.status]}</span>
          {isOverdue(issue) && <span className="pill-overdue">Overdue</span>}
        </span>
      </div>

      {img && (
        // On wide screens the photo fills whatever height the text needs, so a portrait photo cannot stretch the card.
        <div className="relative aspect-[16/10] overflow-hidden bg-sand md:col-start-1 md:row-span-2 md:row-start-1 md:aspect-auto md:min-h-44">
          <img src={img} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        </div>
      )}

      <div className={`flex flex-1 flex-col gap-1.5 px-4 pb-3 ${img ? 'pt-3 md:col-start-2 md:row-start-2 md:border-t md:border-line' : 'border-t border-line pt-3'}`}>
        <div className="flex gap-3">
          {!img && (
            <span aria-hidden className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})`, color: fg }}>
              <CatIcon size={20} strokeWidth={1.9} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-[15px] leading-snug font-bold">
              {/* Stretched link: the whole card opens the report, while the action buttons stay separate. */}
              <Link to={`/issues/${issue.id}`} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-primary">{issue.title}</Link>
            </h3>
            <p className={`mt-1 text-sm leading-relaxed text-muted ${img ? 'line-clamp-2 md:line-clamp-3' : 'line-clamp-3'}`}>{issue.description}</p>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-2 text-sm font-semibold text-ink">
          <CardActions issue={issue} />
          <span className="flex items-center gap-1.5 px-1"><MessageCircle size={18} strokeWidth={1.8} />{issue.comment_count}</span>
          {issue.video_path && <span className="flex items-center gap-1 text-xs text-muted"><Video size={14} /> Video</span>}
          <span className="text-xs font-medium text-muted">{timeAgo(issue.created_at)}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {issue.severity === 'high' && <span className="tag bg-blush text-brick">High priority</span>}
            <span className="tag">{ISSUE_CATEGORIES[issue.category]}</span>
          </span>
        </div>
      </div>
    </article>
  );
}

// Sponsored posts are deliberately small and gold-tinted: visible, but clearly not a citizen report.
export function SponsoredBanner({ post, onDismiss, onClick, className = '' }: { post: SponsoredPost; onDismiss: (id: string) => void; onClick?: () => void; className?: string }) {
  const donate = safeHttps(post.ngo?.donate_url);
  if (!post.ngo || !donate) return null;
  return (
    // Phones: media, text and close on one row, Donate full width underneath. From sm: one row.
    <article className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-gold-line bg-gold-soft px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] ${className}`}>
      <AdMedia post={post} className="h-14 w-20 shrink-0 rounded-lg sm:h-[4.5rem] sm:w-28" />
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-gold">
          <span className="shrink-0 rounded bg-gold px-1.5 py-px text-[10px] tracking-wide whitespace-nowrap text-white uppercase">Sponsored ad</span>
          <span className="truncate">{post.ngo.name}</span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug font-semibold sm:line-clamp-1">{post.title}</p>
        <p className="hidden truncate text-[11px] text-muted sm:block">
          {(post.cta_label ?? 'Donate') === 'Donate'
            ? `Donations go directly to ${post.ngo.name} on ${new URL(donate).hostname}. CivicPulse never handles your money.`
            : `Opens ${new URL(donate).hostname}. CivicPulse does not sell or endorse this.`}
        </p>
      </div>
      <a href={donate} target="_blank" rel="noopener noreferrer sponsored" onClick={onClick}
        className="col-span-3 row-start-2 inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-gold px-4 text-xs font-bold text-white transition hover:brightness-110 sm:col-span-1 sm:col-start-3 sm:row-start-1">
        {post.cta_label ?? 'Donate'} <ExternalLink size={13} />
      </a>
      <button type="button" onClick={() => onDismiss(post.id)} aria-label={`Close sponsored post from ${post.ngo.name}`}
        className="col-start-3 row-start-1 -mr-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-gold transition hover:bg-gold/15 sm:col-start-4">
        <X size={17} strokeWidth={2.4} />
      </button>
    </article>
  );
}
