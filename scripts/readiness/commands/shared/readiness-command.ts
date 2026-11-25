export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export interface TextOutput {
  write(text: string): unknown;
}

export interface ReadinessIo {
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

export type ReadinessRun = (
  args: readonly string[],
  io: ReadinessIo,
) => Promise<number>;

export interface ReadinessCommandModule {
  readonly run: ReadinessRun;
}

export class UsageError extends Error {
  override readonly name = 'UsageError';
}
