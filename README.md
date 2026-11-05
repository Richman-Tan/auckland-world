# auckland-world

Richman Tan's portfolio as a little flight over real central Auckland: fly to the beacons for projects, work, study and the rest, or read it all as a plain page at `/page/`.

Concept inspired by [dvlan.dev](https://dvlan.dev). All code, art and copy here are original.

## Run

```sh
nvm use            # Node 22
npm install
npm run dev        # http://localhost:5173  (?map=fake for the synthetic world, ?stop=projects to start at a stop, ?debug for window.__aw)
npm test
npm run build
```

## Map data

```sh
npm run map:fake   # synthetic world in public/map-fake (no network)
npm run map        # fetch (cached in data/), build public/map, check
```

See `docs/PLAN.md` for the design and milestones, and `ATTRIBUTION.md` for data licences.

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
- `dev/*.html` dev-only harnesses for the world, flight and UI

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
