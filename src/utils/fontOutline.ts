// Turn the pixels of a glyph into vector outlines.
//
// The filled pixels are merged into as few closed contours as possible:
// one for each connected shape and one for each hole in it, with a point
// only where the outline turns.  The corners can then be rounded, with
// separate radii for the corners that stick out (convex) and the ones where
// pixels meet (concave).
//
// Coordinates are in pixels, y down, like the bitmap.  Outer contours run
// clockwise on screen and holes counter-clockwise, so both the nonzero and
// evenodd fill rules work.

export interface Point {
  x: number;
  y: number;
}

export type Contour = Point[];

export interface Bitmap {
  width: number;
  height: number;
  // Row by row, non-zero = filled
  pixels: Uint8Array;
}

export type PathCommand =
  | { type: 'M', x: number, y: number }
  | { type: 'L', x: number, y: number }
  | { type: 'C', x1: number, y1: number, x2: number, y2: number, x: number, y: number }
  | { type: 'Z' };

// Directions in clockwise order (y down): right, down, left, up
const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]

// Control point distance that makes a cubic bezier a quarter circle
const KAPPA = 0.5522847498

export function traceOutline(bitmap: Bitmap): Contour[] {
  const { width: w, height: h, pixels } = bitmap
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && pixels[y*w + x] !== 0

  // Every pixel side that borders an empty pixel is an edge of the outline,
  // directed so that the filled side is on its right.  A corner of the pixel
  // grid has at most one such edge leaving it in each direction, so the
  // edges are kept as a bitmask of directions for every grid corner.
  const vw = w + 1
  const out = new Uint8Array(vw * (h + 1))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) {
        continue
      }
      if (!filled(x, y - 1)) { out[y*vw + x] |= 1 }          // top, going right
      if (!filled(x + 1, y)) { out[y*vw + x + 1] |= 2 }      // right, going down
      if (!filled(x, y + 1)) { out[(y+1)*vw + x + 1] |= 4 }  // bottom, going left
      if (!filled(x - 1, y)) { out[(y+1)*vw + x] |= 8 }      // left, going up
    }
  }

  const contours: Contour[] = []
  for (let start = 0; start < out.length; start++) {
    while (out[start] !== 0) {
      let startDir = 0
      while ((out[start] & (1 << startDir)) === 0) {
        startDir++
      }
      const points: Contour = []
      let x = start % vw
      let y = Math.floor(start / vw)
      let dir = startDir
      while (true) {
        out[y*vw + x] &= ~(1 << dir)
        x += DX[dir]
        y += DY[dir]
        const v = y*vw + x
        // Where two pixels touch only diagonally there are two ways to go
        // on.  Turning left first keeps them in one shape, so that rounding
        // the inner corners joins them with a bridge.
        const candidates = [(dir + 3) % 4, dir, (dir + 1) % 4]
        let next = -1
        for (const c of candidates) {
          if ((out[v] & (1 << c)) !== 0 || (v === start && c === startDir)) {
            next = c
            break
          }
        }
        if (next === -1) {
          // Can't happen: every grid corner has as many edges in as out.
          break
        }
        if (next !== dir) {
          points.push({ x, y })
        }
        dir = next
        if (v === start && dir === startDir) {
          break
        }
      }
      if (points.length >= 4) {
        contours.push(points)
      }
    }
  }
  return contours
}

export interface CornerRadii {
  // Corners that stick out
  outer: number;
  // Corners where pixels meet
  inner: number;
}

// The path of a set of contours with rounded corners.  A corner's radius is
// limited to half of its shorter side so that neighbouring corners never
// overlap.
export function roundedPath(contours: Contour[], radii: CornerRadii): PathCommand[] {
  const cmds: PathCommand[] = []
  for (const pts of contours) {
    const n = pts.length
    const corners = pts.map((p, i) => {
      const prev = pts[(i + n - 1) % n]
      const next = pts[(i + 1) % n]
      const len1 = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)
      const len2 = Math.abs(next.x - p.x) + Math.abs(next.y - p.y)
      const d1 = { x: (p.x - prev.x) / len1, y: (p.y - prev.y) / len1 }
      const d2 = { x: (next.x - p.x) / len2, y: (next.y - p.y) / len2 }
      // With the filled side on the right, a right turn is a convex corner.
      const convex = d1.x*d2.y - d1.y*d2.x > 0
      const r = Math.max(0, Math.min(convex ? radii.outer : radii.inner, len1 / 2, len2 / 2))
      return { p, d1, d2, r }
    })
    corners.forEach((c, i) => {
      const { p, d1, d2, r } = c
      const a = { x: p.x - d1.x*r, y: p.y - d1.y*r }
      const b = { x: p.x + d2.x*r, y: p.y + d2.y*r }
      if (i === 0) {
        cmds.push({ type: 'M', x: a.x, y: a.y })
      } else {
        const prev = corners[i - 1]
        const from = { x: prev.p.x + prev.d2.x*prev.r, y: prev.p.y + prev.d2.y*prev.r }
        if (from.x !== a.x || from.y !== a.y) {
          cmds.push({ type: 'L', x: a.x, y: a.y })
        }
      }
      if (r > 0) {
        const k = r * (1 - KAPPA)
        cmds.push({
          type: 'C',
          x1: p.x - d1.x*k, y1: p.y - d1.y*k,
          x2: p.x + d2.x*k, y2: p.y + d2.y*k,
          x: b.x, y: b.y
        })
      }
    })
    // The closing 'Z' draws the last straight side.
    cmds.push({ type: 'Z' })
  }
  return cmds
}

function num(v: number): string {
  // Three decimals are plenty for pixel coordinates.
  const s = (Math.round(v * 1000) / 1000).toString()
  return s.startsWith('0.') ? s.substring(1) : s.startsWith('-0.') ? '-' + s.substring(2) : s
}

// SVG path data for the commands, scaled and moved by the given amounts.
// Straight sides become the short H and V commands.
export function svgPathData(
  cmds: PathCommand[],
  scaleX = 1,
  scaleY = 1,
  offsetX = 0,
  offsetY = 0
): string {
  const tx = (x: number) => x*scaleX + offsetX
  const ty = (y: number) => y*scaleY + offsetY
  let d = ''
  let cur = { x: 0, y: 0 }
  let start = { x: 0, y: 0 }
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        d += `M${num(tx(c.x))} ${num(ty(c.y))}`
        cur = start = { x: c.x, y: c.y }
        break
      case 'L':
        if (c.y === cur.y) {
          d += `H${num(tx(c.x))}`
        } else if (c.x === cur.x) {
          d += `V${num(ty(c.y))}`
        } else {
          d += `L${num(tx(c.x))} ${num(ty(c.y))}`
        }
        cur = { x: c.x, y: c.y }
        break
      case 'C':
        d += `C${num(tx(c.x1))} ${num(ty(c.y1))} ${num(tx(c.x2))} ${num(ty(c.y2))} ${num(tx(c.x))} ${num(ty(c.y))}`
        cur = { x: c.x, y: c.y }
        break
      case 'Z':
        d += 'Z'
        cur = start
        break
    }
  }
  return d
}
