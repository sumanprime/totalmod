import { defineConfig } from "vitest/config";

// The path tests drive real git in temp repos; give them room on a busy machine.
export default defineConfig({ test: { testTimeout: 30_000 } });
