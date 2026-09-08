import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

const require = createRequire(import.meta.url);
const { createResearchHandler } = require("./lib/research-handler");
const { createToolHandler } = require("./lib/tool-handler");
const { createAiProxyHandler } = require("./lib/ai-proxy");
const { configuredBodyLimit } = require("./lib/request-body");

const runtimeFiles = [
  // Classic app.js imports these by source URL outside Vite's module graph.
  "src/shared/export.js",
  "src/shared/excel-export-worker.js",
  "src/shared/file-parser.js",
  "research-theme.js",
  "ai-plan-quality.js",
  "app.js",
  "ppt-report-ai.js",
  "proposal-deck.js",
  "data-worker.js",
  "crosstab-models.js",
  "crosstab-model-ui.js",
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
        if (existsSync(source)) {
          const target = resolve(outputDir, file);
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(source, target);
        }
      });
      cpSync(resolve("templates"), resolve(outputDir, "templates"), { recursive: true });
      mkdirSync(resolve(outputDir, "assets"), { recursive: true });
      copyFileSync(resolve("icon.svg"), resolve(outputDir, "assets", "icon.svg"));
    },
  };
}

function localAiApi(env) {
  return {
    name: "surveykit-local-ai-api",
    configureServer(server) {
      const handler = createAiProxyHandler({ env, maxBodyBytes: configuredBodyLimit(env.AI_PROXY_MAX_BODY_BYTES, 1024 * 1024, 10 * 1024 * 1024) });
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0];
        if (pathname !== "/api/ai" && !pathname?.startsWith("/api/ai/")) return next();
        Promise.resolve(handler(request, response)).catch(next);
      });
    },
  };
}

function localResearchApi(env) {
  return {
    name: "surveykit-local-research-api",
    configureServer(server) {
      const handler = createResearchHandler({
        env: {
          ...env,
          RESEARCH_DEV_USER_ID: env.RESEARCH_DEV_USER_ID || "local-developer",
        },
      });
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/research")) return next();
        Promise.resolve(handler(request, response)).catch(next);
      });
    },
  };
}

function localToolApi(env) {
  return {
    name: "surveykit-local-tool-gateway",
    configureServer(server) {
      const handler = createToolHandler({
        env: {
          ...env,
          TOOL_DEV_USER_ID: env.TOOL_DEV_USER_ID || env.RESEARCH_DEV_USER_ID || "local-developer",
        },
      });
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/tools")) return next();
        Promise.resolve(handler(request, response)).catch(next);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  return {
  plugins: [localAiApi(env), localResearchApi(env), localToolApi(env), copyRuntimeAssets()],
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
    },
  },
  };
});
