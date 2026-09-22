import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy, Mail, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { timeAgo } from '../lib/constants';
import { friendlyError } from '../lib/friendlyError';
import type { SupportMessage, SupportRequest, SupportStatus } from '../lib/types';

const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL as string | undefined;
const CONTACT_PHONE = import.meta.env.VITE_CONTACT_PHONE as string | undefined;
const OPERATOR = (import.meta.env.VITE_OPERATOR_NAME as string | undefined) || 'The CivicPulse team';

const STATUS_LABEL: Record<SupportStatus, string> = { open: 'Waiting for a reply', answered: 'Replied', closed: 'Closed' };
const STATUS_CLASS: Record<SupportStatus, string> = { open: 'status status-pending', answered: 'status status-progress', closed: 'status status-closed' };

export function Support() {
  const { userId, loading } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId) return <Thread id={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div><p className="label flex items-center gap-1.5"><LifeBuoy size={14} /> Support</p><h1 className="page-title">Help <span className="marker">& feedback</span></h1></div>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-bold">Other ways to reach us</h2>
        {CONTACT_EMAIL && (
          <a href={`mailto:${CONTACT_EMAIL}`} className="flex items-center gap-2 text-sm text-primary hover:underline"><Mail size={16} /> {CONTACT_EMAIL}</a>
        )}
        {CONTACT_PHONE && (
          <a href={`tel:${CONTACT_PHONE}`} className="flex items-center gap-2 text-sm text-primary hover:underline"><Phone size={16} /> {CONTACT_PHONE}</a>
        )}
        {!CONTACT_EMAIL && !CONTACT_PHONE && (
          <p className="text-xs text-muted">Use the form below — it reaches {OPERATOR} directly and keeps a record you can follow up on.</p>
        )}
      </section>

      {loading ? null : userId ? (
        <>
          <NewRequest onOpened={setOpenId} />
          <MyRequests onOpen={setOpenId} />
        </>
      ) : (
        <p className="card-flat p-4 text-sm text-muted">
          <Link to="/auth" state={{ from: '/support' }} className="font-semibold text-primary underline">Sign in</Link> to send a message and see replies here.
        </p>
      )}
    </div>
  );
}

function NewRequest({ onOpened }: { onOpened: (id: string) => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);

  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('open_support_request', { p_subject: subject.trim(), p_body: body.trim() });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ['support-requests'] }); onOpened(id); },
  });

  if (!open) {
    return (
      <button type="button" className="btn btn-primary w-full" onClick={() => setOpen(true)}>
        <MessageCircle size={16} /> Ask a question or report a problem
      </button>
    );
  }

  function submit(e: FormEvent) { e.preventDefault(); send.mutate(); }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="text-sm font-bold">New message</h2>
      <div><label className="label" htmlFor="sup-subj">Subject</label><input id="sup-subj" className="input" required minLength={3} maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" /></div>
      <div><label className="label" htmlFor="sup-body">Message</label><textarea id="sup-body" className="input" required rows={4} minLength={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What's happening, and what did you expect instead?" /></div>
      {send.isError && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError((send.error as Error).message)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!subject.trim() || !body.trim() || send.isPending}>{send.isPending ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  );
}

function MyRequests({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useQuery({
    queryKey: ['support-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('support_requests').select('id, subject, status, created_at, updated_at').order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data as SupportRequest[];
    },
  });

  if (list.isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!list.data?.length) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-muted">Your messages</h2>
      <ul className="space-y-2">
        {list.data.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className="card-flat flex w-full items-center justify-between gap-2 p-3 text-start hover:border-primary">
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{r.subject}</span><span className="text-xs text-muted">{timeAgo(r.updated_at)}</span></span>
              <span className={`${STATUS_CLASS[r.status]} shrink-0`}>{STATUS_LABEL[r.status]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const request = useQuery({
    queryKey: ['support-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('support_requests').select('id, subject, status, created_at, updated_at').eq('id', id).single();
      if (error) throw new Error(error.message);
      return data as SupportRequest;
    },
  });
  const messages = useQuery({
    queryKey: ['support-messages', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('support_messages').select('id, request_id, author_id, is_staff, body, created_at').eq('request_id', id).order('created_at');
      if (error) throw new Error(error.message);
      return data as SupportMessage[];
    },
  });

  const reply = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('reply_support_request', { p_request: id, p_body: body.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setBody(''); qc.invalidateQueries({ queryKey: ['support-messages', id] }); qc.invalidateQueries({ queryKey: ['support-request', id] }); qc.invalidateQueries({ queryKey: ['support-requests'] }); },
  });

  const closed = request.data?.status === 'closed';

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><ArrowLeft size={15} /> Back to messages</button>
      {request.data && (
        <div className="flex items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-lg font-bold">{request.data.subject}</h1>
          <span className={`${STATUS_CLASS[request.data.status]} shrink-0`}>{STATUS_LABEL[request.data.status]}</span>
        </div>
      )}
      <ul className="space-y-2">
        {(messages.data ?? []).map((m) => (
          <li key={m.id} className={`card-flat max-w-[85%] p-3 text-sm ${m.is_staff ? 'bg-primary-soft' : 'ms-auto'}`}>
            {m.is_staff && <p className="mb-1 flex items-center gap-1 text-[11px] font-bold text-primary"><ShieldCheck size={12} /> CivicPulse staff</p>}
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className="mt-1 text-[11px] text-muted">{timeAgo(m.created_at)}</p>
          </li>
        ))}
      </ul>
      {closed ? (
        <p className="card-flat p-3 text-center text-sm text-muted">This message is closed. Send a new one from the Help page if you still need help.</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) reply.mutate(); }} className="space-y-2">
          <textarea className="input" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply…" aria-label="Reply" />
          {reply.isError && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError((reply.error as Error).message)}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={!body.trim() || reply.isPending}>{reply.isPending ? 'Sending…' : 'Send'}</button>
        </form>
      )}
    </div>
  );
}
