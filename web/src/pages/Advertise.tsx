import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, BarChart3, Eye, Megaphone, MousePointerClick, Pencil, Plus, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { SponsoredBanner } from '../components/FeedCards';
import { useAuth } from '../hooks/useAuth';
import { ISSUE_CATEGORIES } from '../lib/constants';
import { supabase, uploadAdMedia } from '../lib/supabase';
import type { IssueCategory } from '../lib/types';
import { friendlyError } from '../lib/friendlyError';

export const CPM_INR = 100; // flat price per 1,000 views
const PAYMENT_URL = (import.meta.env.VITE_ADS_PAYMENT_URL as string | undefined) ?? '';
const CTAS = ['Learn more', 'Donate', 'Visit', 'Shop now', 'Sign up', 'Register'] as const;

interface Advertiser { id: string; name: string; kind: 'ngo' | 'business' | 'government'; website: string | null; contact_email: string; verified: boolean }
export interface Campaign {
  id: string; advertiser_id: string; title: string; body: string; cta_label: string; cta_url: string;
  media_path: string | null; media_type: 'image' | 'gif' | 'video' | null; target_category: IssueCategory | null; target_area: string | null;
  budget_inr: number; starts_at: string; ends_at: string; status: 'draft' | 'pending' | 'approved' | 'rejected' | 'paused' | 'ended';
  review_note: string | null; paid: boolean; payment_ref: string | null; created_at: string;
}
export interface DayStat { campaign_id: string; day: string; views: number; clicks: number }

export const CAMPAIGN_STATUS: Record<Campaign['status'], { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'status status-pending' },
  pending: { label: 'In review', cls: 'status status-progress' },
  approved: { label: 'Approved', cls: 'status status-resolved' },
  rejected: { label: 'Needs changes', cls: 'status status-closed' },
  paused: { label: 'Paused', cls: 'status status-pending' },
  ended: { label: 'Ended', cls: 'status status-closed' },
};

export function liveState(c: Campaign, spent: number): string {
  const now = Date.now();
  if (c.status !== 'approved') return CAMPAIGN_STATUS[c.status].label;
  if (!c.paid) return 'Approved, awaiting payment';
  if (spent >= c.budget_inr) return 'Budget used up';
  if (now < new Date(c.starts_at).getTime()) return 'Scheduled';
  if (now > new Date(c.ends_at).getTime()) return 'Finished';
  return 'Running';
}

export function totals(stats: DayStat[] | undefined, id: string) {
  const rows = (stats ?? []).filter((s) => s.campaign_id === id);
  const views = rows.reduce((a, r) => a + r.views, 0);
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  return { views, clicks, ctr: views ? (100 * clicks) / views : 0, spent: Math.round((views * CPM_INR) / 10) / 100 };
}

const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function Advertise() {
  const { userId, isGuest, loading } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const adv = useQuery({
    queryKey: ['advertiser', userId],
    enabled: Boolean(userId) && !isGuest,
    queryFn: async () => {
      const { data, error } = await supabase.from('advertisers').select('id, name, kind, website, contact_email, verified').eq('owner_id', userId!).maybeSingle();
      if (error) throw new Error(error.message);
      return data as Advertiser | null;
    },
  });

  const campaigns = useQuery({
    queryKey: ['my-campaigns', adv.data?.id],
    enabled: Boolean(adv.data),
    queryFn: async () => {
      const { data, error } = await supabase.from('ad_campaigns').select('*').eq('advertiser_id', adv.data!.id).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data as Campaign[];
    },
  });

  const stats = useQuery({
    queryKey: ['my-ad-stats', (campaigns.data ?? []).map((c) => c.id).join(',')],
    enabled: (campaigns.data?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('ad_daily_stats').select('campaign_id, day, views, clicks').in('campaign_id', campaigns.data!.map((c) => c.id));
      if (error) throw new Error(error.message);
      return data as DayStat[];
    },
  });

  const act = useMutation({
    mutationFn: async (a: { id: string; action: 'submit' | 'pause' | 'resume' | 'delete' }) => {
      const { error } = a.action === 'delete'
        ? await supabase.from('ad_campaigns').delete().eq('id', a.id)
        : await supabase.rpc('set_campaign_state', { p_id: a.id, p_action: a.action });
      if (error) throw new Error(error.message);
      return a.action;
    },
    onSuccess: (action) => {
      setMsg({ ok: true, text: action === 'submit' ? 'Sent for review. We usually reply within 2 working days.' : 'Done.' });
      qc.invalidateQueries({ queryKey: ['my-campaigns'] });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  if (loading) return <p className="py-10 text-center text-sm text-muted">Loading…</p>;

  if (!userId || isGuest) {
    return (
      <div className="card mx-auto max-w-2xl space-y-4 p-6 sm:p-8">
        <p className="label">CivicPulse Ads</p>
        <h1 className="page-title">Reach your <span className="marker">neighbourhood</span></h1>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><Megaphone size={17} className="shrink-0 text-primary" /> Show your cause, event or local business to people who care about their area.</li>
          <li className="flex gap-2"><Wallet size={17} className="shrink-0 text-primary" /> Simple pricing: {inr(CPM_INR)} per 1,000 views. Set a total budget from {inr(500)}; you never pay more.</li>
          <li className="flex gap-2"><ShieldCheck size={17} className="shrink-0 text-primary" /> Every ad is reviewed. No personal tracking: ads can match the topic people are viewing, never who they are.</li>
          <li className="flex gap-2"><BarChart3 size={17} className="shrink-0 text-primary" /> See views, clicks and budget used every day.</li>
        </ul>
        <Link to="/auth" state={{ from: '/advertise' }} className="btn btn-primary w-full">Sign in or create an account to advertise</Link>
      </div>
    );
  }

  if (adv.isLoading) return <p className="py-10 text-center text-sm text-muted">Loading…</p>;
  if (!adv.data) return <AdvertiserForm userId={userId} onDone={() => qc.invalidateQueries({ queryKey: ['advertiser'] })} />;

  const list = campaigns.data ?? [];
  const all = list.map((c) => totals(stats.data, c.id));
  const sum = all.reduce((a, t) => ({ views: a.views + t.views, clicks: a.clicks + t.clicks, spent: a.spent + t.spent }), { views: 0, clicks: 0, spent: 0 });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">Ads Manager</p>
          <h1 className="page-title flex items-center gap-2">{adv.data.name}{adv.data.verified && <BadgeCheck size={20} className="text-primary" aria-label="Verified advertiser" />}</h1>
          <p className="text-xs text-muted">{adv.data.verified ? 'Verified advertiser' : 'Not verified yet. An admin verifies advertisers when approving their first ad.'}</p>
        </div>
        {!editing && <button type="button" className="btn btn-primary" onClick={() => { setMsg(null); setEditing({ cta_label: 'Learn more', budget_inr: 1000, starts_at: toLocal(new Date(Date.now() + 86400000)), ends_at: toLocal(new Date(Date.now() + 15 * 86400000)) }); }}><Plus size={16} /> New campaign</button>}
      </div>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([['Views', sum.views.toLocaleString('en-IN'), Eye], ['Clicks', sum.clicks.toLocaleString('en-IN'), MousePointerClick], ['Click rate', `${sum.views ? ((100 * sum.clicks) / sum.views).toFixed(1) : '0.0'}%`, BarChart3], ['Spent', inr(sum.spent), Wallet]] as const).map(([k, v, Icon]) => (
          <div key={k} className="card flex items-center gap-3 px-4 py-3">
            <Icon size={20} className="text-primary" />
            <div className="flex flex-col-reverse"><dt className="text-xs text-muted">{k}</dt><dd className="text-xl font-bold">{v}</dd></div>
          </div>
        ))}
      </dl>

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${msg.ok ? 'text-leaf' : 'text-brick'}`}>{msg.ok ? msg.text : friendlyError(msg.text)}</p>}

      {editing && <CampaignForm userId={userId} advertiserId={adv.data.id} draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMsg({ ok: true, text: 'Saved as a draft. Submit it for review when ready.' }); qc.invalidateQueries({ queryKey: ['my-campaigns'] }); }} />}

      {list.length === 0 && !editing && <p className="card px-6 py-10 text-center text-sm text-muted">No campaigns yet. Create your first one.</p>}

      <ul className="grid gap-4 lg:grid-cols-2">
        {list.map((c, i) => {
          const t = all[i];
          const pct = Math.min(100, (100 * t.spent) / c.budget_inr);
          return (
            <li key={c.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={CAMPAIGN_STATUS[c.status].cls}>{liveState(c, t.spent)}</span>
                {c.target_category && <span className="tag">{ISSUE_CATEGORIES[c.target_category]}</span>}
                {c.target_area && <span className="tag">{c.target_area}</span>}
                <span className="ml-auto text-[11px] text-muted">{new Date(c.starts_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} to {new Date(c.ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              </div>
              <p className="font-bold">{c.title}</p>
              {c.review_note && <p className="rounded-lg bg-sand p-2 text-xs"><b>Reviewer:</b> {c.review_note}</p>}
              <dl className="grid grid-cols-4 gap-2 text-center text-xs">
                <div><dt className="text-muted">Views</dt><dd className="text-base font-bold">{t.views}</dd></div>
                <div><dt className="text-muted">Clicks</dt><dd className="text-base font-bold">{t.clicks}</dd></div>
                <div><dt className="text-muted">Click rate</dt><dd className="text-base font-bold">{t.ctr.toFixed(1)}%</dd></div>
                <div><dt className="text-muted">Spent</dt><dd className="text-base font-bold">{inr(t.spent)}</dd></div>
              </dl>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>
                <p className="mt-1 text-[11px] text-muted">{inr(t.spent)} of {inr(c.budget_inr)} budget used</p>
              </div>
              {c.status === 'approved' && !c.paid && (
                <p className="rounded-lg bg-primary-soft p-2 text-xs text-primary">
                  Approved. Pay {inr(c.budget_inr)} to start. {PAYMENT_URL ? <a href={PAYMENT_URL} target="_blank" rel="noopener noreferrer" className="font-bold underline">Pay now</a> : 'Our team will send you a payment link.'} Mention campaign ID {c.id.slice(0, 8)}.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {(c.status === 'draft' || c.status === 'rejected') && <>
                  <button type="button" className="btn btn-primary min-h-9 px-3 text-xs" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, action: 'submit' })}>Submit for review</button>
                  <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => { setMsg(null); setEditing({ ...c, starts_at: toLocal(new Date(c.starts_at)), ends_at: toLocal(new Date(c.ends_at)) }); }}><Pencil size={13} /> Edit</button>
                </>}
                {c.status === 'approved' && <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => act.mutate({ id: c.id, action: 'pause' })}>Pause</button>}
                {c.status === 'paused' && <button type="button" className="btn btn-primary min-h-9 px-3 text-xs" onClick={() => act.mutate({ id: c.id, action: 'resume' })}>Resume</button>}
                {!c.paid && <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs text-danger" onClick={() => { if (confirm('Delete this campaign?')) act.mutate({ id: c.id, action: 'delete' }); }}><Trash2 size={13} /> Delete</button>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted">Views are counted once per network per day. Budget is used at {inr(CPM_INR)} per 1,000 views and the ad stops when it runs out. <Link to="/terms" className="underline">Advertising rules</Link></p>
    </div>
  );
}

function AdvertiserForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [f, setF] = useState({ name: '', kind: 'business', website: '', contact_email: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('advertisers').insert({ owner_id: userId, name: f.name.trim(), kind: f.kind, website: f.website.trim() || null, contact_email: f.contact_email.trim().toLowerCase() });
      if (error) throw new Error(error.message.includes('website') ? 'The website must start with https://' : error.message.includes('email') ? 'Please enter a valid email.' : error.message);
    },
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });
  function submit(e: FormEvent) { e.preventDefault(); setError(null); save.mutate(); }
  return (
    <form onSubmit={submit} className="card mx-auto max-w-lg space-y-3 p-6">
      <p className="label">Ads Manager</p>
      <h1 className="page-title">Set up your advertiser profile</h1>
      <p className="text-sm text-muted">This name appears on your ads as the sponsor.</p>
      <label className="label" htmlFor="a-name">Organisation or business name</label>
      <input id="a-name" className="input" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="label" htmlFor="a-kind">Type</label>
      <select id="a-kind" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        <option value="business">Local business</option><option value="ngo">NGO or charity</option><option value="government">Government body</option>
      </select>
      <label className="label" htmlFor="a-web">Website (optional)</label>
      <input id="a-web" className="input" type="url" pattern="https://.*" placeholder="https://" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      <label className="label" htmlFor="a-mail">Billing and contact email</label>
      <input id="a-mail" className="input" type="email" required value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} />
      {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={save.isPending}>Create profile</button>
    </form>
  );
}

function CampaignForm({ userId, advertiserId, draft, onClose, onSaved }: { userId: string; advertiserId: string; draft: Partial<Campaign>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Campaign>>(draft);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = f.starts_at && f.ends_at ? Math.max(1, Math.round((new Date(f.ends_at).getTime() - new Date(f.starts_at).getTime()) / 86400000)) : 1;
  const estViews = Math.floor(((f.budget_inr ?? 0) / CPM_INR) * 1000);

  const save = useMutation({
    mutationFn: async () => {
      const up = file ? await uploadAdMedia(file, userId) : null;
      const row = {
        title: f.title?.trim(), body: f.body?.trim(), cta_label: f.cta_label, cta_url: f.cta_url?.trim(),
        media_path: up?.path ?? f.media_path ?? null, media_type: up?.type ?? f.media_type ?? null,
        target_category: f.target_category || null, target_area: f.target_area?.trim() || null,
        budget_inr: Number(f.budget_inr), starts_at: new Date(f.starts_at!).toISOString(), ends_at: new Date(f.ends_at!).toISOString(),
      };
      const { error } = f.id
        ? await supabase.from('ad_campaigns').update(row).eq('id', f.id)
        : await supabase.from('ad_campaigns').insert({ ...row, advertiser_id: advertiserId });
      if (error) {
        if (up) await supabase.storage.from('ads').remove([up.path]);
        throw new Error(error.message.includes('cta_url') ? 'The link must start with https://' : error.message.includes('budget') ? `Budget must be between ₹500 and ₹5,00,000.` : error.message.includes('ends_at') ? 'The end date must be after the start date.' : error.message);
      }
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const preview = {
    id: 'preview', title: f.title || 'Your headline appears here', body: f.body ?? '', media_path: f.media_path ?? null, media_type: f.media_type ?? null,
    ngo: { name: 'Your organisation', donate_url: f.cta_url?.startsWith('https://') ? f.cta_url : 'https://example.org', website: null }, cta_label: f.cta_label,
  };

  return (
    <form className="card grid gap-5 p-4 lg:grid-cols-2 lg:p-6" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
      <div className="space-y-2.5">
        <h2 className="text-lg font-bold">{f.id ? 'Edit campaign' : 'New campaign'}</h2>
        <label className="label" htmlFor="c-title">Headline</label>
        <input id="c-title" className="input" required minLength={5} maxLength={90} value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <label className="label" htmlFor="c-body">Text</label>
        <textarea id="c-body" className="input" required rows={2} minLength={10} maxLength={200} value={f.body ?? ''} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="c-cta">Button</label>
            <select id="c-cta" className="input" value={f.cta_label} onChange={(e) => setF({ ...f, cta_label: e.target.value })}>{CTAS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label" htmlFor="c-url">Button link</label>
            <input id="c-url" className="input" type="url" required pattern="https://.*" placeholder="https://" value={f.cta_url ?? ''} onChange={(e) => setF({ ...f, cta_url: e.target.value })} /></div>
        </div>
        <label className="label" htmlFor="c-media">Image, GIF or short video (optional, 8 MB max)</label>
        <input id="c-media" className="input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="c-cat">Show next to (optional)</label>
            <select id="c-cat" className="input" value={f.target_category ?? ''} onChange={(e) => setF({ ...f, target_category: (e.target.value || null) as IssueCategory | null })}>
              <option value="">Any topic</option>{Object.entries(ISSUE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="label" htmlFor="c-area">Area label (optional)</label>
            <input id="c-area" className="input" maxLength={60} placeholder="Madhapur" value={f.target_area ?? ''} onChange={(e) => setF({ ...f, target_area: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="c-start">Starts</label><input id="c-start" className="input" type="datetime-local" required value={f.starts_at ?? ''} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></div>
          <div><label className="label" htmlFor="c-end">Ends</label><input id="c-end" className="input" type="datetime-local" required value={f.ends_at ?? ''} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></div>
        </div>
        <label className="label" htmlFor="c-budget">Total budget (₹)</label>
        <input id="c-budget" className="input" type="number" min={500} max={500000} step={100} required value={f.budget_inr ?? ''} onChange={(e) => setF({ ...f, budget_inr: Number(e.target.value) })} />
        <p className="text-xs text-muted">About {estViews.toLocaleString('en-IN')} views over {days} day{days > 1 ? 's' : ''} (up to {inr((f.budget_inr ?? 0) / days)} a day). You pay the budget once approved; unused budget can be refunded on request.</p>
        {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save draft'}</button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="label">Preview</p>
        <SponsoredBanner post={preview} onDismiss={() => {}} />
        <p className="text-[11px] text-muted">Ads always carry a "Sponsored ad" label and a close button. {file ? `New media: ${file.name}` : ''}</p>
      </div>
    </form>
  );
}
