import type { Place } from '../config.ts';
import type { Category, When } from '../contract.ts';

export interface SourceItem {
  // Stable within its source across polls.
  key: string;
  title: string;
  venue: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  category: Category;
  tags: string[];
  priceText: string | null;
  isFree: boolean | null;
  url: string;
  description: string | null;
  imageUrl: string | null;
  occurrences: When[];
}

export interface FetchContext {
  fetch: typeof fetch;
  pause: (ms: number) => Promise<void>;
  today: string;
  place: Place;
}

export interface FetchResult {
  items: SourceItem[];
  // Every event of the source starting before this day was read; null when the whole source was. An item that was
  // known before and is missing now counts as removed only inside this window.
  coveredUntil: string | null;
}

export interface Source {
  id: string;
  label: string;
  fetchItems(ctx: FetchContext): Promise<FetchResult>;
}
