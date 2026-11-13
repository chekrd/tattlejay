import type { Status } from '../../server/contract.ts';
import { agoLabel } from './dates.ts';

export function Sources({ status, onRefresh }: { status: Status; onRefresh: () => void }) {
  const now = Date.now();
  return (
    <section className="panel">
      <h2 className="plain">Sources</h2>
      <p className="hint">Each source is read once a day, the first time the app runs that day. A source that fails keeps the events it gave last time.</p>
      <table className="sources-table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Last read</th>
            <th scope="col" className="number">
              Events
            </th>
          </tr>
        </thead>
        <tbody>
          {status.sources.map((s) => (
            <tr key={s.id}>
              <th scope="row">
                <a href={s.home} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
                {s.lastError && <span className="warn problem">Could not be read: {s.lastError}</span>}
              </th>
              <td>{s.lastOkAt ? agoLabel(s.lastOkAt, now) : 'Never'}</td>
              <td className="number">{s.lastCount ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button type="button" onClick={onRefresh} disabled={status.polling}>
          {status.polling ? 'Reading sources…' : 'Read all now'}
        </button>
      </div>
    </section>
  );
}
