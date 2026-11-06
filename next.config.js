/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["node-forge", "@prisma/client", "pdfmake", "exceljs", "pdf-parse"],
  },
};

module.exports = nextConfig;
