import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const runtimeFiles = [
  "research-theme.js",
  "app.js",
  "ppt-report-ai.js",
  "proposal-deck.js",
  "data-worker.js",
  "cluster-core.js",
  "cluster-worker.js",
  "cluster-analysis.js",
  "sw.js",
  "manifest.webmanifest",
  "icon.svg",
  "cloudflare-pages-verification.txt",
  "88d273ba3d96b5830a3a82b1040dc827.txt.txt",
];

function copyRuntimeAssets() {
  return {
    name: "copy-runtime-assets",
    closeBundle() {
      const outputDir = resolve("dist");
      mkdirSync(outputDir, { recursive: true });
      runtimeFiles.forEach((file) => {
        const source = resolve(file);
        if (existsSync(source)) copyFileSync(source, resolve(outputDir, file));
      });
      cpSync(resolve("templates"), resolve(outputDir, "templates"), { recursive: true });
      mkdirSync(resolve(outputDir, "assets"), { recursive: true });
      copyFileSync(resolve("icon.svg"), resolve(outputDir, "assets", "icon.svg"));
    },
  };
}

export default defineConfig({
  plugins: [copyRuntimeAssets()],
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
