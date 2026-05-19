import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@agora/shared"],
  // Allow Supabase auth/avatar domains. Vercel hosts the web client; the
  // browser pulls user avatars and any Storage-backed assets directly
  // from these origins.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  experimental: {
    // Tree-shake the heaviest client deps more aggressively so the
    // production bundle stays under the free-tier budget.
    optimizePackageImports: [
      "lucide-react",
      "@tiptap/react",
      "@tiptap/starter-kit",
    ],
  },
};

export default withIntl(nextConfig);
