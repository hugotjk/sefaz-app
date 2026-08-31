/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["node-forge", "@prisma/client", "pdfmake"],
  },
};

module.exports = nextConfig;
