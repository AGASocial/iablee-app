import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  // Optimize image loading
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'appleid.cdn-apple.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.gstatic.com',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
    minimumCacheTTL: 60,
  },
  // Enable React strict mode for better development
  reactStrictMode: true,
  // Turbopack configuration
  turbopack: {
    resolveAlias: {
      '@/*': ['./src/*'],
    },
  },
};

export default withNextIntl(nextConfig);
