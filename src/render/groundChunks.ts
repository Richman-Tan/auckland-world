/**
 * The ground near the plane, as GLSL for the terrain material.
 *
 * From the air the ground is one painted image at three metres a pixel. Close to the plane that is
 * a field of flat squares, so inside uGroundR the terrain is drawn from what the land is instead
 * (land.bin: a class and a canopy flag every six metres):
 *
 *  - the class at a pixel is voted between the four nearest cells (voteClass, mirrored and tested
 *    in shared/land.ts) from a slightly wandering position, so a park's edge is a soft line and
 *    not a staircase;
 *  - each class is painted in the colour the ground image uses for it, broken up the way that kind
 *    of land is: tufts in grass, mown stripes on a pitch, plots in a suburb, bays and parked cars in
 *    a car park, slabs in paving, grain in sand;
 *  - tree canopy is a dark, leafy patch, and from far away a tint on the painted ground, so the
 *    suburbs are as green as they really are at every distance;
 *  - the shoreline follows the ground image's edge smoothed between its pixels.
 *
 * Every pattern is multiplied around 1 (or mixed around its own mean), so a class has the same
 * average colour near and far and the two meet without a seam, and every pattern fades out as its
 * period nears a pixel (keep), so nothing sparkles at the site's pixel size.
 */
import { LAND_CLASSES, type LandClass } from '../shared/land';

const C = (k: LandClass) => LAND_CLASSES.indexOf(k);

export const LAND_UNIFORMS = /* glsl */ `
uniform sampler2D uLand;   // r: class of the cell, g: canopy (smoothed by the sampler)
uniform vec4 uLandGrid;    // the map's north-west corner (x, z), then cells per metre
uniform float uGroundR;    // how far the close-up ground reaches, metres; 0 turns it off
uniform float uDetail;     // 0 to 1 as the close-up detail fades in
uniform vec3 uLandCol[${LAND_CLASSES.length}];
uniform vec3 uCanopyCol;
uniform vec3 uShoreCol;
`;

export const LAND_LIB = /* glsl */ `
// The light the ground image's hill shading was baked with, and its four bands (scripts/build/ground.ts).
const vec3 HILL_LIGHT = vec3(-0.5417, 0.6428, 0.5417);
float hillBand(vec3 n) {
  float k = dot(n, HILL_LIGHT);
  return k < 0.3 ? 0.805 : (k < 0.55 ? 0.88 : (k < 0.75 ? 0.94 : 1.0));
}

int landAt(ivec2 c) {
  return int(texelFetch(uLand, clamp(c, ivec2(0), textureSize(uLand, 0) - 1), 0).r * 255.0 + 0.5);
}

// The class at q (in cells): the four nearest cells vote with their bilinear weights.
int voteClass(vec2 q) {
  vec2 g = q - 0.5;
  ivec2 i = ivec2(floor(g));
  vec2 f = g - floor(g);
  int c00 = landAt(i);
  int c10 = landAt(i + ivec2(1, 0));
  int c01 = landAt(i + ivec2(0, 1));
  int c11 = landAt(i + ivec2(1, 1));
  float w00 = (1.0 - f.x) * (1.0 - f.y);
  float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y;
  float w11 = f.x * f.y;
  float s00 = w00 + (c10 == c00 ? w10 : 0.0) + (c01 == c00 ? w01 : 0.0) + (c11 == c00 ? w11 : 0.0);
  float s10 = w10 + (c00 == c10 ? w00 : 0.0) + (c01 == c10 ? w01 : 0.0) + (c11 == c10 ? w11 : 0.0);
  float s01 = w01 + (c00 == c01 ? w00 : 0.0) + (c10 == c01 ? w10 : 0.0) + (c11 == c01 ? w11 : 0.0);
  float s11 = w11 + (c00 == c11 ? w00 : 0.0) + (c10 == c11 ? w10 : 0.0) + (c01 == c11 ? w01 : 0.0);
  int best = c00;
  float top = s00;
  if (s10 > top) { best = c10; top = s10; }
  if (s01 > top) { best = c01; top = s01; }
  if (s11 > top) { best = c11; }
  return best;
}

// The ground image's land-or-sea, smoothed between its pixels: 0.5 is the shoreline.
float shoreAt(sampler2D ground, vec2 uv) {
  ivec2 size = textureSize(ground, 0);
  vec2 g = uv * vec2(size) - 0.5;
  ivec2 i = ivec2(floor(g));
  vec2 f = g - floor(g);
  ivec2 hi = size - 1;
  float a00 = texelFetch(ground, clamp(i, ivec2(0), hi), 0).a;
  float a10 = texelFetch(ground, clamp(i + ivec2(1, 0), ivec2(0), hi), 0).a;
  float a01 = texelFetch(ground, clamp(i + ivec2(0, 1), ivec2(0), hi), 0).a;
  float a11 = texelFetch(ground, clamp(i + ivec2(1, 1), ivec2(0), hi), 0).a;
  return mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);
}

// Three flat tones around zero from smooth noise: -1/3, 0, 1/3. The site's way of mottling.
float tones(vec2 p) {
  return floor(vnoise(p) * 3.0) / 3.0 - 0.3333;
}

// One kind of land at p (metres), with px metres to a pixel.
vec3 landColour(int cls, vec2 p, float px) {
  vec3 base = uLandCol[cls];
  float broad = tones(p / 13.0) * keep(px, 13.0);
  vec3 c = base;
  if (cls == ${C('park')}) {
    // Grass: broad patches, and tufts a step apart.
    float tuft = hash21(floor(p / 1.1));
    c = base * (1.0 + 0.1 * broad);
    c *= 1.0 + (0.07 * step(tuft, 0.07) - 0.13 * step(0.8, tuft)) * keep(px, 1.1);
  } else if (cls == ${C('pitch')}) {
    // Mown in stripes.
    vec2 r = vec2(p.x * 0.94 + p.y * 0.342, p.y * 0.94 - p.x * 0.342);
    c = base * (1.0 + 0.07 * (step(0.5, fract(r.x / 11.0)) - 0.5) * keep(px, 11.0));
  } else if (cls == ${C('wood')} || cls == ${C('scrub')}) {
    // Clumps of crowns.
    c = base * (1.0 + 0.3 * tones(p / 4.5) * keep(px, 4.5));
  } else if (cls == ${C('sand')}) {
    float grain = hash21(floor(p / 0.45));
    c = base * (1.0 + 0.05 * broad);
    c *= 1.0 - 0.09 * step(0.84, grain) * keep(px, 0.45);
    c *= 1.0 - 0.05 * step(0.75, fract(p.y / 2.6 + vnoise(p / 7.0) * 1.5)) * keep(px, 2.6);
  } else if (cls == ${C('rock')}) {
    c = base * (1.0 + 0.32 * tones(p / 2.6) * keep(px, 2.6));
  } else if (cls == ${C('water')}) {
    // A pond or a stream: slow bands of light.
    float band = step(0.6, fract(p.y / 3.2 + vnoise(p / 8.0) * 2.0 + uTime * 0.07));
    c = base * (1.0 + 0.07 * band * keep(px, 3.2));
  } else if (cls == ${C('parking')}) {
    // A car park: seal, two rows of bays back to back with an aisle between pairs, and cars in
    // rather more than half of the bays.
    vec3 seal = base * (0.8 + 0.05 * broad);
    float row = mod(p.y, 16.0);
    float bays = step(row, 10.0);
    float bx = mod(p.x, 2.6);
    float line = max(painted(min(bx, 2.6 - bx), 0.07, px), painted(row - 5.0, 0.07, px)) * bays;
    line *= 1.0 - smoothstep(0.3, 0.7, px);
    c = mix(seal, vec3(0.86, 0.85, 0.8), line);
    float side = step(5.0, row);
    vec2 bay = vec2(floor(p.x / 2.6), floor(p.y / 16.0) * 2.0 + side);
    float pick = hash21(bay + 3.7);
    vec2 in_ = vec2(bx - 1.3, row - 5.0 * side - 2.5);
    float car = bays * step(pick, 0.58) * step(abs(in_.x), 0.9) * step(abs(in_.y), 2.1);
    float shade = fract(pick * 37.0);
    vec3 body = shade < 0.3 ? vec3(0.84, 0.84, 0.82) : (shade < 0.52 ? vec3(0.58, 0.6, 0.63) : (shade < 0.74 ? vec3(0.2, 0.21, 0.25) : (shade < 0.87 ? vec3(0.6, 0.2, 0.17) : vec3(0.22, 0.33, 0.52))));
    // The cabin, darker, set back from the bonnet.
    body *= 1.0 - 0.3 * step(abs(in_.x), 0.7) * step(abs(in_.y + 0.3), 1.0);
    c = mix(seal * 0.98, mix(c, body, car), keep(px, 2.6));
  } else if (cls == ${C('residential')}) {
    // A suburb: plots a few metres across, some lawn, some paved, some planted.
    vec2 w = p + (vec2(vnoise(p / 6.0), vnoise(p / 6.0 + 9.7)) - 0.5) * 3.0;
    float plot = hash21(floor(w / 8.0));
    vec3 lawn = mix(base, uLandCol[${C('park')}], 0.5);
    vec3 planted = mix(base, uLandCol[${C('scrub')}], 0.55);
    vec3 paved = base * vec3(0.9, 0.9, 0.93);
    vec3 yard = plot < 0.34 ? lawn : (plot < 0.44 ? planted : (plot < 0.56 ? paved : base));
    vec3 mean = base * 0.44 + lawn * 0.34 + planted * 0.1 + paved * 0.12;
    c = mix(mean, yard, keep(px, 8.0)) * (1.0 + 0.05 * broad);
  } else if (cls == ${C('commercial')}) {
    // Paving, in slabs.
    vec2 s = fract(p / 3.0);
    c = base * (1.0 + 0.04 * broad);
    c *= 1.0 - 0.07 * max(step(s.x, 0.05), step(s.y, 0.05)) * keep(px, 3.0);
  } else if (cls == ${C('industrial')}) {
    // A yard: big concrete slabs, stained here and there.
    vec2 s = fract(p / 6.0);
    c = base * (1.0 + 0.07 * broad);
    c *= 1.0 - 0.08 * (step(0.7, vnoise(p / 5.0)) - 0.3) * keep(px, 5.0);
    c *= 1.0 - 0.05 * max(step(s.x, 0.03), step(s.y, 0.03)) * keep(px, 6.0);
  } else {
    // Unnamed land: bare ground with a few weeds.
    float weed = step(0.9, hash21(floor(p / 1.6))) * keep(px, 1.6);
    c = mix(base * (1.0 + 0.05 * broad), uLandCol[${C('park')}], 0.25 * weed);
  }
  return c;
}

// Tree canopy from above, where the canopy flag says there is some: 0 or 1, with a soft, wandering edge.
float crownAt(float canopy, vec2 p) {
  return step(0.5, canopy + (vnoise(p * 0.3) - 0.5) * 0.45);
}
vec3 crownColour(vec2 p, float px) {
  return uCanopyCol * (1.0 + 0.28 * tones(p / 2.2) * keep(px, 2.2));
}
`;
