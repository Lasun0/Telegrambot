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
  // Increase the body parser limit for API routes
  api: {
    bodyParser: {
      sizeLimit: '1gb',
    },
    responseLimit: false,
  },
  // Note: COOP/COEP headers removed - FFmpeg.wasm will work in single-threaded mode
  // which is slower but more compatible
}

module.exports = nextConfig
