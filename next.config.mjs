/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // TypeScript 7 ships the native compiler and no longer exposes the
    // compiler API Next reaches for during builds. Driving the CLI instead
    // keeps build-time type checking without pinning back to TypeScript 6.
    useTypeScriptCli: true,
  },
};

export default nextConfig;
