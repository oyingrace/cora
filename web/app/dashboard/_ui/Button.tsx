// Minimal button primitive. Four variants:
//   primary    — solid Cora blue, used for the highest-emphasis CTA
//                in a region (matches the landing page CTA)
//   secondary  — bordered surface, used for everything that isn't a
//                primary or destructive action
//   ghost      — transparent / text-only
//   danger     — red-muted, used for destructive actions

import type { CSSProperties, ReactNode, ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  style,
  ...rest
}: Props) {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    fontFamily: 'var(--font-body)',
    fontSize: size === 'sm' ? '0.78rem' : '0.85rem',
    fontWeight: 560,
    letterSpacing: '-0.01em',
    padding: size === 'sm' ? '0.4rem 0.75rem' : '0.55rem 1rem',
    borderRadius: 980,
    cursor: 'pointer',
    transition: 'background 120ms, border-color 120ms, color 120ms, opacity 160ms',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };
  const variants: Record<Variant, CSSProperties> = {
    primary: {
      background: 'var(--blue)',
      color: '#fff',
      border: '1px solid var(--blue)',
    },
    secondary: {
      background: 'var(--surface)',
      color: 'var(--fg)',
      border: '1px solid var(--border)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--fg-muted)',
      border: '1px solid transparent',
    },
    danger: {
      background: 'var(--red-muted)',
      color: 'var(--red)',
      border: '1px solid var(--red-border)',
    },
  };
  return (
    <button {...rest} style={{ ...base, ...variants[variant], ...style }}>
      {icon ? <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span> : null}
      {children}
    </button>
  );
}
