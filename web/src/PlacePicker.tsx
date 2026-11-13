import { type FormEvent, useState } from 'react';
import type { PlaceView, Visit } from '../../server/contract.ts';
import { visit } from './api.ts';

interface Props {
  places: PlaceView[];
  placeId: number;
  onPick: (placeId: number) => void;
  onChanged: () => void;
}

const ELSEWHERE = 'elsewhere';

// Shows where the listing is looking, and lets the person look at another city.
export function PlacePicker({ places, placeId, onPick, onChanged }: Props) {
  const [asking, setAsking] = useState(false);
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ warn: boolean; text: string } | null>(null);

  const look = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    void visit(city)
      .then((found: Visit) => {
        setNote({ warn: false, text: found.found.map((f) => `${f.label}: ${f.note ?? `${f.count} events`}`).join(' · ') });
        setAsking(false);
        setCity('');
        onPick(found.place.id);
        onChanged();
      })
      .catch((err: unknown) => setNote({ warn: true, text: err instanceof Error ? err.message : String(err) }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="where">
      <select
        aria-label="Place"
        value={asking ? ELSEWHERE : String(placeId)}
        onChange={(e) => {
          setNote(null);
          if (e.target.value === ELSEWHERE) return setAsking(true);
          setAsking(false);
          onPick(Number(e.target.value));
        }}
      >
        {places.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} + {p.radiusKm} km
          </option>
        ))}
        <option value={ELSEWHERE}>Another city…</option>
      </select>
      {asking && (
        <form onSubmit={look}>
          <input aria-label="City to look at" placeholder="Praha, Olomouc, Bratislava…" value={city} disabled={busy} onChange={(e) => setCity(e.target.value)} />
          <button type="submit" className="small" disabled={busy || city.trim().length < 2}>
            {busy ? 'Looking…' : 'Look'}
          </button>
        </form>
      )}
      {busy && <span className="note">Reading what is on there. This takes up to a minute.</span>}
      {note && <span className={note.warn ? 'note warn' : 'note'}>{note.text}</span>}
    </div>
  );
}
