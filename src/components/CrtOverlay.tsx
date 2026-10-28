import React from 'react';

import styles from './CrtOverlay.module.css';

// Green phosphor grade plus a bloom of the lit glyphs. Scanlines and the
// vignette are painted on top so they stay on the glass, not in the pixels.
const PHOSPHOR_MATRIX = [
  '0.081 0.272 0.027 0 0.010',
  '0.223 0.751 0.076 0 0.020',
  '0.034 0.114 0.012 0 0.005',
  '0 0 0 1 0'
].join(' ');

export default function CrtOverlay() {
  return (
    <div className={styles.overlay}>
      <svg className={styles.defs} aria-hidden="true" focusable="false">
        <filter id="pet-crt" colorInterpolationFilters="sRGB" x="-6%" y="-6%" width="112%" height="112%">
          <feColorMatrix in="SourceGraphic" type="matrix" values={PHOSPHOR_MATRIX} result="green" />
          <feComponentTransfer in="green" result="highlights">
            <feFuncR type="linear" slope="2.4" intercept="-0.95" />
            <feFuncG type="linear" slope="2.4" intercept="-0.95" />
            <feFuncB type="linear" slope="2.4" intercept="-0.95" />
          </feComponentTransfer>
          <feGaussianBlur in="highlights" stdDeviation="1.35" result="glowNear" />
          <feGaussianBlur in="highlights" stdDeviation="5" result="glowFar" />
          <feComponentTransfer in="glowFar" result="glowFarSoft">
            <feFuncR type="linear" slope="0.4" />
            <feFuncG type="linear" slope="0.55" />
            <feFuncB type="linear" slope="0.3" />
          </feComponentTransfer>
          <feBlend in="green" in2="glowNear" mode="screen" result="withNear" />
          <feBlend in="withNear" in2="glowFarSoft" mode="screen" />
        </filter>
      </svg>
      <div className={styles.scanlines} />
      <div className={styles.vignette} />
      <div className={styles.glass} />
    </div>
  );
}
