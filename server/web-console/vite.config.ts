import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the Vite server proxies API + voice WebSocket traffic to the Node server on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: "http://localhost:8080", changeOrigin: true, ws: true },
      "/health": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
  build: {
    // Emitted into server/dist (next to the compiled server) — Railway ships
    // the dist folder into the runtime image, so the console rides along.
    outDir: "../dist/web-public",
    emptyOutDir: true,
  },
});
