/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['child_process', 'fs', 'path', 'os', 'crypto'],
}
module.exports = nextConfig
