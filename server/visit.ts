import type { Place } from './config.ts';
import type { PlaceView, Visit } from './contract.ts';
import { today } from './dates.ts';
import type { Store } from './db.ts';
import { eventsInText, pageText } from './extract.ts';
import { ingest } from './ingest.ts';
import type { ListedPlace } from './listing.ts';
import type { Ask } from './model.ts';
import { findGooutCity, readGoout } from './sources/goout.ts';
import { getText } from './sources/http.ts';
import type { SourceItem } from './sources/types.ts';
import { titleKey } from './text.ts';

const RADIUS_KM = 30;
// A visit looks a month ahead; a home source looks half a year.
const GOOUT_LIMITS = { horizonDays: 30, maxPages: 10 };

// GoOut's numbers for the cities it features, as its own listings report them.
const GOOUT_CITIES: Record<string, number> = {
  praha: 101748113,
  prague: 101748113,
  brno: 101748109,
  plzen: 101748111,
  pilsen: 101748111,
  pardubice: 101748115,
  'ceske budejovice': 101748103,
  bratislava: 1108800123,
  nitra: 101752049,
  varsava: 101752777,
  warszawa: 101752777,
  warsaw: 101752777,
  krakov: 101752117,
  krakow: 101752117,
  berlin: 101909779,
};

// Kudy z nudy lists by municipality code. The regional capitals, with their centres for when nothing else places them.
// A code is trusted only once the page it opens names the city.
const KUDY_CITIES: Record<string, { code: number; lat: number; lon: number }> = {
  praha: { code: 554782, lat: 50.0755, lon: 14.4378 },
  ostrava: { code: 554821, lat: 49.8209, lon: 18.2625 },
  plzen: { code: 554791, lat: 49.7384, lon: 13.3736 },
  liberec: { code: 563889, lat: 50.7663, lon: 15.0543 },
  olomouc: { code: 500496, lat: 49.5938, lon: 17.2509 },
  'ceske budejovice': { code: 544256, lat: 48.9745, lon: 14.4743 },
  'hradec kralove': { code: 569810, lat: 50.2092, lon: 15.8328 },
  'usti nad labem': { code: 554804, lat: 50.6607, lon: 14.0323 },
  pardubice: { code: 555134, lat: 50.0343, lon: 15.7812 },
  zlin: { code: 585068, lat: 49.2265, lon: 17.6707 },
  jihlava: { code: 586846, lat: 49.3961, lon: 15.5912 },
  'karlovy vary': { code: 554961, lat: 50.2319, lon: 12.872 },
};

export const VISIT_LABELS: [prefix: string, label: string][] = [
  ['goout:', 'GoOut'],
  ['kudyznudy:', 'Kudy z nudy'],
];

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

export interface VisitDeps {
  ask: Ask;
  fetch: typeof fetch;
  pause: (ms: number) => Promise<void>;
  now: () => number;
  timeZone: string;
  home: Place;
}

export function createVisits(store: Store, deps: VisitDeps) {
  const day = () => today(deps.timeZone, new Date(deps.now()));
  const homeView: PlaceView = { id: 0, name: deps.home.name, radiusKm: deps.home.radiusKm };

  async function gooutCity(name: string): Promise<number | undefined> {
    const key = titleKey(name);
    const known = GOOUT_CITIES[key] ?? Number(store.setting(`goout_city:${key}`) ?? 0);
    if (known) return known;
    const found = await findGooutCity(deps, name, ['cz', 'sk'], 4);
    if (found) store.setSetting(`goout_city:${key}`, String(found));
    return found;
  }

  return {
    places: (): PlaceView[] => [homeView, ...store.places().map((p) => ({ id: p.id, name: p.name, radiusKm: p.radiusKm }))],

    // Null for a place that is not known, so a stale link falls back to home.
    placeOf(id: number): ListedPlace | null {
      if (id === 0) return { id: 0, lat: deps.home.lat, lon: deps.home.lon, radiusKm: deps.home.radiusKm };
      return store.places().find((p) => p.id === id) ?? null;
    },

    // Fetches what the sources that cover many cities list for this one, takes it in, and remembers the place.
    async visit(input: string): Promise<Visit> {
      const typed = input.trim().replace(/\s+/g, ' ');
      const key = titleKey(typed);
      // A city looked at before keeps the name it was first given, however it is typed now.
      const name = store.places().find((p) => titleKey(p.name) === key)?.name ?? typed.replace(/(^|[\s-])\p{L}/gu, (start) => start.toUpperCase());
      if (key.length < 2) throw new Error('name a city');
      if (key === titleKey(deps.home.name)) throw new Error(`${deps.home.name} is home`);
      const context = { fetch: deps.fetch, pause: deps.pause, today: day() };
      const found: Visit['found'] = [];
      const taken: { source: string; items: SourceItem[] }[] = [];

      const cityId = await gooutCity(name).catch(() => undefined);
      if (cityId === undefined) {
        found.push({ label: 'GoOut', count: 0, note: 'lists nothing for this city in the coming weeks' });
      } else {
        try {
          const { items } = await readGoout(context, cityId, GOOUT_LIMITS);
          taken.push({ source: `goout:${cityId}`, items });
          found.push({ label: 'GoOut', count: items.length, note: null });
        } catch (err) {
          found.push({ label: 'GoOut', count: 0, note: `could not be read: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      const placed = taken.flatMap((t) => t.items).filter((i) => i.lat !== null && i.lon !== null);
      const kudy = KUDY_CITIES[key];
      const centre = placed.length >= 3 ? { lat: median(placed.map((i) => i.lat!)), lon: median(placed.map((i) => i.lon!)) } : kudy;

      if (!kudy) {
        found.push({ label: 'Kudy z nudy', count: 0, note: 'is read only for Czech regional capitals' });
      } else if (centre) {
        try {
          const url = `https://www.kudyznudy.cz/kalendar-akci?mesto=${kudy.code}`;
          const page = pageText(await getText(deps.fetch, url), url);
          if (!titleKey(page.title).includes(key)) throw new Error('its page for this city could not be confirmed');
          const items = await eventsInText(deps.ask, page.text, url, day());
          taken.push({ source: `kudyznudy:${kudy.code}`, items });
          found.push({ label: 'Kudy z nudy', count: items.length, note: null });
        } catch (err) {
          found.push({ label: 'Kudy z nudy', count: 0, note: `could not be read: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      if (!centre || taken.every((t) => t.items.length === 0)) throw new Error(`nothing could be found for ${name}: ${found.map((f) => `${f.label} ${f.note ?? 'had nothing'}`).join('; ')}`);
      // A visit reads a month, not everything: what it does not see is not known to be cancelled.
      const id = store.savePlace({ name, lat: centre.lat, lon: centre.lon, radiusKm: RADIUS_KM }, deps.now());
      for (const { source, items } of taken) ingest(store, source, { items, coveredUntil: day() }, { today: day(), now: deps.now(), placeId: id });
      return { place: { id, name, radiusKm: RADIUS_KM }, found };
    },
  };
}

export type Visits = ReturnType<typeof createVisits>;
