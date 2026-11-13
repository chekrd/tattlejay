import { useState } from 'react';
import type { RatingValue } from '../../server/contract.ts';
import { fetchHistory } from './api.ts';
import { dayLabel, localDay } from './dates.ts';
import { EventCard, Linked, RatingButtons } from './EventCard.tsx';
import { useLoad } from './hooks.ts';

const VERDICTS: { value: RatingValue; label: string; done: string }[] = [
  { value: 'like', label: 'Liked', done: 'Liked' },
  { value: 'save', label: 'Saved', done: 'Saved' },
  { value: 'dislike', label: 'Disliked', done: 'Disliked' },
];

// Every event the person has reacted to, whether or not it is still listed anywhere.
export function History({ today, revision, onChanged }: { today: string; revision: number; onChanged: () => void }) {
  const history = useLoad(fetchHistory, `history ${revision}`);
  const [only, setOnly] = useState<RatingValue | null>(null);

  if (history.error) return <p className="empty warn">Your history could not be loaded: {history.error}</p>;
  if (!history.data) return <p className="empty">Loading…</p>;
  const { entries, unrated } = history.data;
  const shown = only ? entries.filter((e) => e.value === only) : entries;
  const waiting = unrated.length > 0 && (
    <section>
      <h2 className="plain">Added by you, not rated yet</h2>
      <ul>
        {unrated.map((event) => (
          <EventCard key={event.id} event={event} onChanged={onChanged} showDay={today} />
        ))}
      </ul>
    </section>
  );
  if (entries.length === 0) return waiting || <p className="empty">Nothing yet. Every event you like, dislike or save is kept here.</p>;

  return (
    <>
      {waiting}
      <section className="panel">
        <h2 className="plain">
          Events you reacted to <span className="count">{entries.length}</span>
        </h2>
        <p className="hint">Latest reaction first. Change a reaction here, or press it again to take it back.</p>
        <div className="categories" role="group" aria-label="Show">
          <button type="button" aria-pressed={only === null} onClick={() => setOnly(null)}>
            All
          </button>
          {VERDICTS.map((v) => (
            <button key={v.value} type="button" aria-pressed={only === v.value} onClick={() => setOnly(v.value)}>
              {v.label} {entries.filter((e) => e.value === v.value).length}
            </button>
          ))}
        </div>
        <ul className="starter history">
          {shown.map((entry) => (
            <li key={entry.eventId}>
              <span className="what">
                <Linked url={entry.url ?? undefined}>{entry.title}</Linked>
                <span className="where">{[entry.category, entry.venue, entry.eventDate && `on ${dayLabel(entry.eventDate, today)}`].filter(Boolean).join(' · ')}</span>
                <span className="where">
                  {VERDICTS.find((v) => v.value === entry.value)?.done} {dayLabel(localDay(new Date(entry.at)), today)}
                </span>
              </span>
              <RatingButtons event={{ id: entry.eventId, title: entry.title, rating: entry.value, date: entry.eventDate }} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
