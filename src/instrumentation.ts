export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startExitWorker } = await import("./lib/exitWorker");
    startExitWorker();
  }
}
