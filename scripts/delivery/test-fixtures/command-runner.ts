import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from '../adapters/command-runner.ts';

export interface RecordingRunner {
  readonly runner: CommandRunner;
  readonly calls: () => readonly CommandSpec[];
}

export const commandLineOf = ({ command, args }: CommandSpec): string =>
  [command, ...args].join(' ');

export const createRecordingRunner = (
  exitCodeOf: (spec: CommandSpec) => number = () => 0,
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
