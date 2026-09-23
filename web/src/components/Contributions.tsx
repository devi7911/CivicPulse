import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BadgeCheck, Camera, Grid3x3, HandHeart, Hand, Leaf, PartyPopper, Rows3, ShieldCheck, Sparkles, Trash2, Wrench } from 'lucide-react';
import { FlagButton, HideToggle } from './Moderation';
import { Avatar } from './Avatar';
import { useAuth } from '../hooks/useAuth';
import { isOrg, type AccountType } from '../lib/accounts';
import { OrgChip } from './OrgChip';
import { timeAgo } from '../lib/constants';
import { photoUrl, supabase, uploadPhoto } from '../lib/supabase';
import { creditsFor } from '../lib/sampleCredits';
import { friendlyError } from '../lib/friendlyError';

type Kind = 'achievement' | 'drive' | 'volunteering' | 'donation' | 'fixed' | 'other';
const KINDS: Record<Kind, { label: string; icon: typeof Award }> = {
  drive: { label: 'Clean-up or drive', icon: Leaf },
  volunteering: { label: 'Volunteering', icon: HandHeart },
  fixed: { label: 'Got something fixed', icon: Wrench },
  donation: { label: 'Donation drive', icon: PartyPopper },
  achievement: { label: 'Achievement', icon: Award },
  other: { label: 'Other', icon: Sparkles },
};

interface Contribution {
  id: string; author_id: string; kind: Kind; title: string; body: string; photo_path: string | null;
  applause_count: number; hidden: boolean; created_at: string;
  author: { display_name: string; verified: boolean; avatar_path: string | null; account_type: AccountType; org_name: string | null; points: number } | null;
}

// Community contribution tab: what verified people and organisations did for the city.
const VIEW_KEY = 'contributions-view';
type ContribView = 'grid' | 'list';

export function ContributionsFeed() {
  const { userId, isGuest, isAdmin, profile } = useAuth();
  const qc = useQueryClient();
  const canApplaud = Boolean(userId) && !isGuest;
  const [view, setView] = useState<ContribView>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  function setViewPersist(v: ContribView) { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } }

  const list = useQuery({
    queryKey: ['contributions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contributions')
        .select('id, author_id, kind, title, body, photo_path, applause_count, hidden, created_at, author:profiles!contributions_author_id_fkey(display_name, verified, avatar_path, account_type, org_name, points)')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return data as unknown as Contribution[];
    },
  });
  const mine = useQuery({
    queryKey: ['my-applause', userId],
    enabled: canApplaud,
    queryFn: async () => {
      const { data, error } = await supabase.from('contribution_applause').select('contribution_id').eq('user_id', userId!);
      if (error) throw new Error(error.message);
      return new Set(data.map((r) => r.contribution_id as string));
    },
  });

  const applaud = useMutation({
    mutationFn: async (id: string) => {
      const res = mine.data?.has(id)
        ? await supabase.from('contribution_applause').delete().eq('contribution_id', id).eq('user_id', userId!)
        : await supabase.from('contribution_applause').insert({ contribution_id: id, user_id: userId! });
      if (res.error) throw new Error(res.error.message);
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['contributions'] }); qc.invalidateQueries({ queryKey: ['my-applause'] }); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('contributions').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contributions'] }),
  });

  const items = list.data ?? [];
  const cardProps = { canApplaud, userId, isAdmin, applauded: mine.data, onApplaud: (id: string) => applaud.mutate(id), applaudPending: applaud.isPending, onDelete: (id: string) => remove.mutate(id) };

  return (
    <div className="space-y-4">
      <Composer />
      {list.isLoading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
      {list.data?.length === 0 && (
        <div className="card px-6 py-10 text-center">
          <p className="text-lg font-bold">No contributions shared yet</p>
          <p className="mt-1 text-sm text-muted">Clean-ups, volunteering and fixes by verified residents and organisations appear here.</p>
        </div>
      )}
      {items.length > 0 && (
        <div className="flex justify-end">
          <div role="group" aria-label="Choose layout" className="flex rounded-lg border border-line bg-card p-0.5">
            {([['grid', 'Grid', Grid3x3], ['list', 'List', Rows3]] as const).map(([mode, label, Icon]) => (
              <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setViewPersist(mode)}
                className={`flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === mode ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {view === 'grid' ? (
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2.5 md:grid-cols-3 2xl:grid-cols-4">
          {items.map((c) => <ContributionTile key={c.id} c={c} {...cardProps} />)}
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((c) => <ContributionCard key={c.id} c={c} {...cardProps} />)}
        </ul>
      )}
      {!profile?.verified && (
        <p className="text-center text-xs text-muted">Only verified residents and organisations can share here, with limits, so this stays about the community rather than self-promotion.</p>
      )}
    </div>
  );
}

interface CardProps {
  c: Contribution; canApplaud: boolean; userId: string | null; isAdmin: boolean;
  applauded: Set<string> | undefined; onApplaud: (id: string) => void; applaudPending: boolean; onDelete: (id: string) => void;
}

// Mirrors IssueCard's layout (avatar row on top, photo as a side panel on desktop / full-width
// banner on mobile, content below) so the two feed tabs read as one consistent design language.
function ContributionCard({ c, canApplaud, userId, isAdmin, applauded, onApplaud, applaudPending, onDelete }: CardProps) {
  const K = KINDS[c.kind];
  const a = c.author;
  const name = a && isOrg(a.account_type) && a.org_name ? a.org_name : a?.display_name ?? 'Member';
  const img = photoUrl(c.photo_path);
  const applaudedByMe = applauded?.has(c.id);
  return (
    <li className={`card group relative grid grid-cols-[minmax(0,1fr)] overflow-hidden transition-shadow hover:shadow-lg ${img ? 'md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-[auto_1fr] lg:grid-cols-[20rem_minmax(0,1fr)]' : ''}`}>
      <div className={`flex items-center gap-3 px-4 py-2.5 ${img ? 'md:col-start-2 md:row-start-1' : ''}`}>
        <Avatar name={name} path={a?.avatar_path} size={38} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-1 text-sm font-bold">
            <span className="truncate">{name}</span>
            {a?.verified && <BadgeCheck size={15} className="shrink-0 fill-primary text-white" aria-label="Verified" />}
            <OrgChip type={a?.account_type} verified={a?.verified} />
          </p>
          <p className="truncate text-xs text-muted">
            {a && isOrg(a.account_type) ? `Posted by ${a.display_name} · ` : ''}{K.label}
          </p>
        </div>
        {c.hidden && <span className="pill-overdue shrink-0">Hidden</span>}
      </div>

      {img && (
        <div className="relative aspect-[16/10] overflow-hidden bg-sand md:col-start-1 md:row-span-2 md:row-start-1 md:aspect-auto md:min-h-44">
          <img src={img} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        </div>
      )}

      <div className={`flex flex-1 flex-col gap-1.5 px-4 pb-3 ${img ? 'pt-3 md:col-start-2 md:row-start-2 md:border-t md:border-line' : 'border-t border-line pt-3'}`}>
        <div className="flex gap-3">
          {!img && (
            <span aria-hidden className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><K.icon size={20} strokeWidth={1.9} /></span>
          )}
          <div className="min-w-0">
            <h3 className="text-[15px] leading-snug font-bold">{c.title}</h3>
            <p className={`mt-1 text-sm leading-relaxed text-muted whitespace-pre-wrap ${img ? 'line-clamp-2 md:line-clamp-3' : 'line-clamp-3'}`}>{c.body}</p>
          </div>
        </div>
        {creditsFor(c.photo_path).map((cr) => (
          <p key={cr.source} className="text-[10px] text-muted">
            Photo: <a href={cr.source} target="_blank" rel="noopener noreferrer" className="underline">{cr.author}</a>, <a href={cr.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{cr.license}</a>, via Wikimedia Commons.
          </p>
        ))}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-2 text-sm font-semibold text-ink">
          <button type="button" disabled={!canApplaud || c.author_id === userId || applaudPending} aria-pressed={Boolean(applaudedByMe)}
            onClick={() => onApplaud(c.id)} title={!canApplaud ? 'Sign in to applaud' : c.author_id === userId ? 'You cannot applaud your own post' : undefined}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition ${applaudedByMe ? 'bg-primary text-white' : 'text-ink hover:bg-primary-soft'} disabled:opacity-60`}>
            <Hand size={16} /> {applaudedByMe ? 'Applauded' : 'Applaud'} · {c.applause_count}
          </button>
          {canApplaud && c.author_id !== userId && <FlagButton type="contribution" id={c.id} userId={userId!} compact />}
          {isAdmin && <HideToggle type="contribution" id={c.id} hidden={c.hidden} />}
          {(c.author_id === userId || isAdmin) && (
            <button type="button" className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] font-semibold text-muted hover:text-brick"
              onClick={() => { if (confirm('Delete this post?')) onDelete(c.id); }}><Trash2 size={12} /> Delete</button>
          )}
          <span className="text-xs font-medium text-muted">{timeAgo(c.created_at)}</span>
          <span className="ml-auto"><span className="tag">{K.label}</span></span>
        </div>
      </div>
    </li>
  );
}

// Grid tile: photo-first, condensed caption. There is no contribution detail page, so unlike
// report tiles this is not a link — the applaud button is the only interactive element.
function ContributionTile({ c, canApplaud, userId, applauded, onApplaud, applaudPending }: CardProps) {
  const K = KINDS[c.kind];
  const a = c.author;
  const img = photoUrl(c.photo_path);
  const applaudedByMe = applauded?.has(c.id);
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-hard-sm">
      <div className="relative aspect-square overflow-hidden bg-sand">
        {img ? (
          <img src={img} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center bg-primary-soft text-primary"><K.icon size={40} strokeWidth={1.6} /></span>
        )}
        {c.hidden && <span className="pill-overdue absolute top-1.5 left-1.5">Hidden</span>}
      </div>
      <div className="px-2.5 pt-2 pb-2.5 sm:px-3">
        <p className="flex items-center gap-1 text-[11px] font-semibold text-muted"><K.icon size={12} /> {K.label}</p>
        <p className="mt-1 line-clamp-2 min-h-[2.2rem] text-[13px] leading-snug font-bold">{c.title}</p>
        <p className="mt-1 truncate text-[11px] text-muted">{a && isOrg(a.account_type) && a.org_name ? a.org_name : a?.display_name ?? 'Member'}</p>
        <button type="button" disabled={!canApplaud || c.author_id === userId || applaudPending} aria-pressed={Boolean(applaudedByMe)}
          onClick={() => onApplaud(c.id)} title={!canApplaud ? 'Sign in to applaud' : c.author_id === userId ? 'You cannot applaud your own post' : undefined}
          className={`mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition ${applaudedByMe ? 'bg-primary text-white' : 'bg-sand text-ink hover:bg-primary-soft'} disabled:opacity-60`}>
          <Hand size={13} /> {c.applause_count}
        </button>
      </div>
    </article>
  );
}

function Composer() {
  const { userId, isGuest, profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('drive');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const org = isOrg(profile?.account_type);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const post = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Please add a photo of the work. Posts with a photo are easier to trust.');
      const path = await uploadPhoto(userId!, file);
      const { error } = await supabase.from('contributions').insert({ author_id: userId!, kind, title: title.trim(), body: body.trim(), photo_path: path });
      if (error) {
        await supabase.storage.from('photos').remove([path]);
        throw new Error(error.message.includes('row-level') ? 'Only verified accounts can share contributions.' : error.message);
      }
    },
    onSuccess: () => { setOpen(false); setTitle(''); setBody(''); setFile(null); setMsg({ ok: true, text: 'Shared with the community.' }); qc.invalidateQueries({ queryKey: ['contributions'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  if (!userId || isGuest) {
    return (
      <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <HandHeart size={20} className="text-primary" />
        <p className="min-w-0 flex-1">Did something for your neighbourhood? Verified residents and organisations can share it here.</p>
        <Link to="/auth" state={{ from: '/' }} className="btn btn-primary min-h-9 px-4 text-xs">Sign in</Link>
      </div>
    );
  }
  if (!profile?.verified) {
    return (
      <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <ShieldCheck size={20} className="text-primary" />
        <p className="min-w-0 flex-1">Get verified to share your contributions. It takes one document and helps keep this space genuine.</p>
        <Link to="/profile" className="btn btn-primary min-h-9 px-4 text-xs">Get verified</Link>
      </div>
    );
  }

  function submit(e: FormEvent) { e.preventDefault(); setMsg(null); post.mutate(); }

  return (
    <div className="card p-4">
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMsg(null); }} className="flex w-full items-center gap-3 text-start text-sm text-muted">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary"><HandHeart size={18} /></span>
          Share what {org ? 'your organisation' : 'you'} did for the city…
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type of contribution">
            {(Object.keys(KINDS) as Kind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`chip ${kind === k ? 'chip-on' : ''}`}>{KINDS[k].label}</button>
            ))}
          </div>
          {kind === 'achievement' && <p className="text-[11px] text-muted">Achievements need at least 50 points earned in CivicPulse, so they reflect real work.</p>}
          <input className="input" required minLength={5} maxLength={100} placeholder="Headline, e.g. 40 volunteers cleaned Durgam Cheruvu" aria-label="Headline" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" rows={3} required minLength={10} maxLength={600} placeholder="What happened, who took part, and what changed" aria-label="Details" value={body} onChange={(e) => setBody(e.target.value)} />
          {preview ? (
            <div className="relative overflow-hidden rounded-xl border border-line">
              <img src={preview} alt="Selected" className="max-h-60 w-full object-cover" />
              <button type="button" onClick={() => setFile(null)} className="absolute end-2 top-2 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-semibold text-white">Change photo</button>
            </div>
          ) : (
            <label className="btn btn-ghost w-full cursor-pointer">
              <Camera size={16} /> Add a photo of the work (required)
              <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <p className="text-[11px] text-muted">{org ? 'Organisations can share 3 posts a week (10 a month).' : 'You can share 1 post a week (3 a month).'} Posts are about community work, not advertising. Please blur faces of people who did not agree to be photographed.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={post.isPending}>{post.isPending ? 'Sharing…' : 'Share'}</button>
          </div>
        </form>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm font-semibold ${msg.ok ? 'text-leaf' : 'text-brick'}`}>{msg.ok ? msg.text : friendlyError(msg.text)}</p>}
    </div>
  );
}
