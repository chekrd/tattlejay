import { fetchPlans } from './api.ts';
import { EventCard } from './EventCard.tsx';
import { useLoad } from './hooks.ts';

export function Plans({ today, revision, onChanged }: { today: string; revision: number; onChanged: () => void }) {
  const plans = useLoad(fetchPlans, `plans ${revision}`);
  if (plans.error) return <p className="empty warn">Your plans could not be loaded: {plans.error}</p>;
  if (!plans.data) return <p className="empty">Loading…</p>;
  if (plans.data.length === 0) return <p className="empty">Nothing saved yet. Save an event and it shows up here.</p>;
  return (
    <ul className="plans">
      {plans.data.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          onChanged={onChanged}
          showDay={today}
          extra={
            <a className="calendar" href={`/api/events/${event.id}/calendar.ics`}>
              Add to calendar
            </a>
          }
        />
      ))}
    </ul>
  );
}
