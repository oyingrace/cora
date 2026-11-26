import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cora',
    short_name: 'Cora',
    description:
      'The financial operating system for AI agents — wallets, spend controls, and virtual Visa cards on Stellar.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f5f7',
    theme_color: '#f5f5f7',
    icons: [],
  };
}
