import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Eye, EyeOff, Flag, MessageCircle } from 'lucide-react';
import { Modal } from './Modal';
import { supabase } from '../lib/supabase';
import type { Issue } from '../lib/types';

const REASONS = {
  spam: 'Spam or advertising',
  abusive: 'Abusive or hateful',
  false: 'False or misleading',
  personal_info: "Shows someone's personal details",
  other: 'Something else',
} as const;
type Reason = keyof typeof REASONS;

// "Report this" for posts and comments. Five reports from different people hide the item for review.
export function FlagButton({ type, id, userId, compact = false }: { type: 'issue' | 'comment' | 'proposal' | 'contribution'; id: string; userId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>('spam');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('content_flags').insert({ reporter_id: userId, target_type: type, target_id: id, reason, note: note.trim() || null });
      if (error) throw new Error(error.message.includes('duplicate') ? 'You have already reported this.' : error.message);
    },
    onSuccess: () => setDone('Thank you. A moderator will review it.'),
    onError: (e: Error) => setDone(e.message),
  });

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setDone(null); }}
        className={`inline-flex items-center gap-1 text-muted hover:text-brick ${compact ? 'min-h-8 px-1 text-[11px]' : 'min-h-9 text-xs font-semibold'}`}>
        <Flag size={compact ? 12 : 14} /> Report
      </button>
      <Modal open={open} title={`Report this ${type === 'issue' ? 'post' : type}`} onClose={() => setOpen(false)}>
        {done ? (
          <div className="space-y-3 text-sm"><p>{done}</p><button type="button" className="btn btn-ghost w-full" onClick={() => setOpen(false)}>Close</button></div>
        ) : (
          <div className="space-y-3">
            <fieldset className="space-y-1.5">
              <legend className="label">What is wrong with it?</legend>
              {(Object.keys(REASONS) as Reason[]).map((r) => (
                <label key={r} className="flex min-h-9 items-center gap-2 text-sm">
                  <input type="radio" name="flag-reason" className="h-4 w-4 accent-primary" checked={reason === r} onChange={() => setReason(r)} /> {REASONS[r]}
                </label>
              ))}
            </fieldset>
            <textarea className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything moderators should know (optional)" aria-label="Note" />
            <button type="button" className="btn btn-primary w-full" disabled={send.isPending} onClick={() => send.mutate()}>{send.isPending ? 'Sendingâ€¦' : 'Send report'}</button>
          </div>
        )}
      </Modal>
    </>
  );
}

// Admin-only: hide or restore a post, comment or petition.
export function HideToggle({ type, id, hidden, onDone }: { type: 'issue' | 'comment' | 'proposal' | 'contribution'; id: string; hidden: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: async () => {
      const reason = hidden ? null : window.prompt('Reason shown to the author (optional)', 'Hidden by a moderator.');
      if (!hidden && reason === null) return;
      const { error } = await supabase.rpc('moderate', { p_type: type, p_id: id, p_hide: !hidden, p_reason: reason });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { ['issue', 'issues', 'comments', 'proposals', 'contributions', 'admin-flags'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onDone?.(); },
    onError: (e: Error) => window.alert(e.message),
  });
  return (
    <button type="button" disabled={run.isPending} onClick={() => run.mutate()}
      className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] font-semibold text-muted hover:text-ink">
      {hidden ? <><Eye size={12} /> Unhide</> : <><EyeOff size={12} /> Hide</>}
    </button>
  );
}

// GHMC has its own official channels. CivicPulse cannot file there for people, so we make it one tap.
const GHMC_WHATSAPP = '918125966586';
const GHMC_PORTAL = 'https://ghmconlinegrievance.cgg.gov.in/';

export function FileWithGhmc({ issue }: { issue: Issue }) {
  const [copied, setCopied] = useState(false);
  const mapLink = issue.lat != null && issue.lng != null ? `https://maps.google.com/?q=${issue.lat.toFixed(5)},${issue.lng.toFixed(5)}` : '';
  const text = [`Complaint: ${issue.title}`, issue.description, `Location: ${issue.location_text}`, mapLink, `CivicPulse ref: ${issue.ref_no}`].filter(Boolean).join('\n');

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }

  return (
    <section className="card p-4">
      <h2 className="text-base font-bold">Also file it officially with GHMC</h2>
      <p className="mt-0.5 text-xs text-muted">CivicPulse is not an official channel. Filing with GHMC too gives your complaint an official GHMC number.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <a className="btn btn-primary" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${GHMC_WHATSAPP}?text=${encodeURIComponent(text)}`}>
          <MessageCircle size={16} /> WhatsApp GHMC
        </a>
        <a className="btn btn-ghost" target="_blank" rel="noopener noreferrer" href={GHMC_PORTAL}><ExternalLink size={15} /> Grievance portal</a>
        <button type="button" className="btn btn-ghost" onClick={copy}><Copy size={15} /> {copied ? 'Copied' : 'Copy details'}</button>
      </div>
      <p className="mt-2 text-[11px] text-muted">WhatsApp opens with your report filled in; attach your photo there before sending. Or call GHMC on 040-21111111.</p>
    </section>
  );
}
