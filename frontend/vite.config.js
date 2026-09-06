import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.BACKEND_URL || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/health": backend,
      "/auth": backend,
      "/rooms": backend,
      "/ingest": backend,
      "/chat": backend,
    },
  },
});
