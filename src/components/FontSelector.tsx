
// @flow
import React, { PureComponent } from 'react';

import { petOnly } from '../utils/platform';

class CustomFontSelect extends React.Component<{
  customFonts: {id: string, name: string}[],
  current: string,
  setCharset: (name: string) => void
}> {

  handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.preventDefault();
    this.props.setCharset(e.target.value);
  }

  render () {
    const petCharsets = [
      {
        id: 'petUpper',
        name: 'PET ABC'
      },
      {
        id: 'petLower',
        name: 'PET abc'
      }
    ];
    const charsets = petOnly ? petCharsets : [
      {
        id: 'upper',
        name: 'ABC'
      },
      {
        id: 'lower',
        name: 'abc'
      }
    ].concat(petCharsets, this.props.customFonts);
    const options = charsets.map(cf => {
      let displayName = cf.name;
      return (
        <option
          key={cf.id}
          value={cf.id}
        >
          {displayName}
        </option>
      );
    })
    return (
      <div style={{marginLeft: '5px'}}>
        <select style={{
          borderStyle: 'solid',
          borderWidth: '0px',
          borderColor: 'rgba(255,255,255, 0.0)'
        }}
          value={this.props.current}
          onChange={this.handleSelectChange}
        >
          {options}
        </select>
      </div>
    )
  }
}

interface FontSelectorProps {
  currentCharset: string;
  setCharset: (c: string) => void;
  customFonts: { id: string, name: string}[];
}

export default class FontSelector extends PureComponent<FontSelectorProps> {
  render () {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        fontSize: '0.8em',
        color: 'rgb(120,120,120)'
      }}>
        <div>Charset: </div>
        <CustomFontSelect
          customFonts={this.props.customFonts}
          current={this.props.currentCharset}
          setCharset={this.props.setCharset}
        />
      </div>
    )
  }
}
