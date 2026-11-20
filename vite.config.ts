import { defineConfig } from "vite";

// In development the /api/* paths are proxied straight to the market-data providers
// (the same job functions/api/[[path]].ts does on Cloudflare Pages in production).
const ua = { "User-Agent": "Mozilla/5.0" };
export default defineConfig({
  server: {
    proxy: {
      "/api/yahoo": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        headers: ua,
        rewrite: (p) => p.replace(/^\/api\/yahoo/, ""),
      },
      "/api/binance": {
        target: "https://data-api.binance.vision",
        changeOrigin: true,
        headers: ua,
        rewrite: (p) => p.replace(/^\/api\/binance/, ""),
      },
    },
  },
});
