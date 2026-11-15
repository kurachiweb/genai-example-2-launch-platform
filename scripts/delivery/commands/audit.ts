import {
  AUDIT_EXCEPTIONS,
  AUDIT_EXCEPTIONS_FILE,
  type AuditException,
  auditArgs,
  auditExceptionProblems,
} from '../core/audit-exceptions.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';
import {
  findInstallTargets,
  runInTarget,
  targetLabelOf,
} from './shared/install-targets.ts';

const TITLE = '既知の脆弱性の確認';

export interface AuditCommandOptions {
  readonly exceptions: readonly AuditException[];
  readonly today: () => string;
}

export const todayInUtc = (): string => new Date().toISOString().slice(0, 10);

const auditTargets = async (
  exceptions: readonly AuditException[],
  deps: DeliveryDeps,
): Promise<number> => {
  const targets = await findInstallTargets(deps.files);
  const step = { args: auditArgs(exceptions) };
  const failed: string[] = [];
  // 1つの対象で見つかっても残りの対象の結果を一度に示すため、全対象を確かめてから判定する
  for (const dir of targets) {
    if ((await runInTarget(dir, step, deps)) !== 0) {
      failed.push(targetLabelOf(dir));
    }
  }
  if (failed.length > 0) {
    deps.stderr.write(
      `${TITLE}: 重大度が最大(critical)の脆弱性が見つかった対象があります(${failed.join('・')})。\n`,
    );
    return EXIT_FAILURE;
  }
  deps.stdout.write(
    `${TITLE}: ${String(targets.length)}件すべて成功しました。\n`,
  );
  return EXIT_SUCCESS;
};

export function createAuditCommand({
  exceptions,
  today,
}: AuditCommandOptions): DeliveryCommand {
  return {
    name: 'audit',
    description:
      '導入の対象ごとに、除外の一覧を除いた重大度が最大(critical)の既知の脆弱性を確かめる',
    run: async (args, deps) => {
      if (args.length > 0) {
        throw new UsageError(`引数は受け取りません: ${args.join(' ')}`);
      }
      const problems = auditExceptionProblems(exceptions, today());
      if (problems.length > 0) {
        deps.stderr.write(
          [
            `${TITLE}: 除外の一覧(${AUDIT_EXCEPTIONS_FILE})を見直してください。`,
            ...problems.map((problem) => `- ${problem}`),
            '',
          ].join('\n'),
        );
        return EXIT_FAILURE;
      }
      return auditTargets(exceptions, deps);
    },
  };
}

export const command: DeliveryCommand = createAuditCommand({
  exceptions: AUDIT_EXCEPTIONS,
  today: todayInUtc,
});
