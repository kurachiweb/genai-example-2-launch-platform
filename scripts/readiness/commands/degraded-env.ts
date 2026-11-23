import {
  buildDegradedLaunches,
  type DegradationRow,
  DEGRADATION_MATRIX,
  EXTERNAL_SERVICES,
  type ExternalService,
  type FailureKind,
  isExternalService,
  rowsWithoutEvidence,
  rowsWithoutNotification,
  servicesWithoutOverride,
} from '../core/degraded-overrides.ts';
import {
  EXIT_SUCCESS,
  type ReadinessCommandModule,
  type ReadinessRun,
  UsageError,
} from './shared/readiness-command.ts';

export interface DegradedEnvDeps {
  readonly matrix: readonly DegradationRow[];
}

const ALL_KEYWORD = 'all';
const MATRIX_FLAG = '--matrix';
const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h']);
const SERVICE_CHOICES = [...EXTERNAL_SERVICES, ALL_KEYWORD].join('・');

const FAILURE_LABELS: Readonly<Record<FailureKind, string>> = {
  timeout: '時間切れ',
  auth: '認証の失敗',
  quota: '上限',
  'bad-response': '応答の誤り',
};

interface ParsedArgs {
  readonly services: readonly ExternalService[];
  readonly showMatrix: boolean;
}

const usageHint = (): string =>
  `サービスは ${SERVICE_CHOICES} のいずれかを指定します。`;

const USAGE = [
  '使い方: degraded-env [サービス...] [--matrix]',
  '',
  `  サービス    止めるサービス(複数指定できる)。${SERVICE_CHOICES}のいずれか`,
  `              サービスを省略するか${ALL_KEYWORD}を指定すると、全てのサービスを止める`,
  `  ${MATRIX_FLAG}    縮退の対応表を、マークダウンの表で表示に加える`,
  '  -h, --help  この使い方を表示する',
  '',
  '止めたサービスの縮退の起動のコマンドと、証跡の無い行・運用者へ通知されない行を表示する。起動はしない。',
  '終了コード0は表示の成功、終了コード2は未知のサービスやオプションの誤りを表す。',
  '',
].join('\n');

const parseArgs = (args: readonly string[]): ParsedArgs | 'help' => {
  if (args.some((arg) => HELP_FLAGS.has(arg))) return 'help';
  const services = new Set<ExternalService>();
  let showMatrix = false;
  for (const arg of args) {
    if (arg === MATRIX_FLAG) {
      showMatrix = true;
    } else if (arg === ALL_KEYWORD) {
      for (const service of EXTERNAL_SERVICES) services.add(service);
    } else if (isExternalService(arg)) {
      services.add(arg);
    } else if (arg.startsWith('--')) {
      throw new UsageError(`未知のオプションです: ${arg}。${usageHint()}`);
    } else {
      throw new UsageError(`未知のサービスです: ${arg}。${usageHint()}`);
    }
  }
  return {
    services:
      services.size === 0 && args.every((arg) => arg === MATRIX_FLAG)
        ? [...EXTERNAL_SERVICES]
        : EXTERNAL_SERVICES.filter((service) => services.has(service)),
    showMatrix,
  };
};

const cell = (text: string): string => text.replaceAll('|', '\\|');

const evidenceCell = (row: DegradationRow): string =>
  row.evidence.length === 0
    ? 'なし'
    : row.evidence.map((path) => `\`${cell(path)}\``).join('<br>');

const matrixTable = (matrix: readonly DegradationRow[]): string =>
  [
    '| サービス | 障害の種類 | 期待する振る舞い | 証跡の自動テスト | 運用者への通知 | 担当spec |',
    '| --- | --- | --- | --- | --- | --- |',
    ...matrix.map(
      (row) =>
        `| ${row.service} | ${FAILURE_LABELS[row.failure]} | ${cell(row.expected)} | ${evidenceCell(row)} | ${row.notifiesOperator ? 'あり' : 'なし'} | ${row.owner} |`,
    ),
  ].join('\n');

const rowLabel = ({ service, failure, owner }: DegradationRow): string =>
  `- ${service}/${failure}(担当spec: ${owner})`;

const rowList = (title: string, rows: readonly DegradationRow[]): string[] =>
  rows.length === 0
    ? [`${title}: なし`]
    : [`${title}: ${String(rows.length)}件`, ...rows.map(rowLabel)];

const launchSection = (
  services: readonly ExternalService[],
): readonly string[] => {
  const launches = buildDegradedLaunches(services);
  const overridable = services.filter(
    (service) => !servicesWithoutOverride(services).includes(service),
  );
  const missing = servicesWithoutOverride(services);
  return [
    `縮退の起動の差し替え(止めるサービス: ${services.join(', ') || 'なし'})`,
    '起動はしません。ローカルのapi・eventを止めてから、別のターミナルで次のコマンドを実行してください。',
    '',
    ...launches.flatMap(({ worker, services: own, command }) => [
      `[${worker}] ${own.join(', ')}`,
      command,
      '',
    ]),
    ...(overridable.length === 0
      ? []
      : [
          `縮退の起動の後のE2Eには、環境変数 E2E_DEGRADED_SERVICES=${overridable.join(',')} を付ける。`,
          '',
        ]),
    ...(missing.length === 0
      ? []
      : [
          `差し替えの手段が無いサービス: ${missing.join(', ')}(対応表だけで確かめる)`,
          '',
        ]),
  ];
};

export function createDegradedEnvCommand({
  matrix,
}: DegradedEnvDeps): ReadinessCommandModule {
  const run: ReadinessRun = (args, io) =>
    Promise.resolve().then(() => {
      const parsed = parseArgs(args);
      if (parsed === 'help') {
        io.stdout.write(USAGE);
        return EXIT_SUCCESS;
      }
      const { services, showMatrix } = parsed;
      io.stdout.write(
        [
          ...launchSection(services),
          ...(showMatrix ? [matrixTable(matrix), ''] : []),
          ...rowList('証跡の無い行(指摘の候補)', rowsWithoutEvidence(matrix)),
          '',
          ...rowList(
            '運用者へ通知されない行(要件6.5の確認)',
            rowsWithoutNotification(matrix),
          ),
          '',
        ].join('\n'),
      );
      return EXIT_SUCCESS;
    });
  return { run };
}

export const { run } = createDegradedEnvCommand({ matrix: DEGRADATION_MATRIX });
