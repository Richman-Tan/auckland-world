/**
 * All materials: custom GLSL3 ShaderMaterials sharing one set of uniforms and the chunks in
 * shaderChunks.ts. Colours are written straight to the framebuffer (no tone mapping, no
 * colour-space conversion), so palette hex values appear as authored.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  GLSL3,
  Matrix4,
  ShaderMaterial,
  type Texture,
  Vector3,
  Vector4,
} from 'three';
import { LAND_CLASSES, LAND_COLOUR } from '../shared/land';
import { ACCENTS, GROUND, type PaletteKey, SKY, WATER, hexToRgb } from '../shared/palette';
import { LAND_LIB, LAND_UNIFORMS } from './groundChunks';
import { COMMON_UNIFORMS, FRAG_OUT, PIXEL_LIB, VERT_WORLD } from './shaderChunks';
import type { SharedUniforms } from './uniforms';

const col = (hex: string) => new Color(...hexToRgb(hex));

type Own = Record<string, { value: unknown }>;

function make(
  shared: SharedUniforms,
  vertexShader: string,
  fragmentShader: string,
  own: Own = {},
  extra: Partial<ConstructorParameters<typeof ShaderMaterial>[0]> = {},
): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: { ...shared, ...own },
    vertexShader,
    fragmentShader: `${COMMON_UNIFORMS}${FRAG_OUT}${PIXEL_LIB}${fragmentShader}`,
    ...extra,
  });
}

/** Clamp clip-space depth so geometry beyond the camera's far plane is not clipped (backdrops, beacons). */
const FAR_CLAMP = /* glsl */ `gl_Position.z = min(gl_Position.z, gl_Position.w * 0.9999);`;

/* --------------------------------------------------------------------- sky */

export function createSkyMaterial(shared: SharedUniforms): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
out vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`,
    /* glsl */ `
in vec2 vNdc;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uZenith;
uniform vec3 uSunColor;
uniform vec3 uDiscColor;
uniform float uCloud;

void main() {
  vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);
  float b = bayer4(gl_FragCoord.xy);
  float e = max(dir.y, 0.0);
  float t = pow(e, 0.5);
  t = floor(t * 7.0 + b) / 7.0;
  vec3 col = mix(uFogColor, uZenith, clamp(t, 0.0, 1.0));

  // Stars: one pixel each, on a grid fixed to the sky, a few of them twinkling. Night only.
  if (uNight > 0.01 && dir.y > 0.02) {
    vec2 sp = dir.xz / (dir.y + 0.25) * 60.0;
    float h = hash21(floor(sp));
    vec2 f = abs(fract(sp) - 0.5);
    // one screen pixel on each axis, however the grid is stretched towards the horizon
    float dot1 = step(f.x, fwidth(sp.x) * 0.6) * step(f.y, fwidth(sp.y) * 0.6);
    float twinkle = 0.55 + 0.45 * step(0.5, fract(h * 91.0 + uTime * 0.35));
    // sparse, and only once it is properly dark (not at dusk)
    float star = step(0.955, h) * dot1 * twinkle * smoothstep(0.45, 0.95, uNight) * smoothstep(0.06, 0.4, dir.y);
    col = mix(col, vec3(0.92, 0.95, 1.0), star);
  }

  // Clouds: two bands of drifting noise in three dithered steps, taking their colour from the
  // horizon and the sun so they turn gold at dusk and grey-blue at night.
  if (uCloud > 0.01 && dir.y > 0.0) {
    vec2 cp = dir.xz / (dir.y + 0.12);
    float n = vnoise(cp * 1.3 + vec2(uTime * 0.006, 0.0)) * 0.65 + vnoise(cp * 3.1 - vec2(uTime * 0.01, uTime * 0.004)) * 0.35;
    float th = mix(0.85, 0.35, uCloud);
    float cover = smoothstep(th, th + 0.18, n) * smoothstep(0.0, 0.12, dir.y);
    cover = floor(cover * 3.0 + b) / 3.0;
    col = mix(col, mix(uFogColor, uSunColor, 0.45), clamp(cover, 0.0, 1.0) * 0.85);
  }

  float s = dot(dir, uSunDir);
  float glow = smoothstep(0.80, 0.995, s);
  glow = floor(glow * 4.0 + b * 0.8) / 4.0;
  col = mix(col, uSunColor, glow * 0.35);
  float disc = step(0.9988, s);
  float ring = step(0.9965, s);
  col = mix(col, uSunColor, ring * 0.55);
  col = mix(col, uDiscColor, disc);
  outColor = vec4(col, 1.0);
}`,
    {
      uInvProj: { value: new Matrix4() },
      uCamWorld: { value: new Matrix4() },
      uZenith: { value: col(SKY.zenith) },
      uSunColor: { value: col(SKY.sun) },
      uDiscColor: { value: new Color(1.0, 0.97, 0.85) },
      uCloud: { value: 0 },
    },
    { depthTest: false, depthWrite: false, side: FrontSide },
  );
}

/* ----------------------------------------------------------------- terrain */

/** What the close-up ground is drawn from: the land grid as a texture, and where it lies. */
export interface LandSource {
  texture: Texture;
  /** The map's north-west corner. */
  minX: number;
  minZ: number;
  /** Cell size, metres. */
  cell: number;
}

/**
 * The terrain. Without `land` it is the painted ground image and nothing else, which is what is
 * shown first. With it (the material is swapped once land.bin has loaded) the ground within
 * uGroundR of the camera is drawn from the land grid instead (groundChunks.ts), behind a dithered
 * edge, and tree canopy tints the painted ground beyond.
 */
export function createTerrainMaterial(shared: SharedUniforms, ground: Texture, land?: LandSource): ShaderMaterial {
  const vertex = /* glsl */ `
out vec2 vUv;
${VERT_WORLD.replace('void main() {', 'void main() {\n  vUv = uv;')}`;
  if (!land) {
    return make(
      shared,
      vertex,
      /* glsl */ `
in vec3 vWorld;
in vec2 vUv;
uniform sampler2D uGround;
void main() {
  vec4 t = texture(uGround, vUv);
  if (t.a < 0.5) discard;
  vec3 n = flatNormal(vWorld);
  vec3 lit = mix(uAmbient, lambert3(n), 0.45);
  vec3 c = t.rgb * lit * planeShadow(vWorld);
  float d = length(vWorld - cameraPosition);
  outColor = vec4(pixelFog(c, d, 1.0), 1.0);
}`,
      { uGround: { value: ground } },
    );
  }
  return make(
    shared,
    vertex,
    /* glsl */ `
in vec3 vWorld;
in vec2 vUv;
uniform sampler2D uGround;
${LAND_UNIFORMS}
${LAND_LIB}
void main() {
  // Everything that needs screen-space derivatives is read before the branch below.
  vec4 t = texture(uGround, vUv);
  vec2 p = vWorld.xz;
  vec2 q = (p - uLandGrid.xy) * uLandGrid.z;
  float canopy = texture(uLand, q / vec2(textureSize(uLand, 0))).g;
  vec2 fw = fwidth(p);
  float px = max(max(fw.x, fw.y), 0.0001);
  vec3 n = flatNormal(vWorld);
  float d = length(vWorld - cameraPosition);
  float dither = bayer4(gl_FragCoord.xy);

  float nearK = uGroundR > 1.0 ? uDetail * (1.0 - smoothstep(0.7 * uGroundR, uGroundR, d)) : 0.0;
  vec3 c;
  if (nearK > dither) {
    float shore = shoreAt(uGround, vUv);
    if (shore < 0.5) discard;
    // The class is read from a position that wanders a metre or two, so boundaries are not ruled lines.
    vec2 wander = (vec2(vnoise(p * 0.13), vnoise(p * 0.13 + 23.1)) - 0.5) * 0.55;
    int cls = voteClass(q + wander);
    c = landColour(cls, p, px) * hillBand(n);
    if (cls != ${LAND_CLASSES.indexOf('water')}) {
      // Canopy, given some height by the light: its sunward edge is bright, and the ground just
      // beyond its far edge is in its shadow. One more reading, three metres towards the sun.
      vec2 sunward = normalize(uSunDir.xz + vec2(1e-4, 0.0)) * 3.0;
      float crown = crownAt(canopy, p);
      float crownSunward = crownAt(textureLod(uLand, (q + sunward * uLandGrid.z) / vec2(textureSize(uLand, 0)), 0.0).g, p + sunward);
      c *= 1.0 - 0.24 * (1.0 - crown) * crownSunward;
      c = mix(c, crownColour(p, px) * (1.0 + 0.2 * (1.0 - crownSunward)), crown);
    }
    // The water's edge: a line of wet foam where the land stops.
    c = mix(c, uShoreCol, step(shore, 0.72));
  } else {
    if (t.a < 0.5) discard;
    // Canopy over the painted ground: three dithered steps of green, by how much of it there is.
    float cover = smoothstep(0.2, 0.8, canopy);
    c = mix(t.rgb, uCanopyCol, 0.85 * uDetail * floor(cover * 3.0 + dither) / 3.0);
  }
  vec3 lit = mix(uAmbient, lambert3(n), 0.45);
  c *= lit * planeShadow(vWorld);
  outColor = vec4(pixelFog(c, d, 1.0), 1.0);
}`,
    {
      uGround: { value: ground },
      uLand: { value: land.texture },
      uLandGrid: { value: new Vector4(land.minX, land.minZ, 1 / land.cell, 0) },
      uGroundR: { value: 0 },
      uDetail: { value: 0 },
      uLandCol: { value: LAND_CLASSES.map((k) => col(GROUND[LAND_COLOUR[k]])) },
      uCanopyCol: { value: col(GROUND.canopy) },
      uShoreCol: { value: col(GROUND.foam) },
    },
  );
}

/** The coarse ring beyond the world rectangle: low mip of the ground texture, clamped UVs, heavily fogged. */
export function createOutskirtsMaterial(shared: SharedUniforms, ground: Texture): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
out vec2 vUv;
${VERT_WORLD.replace('void main() {', 'void main() {\n  vUv = uv;')}`,
    /* glsl */ `
in vec3 vWorld;
in vec2 vUv;
uniform sampler2D uGround;
void main() {
  vec4 t = textureLod(uGround, clamp(vUv, 0.001, 0.999), 6.0);
  if (t.a < 0.5) discard;
  vec3 n = flatNormal(vWorld);
  vec3 c = t.rgb * mix(uAmbient, lambert3(n), 0.45) * 0.92;
  float d = length(vWorld - cameraPosition);
  outColor = vec4(pixelFog(c, d * 1.35, 1.0), 1.0);
}`,
    { uGround: { value: ground } },
  );
}

/* ------------------------------------------------------------------- water */

/**
 * The sea. Where the land is comes from the ground image's alpha, read from its smaller copies
 * (`shoreLod`: the level whose pixels are about six metres), which the sampler blends between their
 * pixels: so the foam and the pale shallows follow the shore as smooth bands rather than as the
 * image's squares.
 */
export function createWaterMaterial(shared: SharedUniforms, ground: Texture, rect: Vector4, shoreLod = 1): ShaderMaterial {
  return make(
    shared,
    VERT_WORLD,
    /* glsl */ `
in vec3 vWorld;
uniform sampler2D uGround;
uniform vec4 uRect; // minX, minZ, width, depth of the ground texture
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSparkle;
uniform float uShoreLod;

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // slow, quantised wave bands
  float w = sin(p.x * 0.031 + p.y * 0.017 + t * 0.45)
          + sin(p.x * -0.013 + p.y * 0.043 - t * 0.33)
          + sin(p.x * 0.083 + p.y * 0.061 + t * 0.7) * 0.6;
  w = w / 2.6;
  float q = floor(w * 2.0 + 2.0) / 4.0;

  // How much land is close by: within a few metres (nearL) and within fifteen or so (farL), each
  // rising smoothly from 0 out at sea to about a half at the shoreline.
  float nearL = 0.0;
  float farL = 0.0;
  // Read from a position that wanders a few metres, so the bands are not the sampler's straight lines.
  vec2 sway = (vec2(vnoise(p * 0.06), vnoise(p * 0.06 + 7.3)) - 0.5) * 7.0;
  vec2 uv = (p + sway - uRect.xy) / uRect.zw;
  if (dist < 2400.0 && uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
    nearL = textureLod(uGround, uv, uShoreLod).a;
    farL = textureLod(uGround, uv, uShoreLod + 1.6).a;
  }
  float dither = bayer4(gl_FragCoord.xy);
  vec3 c = mix(uDeep, uShallow, 0.30 + 0.45 * q);
  // The shallows: paler in three dithered steps towards the shore.
  float shallow = clamp(farL * 1.7 + nearL * 0.3, 0.0, 0.8);
  c = mix(c, uShallow * 1.08, floor(shallow * 3.0 + dither) / 3.0);

  // Foam: a solid fringe at the shore that the swell pushes in and out a little, and a faint
  // moving band just outside it.
  float band = step(0.35, sin((p.x + p.y) * 0.05 - t * 1.4) * 0.5 + 0.5);
  float lap = 0.1 + 0.04 * sin(t * 0.8 + p.x * 0.07 + p.y * 0.05);
  // Only against real shore: a jetty or a pontoon a few metres wide is land in the image but has
  // no surf, and shows up here as very little land in the wider reading.
  float shore = step(0.2, farL);
  float fringe = step(lap, nearL) * shore;
  float foam = fringe + (1.0 - fringe) * shore * band * 0.45;
  foam *= 1.0 - smoothstep(1400.0, 2400.0, dist);
  c = mix(c, uFoam * uAmbient, clamp(foam, 0.0, 1.0));

  // sparse sparkles
  float h = hash21(floor(p / 4.0) + floor(t * 4.0) * 17.0);
  vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
  float glint = max(dot(R, uSunDir), 0.0);
  float thr = 0.9993 - 0.004 * step(0.7, glint) - 0.004 * step(0.9, glint);
  float spark = step(thr, h) * (1.0 - smoothstep(300.0, 1100.0, dist));
  // sun glitter fades out with the daylight
  c = mix(c, uSparkle, spark * (1.0 - uNight));

  // lighter towards the horizon
  float up = clamp(V.y, 0.0, 1.0);
  c = mix(c, uFogColor, pow(1.0 - up, 3.0) * 0.4);
  c *= planeShadow(vWorld);

  outColor = vec4(pixelFog(c, dist, 1.0), 1.0);
}`,
    {
      uGround: { value: ground },
      uRect: { value: rect },
      uDeep: { value: col(WATER.deep) },
      uShallow: { value: col(WATER.shallow) },
      uFoam: { value: col(WATER.foam) },
      uSparkle: { value: col(WATER.sparkle) },
      uShoreLod: { value: shoreLod },
    },
  );
}

/* --------------------------------------------------------------- buildings */

export function createBuildingMaterial(shared: SharedUniforms): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
in vec2 aStyle;
out vec3 vWorld;
flat out vec2 vStyle;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vStyle = aStyle;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    /* glsl */ `
in vec3 vWorld;
flat in vec2 vStyle;
uniform vec3 uWall[16];
uniform vec3 uRoof[16];
void main() {
  vec3 n = flatNormal(vWorld);
  int st = int(vStyle.x + 0.5);
  bool roof = n.y > 0.5;
  vec3 alb = roof ? uRoof[(st >> 4) & 15] : uWall[st & 15];
  vec3 shade = lambert3(n);
  vec3 c = alb * shade;
  float dist = length(vWorld - cameraPosition);

  if (!roof && vStyle.y > 12.0 && n.y > -0.5) {
    // procedural windows: floors every 3.2 m, columns every 2.8 m along the wall
    vec2 hn = normalize(n.xz + vec2(1e-5));
    float along = dot(vWorld.xz, vec2(-hn.y, hn.x));
    vec2 cell = vec2(along / 2.8, vWorld.y / 3.2);
    vec2 f = fract(cell);
    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.28, f.y) * step(f.y, 0.80);
    float fw = max(fwidth(cell.x), fwidth(cell.y));
    float fade = 1.0 - smoothstep(0.22, 0.5, fw);
    // About one window in seven is lit in the afternoon; by night half of them are.
    float lit = step(mix(0.86, 0.5, uNight), hash21(floor(cell)));
    vec3 glass = mix(alb * 0.42, vec3(0.16, 0.34, 0.38), 0.65);
    glass = mix(glass, vec3(1.0, 0.82, 0.45), lit * 0.8);
    vec3 wc = mix(alb * shade, glass * mix(shade, vec3(1.0), lit), win);
    // far away the pattern averages out to a slightly darker wall, with a warm lift from the lit
    // windows at night so distant towers still read as occupied
    vec3 farC = alb * shade * 0.9 + vec3(0.5, 0.38, 0.18) * (uNight * 0.24);
    c = mix(farC, wc, fade);
  }
  c *= planeShadow(vWorld);
  outColor = vec4(pixelFog(c, dist, 1.0), 1.0);
}`,
    { uWall: shared.uWall, uRoof: shared.uRoof },
  );
}

/* --------------------------------------------------------------- landmarks */

/**
 * Vertex-coloured, flat-lit. The colour's alpha says what kind of surface it is (see the ALPHA_*
 * constants in world/landmarks/builder.ts): 1 is normal, ~0.5 the blinking aircraft light, ~0.69 a
 * window band and ~0.82 a floodlit face. The last two look ordinary by day and light up at night.
 * `fogCap` limits the fog amount (Rangitoto keeps a readable silhouette). `interior` marks a room,
 * which is lit by its own lamps whatever the hour.
 */
export function createLandmarkMaterial(shared: SharedUniforms, fogCap = 1.0, interior = false): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
in vec4 aColor;
out vec3 vWorld;
out vec4 vColor;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    /* glsl */ `
in vec3 vWorld;
in vec4 vColor;
uniform float uFogCap;
uniform float uInterior;
void main() {
  float dist = length(vWorld - cameraPosition);
  if (vColor.a < 0.6) {
    float blink = step(0.55, fract(uTime * 0.8));
    vec3 e = mix(vec3(0.25, 0.02, 0.03), vec3(1.0, 0.18, 0.15), blink);
    outColor = vec4(e, 1.0);
    return;
  }
  vec3 n = flatNormal(vWorld);
  vec3 c = vColor.rgb * lambert3(n);
  vec3 lamp = vColor.rgb * vec3(1.06, 1.0, 0.9);
  if (vColor.a < 0.9) {
    // window bands glow warm at night; floodlit faces show in their own light instead of the moon's
    c = mix(c, vColor.a < 0.75 ? vec3(1.0, 0.82, 0.45) : lamp, uNight);
  }
  c = mix(c, lamp, uInterior * uNight);
  // Out of doors only: nothing flies over the inside of a room.
  if (uInterior < 0.5) c *= planeShadow(vWorld);
  outColor = vec4(pixelFog(c, dist, uFogCap), 1.0);
}`,
    { uFogCap: { value: fogCap }, uInterior: { value: interior ? 1 : 0 } },
  );
}

/* ----------------------------------------------------------------- ambient */

/**
 * Boats and bridge traffic: instanced box models (render/boxes.ts with display colours), flat-lit and
 * fogged like everything else. aGlow marks a model's lamps, which are just paint by day and shine
 * at night: 1 a white head or mast light, 2 a red tail light, 3 a warm cabin window. An instance
 * colour, when the mesh has one, tints the paint but not the lamps.
 */
export function createAmbientMaterial(shared: SharedUniforms): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
in vec3 aTint;
in float aGlow;
out vec3 vWorld;
out vec3 vColor;
out float vGlow;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vGlow = aGlow;
  vColor = aTint;
#ifdef USE_INSTANCING_COLOR
  if (aGlow < 0.5) vColor *= instanceColor;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    /* glsl */ `
in vec3 vWorld;
in vec3 vColor;
in float vGlow;
void main() {
  float dist = length(vWorld - cameraPosition);
  vec3 c = vColor * lambert3(flatNormal(vWorld));
  if (vGlow > 0.5) {
    vec3 lamp = vGlow < 1.5 ? vec3(1.0, 0.96, 0.78) : (vGlow < 2.5 ? vec3(1.0, 0.16, 0.12) : vec3(1.0, 0.82, 0.45));
    c = mix(c, lamp, uNight);
  } else {
    c *= planeShadow(vWorld);
  }
  outColor = vec4(pixelFog(c, dist, 1.0), 1.0);
}`,
  );
}

/* ------------------------------------------------------------------- roads */

/**
 * Road ribbons (world/ribbons.ts). The mesh is a plain strip; everything that makes it a road is
 * painted here from two numbers on each vertex, how far across the road it is and how far along:
 * the seal with its patches, the kerb and footpath, edge lines, the centre line and lane dashes,
 * rail with its sleepers, and at night the pools of light under the lamps of main roads.
 *
 * Only what is near the camera is drawn (uRibbonR, with a dithered edge); beyond that the roads
 * painted into the ground image take over. Painted lines are drawn by how much of a pixel they
 * cover and are dropped once a pixel is wider than a lane marking can survive, so nothing sparkles.
 */
export function createRibbonMaterial(shared: SharedUniforms): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
in float aAcross;
in float aAlong;
in float aHalf;
in vec4 aInfo;
out vec3 vWorld;
out float vAcross;
out float vAlong;
out float vHalf;
flat out vec4 vInfo;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vAcross = aAcross;
  vAlong = aAlong;
  vHalf = aHalf;
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    /* glsl */ `
in vec3 vWorld;
in float vAcross;
in float vAlong;
in float vHalf;
flat in vec4 vInfo;
uniform float uRibbonR;
uniform float uDetail;
const float LANE = 3.3;

void main() {
  float dist = length(vWorld - cameraPosition);
  float dither = bayer4(gl_FragCoord.xy);
  float gate = uDetail * (1.0 - smoothstep(0.72 * uRibbonR, uRibbonR, dist));
  if (gate <= dither) discard;

  int cls = int(vInfo.x + 0.5);
  float lanes = vInfo.y;
  int flags = int(vInfo.z + 0.5);
  bool oneway = (flags & 1) != 0;
  bool marked = (flags & 2) != 0;
  float path = vInfo.w * 0.1;
  float a = abs(vAcross);
  float pxA = max(fwidth(vAcross), 0.0001);
  float pxL = max(fwidth(vAlong), 0.0001);
  // Markings are 10 to 25 cm wide: past this they are gone, not a scatter of dots.
  float fine = 1.0 - smoothstep(0.3, 0.7, pxA);

  vec3 c;
  float line = 0.0;
  vec3 paint = vec3(0.9, 0.89, 0.84);
  if (cls == 15) {
    // Rail: ballast, sleepers, and the two rails.
    c = vec3(0.45, 0.42, 0.38);
    float sleeper = step(0.55, fract(vAlong / 1.5)) * step(a, 1.3);
    c *= 1.0 - 0.28 * sleeper * keep(pxL, 1.5);
    line = painted(a - 0.72, 0.1, pxA) * fine;
    paint = vec3(0.66, 0.67, 0.7);
  } else {
    // Seal: newer on motorways, greyer on back streets, in patches a lane wide and a few metres long.
    c = cls >= 13 ? vec3(0.4, 0.37, 0.36) : (cls >= 8 ? vec3(0.32, 0.32, 0.35) : (cls <= 1 ? vec3(0.43, 0.42, 0.42) : vec3(0.36, 0.36, 0.39)));
    float worn = hash21(floor(vec2(vAlong / 6.0, (vAcross + 60.0) / LANE)) + vInfo.xy);
    c *= 1.0 + (worn - 0.5) * 0.1 * keep(pxL, 6.0);
    if (path > 0.0) {
      if (a > vHalf) {
        // Footpath: pale concrete with a joint every two metres.
        float joint = step(fract(vAlong / 2.0), 0.1) * keep(pxL, 2.0);
        c = vec3(0.7, 0.68, 0.63) * (1.0 - 0.14 * joint);
      }
      // The kerb between them.
      float kerb = painted(a - vHalf, 0.14, pxA) * (1.0 - smoothstep(0.5, 1.4, pxA));
      c = mix(c, vec3(0.82, 0.81, 0.76), kerb);
    }
    if (marked) {
      // Edge lines on main roads.
      if (cls >= 8) line = painted(a - (vHalf - 0.45), 0.1, pxA);
      // Lane boundaries sit every lane-width across; with an even number of lanes one is the centre.
      float even = 1.0 - mod(lanes, 2.0);
      float shift = even > 0.5 ? 0.0 : LANE * 0.5;
      float d = abs(mod(a + shift + LANE * 0.5, LANE) - LANE * 0.5);
      float dash = mix(0.3, step(fract(vAlong / 10.0), 0.3), keep(pxL, 10.0));
      if (a < vHalf - 1.2) {
        float on = painted(d, 0.12, pxA);
        bool centre = !oneway && even > 0.5 && a < LANE * 0.5;
        if (centre) on *= cls >= 6 ? (lanes > 3.5 ? 1.0 : dash) : 0.0;
        else on *= (lanes > 2.5 || (oneway && lanes > 1.5)) ? dash : 0.0;
        line = max(line, on);
      }
      line *= fine;
    }
  }
  c = mix(c, paint, step(dither, line * 0.999));

  vec3 n = flatNormal(vWorld);
  c *= mix(uAmbient, lambert3(n), 0.45);
  if (cls >= 8 && cls != 15) {
    // Street lamps: a warm pool every forty metres, alternate sides.
    float along = mod(vAlong, 40.0) - 20.0;
    float side = mod(floor(vAlong / 40.0), 2.0) < 0.5 ? 1.0 : -1.0;
    float pool = (1.0 - smoothstep(3.0, 15.0, length(vec2(along, vAcross - side * vHalf * 0.6))));
    c = mix(c, c * vec3(2.6, 2.1, 1.3) + vec3(0.05, 0.035, 0.01), pool * uNight * 0.85);
  }
  c *= planeShadow(vWorld);
  outColor = vec4(pixelFog(c, dist, 1.0), 1.0);
}`,
    { uRibbonR: { value: 0 }, uDetail: { value: 0 } },
    { side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 },
  );
}

/* ------------------------------------------------------------------- plane */

/**
 * The plane: one mesh of coloured boxes (flight/plane.ts), lit by the same three steps of light as
 * the city. Each vertex says which part it belongs to and where that part hinges, so the control
 * surfaces, the propeller and the boost flame all move here, in the vertex stage, in one draw call.
 *
 *   aPart  0 airframe  1 propeller  2 left aileron  3 right aileron  4 elevator  5 rudder
 *          6 boost flame  7 propeller disc
 *   aGlow  0 paint  1 red nav light  2 green nav light  3 strobe  4 landing light  5 flame
 *
 * uSurf is (aileron, elevator, rudder) in radians: positive rolls right, pitches up, yaws right.
 */
export function createPlaneMaterial(shared: SharedUniforms): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
in vec3 aTint;
in float aGlow;
in float aPart;
in vec3 aPivot;
uniform float uProp;
uniform vec3 uSurf;
uniform float uBoost;
out vec3 vWorld;
out vec3 vColor;
out float vGlow;
out float vPart;
out vec2 vDisc;
vec3 turnX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 turnY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
vec3 turnZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
void main() {
  vec3 p = position - aPivot;
  int part = int(aPart + 0.5);
  // Every surface hinges at its leading edge and trails towards the tail (+z).
  if (part == 1) p = turnZ(p, uProp);
  else if (part == 2) p = turnX(p, uSurf.x);
  else if (part == 3) p = turnX(p, -uSurf.x);
  else if (part == 4) p = turnX(p, -uSurf.y);
  else if (part == 5) p = turnY(p, uSurf.z);
  else if (part == 6) p *= vec3(step(0.001, uBoost), step(0.001, uBoost), uBoost);
  vDisc = p.xy;
  vec4 wp = modelMatrix * vec4(p + aPivot, 1.0);
  vWorld = wp.xyz;
  vColor = aTint;
  vGlow = aGlow;
  vPart = aPart;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    /* glsl */ `
in vec3 vWorld;
in vec3 vColor;
in float vGlow;
in float vPart;
in vec2 vDisc;
void main() {
  if (vPart > 6.5) {
    // The spinning propeller as a see-through disc: a ring of scattered pixels.
    float r = length(vDisc);
    if (r > 2.3 || r < 0.55 || bayer4(gl_FragCoord.xy) > 0.22) discard;
    outColor = vec4(vec3(0.2, 0.21, 0.24) * mix(vec3(1.0), uAmbient, 0.6), 1.0);
    return;
  }
  // Mostly the world's light, with a little of its own so it never sinks into the night.
  vec3 own = mix(vec3(1.0), uAmbient, 0.5);
  vec3 c = vColor * mix(lambert3(flatNormal(vWorld)), own, 0.25);
  if (vGlow > 0.5) {
    float blink = 0.55 + 0.45 * sin(uTime * 9.0);
    if (vGlow < 1.5) c = vec3(1.0, 0.19, 0.19) * (0.6 + 0.4 * blink);
    else if (vGlow < 2.5) c = vec3(0.21, 1.0, 0.48) * (0.6 + 0.4 * (1.0 - blink));
    else if (vGlow < 3.5) c = mix(c, vec3(1.0), step(0.88, fract(uTime * 0.8)));
    else if (vGlow < 4.5) c = mix(c, vec3(1.0, 0.96, 0.8), uNight);
    else c = vColor;
  }
  outColor = vec4(c, 1.0);
}`,
    { uProp: { value: 0 }, uSurf: { value: new Vector3() }, uBoost: { value: 0 } },
  );
}

/* ----------------------------------------------------------------- beacons */

export interface BeaconUniforms {
  uColor: { value: Color };
  uActive: { value: number };
}

export function createColumnMaterial(shared: SharedUniforms, color: PaletteKey): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
out vec3 vWorld;
out float vH;
out vec3 vNrm;
uniform float uHeight;
void main() {
  vH = position.y / uHeight;
  vNrm = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${FAR_CLAMP}
}`,
    /* glsl */ `
in vec3 vWorld;
in float vH;
in vec3 vNrm;
uniform vec3 uColor;
uniform float uActive;
uniform float uHeight;
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec2 hv = normalize(toCam.xz + vec2(1e-5));
  float rim = abs(dot(normalize(vNrm.xz + vec2(1e-5)), hv));
  float stripe = step(0.5, fract(vWorld.y / 16.0 - uTime * 0.4));
  float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
  float boost = 1.0 + uActive * (0.55 + 0.45 * pulse);
  float a = (0.20 + 0.26 * stripe) * pow(max(1.0 - vH, 0.0), 1.2);
  a *= (0.4 + 0.6 * rim) * boost;
  a *= mix(1.0, 0.75, smoothstep(1500.0, 4500.0, dist));
  a = clamp(a, 0.0, 1.0);
  a = floor(a * 6.0 + bayer4(gl_FragCoord.xy)) / 6.0;
  vec3 c = uColor * (1.0 + 0.35 * stripe + 0.25 * uActive);
  outColor = vec4(c, a);
}`,
    {
      uColor: { value: col(ACCENTS[color]) },
      uActive: { value: 0 },
      uHeight: { value: 700 },
    },
    {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    },
  );
}

export function createRingMaterial(shared: SharedUniforms, color: PaletteKey, radius: number): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
out vec3 vWorld;
out vec2 vLocal;
void main() {
  vLocal = position.xz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${FAR_CLAMP}
}`,
    /* glsl */ `
in vec3 vWorld;
in vec2 vLocal;
uniform vec3 uColor;
uniform float uActive;
uniform float uRadius;
void main() {
  float dist = length(cameraPosition - vWorld);
  float r = length(vLocal) / uRadius;
  float ph = fract(uTime * 0.5);
  float rp = 0.25 + 0.75 * ph;
  float pulse = step(abs(r - rp), 0.05 + 0.02 * uActive) * (1.0 - ph);
  float edge = step(0.9, r) * step(r, 1.0);
  float disc = 0.12 * step(r, 1.0);
  float a = (disc + edge * 0.6 + pulse * 0.8) * (1.0 + uActive * 0.8);
  a = clamp(a, 0.0, 1.0);
  a = floor(a * 5.0 + bayer4(gl_FragCoord.xy)) / 5.0;
  outColor = vec4(uColor * 1.2, a);
}`,
    {
      uColor: { value: col(ACCENTS[color]) },
      uActive: { value: 0 },
      uRadius: { value: radius },
    },
    { transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide },
  );
}

export function createIconMaterial(shared: SharedUniforms, tex: Texture, pxSize: number): ShaderMaterial {
  return make(
    shared,
    /* glsl */ `
out vec2 vUv;
uniform vec3 uCenter;
uniform float uPxSize;
void main() {
  vUv = uv;
  vec4 cv = viewMatrix * vec4(uCenter, 1.0);
  float dist = max(-cv.z, 0.5);
  float worldPerPx = 2.0 * dist / (projectionMatrix[1][1] * uResY);
  // Where the icon's centre lands on screen, before the quad is spread around it.
  vec4 centre = projectionMatrix * cv;
  cv.xy += position.xy * uPxSize * worldPerPx;
  gl_Position = projectionMatrix * cv;
  ${FAR_CLAMP}
  // Under the title card: drop the whole icon (all four corners agree, so it never half-shows).
  if (centre.w > 0.0 && centre.x / centre.w < uIconClipLeft) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`.replace('void main', 'uniform float uResY;\nuniform float uIconClipLeft;\nvoid main'),
    /* glsl */ `
in vec2 vUv;
uniform sampler2D uTex;
uniform float uActive;
void main() {
  vec4 t = texture(uTex, vUv);
  if (t.a < 0.5) discard;
  float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
  vec3 c = t.rgb * (1.0 + uActive * (0.25 + 0.35 * pulse));
  outColor = vec4(c, 1.0);
}`,
    {
      uTex: { value: tex },
      uCenter: { value: new Vector3() },
      uPxSize: { value: pxSize },
      uActive: { value: 0 },
    },
    // Drawn over the scene so a building or hill in front never clips the icon.
    { transparent: true, depthWrite: false, depthTest: false, side: DoubleSide },
  );
}
