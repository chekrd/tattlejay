# Tattlejay

What's on in Brno, from every source in one list, with picks chosen for your taste. A single-user app that runs on
your Mac.

Brno's events are scattered across the city's open-data feed, GoOut, theatres, cinemas, Meetup, Luma and a dozen
community calendars. Tattlejay reads them all once a day, merges entries that are sure to be the same event, and lists
what's on by date, category and price.

## Picks

Like, dislike or save events, and say in your own words what you like. From that the app keeps a short taste profile,
which you can read and edit, and scores every upcoming event against it. The best unrated matches show as
**Picked for you**, each with its reason. Rules can always show or always hide a venue or performer.

**Past 7 days** lets you rate what you went to, and **History** keeps every reaction, even after the event is gone.

The profile and the scores are written by the Claude CLI (`claude -p`) under your own login.

## Beyond the built-in sources

- **Add a source**: paste the address of any programme page. Its events are read from the structured data it
  publishes, or by the model from its text, and you see what was found before adding it.
- **Add one event**: paste a link, the event's text, or a screenshot or poster. This is the way in for Facebook and
  Instagram, and it works for events that are already over, so you can rate them.
- **Online**: online-only events get a tab of their own, with their own picks.
- **Another city**: name a city and the app reads what GoOut, and Kudy z nudy for the Czech regional capitals, list
  there over the next month, scored against your taste.

## Run it

```sh
pnpm install
pnpm start        # http://127.0.0.1:7440
pnpm check        # types, lint, tests
```

`TATTLEJAY_DATA_DIR` and `TATTLEJAY_PORT` change where the database lives (default
`~/Library/Application Support/tattlejay`) and the port.
