import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { timeAgo } from '../lib/constants';
import { supabase } from '../lib/supabase';
import type { AppNotification } from '../lib/types';

// In-app notifications: the database writes one whenever a report you made or follow changes.
export function NotificationBell({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const list = useQuery({
    queryKey: ['notifications', userId],
    enabled: Boolean(userId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications')
        .select('id, issue_id, kind, title, body, read_at, created_at')
        .order('created_at', { ascending: false }).limit(30);
      if (error) throw new Error(error.message);
      return data as AppNotification[];
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!userId) return null;
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read_at);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        className={`relative flex h-10 w-10 items-center justify-center rounded-full transition ${tone === 'light' ? 'text-white hover:bg-white/15' : 'text-ink hover:bg-sand'}`}>
        <Bell size={21} />
        {unread.length > 0 && (
          <span className="absolute top-1 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brick px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-card text-ink shadow-2xl lg:right-auto lg:left-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-bold">Notifications</p>
            {unread.length > 0 && (
              <button type="button" onClick={() => markRead.mutate(unread.map((n) => n.id))} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No notifications yet. Follow a report to hear about it.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <Link to={n.issue_id ? `/issues/${n.issue_id}` : '/'} onClick={() => { setOpen(false); if (!n.read_at) markRead.mutate([n.id]); }}
                  className={`flex gap-3 px-4 py-3 transition hover:bg-sand ${n.read_at ? '' : 'bg-primary-soft/60'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-primary'}`} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-snug">{n.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-muted">{timeAgo(n.created_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
