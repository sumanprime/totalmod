import { defineConfig } from "vitest/config";

// Telemetry is fire-and-forget; tests wait for it with vi.waitFor.
export default defineConfig({ test: { testTimeout: 15_000 } });
