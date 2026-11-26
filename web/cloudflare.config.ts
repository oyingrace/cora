import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "cora",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-25",
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      CORA_BACKEND_URL: "https://cora-backend.fly.dev",
      NEXT_PUBLIC_API_BASE: "https://agent-cora.fs.kg",
      NEXT_PUBLIC_DASHBOARD_URL: "https://dashboard.agent-cora.fs.kg",
      NEXT_PUBLIC_NETWORK: "testnet",
      NEXT_PUBLIC_MOCK_VCC: "true",
    },
  }),
});
