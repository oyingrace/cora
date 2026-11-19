'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS: { href: string; label: string }[] = [
  { href: '/#how', label: 'How it works' },
  { href: '/#control', label: 'Control' },
  { href: '/dashboard', label: 'Sign in' },
];

export function NavLinks() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
      <div className={`nav-menu${menuOpen ? ' nav-menu--open' : ''}`}>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="nav-link"
            onClick={() => setMenuOpen(false)}
            style={{
              textDecoration: 'none',
              color: link.href === '/dashboard' ? 'var(--fg)' : 'var(--fg-muted)',
              fontSize: '0.9375rem',
              fontWeight: link.href === '/dashboard' ? 560 : 450,
              letterSpacing: '-0.01em',
              padding: '0.45rem 0.75rem',
              borderRadius: 980,
              background: link.href === '/dashboard' ? 'var(--surface-3)' : 'transparent',
              transition: 'transform 100ms ease-out, opacity 160ms ease',
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>

      <button
        type="button"
        className="nav-burger"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        onPointerDown={() => setMenuOpen((v) => !v)}
        style={{
          display: 'none',
          border: 'none',
          background: 'var(--surface-3)',
          borderRadius: 980,
          width: 40,
          height: 40,
          cursor: 'pointer',
        }}
      >
        <span aria-hidden>{menuOpen ? '✕' : '☰'}</span>
      </button>
    </div>
  );
}
