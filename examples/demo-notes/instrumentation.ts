// Runs once when the server starts: lock down the env before any request code runs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getMode } = await import("./lib/mode");
  if (getMode() === "mock") {
    const { installMockGuard } = await import("./lib/mock-guard");
    installMockGuard();
  }
}
