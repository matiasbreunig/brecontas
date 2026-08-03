/**
 * Next runs this once when the server boots — the only hook the standalone
 * build gives us for starting background work.
 */
export async function register() {
  // Edge runtime has no SQLite and no timers we want here.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startJobWorker } = await import("@/server/services/jobs/worker");
  startJobWorker();
}
