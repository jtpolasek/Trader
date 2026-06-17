export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startExitWorker } = await import("./lib/exitWorker");
    const { startCopyWorker } = await import("./lib/copyWorker");
    const { startCopyRealtimeWatcher } = await import("./lib/copyRealtime");
    startExitWorker();
    startCopyWorker();
    startCopyRealtimeWatcher();
  }
}
