import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { type Place, WEB_DIST } from './config.ts';
import { CATEGORIES, type Category, type EventView, type Status } from './contract.ts';
import { addDays, isDate, today } from './dates.ts';
import type { Store } from './db.ts';
import { listEvents } from './listing.ts';
import type { Poller } from './poll.ts';
import type { Source } from './sources/types.ts';

export interface AppDeps {
  store: Store;
  poller: Poller;
  sources: Source[];
  place: Place;
  timeZone: string;
  now: () => number;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

const isLocal = (url: string | undefined) => {
  if (!url) return true;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

export function createApp({ store, poller, sources, place, timeZone, now }: AppDeps) {
  const app = new Hono();
  const labels = new Map(sources.map((s) => [s.id, s.label]));

  // The server has no login; it answers only pages loaded from this machine under its own name, so a website open in
  // the same browser cannot reach it through a DNS name that points here.
  app.use('/api/*', async (c, next) => {
    if (!isLocal(c.req.url) || !isLocal(c.req.header('origin'))) return c.json({ error: 'not allowed' }, 403);
    return next();
  });

  const status = (): Status => ({
    polling: poller.polling,
    place: { name: place.name, radiusKm: place.radiusKm },
    sources: sources.map((s) => ({ id: s.id, label: s.label, ...store.sourceState(s.id) })),
  });

  app.get('/api/events', (c) => {
    const from = c.req.query('from') ?? today(timeZone, new Date(now()));
    const to = c.req.query('to') ?? (isDate(from) ? addDays(from, 6) : '');
    if (!isDate(from) || !isDate(to) || to < from) return c.json({ error: 'from and to must be dates, from first' }, 400);
    const categories = (c.req.queries('category') ?? []).filter((v): v is Category => CATEGORIES.some((known) => known === v));
    const events: EventView[] = listEvents(store.upcoming(from), labels, {
      from,
      to,
      categories,
      freeOnly: c.req.query('free') === '1',
      place,
    });
    return c.json({ from, to, events });
  });

  app.get('/api/status', (c) => c.json(status()));

  app.post('/api/refresh', (c) => {
    void poller.run(true);
    return c.json(status(), 202);
  });

  app.use('/*', serveStatic({ root: WEB_DIST }));

  return app;
}
