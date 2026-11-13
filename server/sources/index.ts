import { brnoAi } from './brnoAi.ts';
import { base48, luma, pyvo, wug } from './calendars.ts';
import { kinoArt, scala } from './cinemas.ts';
import { cityFeed } from './cityFeed.ts';
import { expat } from './expat.ts';
import { goout } from './goout.ts';
import { impactHub } from './impactHub.ts';
import { mdb } from './mdb.ts';
import { meetup, meetupOnline } from './meetup.ts';
import type { Source } from './types.ts';

// Read in this order. The two city-wide feeds come first so the smaller sources merge into their events.
export const SOURCES: Source[] = [cityFeed, goout, mdb, scala, kinoArt, impactHub, meetup, meetupOnline, luma, brnoAi, pyvo, wug, base48, expat];
