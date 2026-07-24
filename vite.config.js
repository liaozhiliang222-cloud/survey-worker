import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 保持兼容性：不使用 hash 文件名（Cloudflare Pages 缓存由 SW 管理）
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  server: {
    port: 4281,
    proxy: {
      "/pptx-api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pptx-api/, "/api/pptx-report"),
      },
      "/api/ai": {
        target: "http://127.0.0.1:4281",
        changeOrigin: true,
      },
    },
  },
});
