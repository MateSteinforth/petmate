import React, { useState, useMemo } from 'react'
import { connect } from 'react-redux'

import Modal from '../components/Modal'
import { Toolbar } from '../redux/toolbar'
import * as selectors from '../redux/selectors'
import { RootState, Framebuf, Font, TypeFont } from '../redux/types'
import * as utils from '../utils'
import { fs } from '../utils/electronImports'
import * as platform from '../utils/platform'
import {
  TracedFont,
  Spacing,
  traceTypeFont,
  computeMetrics,
  drawnLetterSpacing,
  layoutText,
  countPoints,
  buildOpenTypeFont,
  buildSvg
} from '../utils/fontExport'

import styles from './FontExportModal.module.css'

// A full character block is 8 pixels, so this rounds a one block wide
// stroke all the way.
const MAX_RADIUS = 8
const PREVIEW_CHARS_PER_LINE = 13

const MAX_LETTER_SPACING = 16

// The settings stay as they were when the dialog is opened again.  The
// letter spacing starts out as the gap the glyphs were drawn with.
let lastRadii = { outer: 0, inner: 0 }
let lastSpacing: { proportional: boolean, letterSpacing: number|null, kerning: number } =
  { proportional: true, letterSpacing: null, kerning: 1 }

function defaultSampleText(font: TracedFont): string {
  const chars = font.glyphs.map(g => g.char).join('')
  const lines = []
  for (let i = 0; i < chars.length; i += PREVIEW_CHARS_PER_LINE) {
    lines.push(chars.substring(i, i + PREVIEW_CHARS_PER_LINE))
  }
  return lines.join('\n')
}

function fileBaseName(familyName: string): string {
  const base = familyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base !== '' ? base : 'font'
}

function saveFile(name: string, ext: string, data: Uint8Array|string) {
  platform.showSaveDialog([{ name, extensions: [ext] }], `${name}.${ext}`).then(filename => {
    if (filename === undefined) {
      return
    }
    try {
      fs.writeFileSync(filename, data, null)
    } catch (e) {
      console.error(e)
      alert(`Failed to save file '${filename}'!`)
    }
  })
}

function Slider (props: {
  label: string,
  value: number,
  max: number,
  step: number,
  format: (v: number) => string,
  disabled?: boolean,
  onChange: (v: number) => void
}) {
  return (
    <label className={styles.slider} style={{ opacity: props.disabled ? 0.4 : 1 }}>
      <span className={styles.sliderLabel}>{props.label}</span>
      <input
        type='range'
        min={0}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={e => props.onChange(parseFloat(e.target.value))}
      />
      <span className={styles.sliderValue}>{props.format(props.value)}</span>
    </label>
  )
}

const formatPx = (v: number) => `${v.toFixed(2)} px`
const formatWholePx = (v: number) => `${v} px`
const formatPercent = (v: number) => `${Math.round(v * 100)} %`

interface FontExportProps {
  font: TracedFont;
  defaultName: string;
  onClose: () => void;
}

function FontExport (props: FontExportProps) {
  const { font } = props
  const [radii, setRadiiState] = useState(lastRadii)
  const [sample, setSample] = useState<string|null>(null)
  const [familyName, setFamilyName] = useState(props.defaultName)

  const setRadii = (r: { outer: number, inner: number }) => {
    lastRadii = r
    setRadiiState(r)
  }
  const [spacingState, setSpacingState] = useState(lastSpacing)
  const spacing: Spacing = {
    ...spacingState,
    letterSpacing: spacingState.letterSpacing !== null ?
      spacingState.letterSpacing :
      Math.min(MAX_LETTER_SPACING, drawnLetterSpacing(font))
  }
  const setSpacing = (s: Partial<Spacing>) => {
    lastSpacing = { ...spacingState, ...s }
    setSpacingState(lastSpacing)
  }
  const { proportional, letterSpacing, kerning } = spacing
  const metrics = useMemo(
    () => computeMetrics(font, { proportional, letterSpacing, kerning }),
    [font, proportional, letterSpacing, kerning]
  )
  const text = sample !== null ? sample : defaultSampleText(font)
  const layout = useMemo(() => layoutText(font, radii, metrics, text), [font, radii, metrics, text])
  const points = useMemo(() => countPoints(font, radii), [font, radii])
  const name = familyName.trim() !== '' ? familyName.trim() : 'PETSCII Font'
  const base = fileBaseName(name)

  return (
    <div className={styles.container}>
      <h2>Export font for the web</h2>
      <div className={styles.preview}>
        <svg
          viewBox={`${-4} ${-4} ${layout.width + 8} ${layout.height + 8}`}
          preserveAspectRatio='xMidYMid meet'
        >
          {layout.paths.map((d, i) => <path key={i} d={d} />)}
        </svg>
      </div>
      <div className={styles.controls}>
        <Slider
          label='Round outer corners'
          max={MAX_RADIUS}
          step={0.25}
          format={formatPx}
          value={radii.outer}
          onChange={outer => setRadii({ ...radii, outer })}
        />
        <Slider
          label='Round where pixels meet'
          max={MAX_RADIUS}
          step={0.25}
          format={formatPx}
          value={radii.inner}
          onChange={inner => setRadii({ ...radii, inner })}
        />
        <label className={styles.check}>
          <input
            type='checkbox'
            checked={proportional}
            onChange={e => setSpacing({ proportional: e.target.checked })}
          />
          Fit the spacing to the shapes of the letters (off: every letter is as wide as its cell)
        </label>
        <Slider
          label='Letter spacing'
          max={MAX_LETTER_SPACING}
          step={1}
          format={formatWholePx}
          disabled={!proportional}
          value={letterSpacing}
          onChange={v => setSpacing({ letterSpacing: v })}
        />
        <Slider
          label='Kerning'
          max={1}
          step={0.05}
          format={formatPercent}
          disabled={!proportional}
          value={kerning}
          onChange={v => setSpacing({ kerning: v })}
        />
        <div className={styles.fields}>
          <label>
            <span>Preview text</span>
            <textarea
              rows={2}
              value={text}
              spellCheck={false}
              onChange={e => setSample(e.target.value)}
            />
          </label>
          <label>
            <span>Font name</span>
            <input
              type='text'
              value={familyName}
              spellCheck={false}
              onChange={e => setFamilyName(e.target.value)}
            />
          </label>
        </div>
        <div className={styles.info}>
          {font.glyphs.length} glyphs, {points} outline points, {metrics.kerningPairs} kerning pairs.  Use the font file on a page with{' '}
          <code>{`@font-face { font-family: "${name}"; src: url("${base}.otf"); }`}</code>
        </div>
      </div>
      <div className={styles.buttons}>
        <button className='cancel' onClick={props.onClose}>Close</button>
        <button className='primary' onClick={() => saveFile(base, 'svg', buildSvg(font, radii, name))}>
          Save SVG
        </button>
        <button className='primary' onClick={() => saveFile(base, 'otf', buildOpenTypeFont(font, radii, metrics, name))}>
          Save font (.otf)
        </button>
      </div>
    </div>
  )
}

interface FontExportModalProps {
  show: boolean;
  typeFont: TypeFont|null;
  source: Framebuf|null;
  font: Font|null;
  workspaceFilename: string|null;
  Toolbar: any;
}

function FontExportModal_ (props: FontExportModalProps) {
  const { show, typeFont, source, font } = props
  const traced = useMemo(() => {
    if (!show || typeFont === null || source === null || font === null) {
      return null
    }
    return traceTypeFont(source, font, typeFont, utils.screenPixelAspectX(source.width))
  }, [show, typeFont, source, font])

  const close = () => props.Toolbar.setShowFontExport(false)
  let body = null
  if (show) {
    if (traced !== null && traced.glyphs.length > 0) {
      const workspaceName = utils.workspaceBaseName(props.workspaceFilename)
      body =
        <FontExport
          font={traced}
          defaultName={workspaceName !== 'untitled' ? workspaceName : 'PETSCII Font'}
          onClose={close}
        />
    } else {
      body = (
        <div className={styles.container}>
          <h2>Export font for the web</h2>
          <p className={styles.empty}>
            There's no font to export yet.  Draw the letters of your font next to each
            other on a screen, pick the type tool and drag a frame around the A.
          </p>
          <div className={styles.buttons}>
            <button className='cancel' onClick={close}>Close</button>
          </div>
        </div>
      )
    }
  }
  return (
    <Modal showModal={show} width={760}>
      {body}
    </Modal>
  )
}

export default connect(
  (state: RootState) => {
    const { typeFont, showFontExport } = state.toolbar
    const source = showFontExport && typeFont !== null ?
      selectors.getFramebufByIndex(state, typeFont.framebufIndex) :
      null
    return {
      show: showFontExport,
      typeFont,
      source,
      font: source !== null ? selectors.getFramebufFont(state, source).font : null,
      workspaceFilename: state.toolbar.workspaceFilename
    }
  },
  (dispatch: any) => ({
    Toolbar: Toolbar.bindDispatch(dispatch)
  })
)(FontExportModal_)
