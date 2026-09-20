export type RuntimeState = {
  spontaneousPaused: boolean;
  dryRun: boolean;
  lastTickAt: number | null;
  lastSpontaneousAt: number | null;
};

export const createRuntimeState = (dryRun: boolean): RuntimeState => ({
  spontaneousPaused: false,
  dryRun,
  lastTickAt: null,
  lastSpontaneousAt: null,
});
