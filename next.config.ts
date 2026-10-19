import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pembuat gambar PNG untuk bot Telegram memakai library native; jangan di-bundle oleh Next.
  serverExternalPackages: ["@napi-rs/canvas"],
  // Font untuk gambar report harus ikut terdeploy ke fungsi webhook Telegram di Vercel.
  outputFileTracingIncludes: {
    "/api/telegram/webhook": ["./features/telegram/report-images/fonts/**/*"],
  },
};

export default nextConfig;
