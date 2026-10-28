import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
  "src/shared/driver-import.mjs",
  "src/shared/vendor/spss-reader.mjs",
  "src/shared/vendor/datareader-spss-LICENSE",
  "research-theme.js",
  "ai-plan-quality.js",
  "questionnaire-quality.js",
  "questionnaire-delivery.js",
  "questionnaire-workflow.js",
  "questionnaire-review-ui.js",
  "app.js",
  "ppt-report-ai.js",
  "proposal-deck.js",
  "data-worker.js",
  "crosstab-models.js",
  "crosstab-net.js",
  "crosstab-model-ui.js",
  "indicator-weighting.js",
  "indicator-weighting-ui.js",
  "driver-core.js",
  "driver-analysis-ui.js",
  "driver-lmg.js",
  "driver-lmg-ui.js",
  "driver-lmg-worker.js",
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

// 构建时把 index.html 里经典脚本的 ?v= 换成内容哈希（h + 12 位 sha256）。
// 文件内容变化时 URL 必然变化，sw.js 只对这种格式做缓存优先，不会返回旧代码。
function contentVersion(file) {
  return `h${createHash("sha256").update(readFileSync(resolve(file))).digest("hex").slice(0, 12)}`;
}

function versionClassicScripts(html) {
  return html.replace(/(<script\b[^>]*\bsrc=")\.\/([^"?]+)\?v=[^"]*(")/g, (match, head, file, tail) => (
    runtimeFiles.includes(file) && existsSync(resolve(file)) ? `${head}./${file}?v=${contentVersion(file)}${tail}` : match
  ));
}

function contentVersionedScripts() {
  return {
    name: "content-versioned-scripts",
    apply: "build",
    transformIndexHtml: { order: "post", handler: versionClassicScripts },
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
  plugins: [localAiApi(env), localResearchApi(env), localToolApi(env), contentVersionedScripts(), copyRuntimeAssets()],
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 带内容哈希的文件名：sw.js 对 /assets/name-hash.(js|css) 缓存优先，内容变化即换 URL。
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  server: {
    port: 4281,
    watch: { ignored: ['**/.data/**', '**/test-results/**', '**/playwright-report/**', '**/*.crdownload'] },
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
