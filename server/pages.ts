import { createHash, randomUUID } from 'node:crypto';
import type { Capture, FoundEvent, PagePreview } from './contract.ts';
import { today } from './dates.ts';
import type { PageSource, Store } from './db.ts';
import { embeddedItems, eventsInPicture, eventsInText, pageText, type Read, readPage } from './extract.ts';
import { ingest } from './ingest.ts';
import type { Ask, Picture } from './model.ts';
import { getText } from './sources/http.ts';
import type { FetchContext, FetchResult, Source, SourceItem } from './sources/types.ts';

// Events a person added one at a time. Nothing reads this source again, so they stay until their date passes.
export const CAPTURED = { id: 'captured', label: 'Added by you' };

const KEEP_PREVIEW_MS = 30 * 60_000;
const ANY_DAY = '0000-01-01';

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

export const pageSourceId = (id: number) => `page-${id}`;

function found(item: SourceItem): FoundEvent {
  return {
    title: item.title,
    when: item.occurrences[0]!,
    moreDates: item.occurrences.length - 1,
    venue: item.venue,
    address: item.address,
    category: item.category,
    priceText: item.priceText,
    url: item.url,
    online: item.online ?? false,
  };
}

function webAddress(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch (err) {
    throw new Error('that is not a web address', { cause: err });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http and https addresses can be read');
  return url.href;
}

export interface PagesDeps {
  ask: Ask;
  fetch: typeof fetch;
  now: () => number;
  timeZone: string;
}

export function createPages(store: Store, deps: PagesDeps) {
  const previews = new Map<string, { at: number; hash: string; read: Read }>();
  const captures = new Map<string, { at: number; item: SourceItem }>();
  const day = () => today(deps.timeZone, new Date(deps.now()));

  function forget<T extends { at: number }>(kept: Map<string, T>) {
    for (const [key, entry] of kept) if (deps.now() - entry.at > KEEP_PREVIEW_MS) kept.delete(key);
  }

  // The model reads a page only when its text has changed since the last read; otherwise what it found then stands.
  async function read(fetcher: typeof fetch, url: string, known: Pick<PageSource, 'pageHash' | 'items'> | null): Promise<{ hash: string; read: Read }> {
    const html = await getText(fetcher, url);
    const page = pageText(html, url);
    const hash = hashOf(page.text);
    const embedded = embeddedItems(html, url, day());
    if (embedded.length > 0) return { hash, read: { title: page.title, method: 'embedded', items: embedded } };
    if (known?.pageHash === hash && known.items) {
      const items = (JSON.parse(known.items) as SourceItem[])
        .map((item) => ({ ...item, occurrences: item.occurrences.filter((o) => o.endDate >= day()) }))
        .filter((item) => item.occurrences.length > 0);
      return { hash, read: { title: page.title, method: 'model', items } };
    }
    return { hash, read: await readPage(deps.ask, html, url, day()) };
  }

  function asSource(page: PageSource): Source {
    return {
      id: pageSourceId(page.id),
      label: page.label,
      home: page.url,
      async fetchItems({ fetch }: FetchContext): Promise<FetchResult> {
        const current = store.pageSources().find((p) => p.id === page.id) ?? page;
        const { hash, read: result } = await read(fetch, page.url, current);
        store.keepPage(page.id, hash, JSON.stringify(result.items));
        // A page shows its nearest events, not all of them, so one missing from it is not known to be cancelled.
        return { items: result.items, coveredUntil: day() };
      },
    };
  }

  return {
    sources: (): Source[] => store.pageSources().map(asSource),

    pageIdOf: (sourceId: string) => store.pageSources().find((p) => pageSourceId(p.id) === sourceId)?.id ?? null,

    async preview(input: string): Promise<PagePreview> {
      const url = webAddress(input);
      if (store.pageSources().some((p) => p.url === url)) throw new Error('that page is already a source');
      const result = await read(deps.fetch, url, null);
      forget(previews);
      previews.set(url, { at: deps.now(), ...result });
      return { url, label: result.read.title || new URL(url).hostname, method: result.read.method, events: result.read.items.map(found) };
    },

    // Adds a previewed page as a source and takes in what the preview found.
    async add(input: string, label: string): Promise<void> {
      const url = webAddress(input);
      const result = previews.get(url) ?? (await read(deps.fetch, url, null));
      previews.delete(url);
      const id = store.addPageSource(url, label.trim() || new URL(url).hostname);
      store.keepPage(id, result.hash, JSON.stringify(result.read.items));
      ingest(store, pageSourceId(id), { items: result.read.items, coveredUntil: day() }, { today: day(), now: deps.now() });
      store.setSourceState(pageSourceId(id), { lastOkAt: deps.now(), lastError: null, lastCount: result.read.items.length });
    },

    remove(id: number) {
      store.removePageSource(id, pageSourceId(id));
    },

    // Reads one event out of a link, pasted text or a picture, for the person to confirm.
    async capture(from: { url?: string | undefined; text?: string | undefined; picture?: Picture | undefined }): Promise<Capture> {
      // An event handed over by a person may be over already: they may want it only to say what they thought of it.
      let items: SourceItem[];
      if (from.picture) {
        items = await eventsInPicture(deps.ask, from.picture, day(), ANY_DAY);
      } else if (from.url) {
        const url = webAddress(from.url);
        const html = await getText(deps.fetch, url);
        const embedded = embeddedItems(html, url, ANY_DAY);
        items = embedded.length > 0 ? embedded : await eventsInText(deps.ask, pageText(html, url).text, url, day(), 1, ANY_DAY);
      } else if (from.text?.trim()) {
        items = await eventsInText(deps.ask, from.text.trim().slice(0, 20_000), null, day(), 1, ANY_DAY);
      } else {
        throw new Error('give a link, some text or a picture');
      }
      const item = items[0];
      if (!item) throw new Error('no event could be read from that');
      const token = randomUUID();
      forget(captures);
      captures.set(token, { at: deps.now(), item: { ...item, key: hashOf(`${item.key} ${item.occurrences[0]!.startDate}`) } });
      return { token, event: found(item) };
    },

    addCapture(token: string): boolean {
      const capture = captures.get(token);
      if (!capture) return false;
      captures.delete(token);
      // "Covered until today" removes nothing: earlier captures stay.
      ingest(store, CAPTURED.id, { items: [capture.item], coveredUntil: day() }, { today: day(), now: deps.now() });
      return true;
    },
  };
}

export type Pages = ReturnType<typeof createPages>;
