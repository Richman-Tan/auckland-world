# Plan: "Fly over Auckland" portfolio (inspired by dvlan.dev)

> **Status (November 2026).** This is the original build plan, kept as a record. Phase 1 (M0 to M6) and Phase 2's Sky Deck room, Claude chat and Vercel config are built. A later round (v0.3.0) gave the world its close-up detail: roads with markings, ground drawn from land type, LiDAR tree canopy and trees, pitched roofs and wall detail, a rebuilt Harbour Bridge, marinas with boats, and five modelled landmarks; those are described in the README, not here. Where this document and the code disagree, the code wins: the current layout, scripts and behaviour are described in `README.md`. Never built from this plan: music, and `osmtogeojson` / `lerc` (neither was needed).

## Context

**What dvlan.dev is.** "Dylan's World" is Dylan Nguyen's personal portfolio, built as a game. I read its source to see how it works:

- **Title screen.** You can fly over the harbour, go straight to a stop, or read everything as a page.
- **The world.** Real Sydney, about 4.4 × 5.3 km, with 12,000 OpenStreetMap (OSM) buildings and terrain. The ground is a stylised render of OSM data with a water shader under it. All of this is pre-baked into `/map/*.bin.gz` and `.webp` files.
- **Hand-modelled landmarks**, such as the bridge, the Opera House and the tower.
- **Flight.** A pixel-art plane with a chase camera and boost. The cockpit HUD has speed and altitude gauges, a compass, radar and a text display. A Tab map lists the destinations, and autopilot runs with a time-warp overlay. There's a touch joystick on mobile.
- **Beacons** at real places for work, projects and hobbies. Each opens a paged briefing with images.
- **Phase-2-type features.** First-person rooms you can land in, with demo videos on screens. An avatar chat on the bridge (scripted topics, plus a `/api/chat` LLM endpoint). A Spotify radio.
- **Stack.** Vite, vanilla TypeScript and three.js, hosted on Vercel.

**Goal.** Build the same concept over **central Auckland**, as Richman's own portfolio. All code, art direction, HUD design and copy will be original. Nothing is copied from dvlan's bundle, assets or text, and the site carries an "inspired by dvlan.dev" credit.

**What you decided**
- Content is your own portfolio.
- Phased build, MVP first.
- Chat is scripted for now; a Claude backend can come later.
- A local repo with no remote and no deploy until you approve.
- The title line reads "Software Developer · Sandfield".

## Where it lives

- **Repo:** new git repo at `~/Project.git/auckland-world`. This follows the repo convention used by the dev-log skill.
  - No remote.
- **Old repo:** leave `~/Project.git/richman-portfolio` (the abandoned folio-2025 fork) untouched. Port its content files `sources/data/{profile,education,experience,projects,skills,social}.js` to TS, with corrections:
  - GPA becomes "8.0/9 (7.96)", replacing the stale 8.25.
  - Strip Sandfield internal names and metrics.
- **Vault side, after the MVP works:**
  - Create a project note with the `new-project` skill.
  - Add a `07 Sources/` note for dvlan.dev, holding this teardown.
  - Link the open "Portfolio site" item in `02 Areas/Career.md`.
  - Add one line to Hot Context.

## Key decisions

| Decision | Choice |
|---|---|
| World rectangle | NZTM E 1,753,600–1,760,800, N 5,916,400–5,924,400 (7.2 × 8 km, about lat −36.886 to −36.814, lon 174.7235 to 174.804). It covers Harbour Bridge and Northcote Point, the CBD, Wynyard, Ponsonby, Grafton, the Domain, Parnell, Devonport's edge and Mt Eden, with margin. It lines up exactly with 4 LINZ tiles. |
| Coordinate frame | NZTM-local metres: x = E − 1,757,200, z = −(N − 5,920,400), y up. Sky Tower sits at about the origin. The rasters need no reprojection; only OSM vectors go through proj4. A quadratic lat/lon fit is stored in meta, so the runtime doesn't need proj4. |
| Terrain | LINZ Auckland 2024 LiDAR 1 m DEM (public S3 bucket `nz-elevation`, CC BY 4.0). Tiles: BA31_10000_0405, BA31_10000_0505, BA32_10000_0401, BA32_10000_0501 (about 351 MB total, downloaded once). Area-averaged to a 20 m grid (361×401). |
| Building heights | **Real heights**: median(DSM − DEM) inside each OSM footprint, using a 1 m inset and a global alignment-shift test. Fallbacks in order: OSM `height`, then `building:levels` × 3.2, then a default by building type. About 28–32k buildings. |
| Water | Draw the OSM coastline as barrier lines, flood-fill from fixed sea seed points, then add piers back as land. The DEM is used only for validation. |
| Payload | Ship building footprints (struct-of-arrays, delta-coded, gzipped) and extrude them in a Web Worker with earcut. The collision grid is built at runtime. Target is 2.2 MB or less for the map (hard cap 3 MB). |
| Ground texture | Skia render (`@napi-rs/canvas`) at 3 m/px, 2400×2667 WebP, with layers for landuse, parks, beach, quantised hillshade, roads by class, rail, footprints, inland water and sea alpha cut-out. Also `ground-lo.webp` for the low quality tier and a 512 px minimap. |
| Look | Render to a low-res target (about 640×360), upscale with nearest-neighbour, flat dithered fog, quantised lighting. Auckland palette: harbour teal, pōhutukawa red, kōwhai, volcanic green, weatherboard villas, corrugated-iron roofs. Fonts are Jersey 10 (display) and Departure Mono (HUD), both OFL and self-hosted. |
| Libraries | Runtime: `three` (≥0.184, WebGL2) and `earcut@3`. Gzip is decoded natively with `DecompressionStream`. Dev: `vite@7`, `typescript@5.9` strict, `vitest`, `tsx`, Node 22. Pipeline: `geotiff@2` (with `lerc@4` as fallback), `proj4`, `osmtogeojson`, `@napi-rs/canvas`, `node:zlib`. |

## Stops (beacons)

| # | Stop | Where | Briefing pages |
|---|---|---|---|
| 1 | **Projects** (pōhutukawa red) | Sky Tower | DementiaGuide AI, WIE Academy (Scrum Master, SOFTENG 761; **no repo link**, since it's private until after exams), Chudvents, Virtual Patient Simulator |
| 2 | **Work** (kōwhai) | Sandfield, 130 Ponsonby Rd (their public address; **you confirm**) | Sandfield: intern, then Software Developer (capability level only, no client or internal names), and Fetch TCG |
| 3 | **Study** (teal) | UoA Faculty of Engineering | BE(Hons) Software Engineering, GPA 8.0/9, Dean's Honours List 2023 and 2024, SESA Treasurer · Social Events Lead, WDCC |
| 4 | **Talk to me** (cream) | Top of the Harbour Bridge truss (measured from the DSM) | Contact links and scripted "quick answers". In Phase 2 this becomes the avatar chat. |
| 5 | **Off the clock** (volcanic green) | Maungawhau / Mt Eden summit | Snowboarding, volleyball, badminton, road trips, the beach, gaming, cooking |

The player spawns over Wynyard Quarter at 150 m, heading towards Sky Tower.

## Repo layout (summary)

```
scripts/  config.ts  lib/{geo,geom,raster,io}.ts  fetch/{overpass,linz,index}.ts
          build/{mosaic,water,terrain,buildings,landmarks,places,ground,minimap,meta,fake,index}.ts  check/{map,bundle}.ts
src/      shared/{mapFormat,palette}.ts      (pure; shared by pipeline and runtime)
          app/{contracts,fsm,app,loop,quality,debug}.ts
          content/{types,profile,projects,work,study,contact,offclock,chat,stops,validate,renderHtml}.ts
          render/  world/{loader,geometry.worker,extrude,collisionGrid,terrain,buildings,water,sky,outskirts,beacons,landmarks/*}.ts
          flight/{plane,flightModel,collision,camera,autopilot,proximity,boundary}.ts  input/  ui/{title,loading,nav,briefing,warp,pause,hud/*}.ts
public/map/ (built data, committed)  public/map-fake/ (synthetic, for parallel dev)  public/fonts/  public/media/
page/index.html (read-as-page, prerendered at build time from the same content)   data/ (gitignored raw cache)
```

npm scripts:
- `dev`, `build` (runs typecheck, then vite build), `typecheck`, `test`
- `map:fetch` (makes no network calls once the cache is complete), `map:build`, `map:check`, `map:fake`, `map`
- `check:bundle`

## Runtime design (essentials)

- **State machine.** `fsm.ts` is pure and unit-tested. States: title, loading, flying, nav, autopilot (climb / cruise / descend / arrive), briefing, paused, error.
  - Phase 2 adds `room` and `chat` states without refactoring.
  - Three.js and the map start loading in the background while the title screen shows.
- **Flight.** Arcade model on a fixed 60 Hz step.
  - Speed is 35–130 m/s, with boost on Shift and no stalling. With no input, the plane auto-levels.
  - Ceiling is 550/600 m. A ground-proximity assist triggers a "PULL UP" warning.
  - Collision is checked against the runtime height grid plus analytic colliders for Sky Tower and the bridge. Hits bounce the plane off; three hits in a row respawn it at the last safe point.
  - Leaving the area triggers a turn-back.
  - The chase camera is a damped spring.
- **Input.**
  - Keyboard: WASD or arrows, Shift to boost, Space for the briefing, Tab or M for the map, 1–5 to pick a stop, Enter to engage autopilot, Esc to back out.
  - Mouse: drag to steer.
  - Touch: joystick plus buttons.
- **Autopilot.** It produces the same inputs a player would, so the plane never teleports.
  - Cruise altitude is the corridor's maximum obstacle height + 60 m, with a detour around Sky Tower.
  - Time warp is up to ×8.
  - On arrival the plane orbits the beacon and the briefing opens.
- **HUD** (original design):
  - Bottom deck: speed tape, boost bar, text display ("OVER PONSONBY · NEXT SKY TOWER 1.2 KM"), heading-up radar, altitude tape.
  - Top: compass strip with a destination marker.
  - Also: toasts, the approach prompt, an off-screen arrow pointing to the destination, and a permanent attribution corner.
  - The nav overlay has a list and the minimap.
  - The briefing is an accessible dialog docked on the right (a bottom sheet on mobile).
  - The warp overlay is styled as a "transit tape".
- **Content model.** `Stop { beacon, briefing: Page[], experiences: Experience[] }`, where a `Page` is made of typed `Block`s.
  - Phase 2 rooms and chat are added as `experiences` entries.
  - Chat topics already live in the content, so a Claude `/api/chat` backend becomes just another backend later.
- **Read-as-page.** `/page/` is prerendered by a Vite plugin from the same content. It works without JS, never loads three.js, and has semantic headings.
- **Performance budget:**
  - 60 draw calls or fewer (buildings merged in 1 km chunks with frustum culling) and 700k visible triangles or fewer.
  - 60 fps on the M3.
  - Quality tiers plus an FPS governor for mobile.
  - Main JS 250 KB gzipped or less.
- **Debug hook.** `window.__aw` (`state`, `teleport`, `autopilot`, `info`) is only available in dev or with `?debug`. It's there so browser checks can be scripted.

## Milestones (Phase 1)

Agents run in parallel in separate git worktrees, never more than 4 at once. They share one data cache through `AW_DATA_DIR`. `src/shared/*` and `src/app/contracts.ts` are frozen after M0.

1. **M0 · Scaffold and contracts** (me)
   - `git init`, multi-page Vite setup, every dependency installed up front.
   - Write `mapFormat.ts` with a round-trip test, `contracts.ts`, `fsm.ts` with tests, and `content/types.ts`.
   - `map:fake` generates a synthetic world in the real formats.
   - Done when typecheck, test, build and fake all pass, and the first commit is made.
2. **In parallel:**
   - **M1 · Data pipeline** (agent A: `scripts/`, `data/`, `public/map/`).
     - Day 1 starts with a LERC decode spike. The check is that tile BA32_10000_0401 decodes with max 195.74. If both decoders fail, I'll ask you about installing GDAL with Homebrew.
     - Then: fetch (Overpass with 3 endpoints, backoff, 2×2 split, cache), then mosaic, water, terrain, landmarks, buildings, ground, minimap and meta.
     - Done when `map:check` passes.
   - **M2 · World rendering** (agent B: `src/render`, `src/world`).
     - Low-res renderer, sky and fog, terrain, water, outskirts, worker extrusion plus the collision grid, Sky Tower, the Harbour Bridge (shape measured from the DSM), a Rangitoto backdrop, and beacons.
     - Built against the fake map first.
   - **M3 · Flight** (agent C: `src/flight`, `src/input`).
     - Plane, flight model, collision, camera, input, autopilot, proximity.
     - Headless autopilot test: from 20 seeded starts to all 5 stops, every run must arrive within 120 s of simulated time with zero collisions.
   - **M4 · UI and content** (agent D: `src/ui`, `src/content`, `page/`, fonts).
     - Ported and corrected content, title, loading screen, HUD, nav, briefing, warp overlay, a `?ui=harness` test page, and the prerender plugin.
     - Content tests: GPA string, no WIE links, a denylist for Sandfield internal names, alt text on every image.
3. **M5 · Integration** (me)
   - Wire the state machine and the real map, with a loading bar driven by bytes received.
   - Place the 5 beacons. Connect prompt to briefing, and nav to autopilot to arrival to briefing.
   - Add the `?stop=` deep link, the "go straight to a stop" option, and the no-WebGL fallback to `/page/`.
4. **M6 · Polish**
   - Mobile layout and quality tiers, reduced motion, attribution everywhere it's required, payload and bundle checks, README, `ATTRIBUTION.md`.
   - **You review the Sandfield copy before it's committed.**

**I'll check these with you at M4 (defaults in brackets):**
- Sandfield address and the start date of the role [130 Ponsonby Rd].
- How much of the Sandfield work to describe [capability only, no metrics].
- Whether to host a CV PDF [no].
- Whether to keep "top 5% of cohort" [keep, it's on your CV].
- Code licence [all rights reserved].

## Licensing and attribution

These lines appear on the title screen, as a HUD corner while flying, in the page footer and in `ATTRIBUTION.md`:
- "Map data © OpenStreetMap contributors, ODbL." This includes a note that the derived data in `/map/` is under the ODbL.
- "Elevation and building heights from the Auckland LiDAR 1m DEM & DSM (2024), Toitū Te Whenua LINZ, CC BY 4.0."
- The OFL font licences, and "Concept inspired by dvlan.dev".

## Verification

- **Pipeline** (`npm run map:check`, automated):
  - Files: every file matches its sha256 and size; payload is within budget.
  - Buildings: decoded with the runtime's own decoder. Count is 18k–34k, median height 5–9 m, tallest building 140–200 m, and nothing taller than 60 m within 80 m of the Sky Tower anchor. At least 85% of heights come from LiDAR.
  - Terrain: Mt Eden DEM maximum is 194–198 m. Sky Tower DSM − DEM is 180–330 m. The Harbour Bridge truss top is 55–75 m.
  - Water: water covers 15–45% of the area, the coastline orientation check agrees at least 97%, and known land and water points are classified correctly.
  - Geo fit residual is under 0.05 m.
- **Code:** `npm run typecheck && npm test && npm run build`, plus `check:bundle` (the `/page/` chunk has no three.js).
- **Browser** (Chrome on `npm run dev`, scripted via `window.__aw`):
  - Title screen with no console errors, and map transfer of 3 MB or less.
  - Flight beside the Sky Tower pod, with HUD values changing.
  - The Tab nav overlay.
  - Autopilot to each of the 5 stops, ending in a briefing.
  - Briefing paging by keyboard, with focus returning correctly.
  - `/page/` content present without JS (`curl` and grep for `<h2>`).
  - Mobile at 390×844 and 844×390.
  - `?debug` fps, draw-call and triangle readings over the CBD and over Mt Eden.
  - The `?stop=talk` deep link.
  - Attribution visible everywhere it's required.
- **Fresh eyes:** before release, an independent reviewer re-checks every portfolio fact against the CV (`~/Documents/cv/cv.tex`) and the vault notes, and checks the denylist and privacy rules (no phone number, no WIE repo link, no Sandfield internal names).

## Phase 2 (later, separate approval)

- Rooms you can land in, with demo videos.
- An avatar chat on the bridge: scripted topics first, then a Claude Haiku `/api/chat` with a usage cap.
- Optional music.
- Deploy to Vercel, with your login and your approval.
