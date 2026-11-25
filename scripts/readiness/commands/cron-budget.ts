import { parseArgs } from 'node:util';

import {
  JsonSourceError,
  type ReadText,
  readJsonRecords,
  readTextFile,
} from '../adapters/json-lines-source.ts';
import {
  type ScheduledRunSummary,
  cronBudgetFailures,
  judgeCronBudgetRuns,
  parseExpectedOrder,
  parseScheduledRunSummary,
  renderCronBudgetMarkdown,
} from '../core/cron-budget.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  type ReadinessCommandModule,
  type ReadinessIo,
  UsageError,
} from './shared/readiness-command.ts';

export interface CronBudgetDeps {
  readonly readText: ReadText;
}

const USAGE = [
  '使い方: cron-budget --expected-order <期待のジョブの順序のファイル> <ログのファイル>...',
  '',
  '  --expected-order  日次タイムラインの4:21の表のジョブの名前を、順序の小さい順に1行ずつ書いたファイル',
  '  <ログのファイル>  定期実行の要約のログ(JSON LinesまたはJSON配列)。複数を渡すと合わせて判定する',
  '',
  '4:21の起動だけを予算・上限・目安・順序で判定し、他の起動は所要時間を参考の値として並べる。',
  '判定に失敗すると終了コード1、入力の形の誤りは2を返す。',
  '',
].join('\n');

interface Options {
  readonly expectedOrderPath: string;
  readonly logPaths: readonly string[];
}

const parseOptions = (args: readonly string[]): Options | 'help' => {
  try {
    const { values, positionals } = parseArgs({
      args: [...args],
      options: {
        'expected-order': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help === true) return 'help';
    const expectedOrderPath = values['expected-order'];
    if (expectedOrderPath === undefined) {
      throw new UsageError(
        '--expected-orderで期待のジョブの順序のファイルを指定してください',
      );
    }
    if (positionals.length === 0) {
      throw new UsageError('ログのファイルを1つ以上指定してください');
    }
    return { expectedOrderPath, logPaths: positionals };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
      {
        cause: error,
      },
    );
  }
};

const withUsageError = async <T>(task: () => Promise<T>): Promise<T> => {
  try {
    return await task();
  } catch (error) {
    if (error instanceof JsonSourceError) {
      throw new UsageError(error.message, { cause: error });
    }
    throw error;
  }
};

const loadExpectedOrder = async (
  path: string,
  readText: ReadText,
): Promise<readonly string[]> => {
  const order = parseExpectedOrder(await readText(path));
  if (order.length === 0) {
    throw new UsageError(`${path}にジョブの名前がありません`);
  }
  return order;
};

const loadRuns = async (
  paths: readonly string[],
  readText: ReadText,
): Promise<readonly ScheduledRunSummary[]> => {
  const recordsPerFile = await Promise.all(
    paths.map((path) => readJsonRecords(path, readText)),
  );
  return recordsPerFile
    .flat()
    .map(parseScheduledRunSummary)
    .filter((run) => run !== undefined);
};

export function createCronBudgetCommand(
  deps: CronBudgetDeps,
): ReadinessCommandModule {
  return {
    run: async (args, { stdout, stderr }: ReadinessIo) => {
      const options = parseOptions(args);
      if (options === 'help') {
        stdout.write(USAGE);
        return EXIT_SUCCESS;
      }
      const [expectedOrder, runs] = await withUsageError(() =>
        Promise.all([
          loadExpectedOrder(options.expectedOrderPath, deps.readText),
          loadRuns(options.logPaths, deps.readText),
        ]),
      );
      const judgements = judgeCronBudgetRuns(runs, expectedOrder);
      stdout.write(renderCronBudgetMarkdown(judgements));
      const failures = cronBudgetFailures(judgements);
      if (failures.length === 0) return EXIT_SUCCESS;
      stderr.write(failures.map((failure) => `${failure}\n`).join(''));
      return EXIT_FAILURE;
    },
  };
}

export const { run } = createCronBudgetCommand({ readText: readTextFile });
