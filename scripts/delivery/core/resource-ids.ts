import type {
  DeployEnvironment,
  WorkerKey,
} from '../catalog/resource-catalog.ts';
import type { WorkerConfigFile } from './config-contract.ts';
import {
  type TableRow,
  formatMarkdownTable,
  formatTextTable,
} from './violation.ts';
import type { EffectiveWranglerConfig } from './wrangler-config.ts';

export const RESOURCE_IDS_OUTPUT = 'resource_ids';

export type ResourceIdField =
  { readonly d1Binding: string } | { readonly varName: string };

export interface ResourceIdTarget {
  readonly output: readonly string[];
  readonly worker: WorkerKey;
  readonly field: ResourceIdField;
}

const D1_MAIN = ['d1', 'main'];
const TURNSTILE_SITEKEY = ['turnstile_sitekey'];
const WEB_ANALYTICS_SITE_TOKEN = ['web_analytics_site_token'];

export const RESOURCE_ID_TARGETS: readonly ResourceIdTarget[] = [
  { output: D1_MAIN, worker: 'api', field: { d1Binding: 'DB' } },
  { output: D1_MAIN, worker: 'event', field: { d1Binding: 'DB' } },
  {
    output: TURNSTILE_SITEKEY,
    worker: 'client',
    field: { varName: 'TURNSTILE_SITE_KEY' },
  },
  {
    output: TURNSTILE_SITEKEY,
    worker: 'admin',
    field: { varName: 'TURNSTILE_SITE_KEY' },
  },
  {
    output: WEB_ANALYTICS_SITE_TOKEN,
    worker: 'client',
    field: { varName: 'WEB_ANALYTICS_TOKEN' },
  },
];

export interface ResourceIdMismatch {
  readonly worker: WorkerKey;
  readonly file: string;
  readonly configPath: string;
  readonly current: string;
  readonly expected: string;
}

export type ResourceIdConfigs = Readonly<Record<WorkerKey, WorkerConfigFile>>;

export type ReconcileResult =
  readonly ResourceIdMismatch[] | { readonly error: string };

type JsonObject = Readonly<Record<string, unknown>>;

class OutputShapeError extends Error {}

const OUTPUT_LABEL = 'OpenTofuの出力';

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (message: string): never => {
  throw new OutputShapeError(message);
};

// 解析の誤りの理由は入力の断片を含み得るため、sensitiveな値を出さないよう理由を示さない
const parseOutputs = (outputsJson: string): JsonObject => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputsJson);
  } catch {
    return fail(`${OUTPUT_LABEL}をJSONとして解析できません`);
  }
  return isRecord(parsed)
    ? parsed
    : fail(`${OUTPUT_LABEL}がオブジェクトではありません`);
};

// sensitiveな出力は値に触れずに飛ばし、resource_idsがsensitiveなら値を示さずに止める
const resourceIdsOf = (outputs: JsonObject): unknown => {
  const output = outputs[RESOURCE_IDS_OUTPUT];
  if (output === undefined) {
    return fail(`${OUTPUT_LABEL}に${RESOURCE_IDS_OUTPUT}がありません`);
  }
  if (!isRecord(output)) {
    return fail(`${OUTPUT_LABEL}${RESOURCE_IDS_OUTPUT}の形が不正です`);
  }
  if (output['sensitive'] !== false) {
    return fail(
      `${OUTPUT_LABEL}${RESOURCE_IDS_OUTPUT}がsensitiveのため読み取りません。outputs.tfで秘密でない識別子だけを出力してください`,
    );
  }
  return output['value'];
};

const outputValueAt = (
  resourceIds: unknown,
  path: readonly string[],
): string => {
  const label = `${OUTPUT_LABEL}${[RESOURCE_IDS_OUTPUT, ...path].join('.')}`;
  const value = path.reduce<unknown>(
    (node, key) => (isRecord(node) ? node[key] : undefined),
    resourceIds,
  );
  if (typeof value !== 'string') return fail(`${label}が文字列ではありません`);
  return value === '' ? fail(`${label}が空です`) : value;
};

export const configPathOf = (
  field: ResourceIdField,
  environment: DeployEnvironment,
): string =>
  'd1Binding' in field
    ? `env.${environment}.d1_databases[${field.d1Binding}].database_id`
    : `env.${environment}.vars.${field.varName}`;

const currentValueOf = (
  field: ResourceIdField,
  config: EffectiveWranglerConfig,
): string =>
  'd1Binding' in field
    ? (config.d1.find(({ binding }) => binding === field.d1Binding)
        ?.databaseId ?? '')
    : (config.vars[field.varName] ?? '');

const mismatchesOf = (
  resourceIds: unknown,
  configs: ResourceIdConfigs,
  environment: DeployEnvironment,
): readonly ResourceIdMismatch[] => {
  const expectedValues = RESOURCE_ID_TARGETS.map(({ output }) =>
    outputValueAt(resourceIds, output),
  );
  return RESOURCE_ID_TARGETS.flatMap(({ worker, field }, index) => {
    const { file, config } = configs[worker];
    const current = currentValueOf(field, config);
    const expected = expectedValues[index] ?? '';
    return current === expected
      ? []
      : [
          {
            worker,
            file,
            configPath: configPathOf(field, environment),
            current,
            expected,
          },
        ];
  });
};

export function reconcileResourceIds(
  outputsJson: string,
  configs: ResourceIdConfigs,
  environment: DeployEnvironment,
): ReconcileResult {
  try {
    const resourceIds = resourceIdsOf(parseOutputs(outputsJson));
    return mismatchesOf(resourceIds, configs, environment);
  } catch (error) {
    if (error instanceof OutputShapeError) return { error: error.message };
    throw error;
  }
}

const HEADER: TableRow = ['ファイル', '項目', '現在の値', '反映すべき値'];

const NO_MISMATCHES = '識別子の食い違いはありません。';

const countLineOf = (mismatches: readonly ResourceIdMismatch[]): string =>
  `識別子の食い違いが${String(mismatches.length)}件あります。反映すべき値をWrangler設定へ書いてください。`;

const rowOf = ({
  file,
  configPath,
  current,
  expected,
}: ResourceIdMismatch): TableRow => [file, configPath, current, expected];

export function formatMismatchTable(
  mismatches: readonly ResourceIdMismatch[],
): string {
  if (mismatches.length === 0) return `${NO_MISMATCHES}\n`;
  return [
    countLineOf(mismatches),
    ...formatTextTable(HEADER, mismatches.map(rowOf)),
    '',
  ].join('\n');
}

export function formatMismatchMarkdown(
  title: string,
  mismatches: readonly ResourceIdMismatch[],
): string {
  const heading = [`### ${title}`, ''];
  if (mismatches.length === 0) {
    return [...heading, NO_MISMATCHES, ''].join('\n');
  }
  return [
    ...heading,
    countLineOf(mismatches),
    '',
    ...formatMarkdownTable(HEADER, mismatches.map(rowOf)),
    '',
  ].join('\n');
}
