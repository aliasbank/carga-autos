import type { NextConfig } from "next";

function normalizeBasePath(value: string | undefined) {
  const candidate = (value || "").trim();
  if (!candidate || candidate === "/") return "";
  return `/${candidate.replace(/^\/+|\/+$/g, "")}`;
}

// Build with APP_BASE_PATH=/cargadores when the application is served below
// AppSec's existing hostname. Leaving it empty preserves local/root hosting.
const basePath = normalizeBasePath(process.env.APP_BASE_PATH);

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
