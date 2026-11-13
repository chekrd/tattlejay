import { type ClipboardEvent, type DragEvent, type FormEvent, useState } from 'react';
import type { Capture, FoundEvent, PagePreview, Status } from '../../server/contract.ts';
import { addCapture, addPage, capture, previewPage, removePage } from './api.ts';
import { agoLabel, dayLabel, timeLabel } from './dates.ts';
import { Linked } from './EventCard.tsx';

const SHOWN_IN_PREVIEW = 12;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function Found({ event, today }: { event: FoundEvent; today: string }) {
  return (
    <li>
      <span className="what">
        <Linked url={event.url}>{event.title}</Linked>
        <span className="where">
          {[dayLabel(event.when.startDate, today), timeLabel(event.when), event.online ? 'Online' : (event.venue ?? event.address), event.category, event.priceText, event.moreDates > 0 ? `+${event.moreDates} more dates` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </li>
  );
}

function AddPage({ today, onStatus, onChanged }: { today: string; onStatus: (status: Status) => void; onChanged: () => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const work = (job: Promise<void>) => {
    setBusy(true);
    setFailure(null);
    void job.catch((err: unknown) => setFailure(reason(err))).finally(() => setBusy(false));
  };

  const read = (e: FormEvent) => {
    e.preventDefault();
    work(
      previewPage(url).then((found) => {
        setPreview(found);
        setLabel(found.label);
      }),
    );
  };

  const accept = () =>
    preview &&
    work(
      addPage(preview.url, label).then((status) => {
        onStatus(status);
        onChanged();
        setPreview(null);
        setUrl('');
      }),
    );

  return (
    <section className="panel">
      <h2 className="plain">Add a source</h2>
      <p className="hint">Paste the address of a programme or events page. You see what can be read from it before it is added; after that it is read once a day.</p>
      <form className="row" onSubmit={read}>
        <input type="url" aria-label="Address of an events page" placeholder="https://…" value={url} disabled={busy || preview !== null} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" disabled={busy || preview !== null || url.trim() === ''}>
          {busy && !preview ? 'Reading the page…' : 'Read it'}
        </button>
      </form>
      {failure && <p className="note warn">That did not work: {failure}</p>}
      {preview && (
        <div className="preview">
          <p className="hint">
            {preview.events.length === 0
              ? 'No upcoming events could be read from this page.'
              : `${preview.events.length} upcoming ${preview.events.length === 1 ? 'event' : 'events'} found, ${preview.method === 'embedded' ? 'from data the page publishes' : 'read from the page text by the model'}.`}
          </p>
          <ul className="starter">
            {preview.events.slice(0, SHOWN_IN_PREVIEW).map((event) => (
              <Found key={`${event.title} ${event.when.startDate}`} event={event} today={today} />
            ))}
          </ul>
          {preview.events.length > SHOWN_IN_PREVIEW && <p className="hint">…and {preview.events.length - SHOWN_IN_PREVIEW} more.</p>}
          <div className="row">
            <input aria-label="Name for this source" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button type="button" onClick={accept} disabled={busy || preview.events.length === 0}>
              {busy ? 'Adding…' : 'Add this source'}
            </button>
            <button type="button" onClick={() => setPreview(null)} disabled={busy}>
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const asDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('the picture could not be read')));
    reader.onerror = () => reject(new Error('the picture could not be read'));
    reader.readAsDataURL(file);
  });

function AddEvent({ today, onChanged }: { today: string; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Capture | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ warn: boolean; text: string } | null>(null);

  const read = (from: Promise<{ url?: string; text?: string; picture?: string }>) => {
    setBusy(true);
    setNote(null);
    void from
      .then(capture)
      .then(setFound)
      .catch((err: unknown) => setNote({ warn: true, text: `That did not work: ${reason(err)}` }))
      .finally(() => setBusy(false));
  };

  const readText = (e: FormEvent) => {
    e.preventDefault();
    const pasted = text.trim();
    read(Promise.resolve(/^https?:\/\/\S+$/.test(pasted) ? { url: pasted } : { text: pasted }));
  };

  const readPicture = (file: File | null | undefined) => {
    if (file?.type.startsWith('image/')) read(asDataUrl(file).then((picture) => ({ picture })));
  };

  const onPaste = (e: ClipboardEvent) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    readPicture(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    readPicture(e.dataTransfer.files[0]);
  };

  const accept = () =>
    found &&
    void addCapture(found.token).then(
      () => {
        setNote({ warn: false, text: `Added: ${found.event.title}. It is in the listing on its date, and under History until you rate it.` });
        setFound(null);
        setText('');
        onChanged();
      },
      (err: unknown) => setNote({ warn: true, text: `That did not work: ${reason(err)}` }),
    );

  return (
    <section className="panel" onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <h2 className="plain">Add one event</h2>
      <p className="hint">For events that live where the app cannot look, such as Facebook or Instagram. Paste a link or the event's text, or paste or drop a screenshot or poster.</p>
      <form onSubmit={readText}>
        <textarea aria-label="A link or the text of an event" rows={3} placeholder="A link, or the text of the event" value={text} disabled={busy || found !== null} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button type="submit" disabled={busy || found !== null || text.trim() === ''}>
            {busy ? 'Reading…' : 'Read it'}
          </button>
          <label className="file">
            or choose a picture
            <input type="file" accept="image/*" disabled={busy || found !== null} onChange={(e) => readPicture(e.target.files?.[0])} />
          </label>
        </div>
      </form>
      {note && <p className={note.warn ? 'note warn' : 'note'}>{note.text}</p>}
      {found && (
        <div className="preview">
          <ul className="starter">
            <Found event={found.event} today={today} />
          </ul>
          <div className="row">
            <button type="button" onClick={accept}>
              Add to my listing
            </button>
            <button type="button" onClick={() => setFound(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

interface Props {
  status: Status;
  today: string;
  onRefresh: () => void;
  onStatus: (status: Status) => void;
  onChanged: () => void;
}

export function Sources({ status, today, onRefresh, onStatus, onChanged }: Props) {
  const now = Date.now();
  const remove = (id: number) =>
    void removePage(id).then((next) => {
      onStatus(next);
      onChanged();
    });

  return (
    <>
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
              <td />
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
                <td>{s.lastOkAt ? agoLabel(s.lastOkAt, now) : 'Not yet'}</td>
                <td className="number">{s.lastCount ?? '–'}</td>
                <td className="number">
                  {s.pageId !== null && (
                    <button type="button" className="small" onClick={() => remove(s.pageId!)}>
                      Remove
                    </button>
                  )}
                </td>
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
      <AddPage today={today} onStatus={onStatus} onChanged={onChanged} />
      <AddEvent today={today} onChanged={onChanged} />
    </>
  );
}
