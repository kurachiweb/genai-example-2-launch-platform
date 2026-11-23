import {
  EXIT_FAILURE,
  type ReadinessCommandModule,
} from './readiness-command.ts';

export const notImplemented =
  (name: string) => (): Promise<ReadinessCommandModule> =>
    Promise.resolve({
      run: (_args, { stderr }) => {
        stderr.write(`${name}は未実装です。\n`);
        return Promise.resolve(EXIT_FAILURE);
      },
    });
