/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '1gb',
    },
  },
  // Note: COOP/COEP headers removed - FFmpeg.wasm will work in single-threaded mode
  // which is slower but more compatible
}

module.exports = nextConfig
