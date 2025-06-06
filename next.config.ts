import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  // Optimize image loading
  images: {
    domains: ['localhost'],
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
