/**
 * Small models as lists of coloured boxes, merged into one geometry so each model is one draw call.
 * Used by the plane (flight/plane.ts) and the ambient traffic (world/ambient.ts).
 */
import { BufferAttribute, BufferGeometry, Color } from 'three';

/** width, height, depth, centre x, y, z, colour (0xrrggbb). */
export type Box = readonly [w: number, h: number, d: number, x: number, y: number, z: number, color: number];

// Corner signs of a box, and its 12 triangles wound to face outwards.
const CORNERS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
] as const;
const FACES = [
  0, 2, 1, 0, 3, 2, // -z
  4, 5, 6, 4, 6, 7, // +z
  0, 1, 5, 0, 5, 4, // -y
  3, 7, 6, 3, 6, 2, // +y
  0, 4, 7, 0, 7, 3, // -x
  1, 2, 6, 1, 6, 5, // +x
] as const;

export const VERTS_PER_BOX = CORNERS.length;

/**
 * One indexed geometry for a set of boxes, with a `color` attribute per vertex.
 *
 * `displayColors` false (the default) converts each hex colour to three's linear working space, as a
 * built-in material's own colour would be: use it with MeshBasicMaterial({ vertexColors: true }).
 * True keeps the hex values as written, for this project's own shaders, which write colours
 * straight to the framebuffer.
 */
export function mergeBoxes(boxes: readonly Box[], displayColors = false): BufferGeometry {
  const positions = new Float32Array(boxes.length * VERTS_PER_BOX * 3);
  const colors = new Float32Array(boxes.length * VERTS_PER_BOX * 3);
  const indices = new Uint16Array(boxes.length * FACES.length);
  const c = new Color();
  boxes.forEach(([w, h, d, x, y, z, color], b) => {
    if (displayColors) c.setRGB(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
    else c.set(color);
    CORNERS.forEach(([sx, sy, sz], i) => {
      const o = (b * VERTS_PER_BOX + i) * 3;
      positions[o] = x + (sx * w) / 2;
      positions[o + 1] = y + (sy * h) / 2;
      positions[o + 2] = z + (sz * d) / 2;
      colors[o] = c.r;
      colors[o + 1] = c.g;
      colors[o + 2] = c.b;
    });
    FACES.forEach((f, i) => (indices[b * FACES.length + i] = b * VERTS_PER_BOX + f));
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
