import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowBigUp, ArrowLeft, BadgeCheck, LogIn, Bell, BellOff, CalendarClock, Camera, Check, Copy, EyeOff, Lock, MapPin, Pencil, Reply, Share2, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { FileWithGhmc, FlagButton, HideToggle } from '../components/Moderation';
import { friendlyError } from '../lib/friendlyError';
import {
  CLOSED_REASONS, COMMENT_LIMIT, FIX_RESPONSE_DAYS, ISSUE_CATEGORIES, ISSUE_SELECT, STATUS_CLASS, STATUS_LABEL,
  fixState, formatDate, isOverdue, timeAgo,
} from '../lib/constants';
import { creditsFor } from '../lib/sampleCredits';
import { videoUrl } from '../lib/report';
import { shareIssue } from '../components/CardActions';
import { OrgChip } from '../components/OrgChip';
import { photoUrl, supabase, uploadPhoto } from '../lib/supabase';
import type { Comment, Issue, IssuePhoto, TimelineEntry } from '../lib/types';

export function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { userId, isAdmin, isGuest, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [editing, setEditing] = useState<{ title: string; description: string; location_text: string } | null>(null);
  const [editComment, setEditComment] = useState<{ id: string; body: string } | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const navigate = useNavigate();
  const reportState = location.state as { justReported?: boolean; followUp?: 'account' | 'device' | 'email' | 'none' } | null;
  const justReported = Boolean(reportState?.justReported);
  const followUp = reportState?.followUp ?? 'account';
  // Guests can report and track their own reports; everything else needs an account.
  const canInteract = Boolean(userId) && !isGuest;
  const toAuth = () => navigate('/auth', { state: { from: location.pathname } });

  const invalidate = (...keys: string[][]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));

  const issue = useQuery({
    queryKey: ['issue', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('issues').select(ISSUE_SELECT).eq('id', id!).single();
      if (error) throw new Error(error.message);
      return data as unknown as Issue;
    },
  });

  const isMine = useQuery({
    queryKey: ['is-mine', id, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_my_issue', { p_issue: id! });
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
  });

  const comments = useQuery({
    queryKey: ['comments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:profiles!comments_author_id_fkey(display_name, role, verified, account_type, org_name)')
        .eq('issue_id', id!).order('created_at');
      if (error) throw new Error(error.message);
      return data as Comment[];
    },
  });

  const timeline = useQuery({
    queryKey: ['timeline', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('issue_timeline').select('id, status, title, note, created_at').eq('issue_id', id!).order('created_at');
      if (error) throw new Error(error.message);
      return data as TimelineEntry[];
    },
  });

  const photos = useQuery({
    queryKey: ['issue-photos', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('issue_photos').select('id, user_id, path, created_at').eq('issue_id', id!).order('created_at');
      if (error) throw new Error(error.message);
      return data as IssuePhoto[];
    },
  });

  const myUpvote = useQuery({
    queryKey: ['upvote', id, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('issue_upvotes').select('issue_id').eq('issue_id', id!).eq('user_id', userId!).maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
  });

  const following = useQuery({
    queryKey: ['follow', id, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('issue_follows').select('issue_id').eq('issue_id', id!).eq('user_id', userId!).maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
  });

  const toggleUpvote = useMutation({
    mutationFn: async () => {
      const uid = userId!;
      const res = myUpvote.data
        ? await supabase.from('issue_upvotes').delete().eq('issue_id', id!).eq('user_id', uid)
        : await supabase.from('issue_upvotes').insert({ issue_id: id!, user_id: uid });
      if (res.error) throw new Error(res.error.message);
      // Backing a report also follows it, so the person hears when it changes.
      if (!myUpvote.data && !following.data) await supabase.from('issue_follows').insert({ issue_id: id!, user_id: uid });
    },
    onError: (e: Error) => setError(e.message),
    onSettled: () => invalidate(['upvote', id!], ['issue', id!], ['issues'], ['follow', id!]),
  });

  const toggleFollow = useMutation({
    mutationFn: async () => {
      const res = following.data
        ? await supabase.from('issue_follows').delete().eq('issue_id', id!).eq('user_id', userId!)
        : await supabase.from('issue_follows').insert({ issue_id: id!, user_id: userId! });
      if (res.error) throw new Error(res.error.message);
    },
    onSettled: () => invalidate(['follow', id!]),
  });

  const addComment = useMutation({
    mutationFn: async (a: { text: string; parentId: string | null }) => {
      const { error } = await supabase.from('comments').insert({ issue_id: id!, author_id: userId!, body: a.text, parent_id: a.parentId });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, a) => { if (a.parentId) { setReplyTo(null); setReplyBody(''); } else setBody(''); setError(null); invalidate(['comments', id!], ['issue', id!]); refreshProfile(); },
    onError: (e: Error) => setError(e.message),
  });

  const addPhoto = useMutation({
    mutationFn: async (file: File) => {
      const path = await uploadPhoto(userId!, file);
      const { error } = await supabase.from('issue_photos').insert({ issue_id: id!, user_id: userId!, path });
      if (error) { await supabase.storage.from('photos').remove([path]); throw new Error(error.message); }
    },
    onSuccess: () => { setError(null); invalidate(['issue-photos', id!]); },
    onError: (e: Error) => setError(e.message),
  });

  const respond = useMutation({
    mutationFn: async (accept: boolean) => {
      const { error } = await supabase.rpc('respond_to_fix', { p_issue: id!, p_accept: accept, p_note: accept ? null : rejectNote.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setRejecting(false); setRejectNote(''); setError(null); invalidate(['issue', id!], ['timeline', id!], ['issues'], ['issue-stats']); refreshProfile(); },
    onError: (e: Error) => setError(e.message),
  });

  const templates = useQuery({
    queryKey: ['response-templates'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('response_templates').select('id, title, body').order('title');
      if (error) throw new Error(error.message);
      return data as { id: string; title: string; body: string }[];
    },
  });

  const saveIssue = useMutation({
    mutationFn: async (d: { title: string; description: string; location_text: string }) => {
      const { error } = await supabase.rpc('edit_my_issue', { p_id: id!, p_title: d.title, p_description: d.description, p_location_text: d.location_text });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setEditing(null); setError(null); invalidate(['issue', id!], ['timeline', id!], ['issues']); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteIssue = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_my_issue', { p_id: id! });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { invalidate(['issues'], ['issue-stats'], ['my-issues']); navigate('/', { replace: true }); },
    onError: (e: Error) => setError(e.message),
  });

  const saveComment = useMutation({
    mutationFn: async (c: { id: string; body: string }) => {
      const { error } = await supabase.rpc('edit_my_comment', { p_id: c.id, p_body: c.body });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setEditComment(null); setError(null); invalidate(['comments', id!]); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteComment = useMutation({
    mutationFn: async (cid: string) => {
      const { error } = await supabase.from('comments').delete().eq('id', cid);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate(['comments', id!], ['issue', id!]),
    onError: (e: Error) => setError(e.message),
  });

  if (issue.isLoading) return <p className="py-10 text-center text-sm text-muted">Loading…</p>;
  if (issue.isError || !issue.data) return <p className="py-10 text-center text-sm font-semibold text-brick">This report could not be found. It may be confidential or removed.</p>;

  const it = issue.data;
  const mine = (comments.data ?? []).filter((c) => c.author_id === userId).length;
  // Staff replies are not limited; the database exempts admins too.
  const remaining = isAdmin ? Infinity : Math.max(0, COMMENT_LIMIT - mine);
  const before = photoUrl(it.photo_path);
  const after = photoUrl(it.resolved_photo_path);
  const extra = photos.data ?? [];
  const myExtra = extra.filter((p) => p.user_id === userId).length;
  const overdue = isOverdue(it);
  const credits = creditsFor(it.photo_path, it.resolved_photo_path);
  const fix = fixState(it);
  const open = it.status === 'pending' || it.status === 'progress';
  const deadline = it.resolved_at ? new Date(new Date(it.resolved_at).getTime() + FIX_RESPONSE_DAYS * 86_400_000) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (text) addComment.mutate({ text, parentId: null });
  }

  function submitReply(e: FormEvent, parentId: string) {
    e.preventDefault();
    const text = replyBody.trim();
    if (text) addComment.mutate({ text, parentId });
  }

  async function copyRef() {
    try { await navigator.clipboard.writeText(it.ref_no); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }

  return (
    <article className="space-y-5 lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="stagger card space-y-4 p-5">
        <Link to="/" className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={16} /> Back to feed</Link>

        {justReported && (
          <div role="status" className="rounded-xl border border-leaf/30 bg-[#e7f6ec] p-3 text-sm">
            <p className="font-bold text-leaf">Report submitted. Your reference number is {it.ref_no}.</p>
            {followUp === 'email' ? (
              <p className="mt-0.5 text-xs text-muted">We will email you whenever it changes, wherever you check your inbox. CivicPulse is not an official GHMC channel.</p>
            ) : followUp === 'none' ? (
              <p className="mt-0.5 text-xs text-muted">You chose not to track it, so note the reference number. You can find the report any time by searching for it on the home page. CivicPulse is not an official GHMC channel.</p>
            ) : (
              <p className="mt-0.5 text-xs text-muted">You will get updates in the bell whenever it changes, and can confirm the fix here. CivicPulse is not an official GHMC channel.</p>
            )}
            {followUp === 'device' && (
              <p className="mt-1.5 text-xs">You are tracking this on this device only. <Link to="/auth" state={{ mode: 'signup' }} className="font-bold text-primary underline">Create an account</Link> to track it anywhere, and to back, comment on or follow other reports.</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copyRef} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line px-3 py-1 font-mono text-[11px] font-semibold text-ink hover:bg-sand" aria-label={`Reference number ${it.ref_no}. Copy`}>
            {it.ref_no} {copied ? <Check size={12} className="text-leaf" /> : <Copy size={12} className="text-muted" />}
          </button>
          <span className={STATUS_CLASS[it.status]}>{STATUS_LABEL[it.status]}</span>
          {overdue && <span className="pill-overdue">Overdue</span>}
          <span className="tag">{ISSUE_CATEGORIES[it.category]}</span>
          {it.area && <span className="tag">{it.area}</span>}
          <button type="button" onClick={() => void shareIssue(it)} className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-full border border-line px-3 text-xs font-semibold hover:bg-sand"><Share2 size={13} /> Share</button>
          <span className="tag">Priority {it.priority_score}/100</span>
          {it.confidential && <span className="tag"><Lock size={11} className="mr-1" />Confidential</span>}
        </div>

        {it.hidden && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-blush p-3 text-sm text-brick">
            <EyeOff size={16} className="mt-0.5 shrink-0" /> <span><span className="font-bold">Hidden from the public.</span> {it.hidden_reason ?? 'Awaiting moderator review.'}</span>
          </p>
        )}

        {editing ? (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); saveIssue.mutate(editing); }}>
            <label className="label" htmlFor="e-title">Title</label>
            <input id="e-title" className="input" minLength={5} maxLength={120} required value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <label className="label" htmlFor="e-desc">Description</label>
            <textarea id="e-desc" className="input" rows={4} minLength={10} maxLength={2000} required value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <label className="label" htmlFor="e-loc">Location</label>
            <input id="e-loc" className="input" minLength={3} maxLength={200} required value={editing.location_text} onChange={(e) => setEditing({ ...editing, location_text: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saveIssue.isPending}>{saveIssue.isPending ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
        ) : (
          <h1 className="page-title text-2xl lg:text-[1.75rem]">{it.title}</h1>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex items-center gap-1 text-xs text-muted">
            {it.anonymous ? <><EyeOff size={13} /> Anonymous citizen</> : <>{it.author?.display_name ?? 'Citizen'}{it.author?.verified && <BadgeCheck size={13} className="text-primary" aria-label="Verified" />}</>}
            <span aria-hidden>·</span> {timeAgo(it.created_at)}
          </p>
          <span className="ml-auto flex items-center gap-2">
            {isMine.data && it.status === 'pending' && !editing && (
              <>
                <button type="button" className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-primary"
                  onClick={() => setEditing({ title: it.title, description: it.description, location_text: it.location_text })}><Pencil size={13} /> Edit</button>
                <button type="button" className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-brick" disabled={deleteIssue.isPending}
                  onClick={() => { if (window.confirm('Delete this report? This cannot be undone.')) deleteIssue.mutate(); }}><Trash2 size={13} /> Delete</button>
              </>
            )}
            {canInteract && !isMine.data && <FlagButton type="issue" id={it.id} userId={userId!} />}
            {isAdmin && <HideToggle type="issue" id={it.id} hidden={Boolean(it.hidden)} />}
          </span>
        </div>

        {(it.target_date && open) && (
          <p className={`flex items-center gap-2 rounded-xl p-3 text-sm ${overdue ? 'bg-blush text-brick' : 'bg-primary-soft text-primary'}`}>
            <CalendarClock size={17} />
            <span><span className="font-bold">{overdue ? 'Overdue.' : 'Fix promised'}</span> {overdue ? 'It was promised' : ''} by {formatDate(it.target_date)}{it.assignee ? ` · ${it.assignee}` : ''}</span>
          </p>
        )}

        {it.status === 'closed' && it.closed_reason && (
          <div className="rounded-xl border border-line bg-sand p-3 text-sm">
            <p className="font-bold">Closed without a fix: {CLOSED_REASONS[it.closed_reason]}</p>
            {it.closed_note && <p className="mt-0.5 text-muted">{it.closed_note}</p>}
          </div>
        )}

        {(before || after) && (
          <div className={`grid gap-2 ${before && after ? 'grid-cols-2' : ''}`}>
            {before && (
              <figure>
                <img src={before} alt="Reported issue" className="h-48 w-full rounded-xl object-cover lg:h-64" />
                {after && <figcaption className="mt-1 text-center text-[11px] text-muted">Before</figcaption>}
              </figure>
            )}
            {after && (
              <figure>
                <img src={after} onError={(e) => { e.currentTarget.closest('figure')?.remove(); }} alt="After resolution" className="h-48 w-full rounded-xl object-cover lg:h-64" />
                <figcaption className="mt-1 text-center text-[11px] text-leaf">After</figcaption>
              </figure>
            )}
          </div>
        )}
        {it.video_path && (
          <video src={videoUrl(it.video_path) ?? undefined} controls playsInline preload="metadata" className="max-h-96 w-full rounded-xl bg-ink" aria-label="Video of the problem" />
        )}
        {credits.length > 0 && (
          <p className="text-[11px] leading-snug text-muted">
            {credits.map((c, i) => (
              <span key={c.source}>{i > 0 && ' · '}Photo: <a href={c.source} target="_blank" rel="noopener noreferrer" className="underline">{c.author}</a>, <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{c.license}</a></span>
            ))}, via Wikimedia Commons.
          </p>
        )}

        <p className="text-sm leading-relaxed whitespace-pre-wrap">{it.description}</p>
        <p className="flex flex-wrap items-center gap-1 text-sm text-muted">
          <MapPin size={14} /> {it.location_text}
          {it.lat != null && it.lng != null && (
            <a className="ml-1 inline-flex min-h-8 items-center font-semibold text-primary underline" target="_blank" rel="noopener noreferrer"
              href={`https://www.openstreetmap.org/?mlat=${it.lat}&mlon=${it.lng}#map=17/${it.lat}/${it.lng}`}>Open map</a>
          )}
        </p>

        {/* Extra evidence from other citizens */}
        {(extra.length > 0 || (canInteract && open)) && (
          <section aria-labelledby="photos-h" className="space-y-2">
            <h2 id="photos-h" className="text-sm font-bold">Photos from the community ({extra.length})</h2>
            {extra.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {extra.map((p) => <img key={p.id} src={photoUrl(p.path) ?? ''} alt="Extra evidence" loading="lazy" className="aspect-square w-full rounded-lg object-cover" />)}
              </div>
            )}
            {canInteract && open && myExtra < 3 && (
              <label className="btn btn-ghost w-full cursor-pointer sm:w-auto">
                <Camera size={16} /> {addPhoto.isPending ? 'Uploading…' : 'Add my photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={addPhoto.isPending}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto.mutate(f); e.target.value = ''; }} />
              </label>
            )}
          </section>
        )}

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <button type="button" disabled={toggleUpvote.isPending} aria-pressed={Boolean(myUpvote.data)} onClick={() => (canInteract ? toggleUpvote.mutate() : toAuth())}
            className={`btn w-full ${myUpvote.data ? 'btn-primary' : 'btn-ghost'}`}>
            <ArrowBigUp size={18} /> {myUpvote.data ? 'You back this report' : 'Back this report'} · {it.upvote_count}
          </button>
          {canInteract && !isMine.data && (
            <button type="button" disabled={toggleFollow.isPending} aria-pressed={Boolean(following.data)} onClick={() => toggleFollow.mutate()} className="btn btn-ghost">
              {following.data ? <><BellOff size={16} /> Unfollow</> : <><Bell size={16} /> Follow</>}
            </button>
          )}
        </div>
        {!canInteract && (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-sand/70 p-3 text-center sm:flex-row sm:text-left">
            <p className="flex-1 text-xs text-muted">Reporting needs no account. To back, comment on, follow or add photos to reports, create a free account or sign in.</p>
            <Link to="/auth" state={{ from: location.pathname }} className="btn btn-primary min-h-9 shrink-0 px-4 text-xs"><LogIn size={14} /> Create account or sign in</Link>
          </div>
        )}
        {error && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError(error)}</p>}
      </div>

      <div className="stagger space-y-4 lg:sticky lg:top-6">
        {/* The reporter confirms or rejects the fix */}
        {it.status === 'resolved' && (
          <section className="card p-4">
            {fix === 'waiting' && isMine.data && (
              <>
                <h2 className="text-base font-bold">Is it really fixed?</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Please check and respond by {deadline?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. If you do not respond, the fix is treated as accepted.
                </p>
                {!rejecting ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" className="btn btn-primary" disabled={respond.isPending} onClick={() => respond.mutate(true)}><ThumbsUp size={16} /> Yes, fixed</button>
                    <button type="button" className="btn btn-ghost" disabled={respond.isPending} onClick={() => setRejecting(true)}><ThumbsDown size={16} /> Not fixed</button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <label htmlFor="reject" className="label">What is still wrong?</label>
                    <textarea id="reject" className="input" rows={2} maxLength={300} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="The pothole was only half filled." />
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)}>Cancel</button>
                      <button type="button" className="btn btn-danger" disabled={!rejectNote.trim() || respond.isPending} onClick={() => respond.mutate(false)}>Reopen report</button>
                    </div>
                  </div>
                )}
              </>
            )}
            {fix === 'waiting' && !isMine.data && <p className="text-sm text-muted">Waiting for the reporter to confirm the fix.</p>}
            {fix === 'confirmed' && <p className="flex items-center gap-2 text-sm font-semibold text-leaf"><BadgeCheck size={17} /> The reporter confirmed this is fixed.</p>}
            {fix === 'auto' && <p className="text-sm text-muted">Marked fixed. The reporter did not object within {FIX_RESPONSE_DAYS} days.</p>}
          </section>
        )}
        {it.reopen_count > 0 && it.status !== 'resolved' && (
          <p className="rounded-xl bg-blush p-3 text-sm text-brick">The reporter said the earlier fix did not work. Reopened {it.reopen_count} time{it.reopen_count > 1 ? 's' : ''}.</p>
        )}

        {isMine.data && open && !it.confidential && <FileWithGhmc issue={it} />}

        <section aria-labelledby="timeline-h" className="card p-4">
          <h2 id="timeline-h" className="mb-3 text-base font-bold">Progress</h2>
          <ReportStepper it={it} timeline={timeline.data ?? []} />
          <ol className="space-y-3 border-l border-line pl-4">
            {(timeline.data ?? []).map((t) => (
              <li key={t.id} className="relative text-sm">
                <span className="absolute top-1 -left-[23px] h-3 w-3 rounded-full border-2 border-white bg-primary" aria-hidden />
                <p className="font-medium">{t.title}</p>
                {t.note && <p className="text-xs text-muted">{t.note}</p>}
                <p className="text-[11px] text-muted">{timeAgo(t.created_at)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="comments-h" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="comments-h" className="text-base font-bold">Comments ({comments.data?.length ?? 0})</h2>
            {canInteract && !isAdmin && (
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${remaining === 0 ? 'border-brick/30 bg-blush text-brick' : 'border-line bg-primary-soft text-primary'}`}>
                {remaining}/{COMMENT_LIMIT} comments remaining for this post
              </span>
            )}
          </div>
          <ul className="space-y-3">
            {(comments.data ?? []).filter((c) => !c.parent_id).map((c) => {
              const replies = (comments.data ?? []).filter((r) => r.parent_id === c.id);
              return (
                <li key={c.id} className="space-y-2">
                  <CommentRow c={c} userId={userId} isAdmin={isAdmin} canInteract={canInteract}
                    editComment={editComment} setEditComment={setEditComment} saveComment={saveComment} deleteComment={deleteComment}
                    onReply={canInteract && remaining > 0 ? () => { setReplyTo(replyTo === c.id ? null : c.id); setReplyBody(''); } : undefined} />
                  {replies.length > 0 && (
                    <ul className="ml-5 space-y-2 border-l border-line pl-3">
                      {replies.map((r) => (
                        <CommentRow key={r.id} c={r} userId={userId} isAdmin={isAdmin} canInteract={canInteract}
                          editComment={editComment} setEditComment={setEditComment} saveComment={saveComment} deleteComment={deleteComment} />
                      ))}
                    </ul>
                  )}
                  {replyTo === c.id && (
                    <form className="ml-5 space-y-2 border-l border-line pl-3" onSubmit={(e) => submitReply(e, c.id)}>
                      <textarea className="input" rows={2} maxLength={500} autoFocus value={replyBody} aria-label={`Reply to ${c.author?.display_name ?? 'comment'}`}
                        onChange={(e) => setReplyBody(e.target.value)} placeholder="Write a reply…" />
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => { setReplyTo(null); setReplyBody(''); }}>Cancel</button>
                        <button type="submit" className="btn btn-primary min-h-9 px-3 text-xs" disabled={!replyBody.trim() || addComment.isPending}>{addComment.isPending ? 'Posting…' : 'Post reply'}</button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {canInteract && remaining > 0 && (
            <form onSubmit={submit} className="space-y-2">
              <label htmlFor="comment" className="label">{isAdmin ? 'Reply as CivicPulse staff' : 'Add a comment'}</label>
              {isAdmin && <p className="text-[11px] text-muted">Your reply is shown with a <b>Staff</b> label, and the reporter and followers are notified.</p>}
              {isAdmin && (templates.data?.length ?? 0) > 0 && (
                <select className="input" aria-label="Insert a standard reply" value="" onChange={(e) => { const t = templates.data?.find((x) => x.id === e.target.value); if (t) setBody(t.body); }}>
                  <option value="">Insert a standard reply…</option>
                  {templates.data!.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              )}
              <textarea id="comment" className="input" rows={3} maxLength={500} value={body} onChange={(e) => setBody(e.target.value)} placeholder={isAdmin ? 'Update or answer the reporter…' : 'Share useful details, politely.'} />
              <button type="submit" className="btn btn-primary w-full" disabled={!body.trim() || addComment.isPending}>{addComment.isPending ? 'Posting…' : isAdmin ? 'Post staff reply' : 'Post comment'}</button>
            </form>
          )}
          {canInteract && !isAdmin && remaining === 0 && <p className="text-xs text-muted">You have used all {COMMENT_LIMIT} comments on this post. This limit keeps discussions free of spam.</p>}
          {isAdmin && <Link to="/admin" className="block text-center text-xs font-semibold text-primary hover:underline">Manage this report in the admin console</Link>}
        </section>
      </div>
    </article>
  );
}

// One comment or reply card. Replies are rendered nested (see the caller), so this never renders
// its own "Reply" action for a reply — the thread is kept to 2 levels.
function CommentRow({ c, userId, isAdmin, canInteract, editComment, setEditComment, saveComment, deleteComment, onReply }: {
  c: Comment; userId: string | null; isAdmin: boolean; canInteract: boolean;
  editComment: { id: string; body: string } | null; setEditComment: (v: { id: string; body: string } | null) => void;
  saveComment: { mutate: (v: { id: string; body: string }) => void; isPending: boolean };
  deleteComment: { mutate: (id: string) => void };
  onReply?: () => void;
}) {
  return (
    <div className={`card-flat p-3 text-sm ${c.author?.role === 'admin' || (c.author?.account_type === 'government' && c.author.verified) ? 'bg-primary-soft' : ''}`}>
      <p className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted">
        <span className="font-medium text-ink">{c.author && c.author.account_type !== 'individual' && c.author.org_name ? c.author.org_name : c.author?.display_name ?? 'Citizen'}</span>
        {c.author?.account_type === 'individual' && c.author.verified && <BadgeCheck size={13} className="shrink-0 fill-primary text-white" aria-label="Verified" />}
        {c.author?.role === 'admin' && <span className="status status-progress">Staff</span>}
        {c.author?.account_type === 'government' && c.author.verified && <span className="status status-resolved">Official</span>}
        {c.author && c.author.account_type !== 'government' && <OrgChip type={c.author.account_type} verified={c.author.verified} />}
        <span aria-hidden>·</span> {timeAgo(c.created_at)}
      </p>
      {editComment?.id === c.id ? (
        <div className="space-y-2">
          <textarea className="input" rows={2} maxLength={500} value={editComment.body} aria-label="Edit comment" onChange={(e) => setEditComment({ id: c.id, body: e.target.value })} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => setEditComment(null)}>Cancel</button>
            <button type="button" className="btn btn-primary min-h-9 px-3 text-xs" disabled={!editComment.body.trim() || saveComment.isPending} onClick={() => saveComment.mutate(editComment)}>Save</button>
          </div>
        </div>
      ) : (
        <p className={`whitespace-pre-wrap ${c.hidden ? 'text-muted italic' : ''}`}>{c.hidden && !isAdmin ? 'This comment is hidden while a moderator reviews it.' : c.body}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {c.author_id === userId && editComment?.id !== c.id && (
          <>
            {Date.now() - new Date(c.created_at).getTime() < 15 * 60_000 && (
              <button type="button" className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] font-semibold text-muted hover:text-ink" onClick={() => setEditComment({ id: c.id, body: c.body })}><Pencil size={12} /> Edit</button>
            )}
            <button type="button" className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] font-semibold text-muted hover:text-brick"
              onClick={() => { if (window.confirm('Delete this comment?')) deleteComment.mutate(c.id); }}><Trash2 size={12} /> Delete</button>
          </>
        )}
        {onReply && <button type="button" className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] font-semibold text-muted hover:text-ink" onClick={onReply}><Reply size={12} /> Reply</button>}
        {canInteract && c.author_id !== userId && <FlagButton type="comment" id={c.id} userId={userId!} compact />}
        {isAdmin && <HideToggle type="comment" id={c.id} hidden={Boolean(c.hidden)} />}
      </div>
    </div>
  );
}

// A forward-looking pipeline (as opposed to the chronological log below it): shows where the
// report sits among Reported → In progress → Resolved/Closed, including stages not reached yet,
// so a report stuck at "Reported" for weeks doesn't read as if nothing is happening.
function ReportStepper({ it, timeline }: { it: Issue; timeline: TimelineEntry[] }) {
  const passedProgress = timeline.some((t) => t.status === 'progress');
  const terminal = it.status === 'resolved' || it.status === 'closed';
  const activeIndex = terminal ? 2 : it.status === 'progress' ? 1 : 0;
  const steps: { label: string; done: boolean; skipped?: boolean }[] = [
    { label: 'Reported', done: true },
    { label: 'In progress', done: passedProgress, skipped: !passedProgress && terminal },
    { label: it.status === 'closed' ? 'Closed' : 'Resolved', done: terminal },
  ];
  return (
    <div className="mb-4 flex items-start">
      {steps.map((s, i) => (
        <div key={s.label} className={`flex items-center ${i < steps.length - 1 ? 'flex-1' : ''}`}>
          <div className="flex flex-col items-center gap-1">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              s.done ? 'bg-primary text-white' : i === activeIndex ? 'border-2 border-primary text-primary' : s.skipped ? 'border border-dashed border-line text-muted' : 'border border-line text-muted'
            }`}>
              {s.done ? <Check size={13} /> : s.skipped ? '–' : i + 1}
            </span>
            <span className={`w-16 text-center text-[11px] font-semibold ${s.done || i === activeIndex ? 'text-ink' : 'text-muted'}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <span className={`mx-2 mt-3 h-0.5 flex-1 ${steps[i + 1].done ? 'bg-primary' : 'bg-line'}`} aria-hidden />}
        </div>
      ))}
    </div>
  );
}
