/** The assembled 3D world: implements WorldScene on top of the low-res renderer. */
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  type ShaderMaterial,
  Sphere,
  type Texture,
  Vector3,
  Vector4,
} from 'three';
import type { StopPlacement, WorldDetail, WorldScene, WorldStats } from '../app/contracts';
import type { StopId } from '../content/types';
import type { WorldQuery } from '../shared/collision';
import { FOG_FAR } from '../shared/detail';
import type { MapMeta } from '../shared/mapFormat';
import type { Look } from '../shared/timeOfDay';
import { type Ambient, createAmbient } from '../world/ambient';
import type { BuildOutput } from '../world/buildWorld';
import { buildHarbourBridge } from '../world/landmarks/harbourBridge';
import { buildRangitoto } from '../world/landmarks/rangitoto';
import { buildSkyDeck } from '../world/landmarks/skyDeck';
import { buildSkyTower } from '../world/landmarks/skyTower';
import { Beacons } from './beacons';
import {
  createBuildingMaterial,
  createLandmarkMaterial,
  createOutskirtsMaterial,
  createSkyMaterial,
  createTerrainMaterial,
  createWaterMaterial,
} from './materials';
import { PixelRenderer } from './pixelRenderer';
import { type SharedUniforms, applyLook, createSharedUniforms } from './uniforms';

export { FOG_FAR } from '../shared/detail';
/** Rangitoto is drawn at most this far from the camera (inside the 3500 m far plane), scaled to keep its angular size. */
const BACKDROP_DISTANCE = 3300;

export interface WorldParts {
  canvas: HTMLCanvasElement;
  meta: MapMeta;
  query: WorldQuery;
  quality: keyof typeof FOG_FAR;
  ground: Texture;
  built: BuildOutput;
}

function meshGeometry(m: { positions: Float32Array; uvs: Float32Array; indices: Uint32Array }): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('uv', new BufferAttribute(m.uvs, 2));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export class WorldSceneImpl implements WorldScene {
  readonly meta: MapMeta;
  readonly query: WorldQuery;
  readonly renderer: PixelRenderer['renderer'];
  readonly scene = new Scene();
  readonly shared: SharedUniforms;
  get lighting(): SharedUniforms {
    return this.shared;
  }
  private px: PixelRenderer;
  private beacons: Beacons;
  private disposables: { dispose(): void }[] = [];
  private chunkMeshes: Mesh[] = [];
  private rangitoto: Mesh;
  private rangitotoBase = new Vector3();
  private sky: Mesh;
  private water: Mesh;
  private fogFar: number;
  private skyDeck: Mesh;
  private ambient: Ambient;
  private lastRender = 0;
  private fps = 60;
  private frameMs = 0;
  private tmp = new Vector3();

  constructor(parts: WorldParts) {
    this.meta = parts.meta;
    this.query = parts.query;
    this.px = new PixelRenderer(parts.canvas);
    this.renderer = this.px.renderer;
    this.fogFar = FOG_FAR[parts.quality];
    this.shared = createSharedUniforms(this.fogFar);
    const sh = this.shared;
    const meta = parts.meta;
    const track = <T extends { dispose(): void }>(o: T): T => {
      this.disposables.push(o);
      return o;
    };
    const ground = track(parts.ground);
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    ground.anisotropy = maxAniso;

    // Sky: one full-screen triangle, drawn first, no depth.
    const skyGeo = track(new BufferGeometry());
    skyGeo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const skyMat = track(createSkyMaterial(sh));
    this.sky = new Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.name = 'sky';
    this.scene.add(this.sky);

    // Terrain and outskirts.
    const terrainGeo = track(meshGeometry(parts.built.terrainMesh));
    const terrain = new Mesh(terrainGeo, track(createTerrainMaterial(sh, ground)));
    terrain.name = 'terrain';
    this.scene.add(terrain);
    const outGeo = track(meshGeometry(parts.built.outskirts));
    const outskirts = new Mesh(outGeo, track(createOutskirtsMaterial(sh, ground)));
    outskirts.name = 'outskirts';
    this.scene.add(outskirts);

    // Water: a big plane at the water level, drawn after the opaque objects.
    const b = meta.bounds;
    const rect = new Vector4(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    const waterGeo = track(new PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2));
    const water = new Mesh(waterGeo, track(createWaterMaterial(sh, ground, rect)));
    water.position.set(0, meta.water.level, 0);
    water.frustumCulled = false;
    water.renderOrder = 10;
    water.name = 'water';
    this.water = water;
    this.scene.add(water);

    // Buildings: one mesh per 1 km chunk.
    const buildingMat = track(createBuildingMaterial(sh));
    for (const c of parts.built.chunks) {
      const g = track(new BufferGeometry());
      g.setAttribute('position', new BufferAttribute(c.positions, 3));
      g.setAttribute('aStyle', new BufferAttribute(c.style, 2, false));
      g.setIndex(new BufferAttribute(c.indices, 1));
      g.boundingSphere = new Sphere(new Vector3(c.sphere.x, c.sphere.y, c.sphere.z), c.sphere.r);
      const m = new Mesh(g, buildingMat);
      m.name = `buildings-${c.key}`;
      this.chunkMeshes.push(m);
      this.scene.add(m);
    }

    // Landmarks.
    const lmMat = track(createLandmarkMaterial(sh, 1));
    const tower = new Mesh(track(buildSkyTower(meta)), lmMat);
    tower.name = 'sky-tower';
    this.scene.add(tower);
    // The Sky Deck interior, shown only while visiting. Its own material: a room is lit by its own
    // lamps at night, not by the moon.
    this.skyDeck = new Mesh(track(buildSkyDeck(meta)), track(createLandmarkMaterial(sh, 1, true)));
    this.skyDeck.name = 'sky-deck';
    this.skyDeck.visible = false;
    this.scene.add(this.skyDeck);
    const bridge = new Mesh(track(buildHarbourBridge(meta)), lmMat);
    bridge.name = 'harbour-bridge';
    this.scene.add(bridge);

    const rMat = track(createLandmarkMaterial(sh, 0.72));
    this.rangitoto = new Mesh(track(buildRangitoto(meta)), rMat);
    this.rangitoto.name = 'rangitoto';
    this.rangitoto.frustumCulled = false;
    this.rangitotoBase.set(meta.landmarks.rangitoto.x, 0, meta.landmarks.rangitoto.z);
    this.rangitoto.position.copy(this.rangitotoBase);
    this.scene.add(this.rangitoto);

    this.beacons = new Beacons(sh);
    this.disposables.push(this.beacons);
    this.scene.add(this.beacons.group);

    // Ferries and bridge traffic.
    this.ambient = track(createAmbient(meta, parts.query, sh, parts.quality));
    this.scene.add(this.ambient.group);
  }

  /** Compile all shaders once, off the critical path. */
  async warmUp(): Promise<void> {
    const cam = new PerspectiveCamera(60, 16 / 9, 0.5, 3500);
    cam.position.set(0, 300, 0);
    cam.updateMatrixWorld();
    await this.renderer.compileAsync(this.scene, cam);
  }

  add(object: Object3D): void {
    this.scene.add(object);
  }

  setStops(stops: StopPlacement[]): void {
    this.beacons.setStops(stops);
  }

  setActiveStop(id: StopId | null): void {
    this.beacons.setActive(id);
  }

  /** Inside the Sky Deck: show the room, hide the beacons (their columns run through the tower). */
  setInterior(on: boolean): void {
    this.skyDeck.visible = on;
    this.beacons.group.visible = !on;
  }

  update(dt: number, time: number, camera: Camera): void {
    this.shared.uTime.value = time;
    this.beacons.update(dt);
    this.ambient.update(time);
    camera.getWorldPosition(this.tmp);
    const cp = this.tmp;
    // Skip chunks entirely inside fully-fogged distance.
    for (const m of this.chunkMeshes) {
      const s = m.geometry.boundingSphere;
      if (!s) continue;
      const d = Math.hypot(s.center.x - cp.x, s.center.y - cp.y, s.center.z - cp.z);
      m.visible = d - s.radius < this.fogFar;
    }
    // Rangitoto: scaled towards the camera so it sits inside the far plane at the same angular size.
    const base = this.rangitotoBase;
    const dist = Math.hypot(base.x - cp.x, base.y - cp.y, base.z - cp.z);
    const k = Math.min(1, BACKDROP_DISTANCE / Math.max(dist, 1));
    this.rangitoto.scale.setScalar(k);
    this.rangitoto.position.set(cp.x + (base.x - cp.x) * k, cp.y + (base.y - cp.y) * k, cp.z + (base.z - cp.z) * k);
  }

  render(camera: Camera): void {
    if (this.px.contextLost) return;
    const t0 = performance.now();
    camera.updateMatrixWorld();
    const mat = this.sky.material as ShaderMaterial;
    const proj = camera as PerspectiveCamera;
    mat.uniforms.uInvProj.value.copy(proj.projectionMatrixInverse);
    mat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    this.renderer.render(this.scene, camera);
    const t1 = performance.now();
    this.frameMs += (t1 - t0 - this.frameMs) * 0.1;
    if (this.lastRender > 0) {
      const dt = t1 - this.lastRender;
      if (dt > 0) this.fps += (1000 / dt - this.fps) * 0.1;
    }
    this.lastRender = t1;
  }

  setIconClip(left: number | null): void {
    this.shared.uIconClipLeft.value = left ?? -2;
  }

  setLook(look: Look): void {
    applyLook(this.shared, look);
    const sky = (this.sky.material as ShaderMaterial).uniforms;
    sky.uZenith.value.setRGB(...look.zenith);
    sky.uSunColor.value.setRGB(...look.sun);
    sky.uDiscColor.value.setRGB(...look.disc);
    sky.uCloud.value = look.cloud;
    const water = (this.water.material as ShaderMaterial).uniforms;
    water.uDeep.value.setRGB(...look.waterDeep);
    water.uShallow.value.setRGB(...look.waterShallow);
  }

  setDetail(d: WorldDetail): void {
    if (d.fogFar !== this.fogFar) {
      // Fog distance is also the cull distance (see update), so less is drawn as well as less shown.
      this.fogFar = d.fogFar;
      this.shared.uFogFar.value = d.fogFar;
      this.shared.uFogNear.value = Math.round(d.fogFar * 0.1);
    }
    if (d.extraScale !== this.px.extraScale) this.shared.uResY.value = this.px.setExtraScale(d.extraScale).height;
  }

  onContextChange(cb: (lost: boolean) => void): void {
    this.px.onContextChange = cb;
  }

  resize(cssWidth: number, cssHeight: number): { width: number; height: number } {
    const r = this.px.resize(cssWidth, cssHeight);
    this.shared.uResY.value = r.height;
    return r;
  }

  stats(): WorldStats {
    const info = this.renderer.info.render;
    return {
      fps: Math.round(this.fps * 10) / 10,
      frameMs: Math.round(this.frameMs * 100) / 100,
      drawCalls: info.calls,
      triangles: info.triangles,
      internalWidth: this.px.width,
      internalHeight: this.px.height,
      pixelScale: this.px.scale,
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.scene.clear();
    this.px.dispose();
  }
}
