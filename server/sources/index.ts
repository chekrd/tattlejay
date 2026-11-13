import { cityFeed } from './cityFeed.ts';
import { goout } from './goout.ts';
import type { Source } from './types.ts';

export const SOURCES: Source[] = [cityFeed, goout];
