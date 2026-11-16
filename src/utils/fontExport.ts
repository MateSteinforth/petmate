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
    const contours = traceOutline(glyphBitmap(source, font, at, w, h))
    if (contours.length > 0) {
      glyphs.push({ char: GLYPH_CHARS[i], contours })
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
// Text layout for the preview and the SVG specimen

export interface TextLayout {
  // Size in square units (pixel heights)
  width: number;
  height: number;
  // SVG path data of every glyph placed in the text
  paths: string[];
}

export function layoutText(font: TracedFont, radii: CornerRadii, text: string): TextLayout {
  const byChar: { [c: string]: PathCommand[] } = {}
  for (const g of font.glyphs) {
    byChar[g.char] = glyphCommands(g, radii)
  }
  const cw = font.cellWidth * font.pixelAspect
  const lines = text.toUpperCase().split('\n')
  const paths: string[] = []
  lines.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const cmds = byChar[line[col]]
      if (cmds !== undefined) {
        paths.push(svgPathData(cmds, font.pixelAspect, 1, col*cw, row*font.cellHeight))
      }
    }
  })
  return {
    width: Math.max(1, ...lines.map(l => l.length)) * cw,
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

export function buildOpenTypeFont(font: TracedFont, radii: CornerRadii, familyName: string): Uint8Array {
  // The em is one glyph cell high.  Use a round number of font units for
  // each pixel so that the straight sides stay on whole units.
  const unitsPerPixel = Math.max(1, Math.min(100, Math.floor(16000 / font.cellHeight)))
  const sx = unitsPerPixel * font.pixelAspect
  const sy = unitsPerPixel
  const unitsPerEm = font.cellHeight * sy
  const advanceWidth = Math.round(font.cellWidth * sx)
  const X = (x: number) => Math.round(x * sx)
  // Font coordinates have y up, with the baseline at the bottom of the cell.
  const Y = (y: number) => Math.round((font.cellHeight - y) * sy)

  const glyphs = [
    new OpenTypeGlyph({ name: '.notdef', unicode: 0, advanceWidth, path: new OpenTypePath() }),
    new OpenTypeGlyph({ name: 'space', unicode: 32, advanceWidth, path: new OpenTypePath() })
  ]
  for (const g of font.glyphs) {
    const path = new OpenTypePath()
    for (const c of glyphCommands(g, radii)) {
      switch (c.type) {
        case 'M': path.moveTo(X(c.x), Y(c.y)); break
        case 'L': path.lineTo(X(c.x), Y(c.y)); break
        case 'C': path.curveTo(X(c.x1), Y(c.y1), X(c.x2), Y(c.y2), X(c.x), Y(c.y)); break
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
  }
  const otf = new OpenTypeFont({
    familyName,
    styleName: 'Regular',
    unitsPerEm,
    ascender: unitsPerEm,
    descender: 0,
    glyphs
  })
  return new Uint8Array(otf.toArrayBuffer())
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
