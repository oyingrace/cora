'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavLinks } from './NavLinks';
import { Wordmark } from './Wordmark';
import type { ReactNode } from 'react';

export function MarketingChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideChrome = pathname.startsWith('/dashboard');

  if (hideChrome) {
    return <>{children}</>;
  }

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <nav
        className="marketing-nav"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(245, 245, 247, 0.72)',
          backdropFilter: 'var(--material-blur, blur(20px) saturate(180%))',
          WebkitBackdropFilter: 'var(--material-blur, blur(20px) saturate(180%))',
          borderBottom: '1px solid var(--border-hairline)',
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: '0 auto',
            padding: '0 1.5rem',
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link
            href="/"
            style={{
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              color: 'var(--fg)',
            }}
          >
            <Wordmark height={20} />
          </Link>
          <NavLinks />
        </div>
      </nav>

      <main id="main" style={{ flex: 1, position: 'relative', zIndex: 2 }}>
        {children}
      </main>

      <footer
        style={{
          borderTop: '1px solid var(--border-hairline)',
          padding: '2.5rem 1.5rem 2rem',
          marginTop: '2rem',
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem 2rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ color: 'var(--fg-dim)', fontSize: '0.875rem' }}>
            © {new Date().getFullYear()} Cora · Stellar testnet
          </div>
          <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.875rem' }}>
            <Link href="/privacy" style={{ color: 'var(--fg-muted)', textDecoration: 'none' }}>
              Privacy
            </Link>
            <Link href="/terms" style={{ color: 'var(--fg-muted)', textDecoration: 'none' }}>
              Terms
            </Link>
            <Link href="/dashboard" style={{ color: 'var(--fg-muted)', textDecoration: 'none' }}>
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
