import { useEffect, useState } from 'react';
import { CATEGORIES, type Category, type EventView, type Status } from '../../server/contract.ts';
import { type EventQuery, fetchEvents, fetchStatus, requestRefresh } from './api.ts';
import { addDays, agoLabel, dayLabel, localDay, type Preset, presetRange, type Range, timeLabel } from './dates.ts';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'This week' },
  { id: 'range', label: 'Pick dates' },
];

type Loaded = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; events: EventView[] };

function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  // Counts finished polls, so the listing reloads when new data has landed.
  const [landed, setLanded] = useState(0);
  const polling = status?.polling ?? false;

  useEffect(() => {
    const abort = new AbortController();
    let wasPolling = polling;
    const look = () =>
      fetchStatus(abort.signal)
        .then((next) => {
          if (wasPolling && !next.polling) setLanded((n) => n + 1);
          wasPolling = next.polling;
          setStatus(next);
        })
        .catch(() => {});
    void look();
    const timer = setInterval(() => void look(), polling ? 2_000 : 60_000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [polling]);

  const refresh = () => void requestRefresh().then(setStatus).catch(() => {});
  return { status, landed, refresh };
}

function useEvents(query: EventQuery, landed: number): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const key = JSON.stringify(query);

  useEffect(() => {
    const abort = new AbortController();
    fetchEvents(JSON.parse(key) as EventQuery, abort.signal)
      .then((events) => setLoaded({ state: 'ready', events }))
      .catch((err: unknown) => {
        if (!abort.signal.aborted) setLoaded({ state: 'failed', message: err instanceof Error ? err.message : String(err) });
      });
    return () => abort.abort();
  }, [key, landed]);

  return loaded;
}

function StatusLine({ status, onRefresh }: { status: Status | null; onRefresh: () => void }) {
  if (!status) return null;
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

function EventCard({ event }: { event: EventView }) {
  const place = [event.venue, event.address].filter(Boolean).join(' · ');
  return (
    <li className="event">
      <div className="time">{timeLabel(event.when)}</div>
      <div className="body">
        <h3>
          <a href={event.sources[0]?.url} target="_blank" rel="noreferrer">
            {event.title}
          </a>
        </h3>
        {place && <p className="place">{place}</p>}
        {event.description && <p className="description">{event.description}</p>}
        <p className="facts">
          <span className="tag">{event.category}</span>
          {event.priceText && <span className={event.isFree ? 'price free' : 'price'}>{event.priceText}</span>}
          {event.moreDates > 0 && (
            <span className="more">
              +{event.moreDates} more {event.moreDates === 1 ? 'date' : 'dates'}
            </span>
          )}
          <span className="sources">
            {event.sources.map((s) => (
              <a key={s.source} href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            ))}
          </span>
        </p>
      </div>
    </li>
  );
}

function Listing({ events, today }: { events: EventView[]; today: string }) {
  if (events.length === 0) return <p className="empty">Nothing found for these dates and filters.</p>;

  const days: { heading: string; events: EventView[] }[] = [];
  const running: EventView[] = [];
  for (const event of events) {
    if (event.ongoing) {
      running.push(event);
      continue;
    }
    const heading = dayLabel(event.when.startDate, today);
    const last = days.at(-1);
    if (last?.heading === heading) last.events.push(event);
    else days.push({ heading, events: [event] });
  }
  if (running.length > 0) days.push({ heading: 'Already running', events: running });

  return (
    <>
      {days.map((day) => (
        <section key={day.heading}>
          <h2>
            {day.heading} <span className="count">{day.events.length}</span>
          </h2>
          <ul>
            {day.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function App() {
  const today = localDay(new Date());
  const [preset, setPreset] = useState<Preset>('week');
  const [custom, setCustom] = useState<Range>({ from: today, to: addDays(today, 30) });
  const [categories, setCategories] = useState<Category[]>([]);
  const [freeOnly, setFreeOnly] = useState(false);

  const range = preset === 'range' ? custom : presetRange(preset, today);
  const { status, landed, refresh } = useStatus();
  const loaded = useEvents({ ...range, categories, freeOnly }, landed);

  const toggle = (category: Category) =>
    setCategories((chosen) => (chosen.includes(category) ? chosen.filter((c) => c !== category) : [...chosen, category]));

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
        <StatusLine status={status} onRefresh={refresh} />
      </header>

      <div className="filters">
        <div className="presets" role="group" aria-label="Dates">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'range' && (
          <div className="range">
            <label>
              From
              <input
                type="date"
                value={custom.from}
                onChange={(e) => e.target.value && setCustom((c) => ({ from: e.target.value, to: c.to < e.target.value ? e.target.value : c.to }))}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={custom.to}
                min={custom.from}
                onChange={(e) => e.target.value && setCustom((c) => ({ from: c.from, to: e.target.value < c.from ? c.from : e.target.value }))}
              />
            </label>
          </div>
        )}
        <div className="categories" role="group" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={categories.includes(c)} onClick={() => toggle(c)}>
              {c}
            </button>
          ))}
        </div>
        <label className="free">
          <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
          Free only
        </label>
      </div>

      <main aria-busy={loaded.state === 'loading'}>
        {loaded.state === 'loading' && <p className="empty">Loading…</p>}
        {loaded.state === 'failed' && <p className="empty warn">The listing could not be loaded: {loaded.message}</p>}
        {loaded.state === 'ready' && <Listing events={loaded.events} today={today} />}
      </main>

      <footer>
        Event data from <a href="https://www.gotobrno.cz" target="_blank" rel="noreferrer">gotobrno.cz</a> (CC BY, via data.brno.cz) and{' '}
        <a href="https://goout.net" target="_blank" rel="noreferrer">GoOut</a>. Follow a source link for full details and tickets.
      </footer>
    </div>
  );
}
