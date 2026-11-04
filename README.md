# auckland-world

Richman Tan's portfolio as a little flight over real central Auckland: fly to the beacons for projects, work, study and the rest, or read it all as a plain page at `/page/`.

Concept inspired by [dvlan.dev](https://dvlan.dev). All code, art and copy here are original.

## Run

```sh
nvm use            # Node 22
npm install
npm run dev        # http://localhost:5173  (add ?map=fake to use the synthetic world)
npm test
npm run build
```

## Map data

```sh
npm run map:fake   # synthetic world in public/map-fake (no network)
npm run map        # fetch (cached in data/), build public/map, check
```

See `docs/PLAN.md` for the design and milestones, and `ATTRIBUTION.md` for data licences.
