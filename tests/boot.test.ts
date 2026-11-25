import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bootScript } from '../scripts/vite/pagePrerender';
import { content } from '../src/content';
import { jobTitle } from '../src/content/renderHtml';
import { pixelScaleFor, TARGET_HEIGHT } from '../src/shared/pixelScale';
import { aucklandTime, dayPart, SOLAR } from '../src/shared/timeOfDay';
import { TOWER_START, bayer4, clearsAt, layoutSkyline, risen, towerHalfWidth, towerRisen, windowLit } from '../src/ui/boot/skyline';
import { CONTROLS_HINT } from '../src/ui/controls';
import { COMPILE_MARK, DOWNLOAD_SHARE, loadStage } from '../src/ui/loadStage';
import { LOADING_BUILDINGS, LOADING_FACT, titleHtml } from '../src/ui/views/titleHtml';

const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('the title screen as HTML', () => {
  const html = titleHtml(content);

  it('says who this is, without a script', () => {
    expect(html).toContain(`<h1 class="aw-title__name" id="aw-title-name">${content.profile.name}</h1>`);
    expect(html).toContain(content.profile.tagline);
    expect(html).toContain(content.profile.location);
    expect(html).toContain(CONTROLS_HINT);
  });

  it('gives the job and leaves the employer to the Work stop', () => {
    expect(jobTitle('Software Developer · Somewhere')).toBe('Software Developer');
    expect(jobTitle('Software Developer')).toBe('Software Developer');
    expect(html).toContain('<p class="aw-title__role">Software Developer</p>');
    expect(html).not.toContain('Sandfield');
  });

  it('has a button for flying, one for the tour and one for every stop, each switched off until wired', () => {
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2 + content.stops.length);
    for (const b of buttons) expect(b).toContain(' disabled');
    for (const s of content.stops) {
      expect(html).toContain(`data-stop="${s.id}"`);
      expect(html).toContain(`aria-label="Go to ${s.label}, ${s.place}"`);
    }
    expect(html).toContain('is-booting');
  });

  it('keeps the page version one plain link away from the first paint', () => {
    expect(html).toMatch(/<a class="[^"]*aw-title__read[^"]*" href="\/page\/"[^>]*>Read it as a page<\/a>/);
    expect(html).toContain('<a href="/page/#credits">Credits</a>');
  });

  it('announces the loader by its label only', () => {
    expect(html).toContain('<span class="aw-title__loadlabel" role="status">Loading Auckland</span>');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain(`<p class="aw-title__loadnote" aria-hidden="true">${LOADING_FACT}</p>`);
  });

  it('escapes what it is given', () => {
    const evil = structuredClone(content);
    evil.profile.name = '<img src=x onerror=alert(1)>';
    evil.stops[0].place = '"><script>alert(1)</script>';
    const out = titleHtml(evil);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
  });

  it('tells the truth about the buildings', () => {
    const meta = JSON.parse(file('public/map/meta.json')) as { buildings: { count: number } };
    expect(Math.abs(meta.buildings.count - LOADING_BUILDINGS) / meta.buildings.count).toBeLessThan(0.03);
    expect(LOADING_FACT).toBe('About 33,000 real buildings from OpenStreetMap');
  });
});

describe('the home page before any script', () => {
  const home = file('index.html');

  it('has a place for the title inside the UI root, which is styled from the start', () => {
    expect(home).toContain('<div id="ui" class="aw-ui"><!--TITLE--></div>');
    expect(home).toContain('<!--BOOT-->');
  });

  it('fetches the two faces the title is set in, and they exist', () => {
    for (const font of ['Jersey10-latin.woff2', 'DepartureMono-Regular.woff2']) {
      expect(home).toContain(`<link rel="preload" href="/fonts/${font}" as="font" type="font/woff2" crossorigin />`);
      expect(readFileSync(new URL(`../public/fonts/${font}`, import.meta.url)).length).toBeGreaterThan(1000);
    }
    // The name must never be drawn in a stand-in face and then jump.
    expect(file('src/ui/styles/fonts.css')).toMatch(/Jersey10-latin\.woff2/);
    expect(file('src/ui/styles/fonts.css').split('@font-face')[1]).toContain('font-display: block');
  });

  it('keeps the title out of sight until it can be styled, and out of the way without a script', () => {
    expect(home).toContain('<style>.aw-ui { visibility: hidden; }</style>');
    expect(file('src/ui/styles/ui.css')).toContain('.aw-ui { visibility: visible; }');
    expect(home).toContain('<noscript><style>#ui, #scene { display: none; }</style></noscript>');
  });

  it('sizes the pixels with the same rule the renderer uses', () => {
    const script = bootScript(TARGET_HEIGHT);
    const body = /^<script>([\s\S]*)<\/script>$/.exec(script)![1];
    for (const innerHeight of [320, 480, 539, 540, 541, 720, 745, 899, 900, 901, 1080, 1260, 1440, 2160]) {
      for (const search of ['', '?stop=projects', '?map=fake&stop=talk&page=x', '?time=night', '?nonstop=1']) {
        const set: Record<string, string> = {};
        const classes: string[] = [];
        const documentElement = { style: { setProperty: (k: string, v: unknown) => (set[k] = String(v)) }, classList: { add: (c: string) => classes.push(c) } };
        new Function('innerHeight', 'location', 'document', body)(innerHeight, { search }, { documentElement });
        expect(set['--px'], `height ${innerHeight}`).toBe(String(pixelScaleFor(innerHeight)));
        // Only a link that opens a stop skips the title.
        expect(classes, search).toEqual(/[?&]stop=/.test(search) ? ['aw-deep'] : []);
      }
    }
  });
});

describe('how far the load has got', () => {
  it('gives the download most of the bar, by real bytes', () => {
    expect(loadStage({ loadedBytes: 0, totalBytes: 0, label: 'x' })).toEqual({ fraction: 0, label: 'Fetching the map', detail: '' });
    const half = loadStage({ loadedBytes: 900_000, totalBytes: 1_800_000, label: 'Fetching buildings', stage: 'fetch' });
    expect(half.fraction).toBeCloseTo(DOWNLOAD_SHARE / 2);
    expect(half.label).toBe('Fetching the map');
    expect(half.detail).toBe('0.9 of 1.8 MB');
    expect(loadStage({ loadedBytes: 5, totalBytes: 4, label: 'x' }).fraction).toBe(DOWNLOAD_SHARE);
  });

  it('holds at a mark for each step that reports nothing, and never reaches the end on its own', () => {
    const build = loadStage({ loadedBytes: 10, totalBytes: 10, label: 'Building the city', stage: 'build' });
    const compile = loadStage({ loadedBytes: 10, totalBytes: 10, label: 'Compiling shaders', stage: 'compile' });
    expect(build).toEqual({ fraction: DOWNLOAD_SHARE, label: 'Building the city', detail: '' });
    expect(compile).toEqual({ fraction: COMPILE_MARK, label: 'Compiling shaders', detail: '' });
    expect(DOWNLOAD_SHARE).toBeLessThan(COMPILE_MARK);
    expect(COMPILE_MARK).toBeLessThan(1);
  });

  it('never goes backwards as bytes arrive', () => {
    let last = -1;
    for (let b = 0; b <= 1_800_000; b += 37_000) {
      const f = loadStage({ loadedBytes: b, totalBytes: 1_800_000, label: '', stage: 'fetch' }).fraction;
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
});

describe('the skyline that goes up while the map loads', () => {
  const sizes: [number, number][] = [[735, 372], [490, 248], [640, 360], [195, 380], [130, 281], [960, 540], [1, 1]];

  it('lays out the same city every time, inside the picture', () => {
    for (const [w, h] of sizes) {
      const a = layoutSkyline(w, h);
      expect(layoutSkyline(w, h)).toEqual(a);
      expect(a.horizon).toBeLessThan(h === 1 ? 2 : h);
      expect(a.tower.x).toBeGreaterThanOrEqual(a.left);
      expect(a.tower.x).toBeLessThan(Math.max(2, w));
      for (const b of a.blocks) {
        expect(b.x).toBeGreaterThanOrEqual(a.left);
        expect(b.w).toBeGreaterThanOrEqual(5);
        expect(b.height).toBeGreaterThanOrEqual(4);
        expect(b.start).toBeGreaterThanOrEqual(0);
        // Every building is finished before the load is.
        expect(b.start + b.span).toBeLessThanOrEqual(0.97);
      }
    }
  });

  it('keeps clear of the title on a wide screen and uses the whole width on a narrow one', () => {
    expect(layoutSkyline(735, 372).left).toBeGreaterThan(250);
    expect(layoutSkyline(195, 380).left).toBe(0);
    expect(layoutSkyline(735, 372).blocks.length).toBeGreaterThan(40);
  });

  it('makes the tower the tallest thing, and the city tallest around it', () => {
    const s = layoutSkyline(735, 372);
    expect(Math.max(...s.blocks.map((b) => b.height))).toBeLessThan(s.tower.height);
    const near = s.blocks.filter((b) => Math.abs(b.x - s.tower.x) < 60).map((b) => b.height);
    const far = s.blocks.filter((b) => Math.abs(b.x - s.tower.x) > 200).map((b) => b.height);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(near)).toBeGreaterThan(mean(far) * 1.5);
  });

  it('raises each building with the load: nothing before its start, all of it after, never shrinking', () => {
    const s = layoutSkyline(735, 372);
    for (const b of s.blocks) {
      expect(risen(b, 0)).toBe(0);
      expect(risen(b, b.start)).toBe(0);
      expect(risen(b, 1)).toBe(b.height);
      let last = 0;
      for (let p = 0; p <= 1.0001; p += 0.01) {
        const up = risen(b, p);
        expect(up).toBeGreaterThanOrEqual(last);
        expect(up).toBeLessThanOrEqual(b.height);
        last = up;
      }
    }
  });

  it('uses the tower as the gauge: it tops out exactly when the load does', () => {
    expect(towerRisen(200, 0)).toBe(0);
    expect(towerRisen(200, TOWER_START)).toBe(0);
    expect(towerRisen(200, 1)).toBe(200);
    expect(towerRisen(200, 0.999)).toBeLessThan(200);
    expect(towerRisen(200, 0.54)).toBe(100);
    // Still short of the top while the last two steps hold the bar at their marks.
    expect(towerRisen(200, COMPILE_MARK)).toBeLessThan(190);
  });

  it('draws a tower: a shaft, a pod wider than it, a neck, then a one-pixel mast', () => {
    const full = 200;
    expect(towerHalfWidth(0, full)).toBe(2);
    expect(towerHalfWidth(60, full)).toBe(1);
    expect(towerHalfWidth(130, full)).toBeGreaterThanOrEqual(4);
    expect(towerHalfWidth(150, full)).toBe(1);
    expect(towerHalfWidth(180, full)).toBe(0);
    expect(towerHalfWidth(199, full)).toBe(0);
  });

  it('lights about a third of the windows, the same ones each time', () => {
    let lit = 0;
    for (let c = 0; c < 60; c++) for (let r = 0; r < 60; r++) if (windowLit(12345, c, r)) lit++;
    expect(lit / 3600).toBeGreaterThan(0.25);
    expect(lit / 3600).toBeLessThan(0.42);
    expect(windowLit(7, 3, 4)).toBe(windowLit(7, 3, 4));
  });
});

describe('the reveal', () => {
  it('uses each dither level once in every 4 x 4 cell', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(bayer4(x, y));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(bayer4(5, 9)).toBe(bayer4(1, 1));
  });

  it('clears every pixel some time after it starts and before it ends', () => {
    for (const [w, h, cx, cy] of [[735, 372, 470, 150], [195, 380, 120, 250], [16, 16, 0, 0], [16, 16, 15, 15]]) {
      let min = Infinity;
      let max = -Infinity;
      for (let y = 0; y < h; y += 3) {
        for (let x = 0; x < w; x += 3) {
          const t = clearsAt(x, y, w, h, cx, cy);
          min = Math.min(min, t);
          max = Math.max(max, t);
        }
      }
      for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [cx, cy]]) {
        const t = clearsAt(x, y, w, h, cx, cy);
        min = Math.min(min, t);
        max = Math.max(max, t);
      }
      expect(min).toBeGreaterThan(0);
      expect(max).toBeLessThan(1);
    }
  });

  it('opens from the tower outwards', () => {
    const at = (x: number, y: number) => clearsAt(x, y, 736, 372, 472, 152);
    // Same dither cell, so only the distance differs.
    expect(at(472, 152)).toBeLessThan(at(472 + 80, 152));
    expect(at(472 + 80, 152)).toBeLessThan(at(472 + 240, 152));
    expect(at(472, 152)).toBeLessThan(at(0, 368));
    // Half way through, the middle is open and the far corner is not.
    expect(at(472, 152)).toBeLessThan(0.5);
    expect(at(0, 368)).toBeGreaterThan(0.5);
  });
});

describe('the time in Auckland on the title screen', () => {
  it('names the part of the day the city is lit for', () => {
    expect(dayPart(SOLAR.morning)).toBe('Morning');
    expect(dayPart(SOLAR.afternoon)).toBe('Afternoon');
    expect(dayPart(SOLAR.dusk)).toBe('Dusk');
    expect(dayPart(SOLAR.night)).toBe('Night');
    expect(dayPart(6)).toBe('Dawn');
    expect(dayPart(3)).toBe('Night');
    expect(dayPart(27)).toBe('Night');
    expect(dayPart(-18)).toBe('Dawn');
  });

  it('reads the clock on the wall there, whatever the visitor\'s own zone', () => {
    // 26 November 2026, 20:41 UTC is 9:41 the next morning in Auckland (NZDT, UTC+13).
    expect(aucklandTime(new Date(Date.UTC(2026, 10, 25, 20, 41)))).toBe('9:41 am');
    // 1 July, 05:05 UTC is 5:05 in the evening (NZST, UTC+12).
    expect(aucklandTime(new Date(Date.UTC(2026, 6, 1, 5, 5)))).toBe('5:05 pm');
    expect(aucklandTime(new Date(Date.UTC(2026, 6, 1, 12, 0)))).toBe('12:00 am');
  });
});
