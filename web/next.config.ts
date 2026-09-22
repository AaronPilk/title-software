import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const development = process.env.NODE_ENV === "development";
    return [{
      // Match the root route too: vinext's named wildcard excludes an empty path.
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: [
          "default-src 'self'",
          // Framework hydration uses inline scripts; document contents never do.
          "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" + (development ? " 'unsafe-eval'" : ""),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co" + (development ? " ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*" : ""),
          "worker-src 'self' blob:",
          "frame-src 'none'",
          "frame-ancestors 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; ") },
      ],
    }];
  },
};

export default nextConfig;
