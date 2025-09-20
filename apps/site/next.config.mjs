/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com", pathname: "/**" },
    ],
    // If you still see 403s or want to skip optimization locally:
    // unoptimized: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "www.league1fantasy.com", "league1fantasy.com"],
    },
  },
};

export default nextConfig;
