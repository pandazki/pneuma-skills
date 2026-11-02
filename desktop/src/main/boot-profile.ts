/** Opt-in process-relative milestones; window readiness is not application interactivity. */
export function markBoot(stage: string, details: Record<string, string | number | boolean> = {}): void {
  if (process.env.PNEUMA_BOOT_PROFILE !== "1") return;
  console.log(`[boot-profile] ${JSON.stringify({
    scope: "desktop",
    stage,
    elapsedMs: Math.round(process.uptime() * 1000),
    pid: process.pid,
    ...details,
  })}`);
}
