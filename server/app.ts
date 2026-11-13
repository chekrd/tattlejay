import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { z } from 'zod';
import { toIcs } from './calendar.ts';
import { WEB_DIST } from './config.ts';
import { CATEGORIES, type Category, RATING_VALUES, type Status } from './contract.ts';
import { addDays, isDate, today } from './dates.ts';
import type { Store } from './db.ts';
import { type ListQuery, listEvents, type Opinions, pickEvents, starterEvents } from './listing.ts';
import type { Picture } from './model.ts';
import { CAPTURED, type Pages } from './pages.ts';
import type { Poller } from './poll.ts';
import type { Source } from './sources/types.ts';
import type { TasteService } from './taste.ts';
import { VISIT_LABELS, type Visits } from './visit.ts';

export interface AppDeps {
  store: Store;
  poller: Poller;
  taste: TasteService;
  pages: Pages;
  visits: Visits;
  sources: () => Source[];
  timeZone: string;
  now: () => number;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const FAR = '9999-12-31';
const STARTER_COUNT = 30;
const STARTER_DAYS = 60;

const isLocal = (url: string | undefined) => {
  if (!url) return true;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

const RatingBody = z.object({ value: z.enum(RATING_VALUES).nullable() });
const TasteBody = z.object({ seed: z.string().max(2000).optional(), profile: z.string().max(4000).optional() });
const RuleBody = z.object({ text: z.string().trim().min(2).max(80), verdict: z.enum(['always', 'never']) });
const PageBody = z.object({ url: z.string().min(1).max(2000), label: z.string().max(120).optional() });
const CaptureBody = z.object({ url: z.string().max(2000).optional(), text: z.string().max(40_000).optional(), picture: z.string().max(12_000_000).optional() });
const TokenBody = z.object({ token: z.string().min(1) });
const VisitBody = z.object({ city: z.string().trim().min(2).max(80) });

// A picture arrives as a data URL, as the browser reads a pasted or dropped image.
function pictureOf(dataUrl: string | undefined): Picture | undefined {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/.exec(dataUrl ?? '');
  return m ? { data: Buffer.from(m[2]!, 'base64'), extension: m[1] === 'jpeg' ? 'jpg' : m[1]! } : undefined;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createApp({ store, poller, taste, pages, visits, sources, timeZone, now }: AppDeps) {
  const app = new Hono();
  // A source read for a visited city is named by what it is, whichever city it was read for.
  const labels = () => {
    const known = new Map([...sources().map((s): [string, string] => [s.id, s.label]), [CAPTURED.id, CAPTURED.label]]);
    return { get: (source: string) => known.get(source) ?? VISIT_LABELS.find(([prefix]) => source.startsWith(prefix))?.[1] };
  };

  // The place a request asks about; home when it names none or one that is not known.
  const placeOf = (id: string | undefined) => visits.placeOf(Number(id ?? 0)) ?? visits.placeOf(0);
  const day = () => today(timeZone, new Date(now()));

  // The server has no login; it answers only pages loaded from this machine under its own name, so a website open in
  // the same browser cannot reach it through a DNS name that points here.
  app.use('/api/*', async (c, next) => {
    if (!isLocal(c.req.url) || !isLocal(c.req.header('origin'))) return c.json({ error: 'not allowed' }, 403);
    return next();
  });

  const opinions = (): Opinions => ({ ratings: store.ratings(), scores: store.scores(taste.profileVersion()), rules: store.rules() });

  const list = (q: Partial<ListQuery> & Pick<ListQuery, 'from' | 'to' | 'place'>) =>
    listEvents(store.upcoming(q.from), labels(), opinions(), { categories: [], freeOnly: false, ...q });

  const status = (): Status => ({
    polling: poller.polling,
    places: visits.places(),
    sources: sources().map((s) => ({ id: s.id, label: s.label, home: s.home, pageId: pages.pageIdOf(s.id), ...store.sourceState(s.id) })),
    taste: taste.status(),
  });

  app.get('/api/events', (c) => {
    const from = c.req.query('from') ?? day();
    const to = c.req.query('to') ?? (isDate(from) ? addDays(from, 6) : '');
    if (!isDate(from) || !isDate(to) || to < from) return c.json({ error: 'from and to must be dates, from first' }, 400);
    const categories = (c.req.queries('category') ?? []).filter((v): v is Category => CATEGORIES.some((known) => known === v));
    const events = list({ from, to, categories, freeOnly: c.req.query('free') === '1', withHidden: c.req.query('hidden') === '1', place: placeOf(c.req.query('place')) });
    return c.json({ from, to, events });
  });

  // Plans are kept wherever they are.
  app.get('/api/plans', (c) => c.json({ events: list({ from: day(), to: FAR, savedOnly: true, place: null }) }));

  app.get('/api/picks', (c) => c.json(pickEvents(list({ from: day(), to: FAR, place: placeOf(c.req.query('place')) }), day())));

  app.get('/api/starter', (c) =>
    c.json({ events: starterEvents(list({ from: day(), to: addDays(day(), STARTER_DAYS), place: placeOf(c.req.query('place')) }), STARTER_COUNT) }),
  );

  app.post('/api/visit', async (c) => {
    const body = VisitBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'name a city' }, 400);
    try {
      const visit = await visits.visit(body.data.city);
      // The new events are scored at once: the person asked for this city now.
      void taste.run();
      return c.json(visit);
    } catch (err) {
      return c.json({ error: message(err) }, 422);
    }
  });

  app.put('/api/events/:id/rating', async (c) => {
    const body = RatingBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'value must be like, dislike, save or null' }, 400);
    if (!taste.rate(Number(c.req.param('id')), body.data.value)) return c.json({ error: 'no such event' }, 404);
    return c.json({ ok: true });
  });

  app.get('/api/events/:id/calendar.ics', (c) => {
    const id = Number(c.req.param('id'));
    const event = list({ from: day(), to: FAR, withHidden: true, place: null }).find((e) => e.id === id);
    if (!event) return c.json({ error: 'no such event' }, 404);
    return c.body(toIcs(event, timeZone, now()), 200, {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="event-${id}.ics"`,
    });
  });

  app.get('/api/taste', (c) => c.json(taste.taste()));

  app.put('/api/taste', async (c) => {
    const body = TasteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'seed and profile must be text' }, 400);
    if (body.data.seed !== undefined) taste.setSeed(body.data.seed.trim());
    if (body.data.profile !== undefined) taste.editProfile(body.data.profile.trim());
    return c.json(taste.taste());
  });

  app.post('/api/taste/rules', async (c) => {
    const body = RuleBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'a rule needs a text of 2 to 80 characters and always or never' }, 400);
    store.addRule(body.data.text, body.data.verdict);
    return c.json(taste.taste());
  });

  app.delete('/api/taste/rules/:id', (c) => {
    store.removeRule(Number(c.req.param('id')));
    return c.json(taste.taste());
  });

  app.post('/api/taste/refresh', (c) => {
    void taste.run();
    return c.json(status(), 202);
  });

  app.post('/api/sources/preview', async (c) => {
    const body = PageBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'give the address of a page' }, 400);
    try {
      return c.json(await pages.preview(body.data.url));
    } catch (err) {
      return c.json({ error: message(err) }, 422);
    }
  });

  app.post('/api/sources', async (c) => {
    const body = PageBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'give the address of a page' }, 400);
    try {
      await pages.add(body.data.url, body.data.label ?? '');
      return c.json(status());
    } catch (err) {
      return c.json({ error: message(err) }, 422);
    }
  });

  app.delete('/api/sources/:id', (c) => {
    pages.remove(Number(c.req.param('id')));
    return c.json(status());
  });

  app.post('/api/capture', async (c) => {
    const body = CaptureBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'give a link, some text or a picture' }, 400);
    try {
      return c.json(await pages.capture({ url: body.data.url, text: body.data.text, picture: pictureOf(body.data.picture) }));
    } catch (err) {
      return c.json({ error: message(err) }, 422);
    }
  });

  app.post('/api/capture/add', async (c) => {
    const body = TokenBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success || !pages.addCapture(body.data.token)) return c.json({ error: 'that capture has expired; read it again' }, 410);
    return c.json({ ok: true });
  });

  app.get('/api/status', (c) => c.json(status()));

  app.post('/api/refresh', (c) => {
    void poller.run(true);
    return c.json(status(), 202);
  });

  app.use('/*', serveStatic({ root: WEB_DIST }));

  return app;
}
