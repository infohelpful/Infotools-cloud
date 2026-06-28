import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname),
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:19427", changeOrigin: true },
      "/v2": { target: "http://127.0.0.1:19427", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:19427", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "info-admin": resolve(__dirname, "info-admin/index.html"),
        vocalRemover: resolve(__dirname, "sites/vocal-remover/index.html"),
      },
    },
  },
});
