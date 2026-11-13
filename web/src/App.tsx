import { useState } from 'react';
import type { Status } from '../../server/contract.ts';
import { requestPicks, requestRefresh } from './api.ts';
import { agoLabel, localDay } from './dates.ts';
import { useStatus } from './hooks.ts';
import { Plans } from './Plans.tsx';
import { TastePanel } from './TastePanel.tsx';
import { WhatsOn } from './WhatsOn.tsx';

type Tab = 'on' | 'plans' | 'taste';

const TABS: { id: Tab; label: string }[] = [
  { id: 'on', label: "What's on" },
  { id: 'plans', label: 'My plans' },
  { id: 'taste', label: 'My taste' },
];

function SourcesLine({ status, onRefresh }: { status: Status; onRefresh: () => void }) {
  const failed = status.sources.filter((s) => s.lastError);
  const updated = Math.min(...status.sources.map((s) => s.lastOkAt ?? 0));
  return (
    <div className="status">
      {status.polling ? (
        <span>Reading sources…</span>
      ) : failed.length > 0 ? (
        <span className="warn" title={failed.map((s) => `${s.label}: ${s.lastError}`).join('\n')}>
          {failed.map((s) => s.label).join(', ')} could not be read
        </span>
      ) : updated > 0 ? (
        <span>Updated {agoLabel(updated, Date.now())}</span>
      ) : (
        <span>Not read yet</span>
      )}
      <button type="button" onClick={onRefresh} disabled={status.polling}>
        Refresh
      </button>
    </div>
  );
}

export function App() {
  const today = localDay(new Date());
  const [tab, setTab] = useState<Tab>('on');
  // Bumped whenever something the lists show may have changed: a rating, a saved setting, finished background work.
  const [revision, setRevision] = useState(0);
  const changed = () => setRevision((n) => n + 1);
  const { status, setStatus } = useStatus(revision, changed);

  const refreshSources = () => void requestRefresh().then(setStatus).catch(() => {});
  const refreshPicks = () => void requestPicks().then(setStatus).catch(() => {});
  const shared = { today, status, revision, onChanged: changed };

  return (
    <div className="page">
      <header>
        <div>
          <h1>Tattlejay</h1>
          {status && (
            <p className="where">
              {status.place.name} + {status.place.radiusKm} km
            </p>
          )}
        </div>
        {status && <SourcesLine status={status} onRefresh={refreshSources} />}
      </header>

      <nav className="tabs" aria-label="Views">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'on' && <WhatsOn {...shared} onOpenTaste={() => setTab('taste')} onRefreshPicks={refreshPicks} />}
      {tab === 'plans' && <Plans today={today} revision={revision} onChanged={changed} />}
      {tab === 'taste' && <TastePanel {...shared} onRefreshPicks={refreshPicks} />}

      <footer>
        Event data from <a href="https://www.gotobrno.cz" target="_blank" rel="noreferrer">gotobrno.cz</a> (CC BY, via data.brno.cz) and{' '}
        <a href="https://goout.net" target="_blank" rel="noreferrer">GoOut</a>. Follow a source link for full details and tickets.
      </footer>
    </div>
  );
}
