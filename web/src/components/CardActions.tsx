import { createContext, useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowBigUp, Bell, BellRing, Share2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import type { Issue } from '../lib/types';
import { useT } from '../lib/i18n';

// Which reports on screen the person backs or follows, loaded in one query for the whole feed.
interface FeedActions {
  backed: Set<string>;
  followed: Set<string>;
  canInteract: boolean;
  toggleBack: (id: string) => void;
  toggleFollow: (id: string) => void;
  busy: boolean;
}
const Ctx = createContext<FeedActions | null>(null);

export function FeedActionsProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  const { userId, isGuest } = useAuth();
  const qc = useQueryClient();
  const canInteract = Boolean(userId) && !isGuest;
  const key = ['my-marks', userId, ids.join(',')];

  const marks = useQuery({
    queryKey: key,
    enabled: canInteract && ids.length > 0,
    queryFn: async () => {
      const [u, f] = await Promise.all([
        supabase.from('issue_upvotes').select('issue_id').eq('user_id', userId!).in('issue_id', ids),
        supabase.from('issue_follows').select('issue_id').eq('user_id', userId!).in('issue_id', ids),
      ]);
      if (u.error) throw new Error(u.error.message);
      if (f.error) throw new Error(f.error.message);
      return { backed: new Set(u.data.map((r) => r.issue_id as string)), followed: new Set(f.data.map((r) => r.issue_id as string)) };
    },
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['my-marks'] }); qc.invalidateQueries({ queryKey: ['issues'] }); qc.invalidateQueries({ queryKey: ['following'] }); };

  const back = useMutation({
    mutationFn: async (id: string) => {
      const on = marks.data?.backed.has(id);
      const res = on
        ? await supabase.from('issue_upvotes').delete().eq('issue_id', id).eq('user_id', userId!)
        : await supabase.from('issue_upvotes').insert({ issue_id: id, user_id: userId! });
      if (res.error) throw new Error(res.error.message);
      // Backing also follows, so the person hears when it changes.
      if (!on && !marks.data?.followed.has(id)) await supabase.from('issue_follows').insert({ issue_id: id, user_id: userId! });
    },
    onSettled: refresh,
  });
  const follow = useMutation({
    mutationFn: async (id: string) => {
      const res = marks.data?.followed.has(id)
        ? await supabase.from('issue_follows').delete().eq('issue_id', id).eq('user_id', userId!)
        : await supabase.from('issue_follows').insert({ issue_id: id, user_id: userId! });
      if (res.error) throw new Error(res.error.message);
    },
    onSettled: refresh,
  });

  return (
    <Ctx.Provider value={{
      backed: marks.data?.backed ?? new Set(), followed: marks.data?.followed ?? new Set(), canInteract,
      toggleBack: (id) => back.mutate(id), toggleFollow: (id) => follow.mutate(id), busy: back.isPending || follow.isPending,
    }}>{children}</Ctx.Provider>
  );
}

// Sharing: the phone's share sheet where available, otherwise WhatsApp.
export async function shareIssue(issue: Pick<Issue, 'id' | 'title' | 'location_text' | 'ref_no'>) {
  const url = `${window.location.origin}/issues/${issue.id}`;
  const text = `${issue.title} (${issue.location_text}). Back this report on CivicPulse, ref ${issue.ref_no}:`;
  try {
    if (navigator.share) { await navigator.share({ title: issue.title, text, url }); return; }
  } catch (e) { if ((e as Error).name === 'AbortError') return; }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener,noreferrer');
}

const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

// Buttons sit above the card's stretched link (relative z-10), so they never open the report.
export function CardActions({ issue, size = 'md' }: { issue: Issue; size?: 'sm' | 'md' }) {
  const ctx = useContext(Ctx);
  const navigate = useNavigate();
  const { t } = useT();
  const small = size === 'sm';
  const backed = ctx?.backed.has(issue.id) ?? false;
  const followed = ctx?.followed.has(issue.id) ?? false;
  const btn = `relative z-10 inline-flex items-center gap-1 rounded-full transition ${small ? 'min-h-8 px-1.5 text-[11px]' : 'min-h-9 px-2 text-sm'} font-semibold`;

  function needAccount(e: React.MouseEvent) { stop(e); navigate('/auth', { state: { from: `/issues/${issue.id}` } }); }

  // Outside a feed (e.g. Profile) the count is shown as plain text; backing happens on the report page.
  if (!ctx) {
    return (
      <>
        <span className={`inline-flex items-center gap-1 ${small ? 'text-[11px]' : 'px-1 text-sm'} font-semibold text-ink`}><ArrowBigUp size={small ? 15 : 20} strokeWidth={1.8} />{issue.upvote_count}</span>
        <button type="button" aria-label="Share this report" onClick={(e) => { stop(e); void shareIssue(issue); }} className={`${btn} text-muted hover:bg-sand hover:text-ink`}>
          <Share2 size={small ? 14 : 17} />{!small && <span className="hidden sm:inline">Share</span>}
        </button>
      </>
    );
  }

  return (
    <>
      <button type="button" aria-pressed={backed} aria-label={backed ? `You back this report. ${issue.upvote_count} backers` : `Back this report. ${issue.upvote_count} backers`}
        disabled={ctx?.busy} onClick={(e) => { if (!ctx?.canInteract) return needAccount(e); stop(e); ctx.toggleBack(issue.id); }}
        className={`${btn} ${backed ? 'bg-primary text-white' : 'text-ink hover:bg-primary-soft hover:text-primary'}`}>
        <ArrowBigUp size={small ? 16 : 20} strokeWidth={backed ? 2.4 : 1.8} className={backed ? 'fill-white' : ''} />{issue.upvote_count}
      </button>
      {!small && (
        <button type="button" aria-pressed={followed} aria-label={followed ? 'Stop following' : 'Follow for updates'} disabled={ctx?.busy}
          onClick={(e) => { if (!ctx?.canInteract) return needAccount(e); stop(e); ctx.toggleFollow(issue.id); }}
          className={`${btn} ${followed ? 'text-primary' : 'text-muted hover:bg-sand hover:text-ink'}`}>
          {followed ? <BellRing size={17} /> : <Bell size={17} />}<span className="hidden sm:inline">{followed ? t('card.following') : t('card.follow')}</span>
        </button>
      )}
      <button type="button" aria-label="Share this report" onClick={(e) => { stop(e); void shareIssue(issue); }}
        className={`${btn} text-muted hover:bg-sand hover:text-ink`}>
        <Share2 size={small ? 14 : 17} />{!small && <span className="hidden sm:inline">{t('card.share')}</span>}
      </button>
    </>
  );
}
