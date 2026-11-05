/**
 * The Sky Deck at runtime: video screens, plaques and a sign (added to the world scene), and a
 * first-person camera driven by the walker. Videos and text textures are made on the first visit
 * only, so a visitor who never lands downloads nothing extra.
 */
import {
  CanvasTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  VideoTexture,
} from 'three';
import type { MapMeta } from '../shared/mapFormat';
import { type Hotspot, SKY_DECK as D, SKY_DECK_SPOTS, apothem, facetAngle } from './layout';
import { type Walker, hotspotAt, spawnWalker, stepWalker } from './walker';

export interface SkyDeck {
  readonly group: Group;
  readonly camera: PerspectiveCamera;
  enter(): void;
  leave(): void;
  /** Walk by the player's controls and place the camera; returns the hotspot in front of them. */
  step(dt: number, controls: { turn: number; pitch: number; boost?: boolean }): Hotspot | null;
  setAspect(aspect: number): void;
  walker(): Walker;
  /** Debug and tests: stand somewhere specific. */
  place(w: Walker): void;
  dispose(): void;
}

const PANEL = 0x0b1c20;
const CREAM = '#f4ecd8';
const KOWHAI = '#f2c230';

/** A crisp text texture in the site's pixel font. */
function textTexture(lines: { text: string; size: number; color: string }[], w: number, h: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#15181b';
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lines.reduce((a, l) => a + l.size, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    g.font = `${l.size}px "Jersey 10", ui-monospace, monospace`;
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, y + l.size / 2 + 1);
    y += l.size;
  }
  const t = new CanvasTexture(c);
  // Mipmapped so small signs stay legible from across the deck (the low-res render keeps them pixel-art).
  t.magFilter = NearestFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createSkyDeck(meta: MapMeta): SkyDeck {
  const { x: cx, z: cz, groundY } = meta.landmarks.skyTower;
  const F = groundY + D.floor;
  const ap = apothem(D.coreRadius);
  const group = new Group();
  group.name = 'sky-deck-screens';
  group.visible = false;
  const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 3500);
  camera.rotation.order = 'YXZ';
  const geo = new PlaneGeometry(1, 1);
  const disposables: { dispose(): void }[] = [geo];
  const tmp = new Vector3();

  /** A plane on a core facet, `out` metres off the wall, centred at height y above the floor. */
  function mount(facet: number, out: number, y: number, w: number, h: number, mat: MeshBasicMaterial): Mesh {
    const phi = facetAngle(facet);
    const m = new Mesh(geo, mat);
    m.position.set(cx + Math.cos(phi) * (ap + out), F + y, cz + Math.sin(phi) * (ap + out));
    m.scale.set(w, h, 1);
    m.lookAt(tmp.set(m.position.x + Math.cos(phi), m.position.y, m.position.z + Math.sin(phi)));
    group.add(m);
    disposables.push(mat);
    return m;
  }

  const screens = SKY_DECK_SPOTS.filter((s) => s.kind === 'screen').map((spot) => ({
    spot,
    mat: new MeshBasicMaterial({ color: PANEL, toneMapped: false }),
    video: null as HTMLVideoElement | null,
  }));
  for (const s of screens) mount(s.spot.facet, 0.075, 1.77, 2.7, 1.52, s.mat);

  // Text goes on once the pixel font is ready (first visit).
  const plaques: { facet: number; out: number; y: number; w: number; h: number; px: [number, number]; lines: { text: string; size: number; color: string }[] }[] = [
    ...SKY_DECK_SPOTS.filter((s) => s.kind === 'screen').map((s) => ({
      facet: s.facet, out: 0.055, y: 0.72, w: 1.7, h: 0.26, px: [208, 32] as [number, number],
      lines: [{ text: s.title.toUpperCase(), size: 24, color: CREAM }],
    })),
    ...SKY_DECK_SPOTS.filter((s) => s.kind === 'lift').map((s) => ({
      facet: s.facet, out: 0.1, y: 2.95, w: 1.2, h: 0.3, px: [128, 32] as [number, number],
      lines: [{ text: 'LIFT', size: 24, color: KOWHAI }],
    })),
    {
      facet: 1, out: 0.02, y: 2.0, w: 2.6, h: 1.1, px: [208, 88] as [number, number],
      lines: [
        { text: 'SKY DECK', size: 40, color: CREAM },
        { text: 'PROJECTS ON THE SCREENS', size: 16, color: KOWHAI },
        { text: 'THE REAL CITY OUT THE WINDOWS', size: 16, color: KOWHAI },
      ],
    },
  ];
  let mediaReady = false;

  function loadMedia(): void {
    if (mediaReady) return;
    mediaReady = true;
    const draw = () => {
      for (const p of plaques) {
        const tex = textTexture(p.lines, p.px[0], p.px[1]);
        disposables.push(tex);
        mount(p.facet, p.out, p.y, p.w, p.h, new MeshBasicMaterial({ map: tex, toneMapped: false }));
      }
    };
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) void fonts.load('24px "Jersey 10"').then(draw, draw);
    else draw();

    for (const s of screens) {
      if (!s.spot.video) continue;
      const v = document.createElement('video');
      v.src = s.spot.video;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.setAttribute('aria-hidden', 'true');
      const tex = new VideoTexture(v);
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = false;
      disposables.push(tex);
      v.addEventListener(
        'playing',
        () => {
          s.mat.map = tex;
          s.mat.color.set(0xffffff);
          s.mat.needsUpdate = true;
        },
        { once: true },
      );
      s.video = v;
    }
  }

  let w: Walker = spawnWalker();
  let walked = 0;

  function pose(): void {
    const bob = Math.sin(walked * 2.4) * 0.025;
    camera.position.set(cx + w.x, F + D.eye + bob, cz + w.z);
    camera.rotation.set(-0.05, -w.yaw, 0);
  }

  return {
    group,
    camera,
    enter() {
      loadMedia();
      w = spawnWalker();
      walked = 0;
      group.visible = true;
      for (const s of screens) void s.video?.play().catch(() => {});
      pose();
    },
    leave() {
      group.visible = false;
      for (const s of screens) s.video?.pause();
    },
    step(dt, c) {
      const next = stepWalker(w, c, dt);
      walked += Math.hypot(next.x - w.x, next.z - w.z);
      w = next;
      pose();
      return hotspotAt(w);
    },
    setAspect(aspect) {
      if (Math.abs(camera.aspect - aspect) > 1e-3) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    },
    walker: () => ({ ...w }),
    place(next) {
      w = { ...next };
      pose();
    },
    dispose() {
      for (const s of screens) {
        s.video?.pause();
        s.video?.removeAttribute('src');
      }
      for (const d of disposables) d.dispose();
    },
  };
}
