import { TIME_ZONE } from '../config.ts';
import type { When } from '../contract.ts';
import { localOf } from '../dates.ts';
import { embeddedEvents, str } from '../jsonld.ts';
import { collapse, plainText, titleKey } from '../text.ts';
import { getText } from './http.ts';
import { byStart, type FetchContext, type FetchResult, type Source, type SourceItem, type Venue } from './types.ts';

interface Screening {
  // Screenings sharing a key are showtimes of one film.
  key: string;
  title: string;
  url: string;
  when: When;
}

// A cinema's listing is one row per screening; a film is one item with its showtimes.
function films(screenings: Screening[], venue: Venue, today: string): SourceItem[] {
  const byFilm = new Map<string, SourceItem>();
  for (const s of [...screenings].sort((a, b) => byStart(a.when, b.when))) {
    if (s.when.startDate < today) continue;
    const item = byFilm.get(s.key);
    if (item) {
      if (!item.occurrences.some((o) => o.startDate === s.when.startDate && o.startTime === s.when.startTime)) item.occurrences.push(s.when);
      continue;
    }
    byFilm.set(s.key, {
      key: s.key,
      title: s.title,
      ...venue,
      category: 'Film',
      tags: [],
      priceText: null,
      isFree: null,
      url: s.url,
      description: null,
      imageUrl: null,
      occurrences: [s.when],
    });
  }
  return [...byFilm.values()];
}

const SCALA: Venue = { venue: 'Univerzitní kino Scala', address: 'Moravské nám. 127/3, Brno', lat: null, lon: null };
const SCALA_HOME = 'https://www.kinoscala.cz/';

// Scala's front page embeds one schema.org event per screening.
export function scalaItems(html: string, today: string): SourceItem[] {
  const screenings: Screening[] = [];
  for (const event of embeddedEvents(html)) {
    const title = str(event.name);
    const at = localOf(str(event.startDate), TIME_ZONE);
    if (!title || !at) continue;
    screenings.push({
      key: titleKey(plainText(title)),
      title: collapse(plainText(title)),
      url: str(event.url) ?? SCALA_HOME,
      when: { startDate: at.date, startTime: at.time, endDate: at.date, endTime: null },
    });
  }
  return films(screenings, SCALA, today);
}

export const scala: Source = {
  id: 'kino-scala',
  label: 'Kino Scala',
  home: SCALA_HOME,
  neverEmpty: true,
  fetchItems: async ({ fetch, today }: FetchContext): Promise<FetchResult> => ({ items: scalaItems(await getText(fetch, SCALA_HOME), today), coveredUntil: null }),
};

const ART: Venue = { venue: 'Kino Art', address: 'Cihlářská 19, Brno', lat: 49.2043, lon: 16.6036 };
const ART_PROGRAMME = 'https://www.kinoart.cz/cs/program';
// A screening's address carries the film, day and time: /cs/program/<film>/2026/11/22/1545
const ART_SCREENING = /<a\b[^>]*href="(https:\/\/www\.kinoart\.cz\/cs\/program\/([^/"]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})(\d{2}))"[^>]*>([\s\S]*?)<\/a>/g;

export function kinoArtItems(html: string, today: string): SourceItem[] {
  const titles = new Map<string, string>();
  const screenings = new Map<string, Screening>();
  for (const [, url = '', film = '', year, month, day, hour, minute, inner = ''] of html.matchAll(ART_SCREENING)) {
    // Each screening is linked several times: from its poster, its time and its title. Only the title has words.
    const text = plainText(inner);
    if (text.length > (titles.get(film)?.length ?? 0) && !/^\d{1,2}:\d{2}$/.test(text) && !/^více/i.test(text)) titles.set(film, text);
    const date = `${year}-${month}-${day}`;
    screenings.set(url, { key: film, title: film, url, when: { startDate: date, startTime: `${hour}:${minute}`, endDate: date, endTime: null } });
  }
  const named = [...screenings.values()].flatMap((s) => {
    const title = titles.get(s.key);
    return title ? [{ ...s, title }] : [];
  });
  return films(named, ART, today);
}

export const kinoArt: Source = {
  id: 'kino-art',
  label: 'Kino Art',
  home: ART_PROGRAMME,
  neverEmpty: true,
  fetchItems: async ({ fetch, today }: FetchContext): Promise<FetchResult> => ({ items: kinoArtItems(await getText(fetch, ART_PROGRAMME), today), coveredUntil: null }),
};
