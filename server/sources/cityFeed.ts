import { z } from 'zod';
import { USER_AGENT } from '../config.ts';
import type { Category } from '../contract.ts';
import { daysBetween } from '../dates.ts';
import { collapse, decodeEntities, plainText, truncate } from '../text.ts';
import type { FetchContext, FetchResult, Source, SourceItem } from './types.ts';

const ENDPOINT = 'https://services6.arcgis.com/fUWVlHWZNxUvTUh8/arcgis/rest/services/Events/FeatureServer/0/query';
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
// The feed also lists standing services (guided tours "from 2021 to 2050"), which are not events.
const MAX_SPAN_DAYS = 366;

const Attributes = z.object({
  ID: z.number(),
  name: z.string().min(1),
  text: z.string().nullish(),
  tickets: z.string().nullish(),
  tickets_info: z.string().nullish(),
  url: z.string().min(1),
  categories: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  date_from: z.number(),
  date_to: z.number().nullish(),
  first_image: z.string().nullish(),
  address: z.string().nullish(),
});

const Feed = z.object({
  features: z.array(z.object({ attributes: z.unknown() })),
  exceededTransferLimit: z.boolean().optional(),
});

// A row carries several categories; the first one found in this order wins.
const BY_PRIORITY: [string, Category][] = [
  ['Pro rodiny', 'Family and kids'],
  ['Výstava', 'Exhibitions'],
  ['Divadlo', 'Theatre and dance'],
  ['Tanec', 'Theatre and dance'],
  ['Hudba', 'Music'],
  ['Sport', 'Sport'],
  ['Gastronomické', 'Food and markets'],
  ['Literatura', 'Talks and lectures'],
  ['Komentované prohlídky', 'Talks and lectures'],
  ['Festivaly', 'Festivals'],
  ['Noční život', 'Music'],
  ['Folklor', 'Music'],
  ['Vánoce', 'Festivals'],
  ['Veletrhy / vzdělávací', 'Talks and lectures'],
];

function category(tags: string[]): Category {
  return BY_PRIORITY.find(([name]) => tags.includes(name))?.[1] ?? 'Other';
}

// `tickets` reads "Zdarma - ", "Dospělí - 200Kč" or "Dobrovolné - "; `tickets_info` is free text.
function price(tickets: string, info: string): Pick<SourceItem, 'priceText' | 'isFree'> {
  const label = collapse(tickets.replace(/\s*-\s*/g, ' ').replace(/(\d)\s*Kč/g, '$1 Kč').replace(/,(?=\S)/g, ', '));
  const freeByLabel = /zdarma|dobrovoln/i.test(label);
  const priced = /\d/.test(label);
  const isFree = freeByLabel || /vstup\s+(zdarma|voln)/i.test(info) ? true : priced ? false : null;
  const priceText = freeByLabel || priced ? label : info ? truncate(info, 80) : null;
  return { priceText, isFree };
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function parseCityFeed(features: unknown[], today: string): SourceItem[] {
  const items: SourceItem[] = [];
  for (const feature of features) {
    const parsed = Attributes.safeParse(feature);
    if (!parsed.success) continue;
    const a = parsed.data;
    const startDate = day(a.date_from);
    const endDate = a.date_to != null && a.date_to >= a.date_from ? day(a.date_to) : startDate;
    if (endDate < today || daysBetween(startDate, endDate) > MAX_SPAN_DAYS) continue;
    const tags = (a.categories ?? '').split(',').map(collapse).filter(Boolean);
    const description = plainText(a.text ?? '');
    items.push({
      key: String(a.ID),
      title: plainText(a.name),
      venue: null,
      address: a.address ? collapse(decodeEntities(a.address)) : null,
      lat: a.latitude ?? null,
      lon: a.longitude ?? null,
      category: category(tags),
      tags,
      ...price(decodeEntities(a.tickets ?? ''), plainText(a.tickets_info ?? '')),
      url: a.url,
      description: description ? truncate(description, 600) : null,
      imageUrl: a.first_image || null,
      occurrences: [{ startDate, startTime: null, endDate, endTime: null }],
    });
  }
  return items;
}

async function fetchItems({ fetch, today }: FetchContext): Promise<FetchResult> {
  const features: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      orderByFields: 'ObjectId',
      resultOffset: String(page * PAGE_SIZE),
      resultRecordCount: String(PAGE_SIZE),
      f: 'json',
    }).toString();
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) throw new Error(`city feed answered ${res.status}`);
    const body = Feed.parse(await res.json());
    features.push(...body.features.map((f) => f.attributes));
    if (!body.exceededTransferLimit) break;
  }
  return { items: parseCityFeed(features, today), coveredUntil: null };
}

export const cityFeed: Source = { id: 'brno-city', label: 'gotobrno.cz', fetchItems };
