import type { RepoFiles } from '../adapters/repo-files.ts';
import {
  type LcovReport,
  lcovReportsOf,
  type LoadedLcov,
  MERGED_LCOV_PATH,
  mergeLcov,
} from '../core/lcov.ts';
import {
  type DeliveryCommand,
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const TITLE = 'カバレッジの合算';

interface ReadLcov extends LoadedLcov {
  readonly path: string;
}

// テストを持たない種別はアプリごとに異なり、その種別の結果は書き出されないため、無いものは読み飛ばす
const readExisting = async (
  files: RepoFiles,
  reports: readonly LcovReport[],
): Promise<readonly ReadLcov[]> => {
  const found = await Promise.all(
    reports.map(async ({ dir, path }) =>
      (await files.exists(path))
        ? [{ dir, path, lcov: await files.readText(path) }]
        : [],
    ),
  );
  return found.flat();
};

export const command: DeliveryCommand = {
  name: 'coverage-merge',
  description:
    'ルートと各アプリの単体・ブラウザ・Workers統合テストのlcovを、アプリのディレクトリを前置して1つに合算する',
  run: async (args, { files, stdout, stderr }) => {
    if (args.length > 0) {
      throw new UsageError(`引数は受け取りません: ${args.join(' ')}`);
    }
    const reports = await readExisting(files, lcovReportsOf());
    if (reports.length === 0) {
      stderr.write(
        `${TITLE}: 合算するlcov.infoが見つかりません。先にカバレッジの計測付きでテストを実行してください。\n`,
      );
      return EXIT_FAILURE;
    }
    await files.writeText(MERGED_LCOV_PATH, mergeLcov(reports));
    stdout.write(
      [
        ...reports.map(({ path }) => `- ${path}`),
        `${TITLE}: ${String(reports.length)}件の結果を${MERGED_LCOV_PATH}へ合算しました。`,
        '',
      ].join('\n'),
    );
    return EXIT_SUCCESS;
  },
};
