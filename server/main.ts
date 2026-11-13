import { setTimeout as pause } from 'node:timers/promises';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { CLAUDE_COMMAND, CLAUDE_CWD, CLAUDE_MODEL, CLAUDE_TIMEOUT_MS, DB_PATH, HOST, PLACE, POLL_EVERY_MS, PORT, TIME_ZONE } from './config.ts';
import { openStore } from './db.ts';
import { claudeCli } from './model.ts';
import { createPages } from './pages.ts';
import { createPoller } from './poll.ts';
import { SOURCES } from './sources/index.ts';
import { createTaste } from './taste.ts';
import { createVisits } from './visit.ts';

process.on('unhandledRejection', (err) => console.error('unhandled rejection', err));

const store = openStore(DB_PATH);
const ask = claudeCli({ command: CLAUDE_COMMAND, cwd: CLAUDE_CWD, model: CLAUDE_MODEL, timeoutMs: CLAUDE_TIMEOUT_MS });
const taste = createTaste(store, { ask, now: Date.now, timeZone: TIME_ZONE });
const pages = createPages(store, { ask, fetch, now: Date.now, timeZone: TIME_ZONE });
const visits = createVisits(store, { ask, fetch, pause: (ms) => pause(ms), now: Date.now, timeZone: TIME_ZONE, home: PLACE });
// The built-in sources first, so the pages added by address merge into their events.
const sources = () => [...SOURCES, ...pages.sources()];
const poller = createPoller(store, sources, {
  fetch,
  pause: (ms) => pause(ms),
  now: Date.now,
  place: PLACE,
  timeZone: TIME_ZONE,
  everyMs: POLL_EVERY_MS,
  // The day's model work follows the day's reading, once.
  afterPoll: () => {
    if (taste.due()) void taste.run();
  },
});
const app = createApp({ store, poller, taste, pages, visits, sources, timeZone: TIME_ZONE, now: Date.now });

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  console.log(`tattlejay listening on http://${HOST}:${PORT}`);
  // Catch up now, then look again every half hour: a timer does not run while the Mac sleeps, so the first look after
  // it wakes picks up whatever came due meanwhile.
  void poller.run();
  setInterval(() => void poller.run(), 30 * 60_000);
});
