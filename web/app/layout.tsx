import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { MarketingChrome } from '@/app/components/MarketingChrome';
import './globals.css';

const SITE_URL = 'https://agent-cora.fs.kg';
const SITE_NAME = 'Cora';
const SITE_DESCRIPTION =
  'The financial operating system for AI agents. Wallets, spend controls, and virtual Visa cards on Stellar — autonomy without giving up control.';

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — Financial OS for AI agents`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: SITE_URL,
    languages: {
      'en-GB': SITE_URL,
      'x-default': SITE_URL,
    },
  },
  authors: [{ name: 'Cora', url: SITE_URL }],
  creator: 'Cora',
  publisher: 'Cora',
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Financial OS for AI agents`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Financial OS for AI agents`,
    description: SITE_DESCRIPTION,
    site: '@cora',
    creator: '@cora',
  },
  robots: {
    index: true,
    follow: true,
  },
  category: 'technology',
};

export const viewport: Viewport = {
  themeColor: '#f5f5f7',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

const jsonLdOrg = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/logo.svg`,
  description: SITE_DESCRIPTION,
};

const jsonLdSite = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}#website`,
  url: SITE_URL,
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  publisher: { '@id': `${SITE_URL}#organization` },
  inLanguage: 'en-GB',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hdrs = await headers();
  const host = hdrs.get('host') || '';
  const isStatusSubdomain = host === 'status.cora.dev' || host.startsWith('status.cora.dev:');

  return (
    <html lang="en" data-scroll-behavior="smooth" data-theme="light">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([jsonLdOrg, jsonLdSite]),
          }}
        />
      </head>
      <body
        style={{
          background: 'var(--bg)',
          color: 'var(--fg)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          margin: 0,
          fontFamily: 'var(--font-body)',
          textRendering: 'optimizeLegibility',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        }}
      >
        {isStatusSubdomain ? children : <MarketingChrome>{children}</MarketingChrome>}
      </body>
    </html>
  );
}
