import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Empty, Icon, Page, Skeleton, fmtDateTime, type IconName } from '../ui';
import { EmployeeStyles, relTime, useNow } from './bits';

interface Note { id: string; type: string; title: string; body: string; created_at: string; read_at: string | null }

function noteIcon(type: string): IconName {
  const t = type.toLowerCase();
  if (t.includes('correction')) return 'swap';
  if (t.includes('review') || t.includes('flag')) return 'flag';
  if (t.includes('auto') || t.includes('close') || t.includes('forgot')) return 'clock';
  if (t.includes('consent') || t.includes('privacy')) return 'shield';
  if (t.includes('shift') || t.includes('schedule')) return 'calendar';
  if (t.includes('late') || t.includes('alert') || t.includes('warn')) return 'alert';
  return 'bell';
}

export default function Notifications() {
  const { me, refresh } = useAuth();
  const now = useNow();
  const [items, setItems] = useState<Note[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await api<{ items: Note[] }>('/api/notifications');
        if (!live) return;
        setItems(r.items);
        if (r.items.some((n) => !n.read_at)) {
          await api('/api/notifications/read', { body: {} });
          await refresh();
        }
      } catch (e: any) {
        if (live) setError(e.message ?? 'Could not load notifications.');
      }
    })();
    return () => { live = false; };
  }, [refresh]);

  const tz = me?.timezone ?? 'UTC';
  return (
    <Page title="Notifications">
      <EmployeeStyles />
      {error && <Alert kind="bad">{error}</Alert>}
      {!items && !error && <Skeleton lines={4} />}
      {items && items.length === 0 && <Empty icon="bell" title="You are all caught up" />}
      {items && items.length > 0 && (
        <ul className="plain-list">
          {items.map((n) => {
            const unread = !n.read_at;
            return (
              <li key={n.id} className={`note${unread ? ' unread' : ''}`}>
                <span className="tl-icon"><Icon name={noteIcon(n.type)} size={20} /></span>
                <div className="stack-xs" style={{ minWidth: 0 }}>
                  <div className="row between" style={{ flexWrap: 'nowrap', gap: 8 }}>
                    <strong>{n.title}{unread && <span className="sr-only"> (new)</span>}</strong>
                    {unread && <span className="unread-dot" aria-hidden="true" />}
                  </div>
                  <div className="small">{n.body}</div>
                  <time className="small muted" dateTime={n.created_at} title={fmtDateTime(n.created_at, tz)}>{relTime(n.created_at, now, tz)}</time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
