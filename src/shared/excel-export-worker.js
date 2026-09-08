import { buildExcelWorkbookXlsxBytes } from "./export.js?v=20260908-3";
self.onmessage = ({ data }) => {
  try {
    const bytes = buildExcelWorkbookXlsxBytes(data.sheets, progress => self.postMessage({ type: "progress", progress }));
    self.postMessage({ type: "result", buffer: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "Excel 文件打包失败" });
  }
};

self.postMessage({ type: "ready" });
