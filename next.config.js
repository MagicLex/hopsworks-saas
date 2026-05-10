/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Removed static export to enable API routes for Auth0
  // output: 'export',
  images: {
    unoptimized: false, // Re-enabled image optimization now that we use server-side rendering
    domains: ['cdn.prod.website-files.com'] // Allow Hopsworks CDN images
  },
  async redirects() {
    return [
      {
        source: '/login',
        destination: '/',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig