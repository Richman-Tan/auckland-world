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
import { ACCENTS, type PaletteKey, SKY, WATER, hexToRgb } from '../shared/palette';
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
void main() {
  vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);
  float b = bayer4(gl_FragCoord.xy);
  float e = max(dir.y, 0.0);
  float t = pow(e, 0.5);
  t = floor(t * 7.0 + b) / 7.0;
  vec3 col = mix(uFogColor, uZenith, clamp(t, 0.0, 1.0));
  float s = dot(dir, uSunDir);
  float glow = smoothstep(0.80, 0.995, s);
  glow = floor(glow * 4.0 + b * 0.8) / 4.0;
  col = mix(col, uSunColor, glow * 0.35);
  float disc = step(0.9988, s);
  float ring = step(0.9965, s);
  col = mix(col, uSunColor, ring * 0.55);
  col = mix(col, vec3(1.0, 0.97, 0.85), disc);
  outColor = vec4(col, 1.0);
}`,
    {
      uInvProj: { value: new Matrix4() },
      uCamWorld: { value: new Matrix4() },
      uZenith: { value: col(SKY.zenith) },
      uSunColor: { value: col(SKY.sun) },
    },
    { depthTest: false, depthWrite: false, side: FrontSide },
  );
}

/* ----------------------------------------------------------------- terrain */

export function createTerrainMaterial(shared: SharedUniforms, ground: Texture): ShaderMaterial {
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
  vec4 t = texture(uGround, vUv);
  if (t.a < 0.5) discard;
  vec3 n = flatNormal(vWorld);
  vec3 lit = mix(vec3(1.0), lambert3(n), 0.45);
  vec3 c = t.rgb * lit;
  float d = length(vWorld - cameraPosition);
  outColor = vec4(pixelFog(c, d, 1.0), 1.0);
}`,
    { uGround: { value: ground } },
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
  vec3 c = t.rgb * mix(vec3(1.0), lambert3(n), 0.45) * 0.92;
  float d = length(vWorld - cameraPosition);
  outColor = vec4(pixelFog(c, d * 1.35, 1.0), 1.0);
}`,
    { uGround: { value: ground } },
  );
}

/* ------------------------------------------------------------------- water */

export function createWaterMaterial(shared: SharedUniforms, ground: Texture, rect: Vector4): ShaderMaterial {
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

float land(vec2 xz) {
  vec2 uv = (xz - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return textureLod(uGround, uv, 0.0).a;
}

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

  // shallow tint and foam from the ground texture alpha (land = 1)
  float nearL = 0.0;
  float farL = 0.0;
  if (dist < 2400.0) {
    nearL = (land(p + vec2(14.0, 0.0)) + land(p + vec2(-14.0, 0.0)) + land(p + vec2(0.0, 14.0)) + land(p + vec2(0.0, -14.0))) * 0.25;
    farL = (land(p + vec2(34.0, 12.0)) + land(p + vec2(-34.0, -12.0)) + land(p + vec2(-12.0, 34.0)) + land(p + vec2(12.0, -34.0))) * 0.25;
  }
  vec3 c = mix(uDeep, uShallow, 0.30 + 0.45 * q);
  c = mix(c, uShallow * 1.08, clamp(farL * 1.2 + nearL * 0.6, 0.0, 0.8));

  // foam: a solid fringe at the shore and a moving band just outside it
  float band = step(0.35, sin((p.x + p.y) * 0.05 - t * 1.4) * 0.5 + 0.5);
  float foam = step(0.05, nearL) + (1.0 - step(0.05, nearL)) * step(0.05, farL) * band;
  foam *= 1.0 - smoothstep(1400.0, 2400.0, dist);
  c = mix(c, uFoam, clamp(foam, 0.0, 1.0));

  // sparse sparkles
  float h = hash21(floor(p / 4.0) + floor(t * 4.0) * 17.0);
  vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
  float glint = max(dot(R, uSunDir), 0.0);
  float thr = 0.9985 - 0.012 * step(0.7, glint) - 0.01 * step(0.9, glint);
  float spark = step(thr, h) * (1.0 - smoothstep(300.0, 1100.0, dist));
  c = mix(c, uSparkle, spark);

  // lighter towards the horizon
  float up = clamp(V.y, 0.0, 1.0);
  c = mix(c, uFogColor, pow(1.0 - up, 3.0) * 0.4);

  outColor = vec4(pixelFog(c, dist, 1.0), 1.0);
}`,
    {
      uGround: { value: ground },
      uRect: { value: rect },
      uDeep: { value: col(WATER.deep) },
      uShallow: { value: col(WATER.shallow) },
      uFoam: { value: col(WATER.foam) },
      uSparkle: { value: col(WATER.sparkle) },
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
    float lit = step(0.86, hash21(floor(cell)));
    vec3 glass = mix(alb * 0.42, vec3(0.16, 0.34, 0.38), 0.65);
    glass = mix(glass, vec3(1.0, 0.82, 0.45), lit * 0.8);
    vec3 wc = mix(alb * shade, glass * mix(shade, vec3(1.0), lit), win);
    // far away the pattern averages out to a slightly darker wall
    c = mix(alb * shade * 0.9, wc, fade);
  }
  outColor = vec4(pixelFog(c, dist, 1.0), 1.0);
}`,
    { uWall: shared.uWall, uRoof: shared.uRoof },
  );
}

/* --------------------------------------------------------------- landmarks */

/**
 * Vertex-coloured, flat-lit. colour.a = 1 is normal; a ~ 0.5 marks the blinking aircraft light.
 * `fogCap` limits the fog amount (Rangitoto keeps a readable silhouette).
 */
export function createLandmarkMaterial(shared: SharedUniforms, fogCap = 1.0): ShaderMaterial {
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
void main() {
  float dist = length(vWorld - cameraPosition);
  if (vColor.a < 0.9) {
    float blink = step(0.55, fract(uTime * 0.8));
    vec3 e = mix(vec3(0.25, 0.02, 0.03), vec3(1.0, 0.18, 0.15), blink);
    outColor = vec4(e, 1.0);
    return;
  }
  vec3 n = flatNormal(vWorld);
  vec3 c = vColor.rgb * lambert3(n);
  outColor = vec4(pixelFog(c, dist, uFogCap), 1.0);
}`,
    { uFogCap: { value: fogCap } },
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
  cv.xy += position.xy * uPxSize * worldPerPx;
  gl_Position = projectionMatrix * cv;
  ${FAR_CLAMP}
}`.replace('void main', 'uniform float uResY;\nvoid main'),
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
    { transparent: true, depthWrite: false, side: DoubleSide },
  );
}
