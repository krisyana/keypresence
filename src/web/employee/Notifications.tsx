import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Empty, Page, Spinner, fmtDateTime } from '../ui';

interface Note { id: string; type: string; title: string; body: string; created_at: string; read_at: string | null }

export default function Notifications() {
  const { me, refresh } = useAuth();
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
      {error && <Alert kind="bad">{error}</Alert>}
      {!items && !error && <Spinner label="Loading notifications" />}
      {items && items.length === 0 && <Empty>No notifications yet.</Empty>}
      {items && items.length > 0 && (
        <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((n) => (
            <li key={n.id} className="card stack-sm">
              <div className="row between">
                <strong>{n.title}</strong>
                {!n.read_at && <Badge kind="info">New</Badge>}
              </div>
              <div>{n.body}</div>
              <time className="small muted" dateTime={n.created_at}>{fmtDateTime(n.created_at, tz)}</time>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
