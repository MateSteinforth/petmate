
import { Action } from 'redux'
import { ThunkAction } from 'redux-thunk';

import { writeSettings } from '../utils/platform'

import {
  Settings as RSettings,
  EditSaved,
  EditBranch,
  PaletteName,
  RootState,
  SettingsJson
} from './types'
import { ActionsUnion, DispatchPropsFromActions, createAction } from './typeUtils'

import * as fp from '../utils/fp'
import { validCharLayouts } from '../utils'

const LOAD = 'LOAD'
const SET_PALETTE = 'SET_PALETTE'
const SAVE_EDITS = 'SAVE_EDITS'
const CANCEL_EDITS = 'CANCEL_EDITS'
const SET_SELECTED_COLOR_PALETTE = 'SET_SELECTED_COLOR_PALETTE'
const SET_INTEGER_SCALE = 'SET_INTEGER_SCALE'
const SET_CHAR_LAYOUTS = 'SET_CHAR_LAYOUTS'

//const CONFIG_FILE_VERSION = 1

const initialState: RSettings = {
  palettes: fp.mkArray(4, () => fp.mkArray(16, i => i)),
  selectedColorPalette: 'petmate',
  integerScale: false,
  charLayouts: {}
}

function saveSettings(settings: RSettings) {
  writeSettings(JSON.stringify(settings))
}

// Load settings from a JSON doc.  Handle version upgrades.
function fromJson(json: SettingsJson): RSettings {
  let version = undefined
  if (json.version === undefined || json.version === 1) {
    version = 1
  }
  if (version !== 1) {
    console.error('TODO upgrade settings format!')
  }
  const init = initialState
  return {
    palettes: json.palettes === undefined ? init.palettes : json.palettes,
    selectedColorPalette: json.selectedColorPalette === undefined ? init.selectedColorPalette : json.selectedColorPalette,
    integerScale: fp.maybeDefault(json.integerScale, false),
    charLayouts: validCharLayouts(json.charLayouts)
  }
}

function saveEdits (): ThunkAction<void, RootState, undefined, Action> {
  return (dispatch, _getState) => {
    dispatch(actions.saveEditsAction());
    dispatch((_dispatch, getState) => {
      const state = getState().settings
      saveSettings(state.saved)
    })
  }
}

// Set (or with null, reset to the default) the character selector layouts
// of some charsets.  Unlike the other settings, this isn't edited in the
// preferences dialog, so it's saved right away.
function setCharLayouts (layouts: CharLayoutsUpdate): ThunkAction<void, RootState, undefined, Action> {
  return (dispatch, getState) => {
    dispatch(actionCreators.setCharLayoutsAction(layouts));
    saveSettings(getState().settings.saved)
  }
}

type CharLayoutsUpdate = { [charset: string]: number[]|null };

function updateCharLayouts(settings: RSettings, update: CharLayoutsUpdate): RSettings {
  const charLayouts = { ...settings.charLayouts }
  Object.keys(update).forEach(charset => {
    const layout = update[charset]
    if (layout === null) {
      delete charLayouts[charset]
    } else {
      charLayouts[charset] = layout
    }
  })
  return { ...settings, charLayouts }
}

interface BranchArgs {
  branch: EditBranch;
}

interface SetPaletteArgs extends BranchArgs {
  idx: number;
  palette: number[];
}

interface SetSelectedColorPaletteNameArgs extends BranchArgs {
  name: PaletteName;
}

interface SetIntegerScaleArgs extends BranchArgs {
  scale: boolean;
}

const actionCreators = {
  load: (data: SettingsJson) => createAction(LOAD, fromJson(data)),
  saveEditsAction: () => createAction(SAVE_EDITS),
  cancelEdits: () => createAction(CANCEL_EDITS),
  setPalette: (data: SetPaletteArgs) => createAction(SET_PALETTE, data),
  setSelectedColorPaletteName: (data: SetSelectedColorPaletteNameArgs) => createAction(SET_SELECTED_COLOR_PALETTE, data),
  setIntegerScale: (data: SetIntegerScaleArgs) => createAction(SET_INTEGER_SCALE, data),
  setCharLayoutsAction: (data: CharLayoutsUpdate) => createAction(SET_CHAR_LAYOUTS, data)
};

type Actions = ActionsUnion<typeof actionCreators>

export const actions = {
  ...actionCreators,
  saveEdits,
  setCharLayouts
};

export type PropsFromDispatch = DispatchPropsFromActions<typeof actions>;

function updateBranch(
  state:  EditSaved<RSettings>,
  branch: EditBranch,
  field:  Partial<RSettings>
): EditSaved<RSettings> {
  const s: RSettings = state[branch];
  return {
    ...state,
    [branch]: {
      ...s,
      ...field
    }
  }
}

export function reducer(
  state: EditSaved<RSettings> = {
    editing: initialState, // form state while editing
    saved: initialState    // final state for rest of UI and persistence
  },
  action: Actions
): EditSaved<RSettings> {
  switch (action.type) {
    case LOAD:
      let newSaved = action.data
      return {
        saved: newSaved,
        editing: newSaved
      }
    case SAVE_EDITS:
      return {
        ...state,
        saved: state.editing
      }
    case CANCEL_EDITS:
      return {
        ...state,
        editing: state.saved
      }
    case SET_PALETTE:
      const branch: EditBranch = action.data.branch;
      return updateBranch(state, action.data.branch, {
        palettes: fp.arraySet(state[branch].palettes, action.data.idx, action.data.palette)
      });
    case SET_INTEGER_SCALE: {
      return updateBranch(state, action.data.branch, {
        integerScale: action.data.scale
      });
    }
    case SET_SELECTED_COLOR_PALETTE: {
      return updateBranch(state, action.data.branch, {
        selectedColorPalette: action.data.name
      });
    }
    case SET_CHAR_LAYOUTS:
      return {
        saved: updateCharLayouts(state.saved, action.data),
        editing: updateCharLayouts(state.editing, action.data)
      }
    default:
      return state;
  }
}
