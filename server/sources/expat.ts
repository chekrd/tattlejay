import { TIME_ZONE } from '../config.ts';
import type { When } from '../contract.ts';
import { localOf } from '../dates.ts';
import { plainText } from '../text.ts';
import { getText } from './http.ts';
import type { FetchContext, FetchResult, Source, SourceItem } from './types.ts';

const FEED = 'https://www.brnoexpatcentre.eu/events/feed/';

const tag = (item: string, name: string) => new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`).exec(item)?.[1]?.trim() ?? '';

// The description opens with "14/11/2026 - 10:00 - 12:00"; the publication date repeats the start.
function occurrence(description: string, published: string): When | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s*-\s*(\d{1,2}:\d{2}))?(?:\s*-\s*(\d{1,2}:\d{2}))?/.exec(description.trim());
  if (m) {
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    return { startDate: date, startTime: m[4]?.padStart(5, '0') ?? null, endDate: date, endTime: m[5]?.padStart(5, '0') ?? null };
  }
  const at = localOf(published, TIME_ZONE);
  return at && { startDate: at.date, startTime: at.time, endDate: at.date, endTime: null };
}

export function expatItems(xml: string, today: string): SourceItem[] {
  const items: SourceItem[] = [];
  for (const item of xml.split('<item>').slice(1)) {
    const title = plainText(tag(item, 'title'));
    const url = tag(item, 'link');
    const when = occurrence(tag(item, 'description'), tag(item, 'pubDate'));
    if (!title || !url || !when || when.endDate < today) continue;
    items.push({
      key: tag(item, 'guid') || url,
      title,
      venue: null,
      address: null,
      lat: null,
      lon: null,
      category: 'Talks and lectures',
      tags: ['expats'],
      priceText: null,
      isFree: null,
      url,
      description: null,
      imageUrl: null,
      occurrences: [when],
    });
  }
  return items;
}

export const expat: Source = {
  id: 'expat-centre',
  label: 'Brno Expat Centre',
  home: 'https://www.brnoexpatcentre.eu/events/',
  fetchItems: async ({ fetch, today }: FetchContext): Promise<FetchResult> => ({ items: expatItems(await getText(fetch, FEED), today), coveredUntil: null }),
};
