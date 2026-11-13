import { useState } from 'react';
import { CATEGORIES, type Category, type EventView, type Picks, type Status } from '../../server/contract.ts';
import { fetchEvents, fetchPicks } from './api.ts';
import { addDays, dayLabel, type Preset, presetRange, type Range } from './dates.ts';
import { EventCard } from './EventCard.tsx';
import { useLoad } from './hooks.ts';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'past', label: 'Past 7 days' },
  { id: 'today', label: 'Today' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'This week' },
  { id: 'range', label: 'Pick dates' },
];

const PICK_GROUPS: { key: keyof Picks; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'later', label: 'Later' },
];

interface Shared {
  today: string;
  status: Status | null;
  revision: number;
  placeId: number;
  onChanged: () => void;
  // The online events, which are listed apart from those with a place.
  online?: boolean;
}

function PickedForYou({ today, status, revision, placeId, online = false, onChanged, onOpenTaste, onRefreshPicks }: Shared & { onOpenTaste: () => void; onRefreshPicks: () => void }) {
  const picks = useLoad((signal) => fetchPicks(placeId, online, signal), `picks ${placeId} ${online} ${revision}`);
  const taste = status?.taste;
  if (!taste) return null;

  const note = taste.running ? (
    <p className="note">{taste.progress && taste.progress.total > 0 ? `Scoring events: ${taste.progress.done} of ${taste.progress.total}…` : 'Working out your picks…'}</p>
  ) : taste.error ? (
    <p className="note warn">
      Your picks could not be updated: {taste.error}{' '}
      <button type="button" onClick={onRefreshPicks}>
        Try again
      </button>
    </p>
  ) : taste.stale ? (
    <p className="note">
      {taste.ready ? 'Your ratings or new events are not in these picks yet.' : 'You have told Tattlejay enough to make picks.'}{' '}
      <button type="button" onClick={onRefreshPicks}>
        {taste.ready ? 'Refresh my picks' : 'Make my picks'}
      </button>
    </p>
  ) : null;

  const groups = PICK_GROUPS.map((g) => ({ ...g, events: picks.data?.[g.key] ?? [] })).filter((g) => g.events.length > 0);

  return (
    <section className="picks" aria-label="Picked for you">
      <h2 className="plain">{online ? 'Picked for you online' : 'Picked for you'}</h2>
      {note}
      {!taste.ready && !taste.running && !taste.stale && !taste.error && (
        <p className="note">
          No picks yet. Rate a few events below, or say what you like in{' '}
          <button type="button" className="link" onClick={onOpenTaste}>
            My taste
          </button>
          .
        </p>
      )}
      {taste.ready && groups.length === 0 && !taste.running && <p className="note">Nothing upcoming matches your taste strongly enough yet.</p>}
      {groups.map((g) => (
        <div key={g.key} className="pick-group">
          <h3 className="group">{g.label}</h3>
          <ul>
            {g.events.map((event) => (
              <EventCard key={event.id} event={event} onChanged={onChanged} showDay={today} showReason />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

interface DaysProps {
  events: EventView[];
  today: string;
  onChanged: () => void;
  marksUnscored: boolean;
  // Looking back: only what is over, latest day first.
  past: boolean;
}

function Days({ events: all, today, onChanged, marksUnscored, past }: DaysProps) {
  const events = past ? all.filter((e) => e.when.endDate < today) : all;
  if (events.length === 0) {
    return <p className="empty">{past ? 'Nothing from the past week. Only events the app had already read before they happened can show here.' : 'Nothing found for these dates and filters.'}</p>;
  }

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
  if (past) days.reverse();

  return (
    <>
      {days.map((day) => (
        <section key={day.heading}>
          <h2>
            {day.heading} <span className="count">{day.events.length}</span>
          </h2>
          <ul>
            {day.events.map((event) => (
              <EventCard key={event.id} event={event} onChanged={onChanged} marksUnscored={marksUnscored} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function WhatsOn(props: Shared & { onOpenTaste: () => void; onRefreshPicks: () => void }) {
  const { today, status, revision, placeId, online = false, onChanged } = props;
  const [preset, setPreset] = useState<Preset>('week');
  const [custom, setCustom] = useState<Range>({ from: today, to: addDays(today, 30) });
  const [categories, setCategories] = useState<Category[]>([]);
  const [freeOnly, setFreeOnly] = useState(false);
  const [withHidden, setWithHidden] = useState(false);

  const range = preset === 'range' ? custom : presetRange(preset, today);
  const query = { ...range, categories, freeOnly, withHidden, placeId, online };
  const listing = useLoad((signal) => fetchEvents(query, signal), `events ${JSON.stringify(query)} ${revision}`);

  const toggle = (category: Category) =>
    setCategories((chosen) => (chosen.includes(category) ? chosen.filter((c) => c !== category) : [...chosen, category]));

  return (
    <>
      <PickedForYou {...props} />

      <h2 className="plain">{online ? 'Everything online' : 'Everything on'}</h2>
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
        <div className="checks">
          <label>
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
            Free only
          </label>
          <label>
            <input type="checkbox" checked={withHidden} onChange={(e) => setWithHidden(e.target.checked)} />
            Show hidden
          </label>
        </div>
      </div>

      <main aria-busy={listing.data === undefined && listing.error === undefined}>
        {listing.error && <p className="empty warn">The listing could not be loaded: {listing.error}</p>}
        {listing.data === undefined && !listing.error && <p className="empty">Loading…</p>}
        {listing.data && <Days events={listing.data} today={today} onChanged={onChanged} marksUnscored={preset !== 'past' && (status?.taste.ready ?? false)} past={preset === 'past'} />}
      </main>
    </>
  );
}
