import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/api/', '/portal/'],
      },
    ],
    sitemap: 'https://cora.dev/sitemap.xml',
    host: 'https://cora.dev',
  };
}
