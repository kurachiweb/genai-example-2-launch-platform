export interface DeployOutput {
  readonly versionId: string | undefined;
  readonly startupTimeMs: number | undefined;
}

const VERSION_ID_LINE =
  /^\s*Current Version ID: ([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\s*$/m;
const STARTUP_TIME_LINE = /^Worker Startup Time: (\d+) ms\s*$/m;

export function parseDeployOutput(stdout: string): DeployOutput {
  const startupTime = STARTUP_TIME_LINE.exec(stdout)?.[1];
  return {
    versionId: VERSION_ID_LINE.exec(stdout)?.[1],
    startupTimeMs:
      startupTime === undefined ? undefined : Number.parseInt(startupTime, 10),
  };
}
