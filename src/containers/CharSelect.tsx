
import React, { Component, useRef, useCallback, useState, useMemo, MouseEvent, PointerEvent, CSSProperties } from 'react';
import { connect } from 'react-redux'
import { Dispatch, bindActionCreators } from 'redux'

import { RootState, Font, Pixel, Coord2, Rgb } from '../redux/types'
import * as framebuffer from '../redux/editor'
import * as cfonts from '../redux/customFonts'

import { Toolbar } from '../redux/toolbar'
import { framebufIndexMergeProps } from '../redux/utils'

import CharGrid from '../components/CharGrid'
import CharPosOverlay from '../components/CharPosOverlay'
import { CharSelectStatusbar } from '../components/Statusbar'

import * as utils from '../utils'
import * as fp from '../utils/fp'
import * as selectors from '../redux/selectors'
import * as screensSelectors from '../redux/screensSelectors'
import {
  getSettings,
  getSettingsCurrentColorPalette
} from '../redux/settingsSelectors'

import FontSelector from '../components/FontSelector'

import styles from './CharSelect.module.css'

interface CharSelectProps {
  Toolbar: any; // TODO ts
  Framebuffer: framebuffer.PropsFromDispatch;
  charset: string;
  font: Font;
  customFonts: cfonts.CustomFonts;
  canvasScale: {
    scaleX: number, scaleY: number
  };
  colorPalette: Rgb[];
  selected: Coord2 | null;
  backgroundColor: number;
  textColor: number;
  customLayout: boolean;
}

// A drag has to move this many screen pixels before it picks up the char,
// anything less is a click.
const DRAG_START_PX = 4;

// Char position & click hook
function useCharPos(
  charWidth: number,
  charHeight: number,
  initialCharPos: Coord2 | null
) {
  const ref = useRef<HTMLDivElement>(null);
  let [isActive, setIsActive] = useState(true);
  let [charPos, setCharPos] = useState<Coord2|null>(initialCharPos);
  let onMouseMove = useCallback(function(event: MouseEvent) {
    if (isActive && ref.current != null) {
      const bbox = ref.current.getBoundingClientRect();
      const x = Math.floor((event.clientX - bbox.left)/bbox.width * charWidth);
      const y = Math.floor((event.clientY - bbox.top)/bbox.height * charHeight);
      if (x >= 0 && x < charWidth && y >= 0 && y < charHeight) {
        setCharPos({row: y, col: x});
      } else {
        setCharPos(null);
      }
    }
  }, [ref, charWidth, charHeight, setCharPos]);

  let onMouseEnter = useCallback(function() {
    setIsActive(true);
  }, []);

  let onMouseLeave = useCallback(function() {
    setIsActive(false);
    setCharPos(null);
  }, []);

  return {
    charPos,
    divProps: {
      ref,
      onMouseMove,
      onMouseEnter,
      onMouseLeave
    }
  };
}

function CharSelectView(props: {
  font: Font;
  charset: string;
  customFonts: cfonts.CustomFonts;
  canvasScale: {
    scaleX: number, scaleY: number
  };
  colorPalette: Rgb[];
  selected: Coord2;
  backgroundColor: string;
  style: CSSProperties;

  fb: Pixel[][];
  textColor: number;
  customLayout: boolean;
  onCharSelected: (pos: Coord2|null) => void;
  onCharMoved: (from: Coord2, to: Coord2) => void;
  onResetLayout: () => void;
  setCharset: (charset: string) => void;
}) {
  const W = 16
  const H = utils.CHAR_LAYOUT_ROWS
  const { scaleX, scaleY } = props.canvasScale;

  const { charPos, divProps } = useCharPos(W, H, props.selected);

  let screencode: number|null = utils.charScreencodeFromRowCol(props.font, props.selected);
  if (charPos !== null) {
    screencode = utils.charScreencodeFromRowCol(props.font, charPos);
  }

  // Clicking a char selects it, dragging it moves it to another place (or
  // swaps it with the char that's there).  `x` and `y` are in the grid's
  // unscaled pixels.
  const down = useRef<{ pos: Coord2, clientX: number, clientY: number } | null>(null);
  const [drag, setDrag] = useState<{ from: Coord2, x: number, y: number } | null>(null);

  const locate = (e: PointerEvent) => {
    const bbox = divProps.ref.current!.getBoundingClientRect();
    const fx = (e.clientX - bbox.left) / bbox.width;
    const fy = (e.clientY - bbox.top) / bbox.height;
    const pos = { row: Math.floor(fy * H), col: Math.floor(fx * W) };
    const inside = pos.row >= 0 && pos.row < H && pos.col >= 0 && pos.col < W;
    return { pos: inside ? pos : null, x: fx * W * 9, y: fy * H * 9 };
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    const { pos } = locate(e);
    if (pos === null) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    down.current = { pos, clientX: e.clientX, clientY: e.clientY };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    if (d === null) {
      return;
    }
    if (drag === null) {
      const moved = Math.hypot(e.clientX - d.clientX, e.clientY - d.clientY);
      if (moved < DRAG_START_PX || utils.charScreencodeFromRowCol(props.font, d.pos) === null) {
        return;
      }
    }
    const { x, y } = locate(e);
    setDrag({ from: d.pos, x, y });
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    down.current = null;
    if (d === null) {
      return;
    }
    const { pos } = locate(e);
    if (drag !== null) {
      setDrag(null);
      if (pos !== null) {
        props.onCharMoved(drag.from, pos);
      }
    } else if (pos !== null && utils.charScreencodeFromRowCol(props.font, pos) !== null) {
      props.onCharSelected(pos);
    }
  };

  const handlePointerCancel = () => {
    down.current = null;
    setDrag(null);
  };

  const dragCode = drag !== null ? utils.charScreencodeFromRowCol(props.font, drag.from) : null;
  const dragFb = useMemo(() => {
    return [[{ code: dragCode !== null ? dragCode : 0x20, color: props.textColor }]];
  }, [dragCode, props.textColor]);

  const customFonts = Object.entries(props.customFonts).map(([id, { name }]) => {
    return {
      id,
      name
    };
  })
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div className={styles.csContainer} style={props.style}>
        <div
          style={{
            imageRendering: 'pixelated',
            transform: `scale(${scaleX}, ${scaleY})`,
            transformOrigin: '0% 0%',
            width: W*9,
            height: H*9,
            position: 'relative',
            touchAction: 'none',
            userSelect: 'none',
            cursor: drag !== null ? 'grabbing' : undefined
          }}
          {...divProps}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <CharGrid
            width={W}
            height={H}
            backgroundColor={props.backgroundColor}
            grid={true}
            framebuf={props.fb}
            font={props.font}
            colorPalette={props.colorPalette}
          />
          {charPos !== null ?
            <CharPosOverlay
              framebufWidth={W}
              framebufHeight={H}
              grid={true}
              opacity={0.5}
              charPos={charPos!}
            />
            : null}
          {props.selected ?
            <CharPosOverlay
              framebufWidth={W}
              framebufHeight={H}
              grid={true}
              opacity={1.0}
              charPos={props.selected} />
            : null}
          {drag !== null ?
            <div style={{
              position: 'absolute',
              left: drag.x - 4,
              top: drag.y - 4,
              width: 8,
              height: 8,
              zIndex: 2,
              pointerEvents: 'none',
              outline: '0.5px solid rgb(255,255,255)'
            }}>
              <CharGrid
                width={1}
                height={1}
                grid={false}
                backgroundColor={props.backgroundColor}
                framebuf={dragFb}
                font={props.font}
                colorPalette={props.colorPalette}
              />
            </div>
            : null}
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'row',
        marginTop:'4px',
        alignItems:'center',
        justifyContent: 'space-between'
      }}>
        <CharSelectStatusbar
          curScreencode={screencode}
        />
        {props.customLayout ?
          <div
            className={styles.resetLayout}
            title='Put the characters back in their original order'
            onClick={props.onResetLayout}
          >
            Reset layout
          </div>
          : null}
        <FontSelector
          currentCharset={props.charset}
          setCharset={props.setCharset}
          customFonts={customFonts}
        />
      </div>
    </div>
  )
}

class CharSelect extends Component<CharSelectProps> {

  fb: Pixel[][]|null = null;
  font: Font|null = null;
  prevTextColor = -1;

  constructor (props: CharSelectProps) {
    super(props)
    this.computeCachedFb(0)
  }

  computeCachedFb(textColor: number) {
    const { font } = this.props
    const layout = utils.charLayoutOf(font)
    this.fb = fp.mkArray(utils.CHAR_LAYOUT_ROWS, y => {
      return fp.mkArray(16, x => {
        const code = layout[y*16 + x]
        return {
          // Empty places show as blanks
          code: code === utils.EMPTY_CHAR ? 0x20 : code,
          color: textColor
        }
      })
    })
    this.prevTextColor = textColor
    this.font = font
  }

  handleClick = (charPos: Coord2 | null) => {
    this.props.Toolbar.setCurrentChar(charPos)
  }

  render () {
    const { colorPalette } = this.props
    // Editor needs to specify a fixed width/height because the contents use
    // relative/absolute positioning and thus seem to break out of the CSS
    // grid.
    const { scaleX, scaleY } = this.props.canvasScale
    const w = `${Math.floor(scaleX*8*16+scaleX*16)}px`
    const rows = utils.CHAR_LAYOUT_ROWS
    const h = `${Math.floor(scaleY*8*rows+scaleY*rows)}px`
    const backg = utils.colorIndexToCssRgb(
      colorPalette, this.props.backgroundColor
    )
    const s = {width: w, height:h}
    if (this.prevTextColor !== this.props.textColor ||
      this.font !== this.props.font) {
      this.computeCachedFb(this.props.textColor)
    }
    if (!this.fb) {
      throw new Error('FB cannot be null here');
    }
    return (
      <CharSelectView
        canvasScale={this.props.canvasScale}
        backgroundColor={backg}
        style={s}
        fb={this.fb}
        charset={this.props.charset}
        font={this.props.font}
        customFonts={this.props.customFonts}
        colorPalette={colorPalette}
        selected={this.props.selected!}
        textColor={this.props.textColor}
        customLayout={this.props.customLayout}
        onCharSelected={this.handleClick}
        onCharMoved={this.props.Toolbar.moveChar}
        onResetLayout={this.props.Toolbar.resetCharLayout}
        setCharset={this.props.Framebuffer.setCharset}
      />
    )
  }
}

const mapDispatchToProps = (dispatch: Dispatch) => {
  return {
    Framebuffer: bindActionCreators(framebuffer.actions, dispatch),
    Toolbar: Toolbar.bindDispatch(dispatch)
  }
}

const mapStateToProps = (state: RootState) => {
  const framebuf = selectors.getCurrentFramebuf(state)
  const { charset, font } = selectors.getCurrentFramebufFont(state)
  const selected =
    selectors.getCharRowColWithTransform(
      state.toolbar.selectedChar,
      font,
      state.toolbar.charTransform
    );
  return {
    framebufIndex: screensSelectors.getCurrentScreenFramebufIndex(state),
    backgroundColor: framebuf ? framebuf.backgroundColor : framebuffer.DEFAULT_BACKGROUND_COLOR,
    selected,
    textColor: state.toolbar.textColor,
    charset,
    font,
    customLayout: getSettings(state).charLayouts[charset] !== undefined,
    customFonts: selectors.getCustomFonts(state),
    colorPalette: getSettingsCurrentColorPalette(state)
  }
}

export default connect(
  mapStateToProps,
  mapDispatchToProps,
  framebufIndexMergeProps
)(CharSelect)
