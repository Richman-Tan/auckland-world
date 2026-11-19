/** Shared GLSL snippets. Every material is a GLSL3 ShaderMaterial built from these. */

/** Uniforms every fragment shader sees (declared once per shader via this chunk). */
export const COMMON_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uLightHi;
uniform vec3 uLightMid;
uniform vec3 uLightLo;
uniform vec3 uAmbient;
uniform float uNight;
`;

export const FRAG_OUT = /* glsl */ `
layout(location = 0) out highp vec4 outColor;
`;

/** 4x4 Bayer matrix on the window pixel, pixel fog, flat normals and 3-step lambert. */
export const PIXEL_LIB = /* glsl */ `
float bayer4(vec2 fc) {
  ivec2 p = ivec2(mod(fc, 4.0));
  int i = p.x + p.y * 4;
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}

// Linear fog quantised into ~6 dithered bands. 'cap' limits the maximum fog amount.
vec3 pixelFog(vec3 color, float dist, float cap) {
  float f = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  f = floor(f * 6.0 + bayer4(gl_FragCoord.xy)) / 6.0;
  return mix(color, uFogColor, min(f, cap));
}

vec3 flatNormal(vec3 worldPos) {
  return normalize(cross(dFdx(worldPos), dFdy(worldPos)));
}

// Three steps of light: facing the sun (or moon), side-on, facing away. The colours come from the
// time of day (shared/timeOfDay.ts); in the afternoon they are a warm sun, a soft mid and a cool shadow.
vec3 lambert3(vec3 n) {
  float l = dot(n, uSunDir);
  if (l > 0.45) return uLightHi;
  if (l > -0.15) return uLightMid;
  return uLightLo;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

/** Plain world-space vertex stage with a far-plane clamp option (for backdrops and beacons). */
export const VERT_WORLD = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
