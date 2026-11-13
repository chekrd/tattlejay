import { type FormEvent, useState } from 'react';
import type { Rule, Status, Taste } from '../../server/contract.ts';
import { addRule, fetchStarter, fetchTaste, removeRule, saveTaste } from './api.ts';
import { agoLabel, dayLabel } from './dates.ts';
import { Linked, RatingButtons } from './EventCard.tsx';
import { useLoad } from './hooks.ts';

const STARTER_GOAL = 30;

// A text box that starts from the saved text and offers Save only once it differs.
function Editable({ saved, rows, placeholder, label, onSave }: { saved: string; rows: number; placeholder: string; label: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved;
  return (
    <>
      <textarea aria-label={label} rows={rows} value={text} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} />
      <div className="row">
        <button
          type="button"
          disabled={text.trim() === saved}
          onClick={() => {
            onSave(text.trim());
            setDraft(null);
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

function Rules({ rules, onChange }: { rules: Rule[]; onChange: (work: Promise<Taste>) => void }) {
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<Rule['verdict']>('always');
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 2) return;
    onChange(addRule(text.trim(), verdict));
    setText('');
  };
  return (
    <>
      {rules.length > 0 && (
        <ul className="rules">
          {rules.map((rule) => (
            <li key={rule.id}>
              <span>
                <strong>{rule.verdict === 'always' ? 'Always' : 'Never'}</strong> {rule.text}
              </span>
              <button type="button" onClick={() => onChange(removeRule(rule.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={add}>
        <select aria-label="Rule" value={verdict} onChange={(e) => setVerdict(e.target.value === 'never' ? 'never' : 'always')}>
          <option value="always">Always show</option>
          <option value="never">Never show</option>
        </select>
        <input aria-label="Venue or performer" value={text} placeholder="A venue or performer, e.g. Kabinet múz" onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={text.trim().length < 2}>
          Add
        </button>
      </form>
    </>
  );
}

interface Props {
  today: string;
  status: Status | null;
  revision: number;
  onChanged: () => void;
  onRefreshPicks: () => void;
}

export function TastePanel({ today, status, revision, onChanged, onRefreshPicks }: Props) {
  const taste = useLoad(fetchTaste, `taste ${revision}`);
  const starter = useLoad(fetchStarter, `starter ${revision}`);
  const [failure, setFailure] = useState<string | null>(null);

  const apply = (work: Promise<Taste>) =>
    void work.then(
      () => {
        setFailure(null);
        onChanged();
      },
      (err: unknown) => setFailure(err instanceof Error ? err.message : String(err)),
    );

  if (taste.error) return <p className="empty warn">Your taste could not be loaded: {taste.error}</p>;
  if (!taste.data) return <p className="empty">Loading…</p>;
  const { seed, profile, rules, rated } = taste.data;
  const run = status?.taste;

  return (
    <div className="taste">
      {failure && <p className="note warn">That could not be saved: {failure}</p>}

      <section className="panel">
        <h2 className="plain">In your own words</h2>
        <p className="hint">A sentence or two about what you go to, and what you never would.</p>
        <Editable key={`seed ${seed}`} saved={seed} rows={3} label="What you like, in your own words" placeholder="Small club gigs, documentary film, talks about cities. Not musicals." onSave={(text) => apply(saveTaste({ seed: text }))} />
      </section>

      <section className="panel">
        <h2 className="plain">
          Rate some real events <span className="count">{rated} rated</span>
        </h2>
        <p className="hint">
          {rated < STARTER_GOAL
            ? `About ${STARTER_GOAL} ratings give the picks something to stand on. These are spread across categories.`
            : 'More ratings keep sharpening the picks. You can also rate anywhere in the listing.'}
        </p>
        {starter.data && starter.data.length > 0 ? (
          <ul className="starter">
            {starter.data.map((event) => (
              <li key={event.id}>
                <span className="what">
                  <Linked url={event.sources[0]?.url}>{event.title}</Linked>
                  <span className="where">{[event.category, event.venue, dayLabel(event.when.startDate, today)].filter(Boolean).join(' · ')}</span>
                </span>
                <RatingButtons event={event} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Nothing left to rate here; the listing has more.</p>
        )}
      </section>

      <section className="panel">
        <h2 className="plain">Your taste profile</h2>
        <p className="hint">Written from your words and ratings, and used to score every event. Edit it when it gets you wrong; your edit stands until new ratings refine it.</p>
        <Editable key={`profile ${profile}`} saved={profile} rows={8} label="Your taste profile" placeholder="Not written yet. Say what you like above or rate some events, then make your picks." onSave={(text) => apply(saveTaste({ profile: text }))} />
        <div className="row">
          <button type="button" onClick={onRefreshPicks} disabled={run?.running ?? true}>
            {profile ? 'Refresh my picks' : 'Make my picks'}
          </button>
          <span className="hint">
            {run?.running
              ? run.progress && run.progress.total > 0
                ? `Scoring events: ${run.progress.done} of ${run.progress.total}…`
                : 'Working…'
              : run?.error
                ? <span className="warn">Last run failed: {run.error}</span>
                : run?.stale
                  ? 'Your words, ratings or new events are not in the picks yet.'
                  : profile && run?.lastRunAt
                    ? `Up to date, run ${agoLabel(run.lastRunAt, Date.now())}.`
                    : ''}
          </span>
        </div>
      </section>

      <section className="panel">
        <h2 className="plain">Always and never</h2>
        <p className="hint">A venue or performer you always want to see, or never. Matched against event titles and venues.</p>
        <Rules rules={rules} onChange={apply} />
      </section>
    </div>
  );
}
