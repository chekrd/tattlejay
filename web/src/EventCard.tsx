import type { ReactNode } from 'react';
import type { EventView, RatingValue } from '../../server/contract.ts';
import { rate } from './api.ts';
import { dayLabel, NO_TIME, timeLabel } from './dates.ts';

const ACTIONS: { value: RatingValue; label: string; hint: string }[] = [
  { value: 'like', label: 'Like', hint: 'More like this' },
  { value: 'dislike', label: 'Dislike', hint: 'Less like this, and hide it' },
  { value: 'save', label: 'Save', hint: 'Add to my plans' },
];

// An event added from pasted text or a picture has no page to link to.
export function Linked({ url, children }: { url: string | undefined; children: ReactNode }) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

export function RatingButtons({ event, onChanged }: { event: EventView; onChanged: () => void }) {
  const choose = (value: RatingValue) => void rate(event.id, event.rating === value ? null : value).then(onChanged, onChanged);
  return (
    <span className="rating" role="group" aria-label={`Rate ${event.title}`}>
      {ACTIONS.map((a) => (
        <button key={a.value} type="button" className={a.value} title={a.hint} aria-pressed={event.rating === a.value} onClick={() => choose(a.value)}>
          {a.label}
        </button>
      ))}
    </span>
  );
}

interface CardProps {
  event: EventView;
  onChanged: () => void;
  // The full date instead of only the time, for lists that are not grouped by day.
  showDay?: string;
  // Marks events the taste model has not got to yet.
  marksUnscored?: boolean;
  showReason?: boolean;
  extra?: ReactNode;
}

export function EventCard({ event, onChanged, showDay, marksUnscored, showReason, extra }: CardProps) {
  const place = [event.venue, event.address].filter(Boolean).join(' · ');
  const time = timeLabel(event.when);
  return (
    <li className={event.hidden ? 'event hidden' : 'event'}>
      <div className="time">
        {showDay && <span className="day">{event.ongoing ? 'Now' : dayLabel(event.when.startDate, showDay)}</span>}
        <span className={time === NO_TIME ? 'vague' : undefined}>{time}</span>
      </div>
      <div className="body">
        <h3>
          <Linked url={event.sources[0]?.url}>{event.title}</Linked>
        </h3>
        {place && <p className="place">{place}</p>}
        {showReason && event.reason ? <p className="reason">{event.reason}</p> : event.description && <p className="description">{event.description}</p>}
        <p className="facts">
          <span className="tag">{event.category}</span>
          {event.priceText && <span className={event.isFree ? 'price free' : 'price'}>{event.priceText}</span>}
          {event.moreDates > 0 && (
            <span className="more">
              +{event.moreDates} more {event.moreDates === 1 ? 'date' : 'dates'}
            </span>
          )}
          {event.hidden && <span className="more">Hidden</span>}
          {marksUnscored && event.score === null && event.rating === null && !event.hidden && <span className="more">Not scored yet</span>}
          <span className="sources">
            {event.sources.map((s) => (
              <Linked key={s.source} url={s.url}>
                {s.label}
              </Linked>
            ))}
          </span>
        </p>
        <p className="actions">
          <RatingButtons event={event} onChanged={onChanged} />
          {extra}
        </p>
      </div>
    </li>
  );
}
