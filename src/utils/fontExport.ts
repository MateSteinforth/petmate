// Export the font the user drew on a screen (see TypeFont) for use on the
// web: as an OpenType font file and as an SVG with one symbol per glyph.

import { Font as OpenTypeFont, Glyph as OpenTypeGlyph, Path as OpenTypePath } from 'opentype.js'

import { Font, Framebuf, Coord2 } from '../redux/types'
import {
  Bitmap, Contour, CornerRadii, PathCommand,
  traceOutline, roundedPath, svgPathData
} from './fontOutline'

// Same order as utils.TYPE_FONT_GLYPHS: the glyph cells of the font grid,
// left to right and top to bottom.
const GLYPH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-+:;\'"()/=*'

export interface TracedGlyph {
  char: string;
  contours: Contour[];
  // The first and one past the last filled pixel of the glyph, and the
  // same for each of its pixel rows (Infinity and -Infinity for a row
  // without pixels).
  inkLeft: number;
  inkRight: number;
  rowLeft: number[];
  rowRight: number[];
}

// How the glyphs are spaced
export interface Spacing {
  // Use the width of each glyph's shape instead of the width of its cell
  proportional: boolean;
  // Gap between the shapes of two glyphs, in pixels
  letterSpacing: number;
  // How far glyphs are moved into each other's free space, from 0 to 1
  kerning: number;
}

export interface FontMetrics {
  // By glyph index, in pixels: how far a glyph's outline is moved, and how
  // far the next glyph is from it.
  xOffset: number[];
  advance: number[];
  spaceAdvance: number;
  // Adjustment between a pair of glyphs: kerning[left][right]
  kerning: number[][];
  kerningPairs: number;
}

export interface TracedFont {
  // Size of a glyph cell in pixels
  cellWidth: number;
  cellHeight: number;
  // Width of a pixel relative to its height (0.5 on 80 column screens)
  pixelAspect: number;
  // The glyphs that have any pixels set
  glyphs: TracedGlyph[];
}

function glyphBitmap(source: Framebuf, font: Font, at: Coord2, w: number, h: number): Bitmap {
  const pixels = new Uint8Array(w*8 * h*8)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const code = source.framebuf[at.row + row][at.col + col].code
      for (let y = 0; y < 8; y++) {
        const bits = font.bits[code*8 + y]
        for (let x = 0; x < 8; x++) {
          if (bits & (128 >> x)) {
            pixels[(row*8 + y) * w*8 + col*8 + x] = 1
          }
        }
      }
    }
  }
  return { width: w*8, height: h*8, pixels }
}

export function traceTypeFont(
  source: Framebuf,
  font: Font,
  typeFont: { origin: Coord2, width: number, height: number },
  pixelAspect: number
): TracedFont {
  const { origin, width: w, height: h } = typeFont
  const cols = Math.max(0, Math.floor((source.width - origin.col) / w))
  const rows = Math.max(0, Math.floor((source.height - origin.row) / h))
  const glyphs: TracedGlyph[] = []
  for (let i = 0; i < GLYPH_CHARS.length && i < cols*rows; i++) {
    const at = { row: origin.row + Math.floor(i / cols) * h, col: origin.col + (i % cols) * w }
    const bitmap = glyphBitmap(source, font, at, w, h)
    const contours = traceOutline(bitmap)
    if (contours.length > 0) {
      const rowLeft: number[] = []
      const rowRight: number[] = []
      for (let y = 0; y < bitmap.height; y++) {
        let left = Infinity
        let right = -Infinity
        for (let x = 0; x < bitmap.width; x++) {
          if (bitmap.pixels[y*bitmap.width + x] !== 0) {
            left = Math.min(left, x)
            right = x + 1
          }
        }
        rowLeft.push(left)
        rowRight.push(right)
      }
      glyphs.push({
        char: GLYPH_CHARS[i],
        contours,
        inkLeft: Math.min(...rowLeft),
        inkRight: Math.max(...rowRight),
        rowLeft,
        rowRight
      })
    }
  }
  return { cellWidth: w*8, cellHeight: h*8, pixelAspect, glyphs }
}

export function glyphCommands(glyph: TracedGlyph, radii: CornerRadii): PathCommand[] {
  return roundedPath(glyph.contours, radii)
}

// How many points the outlines of the font have, to show how much the
// corner rounding costs.
export function countPoints(font: TracedFont, radii: CornerRadii): number {
  let n = 0
  for (const g of font.glyphs) {
    for (const c of glyphCommands(g, radii)) {
      n += c.type === 'C' ? 3 : c.type === 'Z' ? 0 : 1
    }
  }
  return n
}

//---------------------------------------------------------------------
// Spacing and kerning

// The gap the glyphs have between them the way they were drawn: a good
// letter spacing to start from.
export function drawnLetterSpacing(font: TracedFont): number {
  const gaps = font.glyphs.map(g => font.cellWidth - (g.inkRight - g.inkLeft)).sort((a, b) => a - b)
  return gaps.length > 0 ? Math.max(1, gaps[Math.floor(gaps.length / 2)]) : 1
}

// Widen a row profile so that every row also covers the rows up to
// `radius` above and below it.  Kerning with the widened profiles keeps
// shapes apart diagonally too, not just within the same pixel row.
function spread(rows: number[], radius: number, pick: (...v: number[]) => number): number[] {
  return rows.map((_, y) => pick(...rows.slice(Math.max(0, y - radius), y + radius + 1)))
}

export function computeMetrics(font: TracedFont, spacing: Spacing): FontMetrics {
  const n = font.glyphs.length
  const none = font.glyphs.map(() => Array(n).fill(0))
  if (!spacing.proportional) {
    return {
      xOffset: Array(n).fill(0),
      advance: Array(n).fill(font.cellWidth),
      spaceAdvance: font.cellWidth,
      kerning: none,
      kerningPairs: 0
    }
  }
  const gap = spacing.letterSpacing
  const metrics: FontMetrics = {
    xOffset: font.glyphs.map(g => -g.inkLeft),
    advance: font.glyphs.map(g => g.inkRight - g.inkLeft + gap),
    spaceAdvance: Math.round(font.cellWidth / 2),
    kerning: none,
    kerningPairs: 0
  }
  if (spacing.kerning <= 0) {
    return metrics
  }
  // Without kerning, two glyphs are `gap` apart where both reach their
  // full width.  Kerning moves the right one closer by the free space that
  // is left between the two shapes in the rows where they face each other.
  const radius = Math.max(1, Math.min(font.cellHeight, Math.round(gap)))
  // How far each row of a glyph stays behind the glyph's full width
  const rightSlack = font.glyphs.map(g => spread(g.rowRight, radius, Math.max).map(r => g.inkRight - r))
  const leftSlack = font.glyphs.map(g => spread(g.rowLeft, radius, Math.min).map(l => l - g.inkLeft))
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let free = Infinity
      for (let y = 0; y < font.cellHeight; y++) {
        // Infinite where either glyph has nothing in or near this row
        free = Math.min(free, rightSlack[a][y] + leftSlack[b][y])
      }
      // Never move a glyph more than half way into its narrower neighbour.
      const ga = font.glyphs[a]
      const gb = font.glyphs[b]
      const limit = Math.min(ga.inkRight - ga.inkLeft, gb.inkRight - gb.inkLeft) / 2
      const kern = -Math.round(Math.min(free, limit) * Math.min(1, spacing.kerning))
      if (kern !== 0) {
        metrics.kerning[a][b] = kern
        metrics.kerningPairs++
      }
    }
  }
  return metrics
}

//---------------------------------------------------------------------
// Text layout for the preview and the SVG specimen

export interface TextLayout {
  // Size in square units (pixel heights)
  width: number;
  height: number;
  // SVG path data of every glyph placed in the text
  paths: string[];
}

export function layoutText(
  font: TracedFont,
  radii: CornerRadii,
  metrics: FontMetrics,
  text: string
): TextLayout {
  const indexByChar: { [c: string]: number } = {}
  font.glyphs.forEach((g, i) => { indexByChar[g.char] = i })
  const cmds = font.glyphs.map(g => glyphCommands(g, radii))
  const lines = text.toUpperCase().split('\n')
  const paths: string[] = []
  let width = 1
  lines.forEach((line, row) => {
    let x = 0
    let prev = -1
    for (const char of line) {
      const i = indexByChar[char]
      if (i === undefined) {
        // A space, or a character the font doesn't have
        x += metrics.spaceAdvance
        prev = -1
        continue
      }
      if (prev !== -1) {
        x += metrics.kerning[prev][i]
      }
      paths.push(svgPathData(
        cmds[i], font.pixelAspect, 1,
        (x + metrics.xOffset[i]) * font.pixelAspect, row*font.cellHeight
      ))
      x += metrics.advance[i]
      prev = i
    }
    width = Math.max(width, x)
  })
  return {
    width: width * font.pixelAspect,
    height: lines.length * font.cellHeight,
    paths
  }
}

//---------------------------------------------------------------------
// OpenType font

function upperAndLower(char: string): number[] {
  const codes = [char.charCodeAt(0)]
  const lower = char.toLowerCase()
  if (lower !== char) {
    codes.push(lower.charCodeAt(0))
  }
  return codes
}

//---------------------------------------------------------------------
// Kerning table.  opentype.js doesn't write one, so it's built here and
// added to the finished font file.

class Bytes {
  data: number[] = []
  u16 (v: number) { this.data.push((v >> 8) & 255, v & 255); return this }
  u32 (v: number) { return this.u16(Math.floor(v / 65536)).u16(v & 65535) }
  tag (t: string) { for (let i = 0; i < 4; i++) { this.data.push(t.charCodeAt(i)) } return this }
  bytes (b: number[]|Uint8Array) { for (let i = 0; i < b.length; i++) { this.data.push(b[i]) } return this }
}

// A GPOS table with a 'kern' feature holding one list of glyph pairs.
// `pairs[left]` lists the [right glyph, adjustment] pairs of a glyph.
function makeGposTable(pairs: { [left: number]: [number, number][] }): number[] {
  const lefts = Object.keys(pairs).map(Number).sort((a, b) => a - b)
  const scripts = new Bytes()
    .u16(2)
    .tag('DFLT').u16(14)
    .tag('latn').u16(14)
    // Script: only a default language system
    .u16(4).u16(0)
    // LangSys: no required feature, feature 0
    .u16(0).u16(0xffff).u16(1).u16(0)
  const features = new Bytes()
    .u16(1)
    .tag('kern').u16(8)
    // Feature: lookup 0
    .u16(0).u16(1).u16(0)
  // PairPos format 1: a set of pairs for every left glyph, each moving the
  // right glyph by changing the left one's advance.
  const pairSets = lefts.map(left => {
    const set = pairs[left].slice().sort((a, b) => a[0] - b[0])
    const b = new Bytes().u16(set.length)
    set.forEach(([right, value]) => b.u16(right).u16(value & 0xffff))
    return b.data
  })
  const headerSize = 10 + 2*lefts.length
  const coverage = new Bytes().u16(1).u16(lefts.length)
  lefts.forEach(g => coverage.u16(g))
  const subtable = new Bytes().u16(1).u16(headerSize).u16(0x0004).u16(0).u16(lefts.length)
  let offset = headerSize + coverage.data.length
  pairSets.forEach(set => {
    subtable.u16(offset)
    offset += set.length
  })
  if (offset > 0xffff) {
    throw new Error('too many kerning pairs')
  }
  subtable.bytes(coverage.data)
  pairSets.forEach(set => subtable.bytes(set))
  const lookups = new Bytes()
    .u16(1).u16(4)
    // Lookup: pair adjustment, one subtable
    .u16(2).u16(0).u16(1).u16(8)
    .bytes(subtable.data)
  const scriptsAt = 10
  const featuresAt = scriptsAt + scripts.data.length
  const lookupsAt = featuresAt + features.data.length
  return new Bytes()
    .u16(1).u16(0).u16(scriptsAt).u16(featuresAt).u16(lookupsAt)
    .bytes(scripts.data).bytes(features.data).bytes(lookups.data)
    .data
}

function checksum(data: number[]|Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum = (sum + (data[i] || 0) * 16777216 + ((data[i+1] || 0) << 16) + ((data[i+2] || 0) << 8) + (data[i+3] || 0)) % 4294967296
  }
  return sum
}

// Add a table to a font file, which means writing its table directory and
// checksums again.
function addTable(file: Uint8Array, tag: string, table: number[]): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const tables: { tag: string, data: number[] }[] = [{ tag, data: table }]
  for (let i = 0; i < view.getUint16(4); i++) {
    const rec = 12 + i*16
    const offset = view.getUint32(rec + 8)
    tables.push({
      tag: String.fromCharCode(file[rec], file[rec+1], file[rec+2], file[rec+3]),
      data: Array.from(file.subarray(offset, offset + view.getUint32(rec + 12)))
    })
  }
  tables.sort((a, b) => a.tag < b.tag ? -1 : 1)
  const head = tables.find(t => t.tag === 'head')!
  // The checksum adjustment of the whole file, filled in at the end
  head.data.splice(8, 4, 0, 0, 0, 0)

  const n = tables.length
  const entrySelector = Math.floor(Math.log2(n))
  const searchRange = 16 * Math.pow(2, entrySelector)
  const out = new Bytes()
    .bytes(file.subarray(0, 4))
    .u16(n).u16(searchRange).u16(entrySelector).u16(n*16 - searchRange)
  let offset = 12 + n*16
  let headAt = 0
  tables.forEach(t => {
    if (t === head) {
      headAt = offset
    }
    out.tag(t.tag).u32(checksum(t.data)).u32(offset).u32(t.data.length)
    offset += Math.ceil(t.data.length / 4) * 4
  })
  tables.forEach(t => {
    out.bytes(t.data)
    while (out.data.length % 4 !== 0) {
      out.data.push(0)
    }
  })
  const adjust = (0xb1b0afba - checksum(out.data) + 4294967296) % 4294967296
  const result = Uint8Array.from(out.data)
  new DataView(result.buffer).setUint32(headAt + 8, adjust)
  return result
}

export function buildOpenTypeFont(
  font: TracedFont,
  radii: CornerRadii,
  metrics: FontMetrics,
  familyName: string
): Uint8Array {
  // The em is one glyph cell high.  Use a round number of font units for
  // each pixel so that the straight sides stay on whole units.
  const unitsPerPixel = Math.max(1, Math.min(100, Math.floor(16000 / font.cellHeight)))
  const sx = unitsPerPixel * font.pixelAspect
  const sy = unitsPerPixel
  const unitsPerEm = font.cellHeight * sy
  const X = (x: number) => Math.round(x * sx)
  // Font coordinates have y up, with the baseline at the bottom of the cell.
  const Y = (y: number) => Math.round((font.cellHeight - y) * sy)

  const spaceWidth = X(metrics.spaceAdvance)
  // The glyphs of the font come after these two.
  const FIRST_GLYPH = 2
  const glyphs = [
    new OpenTypeGlyph({ name: '.notdef', unicode: 0, advanceWidth: spaceWidth, path: new OpenTypePath() }),
    new OpenTypeGlyph({ name: 'space', unicode: 32, advanceWidth: spaceWidth, path: new OpenTypePath() })
  ]
  font.glyphs.forEach((g, i) => {
    const dx = metrics.xOffset[i]
    const advanceWidth = X(metrics.advance[i])
    const path = new OpenTypePath()
    for (const c of glyphCommands(g, radii)) {
      switch (c.type) {
        case 'M': path.moveTo(X(c.x + dx), Y(c.y)); break
        case 'L': path.lineTo(X(c.x + dx), Y(c.y)); break
        case 'C': path.curveTo(X(c.x1 + dx), Y(c.y1), X(c.x2 + dx), Y(c.y2), X(c.x + dx), Y(c.y)); break
        case 'Z': path.close(); break
      }
    }
    const [code, ...more] = upperAndLower(g.char)
    const glyph = new OpenTypeGlyph({
      name: 'uni' + code.toString(16).toUpperCase().padStart(4, '0'),
      unicode: code,
      advanceWidth,
      path
    })
    // The font has no lower case of its own, so a-z show the capitals.
    more.forEach(c => glyph.addUnicode(c))
    glyphs.push(glyph)
  })
  const otf = new OpenTypeFont({
    familyName,
    styleName: 'Regular',
    unitsPerEm,
    ascender: unitsPerEm,
    descender: 0,
    glyphs
  })
  const file = new Uint8Array(otf.toArrayBuffer())
  if (metrics.kerningPairs === 0) {
    return file
  }
  const pairs: { [left: number]: [number, number][] } = {}
  metrics.kerning.forEach((row, a) => {
    const set = row
      .map((kern, b): [number, number] => [FIRST_GLYPH + b, X(kern)])
      .filter(([, value]) => value !== 0)
    if (set.length > 0) {
      pairs[FIRST_GLYPH + a] = set
    }
  })
  return addTable(file, 'GPOS', makeGposTable(pairs))
}

//---------------------------------------------------------------------
// SVG

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function glyphSymbolId(char: string): string {
  return /[A-Z0-9]/.test(char) ? `glyph-${char}` : `glyph-u${char.charCodeAt(0).toString(16)}`
}

// An SVG with a <symbol> for every glyph, and all of them laid out as a
// specimen.  A page can show a glyph with <use href="font.svg#glyph-A"/>.
export function buildSvg(font: TracedFont, radii: CornerRadii, familyName: string): string {
  const cw = font.cellWidth * font.pixelAspect
  const ch = font.cellHeight
  const perRow = Math.min(font.glyphs.length, 13) || 1
  const rows = Math.ceil(font.glyphs.length / perRow) || 1
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${perRow*cw} ${rows*ch}" fill="currentColor">`,
    `<title>${xmlEscape(familyName)}</title>`,
    '<defs>'
  ]
  for (const g of font.glyphs) {
    const d = svgPathData(glyphCommands(g, radii), font.pixelAspect, 1)
    lines.push(`<symbol id="${glyphSymbolId(g.char)}" viewBox="0 0 ${cw} ${ch}"><path d="${d}"/></symbol>`)
  }
  lines.push('</defs>')
  font.glyphs.forEach((g, i) => {
    const x = (i % perRow) * cw
    const y = Math.floor(i / perRow) * ch
    lines.push(`<use href="#${glyphSymbolId(g.char)}" x="${x}" y="${y}" width="${cw}" height="${ch}"/>`)
  })
  lines.push('</svg>')
  return lines.join('\n') + '\n'
}
