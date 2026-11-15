import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from '../adapters/command-runner.ts';

export interface RecordingRunner {
  readonly runner: CommandRunner;
  readonly calls: () => readonly CommandSpec[];
}

export type CommandOutputs = Partial<Pick<CommandResult, 'stdout' | 'stderr'>>;

export const commandLineOf = ({ command, args }: CommandSpec): string =>
  [command, ...args].join(' ');

export const createRecordingRunner = (
  exitCodeOf: (spec: CommandSpec) => number = () => 0,
  outputsOf: (spec: CommandSpec) => CommandOutputs = () => ({}),
): RecordingRunner => {
  const calls: CommandSpec[] = [];
  return {
    runner: {
      run: (spec) => {
        calls.push(spec);
        const result: CommandResult = {
          code: exitCodeOf(spec),
          stdout: '',
          stderr: '',
          ...outputsOf(spec),
        };
        return Promise.resolve(result);
      },
      start: () => {
        throw new Error('常駐の起動は使わない');
      },
    },
    calls: () => [...calls],
  };
};
