/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com", pathname: "/uploads/**" },
      { protocol: "https", hostname: "sleepercdn.com", pathname: "/avatars/**" },
      { protocol: "https", hostname: "cdn.sleepers.app", pathname: "/**" }, // if you ever see this host
      { protocol: "https", hostname: "images.ctfassets.net", pathname: "/**" }
    ],
  },
};
export default nextConfig;
