// Cora wordmark — plain typographic lockup, no SVG asset.
//
// Rendered as live text in the display font so it inherits whatever
// `color` the parent sets (light on dark, dark on light, accent, …).
// No image requests, no mask-image, nothing to go stale on a rebrand.
//
// Props:
//   height — visual cap box in px (default 28). Font size scales from it.
//   className / style — forwarded to the span for layout.

import type { CSSProperties } from 'react';

interface Props {
  height?: number;
  className?: string;
  style?: CSSProperties;
}

export function Wordmark({ height = 28, className, style }: Props) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height,
        fontFamily: 'var(--font-display)',
        fontSize: Math.round(height * 0.92),
        fontWeight: 650,
        letterSpacing: '-0.035em',
        lineHeight: 1,
        color: 'currentColor',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}
    >
      Cora
    </span>
  );
}
