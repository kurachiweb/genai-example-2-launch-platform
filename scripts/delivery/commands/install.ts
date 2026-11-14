import {
  type DeliveryCommand,
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';
import {
  findInstallTargets,
  runInTarget,
  stepLineOf,
  type TargetStep,
  targetLabelOf,
} from './shared/install-targets.ts';

const TITLE = '依存パッケージの導入';

// CIが空でなければルートのprepareがGitフックの導入を飛ばす
const INSTALL: TargetStep = {
  args: ['install', '--frozen-lockfile'],
  env: { CI: 'true' },
};

export const command: DeliveryCommand = {
  name: 'install',
  description:
    'ルート・アプリ・共有ディレクトリの配置元の依存パッケージを、ロックファイルのとおりに導入する',
  run: async (args, deps) => {
    if (args.length > 0) {
      throw new UsageError(`引数は受け取りません: ${args.join(' ')}`);
    }
    const targets = await findInstallTargets(deps.files);
    for (const dir of targets) {
      const code = await runInTarget(dir, INSTALL, deps);
      if (code !== 0) {
        deps.stderr.write(
          `${TITLE}: ${targetLabelOf(dir)}の${stepLineOf(INSTALL)}が終了コード${String(code)}で失敗しました。\n`,
        );
        return EXIT_FAILURE;
      }
    }
    deps.stdout.write(
      `${TITLE}: ${String(targets.length)}件すべて成功しました。\n`,
    );
    return EXIT_SUCCESS;
  },
};
