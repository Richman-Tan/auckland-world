# auckland-world

Richman Tan's portfolio as a little flight over real central Auckland: fly to the beacons for projects, work, study and the rest, or read it all as a plain page at `/page/`.

Concept inspired by [dvlan.dev](https://dvlan.dev). All code, art and copy here are original.

## Run

```sh
nvm use            # Node 22
npm install
npm run dev        # http://localhost:5173  (?map=fake for the synthetic world, ?stop=projects to open a stop, ?quality=low|high, ?debug for window.__aw)
npm run typecheck  # src, scripts, api and the dev harnesses
npm test
npm run build      # typecheck, then vite build (this is what Vercel runs)
npm run check:bundle  # after a build: the title page and /page/ load no three.js up front, and stay in budget
```

## Map data

```sh
npm run map:fake   # synthetic world in public/map-fake (no network)
npm run map        # fetch (cached in data/), build public/map, check
```

See `docs/PLAN.md` for the original design and milestones (a record; this README describes the code as it is), and `ATTRIBUTION.md` for data licences.

GitHub Actions (`.github/workflows/ci.yml`) runs the typecheck, the tests, a build and the bundle check on every push to `master` and every pull request.

## Layout

- `src/app/` state machine, contracts, stop placement and the app loop (`app.ts`)
- `src/world/`, `src/render/` map loading, worker extrusion, low-res renderer, terrain, water, landmarks, beacons
- `src/flight/`, `src/input/` flight model, autopilot, orbit, proximity, chase camera, plane, keyboard/mouse/touch
- `src/ui/` title, HUD, nav, briefing, chat, warp, pause and error views
- `src/room/` the Sky Deck: layout and hotspots, walking, and the runtime (screens, signs, first-person camera); the room's mesh is `src/world/landmarks/skyDeck.ts`
- `src/chat/` bridge chat: scripted matching, the AI backend (`remote.ts`), the `/api/chat` handler and its system prompt
- `api/chat.ts` Vercel Node.js function for the AI chat; `api/_site.ts` is its generated prompt (`npm run chat:site`)
- `src/content/` everything the site says (one source for the 3D view and `/page/`)
- `src/shared/` binary map formats, collision, palette (shared by the pipeline and the runtime)
- `scripts/` map pipeline (fetch, build, check) and the synthetic map generator
- `dev/*.html` dev-only harnesses for the world, flight, UI and the social card (`dev/og.html`)

## Tour, progress and links

- **Tour.** "Take the tour" on the title screen loads the world and flies to the first stop on autopilot. Every briefing and the chat then offer "Next stop" (N in a briefing), which flies to the next stop not yet seen, in `TOUR_ORDER` (`src/app/progress.ts`), ending at the chat.
- **Progress.** Opening a stop's briefing, chat or room marks it seen. The set is kept in `localStorage` (`aw:progress:v1`) and shown as ticks on the title and the destinations map; the site works the same with storage blocked.
- **Links.** The address follows what is open (`src/app/route.ts`): `/?stop=projects`, `/?stop=projects&page=wie-academy`, `/?stop=projects&room=skydeck`, `/?stop=talk`. Moving to another stop adds a history entry and a page turn rewrites the current one, so the browser's Back and Forward walk the visit a stop at a time (cutting to the stop rather than flying). "Copy link" in a briefing copies the address, and without WebGL the same link leads to that spot on `/page/`.

## Settings and performance

- **Settings** live in the pause menu (Esc) and are kept in `localStorage` (`aw:settings:v1`, `src/app/settings.ts`): graphics (Auto, Sharp, Fast), which way W or stick-up pitches, and reduced motion.
- **Two kinds of quality.** The tier (`high` or `low`) decides what is loaded: the ground texture, and whether small buildings are built. It is picked once per visit from `?quality=`, else a pinned graphics setting, else the device (touch or four cores and under means low). Detail is adjusted while running, on a ladder in `src/shared/detail.ts`: first a shorter draw distance, then coarser 3D pixels. The HUD keeps its size throughout, because only the canvas changes scale.
- **The governor** (`src/app/governor.ts`) drives that ladder when graphics is Auto. It steps down after about three seconds under 45 fps, tries stepping back up after twelve clean seconds, settles on the lower level if that brings the stutter back, and gives the detail back entirely if lowering it made frames no faster (a 30 Hz power-saving mode, say). `window.__aw.info().detail` shows the level.
- **Reduced motion** (the device preference, or the setting): the title backdrop and the briefing camera hold still, the view does not roll with the bank, and "Fly me there" cuts to the stop instead of time-warping across the city.
- **Idle.** Under the pause menu the scene is drawn twice and then left alone until something changes.
- **Gamepad** (standard layout, `src/input/gamepad.ts`): left stick steers, RT or RB boosts, A reads or confirms, X lands, B goes back, Y opens the map, Start pauses, the D-pad pages, LB is next stop.
- **Touch.** The stick and buttons show only while flying or walking, and each action in the approach prompt is its own button.

## Keyboard

While flying, the input layer owns the keys (`src/input/core.ts`): WASD or arrows steer, Tab or M opens the destinations map, Space reads, E lands, Esc pauses. In any dialog (title, map, briefing, pause) Tab belongs to the browser so focus can move between the buttons, M still toggles the map, and Enter or Space on a focused button only activates that button.

If the browser drops the WebGL context, a notice shows while it recovers; if it does not come back within five seconds the error screen offers a reload and the plain page. `window.__aw.loseContext()` and `restoreContext()` simulate it.

## Bridge chat

Suggested questions and job-hunting questions are always answered from `src/content/chat.ts`. Typed questions go to `POST /api/chat`, which asks Claude Haiku 5.5 using a system prompt built only from the site's content (`src/chat/prompt.ts`, generated into `api/_site.ts` by `npm run chat:site`; a test fails if it is stale, so rerun it after editing content). If the endpoint is off, rate limited or failing, the chat quietly falls back to the scripted answers, and the panel says which mode it is in.

- Set `ANTHROPIC_API_KEY` in the Vercel project's environment variables. Without it, `GET /api/chat` reports `{ "enabled": false }` and everything stays scripted. `npm run dev` has no API, so local dev is always scripted.
- The hard cost cap is the monthly spend limit on the Anthropic account. The handler also limits each visitor (12 questions per 10 minutes) and each instance (400 per hour), and caps answers at 1024 tokens.
- Vercel logs one line per answer with token usage only; visitor text is never logged.

## Sky Deck

Near the Sky Tower (or from the projects briefing) press E to land inside the pod. Walk with the flight controls; the screens on the core play short muted loops from `public/media/skydeck/`, and facing one shows a prompt that opens that project's briefing page beside it. Esc closes the page, Esc again (or the lift, or Leave) puts you back in the plane on the holding circle.

- Screens, their pages and videos are listed in `SKY_DECK_SPOTS` (`src/room/layout.ts`); a test checks each one points at a real projects page.
- Nothing for the room is downloaded until the first visit.

## Map pipeline

`npm run map` = `map:fetch` (cached in `$AW_DATA_DIR`, default `./data`; a second run makes 0 network requests; `-- --only=osm|linz`, `--refresh`) then `map:build` (`-- --stage=water,terrain,landmarks,places,buildings,ground,minimap,meta`) then `map:check`. Outputs go to `public/map/`; the report and debug PNGs (water, hillshade, heights, height-sources) go to `$AW_DATA_DIR/work/`.

- Sources: OpenStreetMap via Overpass (three endpoints, 2 s spacing, 5/15/45 s backoff, 2x2 split on timeout) and the LINZ Auckland 2024 LiDAR 1 m DEM and DSM (public S3, checksum-verified against the STAC `file:checksum` multihash). Tiles that merely touch the world rectangle are not fetched.
- **LERC decode path:** the LINZ tiles are Float32 COGs with TIFF compression 34887 (LERC). `geotiff@2.1.3`'s built-in LERC decoder reads them directly (`GeoTIFF.fromFile` + `readRasters` on a window), so the `lerc@4` WASM fallback and GDAL were not needed. Spike check: `BA32_10000_0401` decodes in about 1 s with max 195.743 and mean 21.919, matching its header statistics. `scripts/build/mosaic.ts` reads each tile in 1024-row strips into one 7200 x 8000 Float32 mosaic per kind (nodata becomes NaN); nothing at full resolution is written to disk.
- `osmtogeojson` is not used; multipolygons are assembled in `scripts/lib/geom.ts` (`assembleRings`).
