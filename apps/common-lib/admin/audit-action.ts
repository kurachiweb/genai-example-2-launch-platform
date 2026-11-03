import { trimWhiteSpace } from '../text/white-space.ts';

export type AuditTargetKind =
  | 'user'
  | 'admin'
  | 'product'
  | 'comment'
  | 'rating'
  | 'image'
  | 'report'
  | 'inquiry'
  | 'sponsorship'
  | 'help-article'
  | 'category'
  | 'legal-document'
  | 'setting';

export type AuditReasonRequirement = 'required' | 'optional' | 'none';

export interface AuditActionDefinition {
  readonly name: string;
  readonly label: string;
  readonly targetKind: AuditTargetKind | null;
  readonly reason: AuditReasonRequirement;
  readonly detailKeys: readonly string[];
  readonly maxTargets: number;
}

export interface AuditActionCatalog {
  find(name: string): AuditActionDefinition | undefined;
  list(): readonly AuditActionDefinition[];
}

export class AuditActionDefinitionError extends Error {
  override readonly name = 'AuditActionDefinitionError';
}

// <対象の領域>.<動詞句>の形で、それぞれ小文字の英字で始まりハイフンでつなぐ(例: admin-account.role-change)
const AUDIT_ACTION_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

const DETAIL_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/u;

const AUDIT_TARGET_KINDS: ReadonlySet<string> = new Set<AuditTargetKind>([
  'user',
  'admin',
  'product',
  'comment',
  'rating',
  'image',
  'report',
  'inquiry',
  'sponsorship',
  'help-article',
  'category',
  'legal-document',
  'setting',
]);

const AUDIT_REASON_REQUIREMENTS: ReadonlySet<string> =
  new Set<AuditReasonRequirement>(['required', 'optional', 'none']);

const fail = (definition: AuditActionDefinition, message: string): never => {
  throw new AuditActionDefinitionError(
    `監査ログの操作種別${JSON.stringify(definition.name)}の${message}`,
  );
};

const assertValidDetailKeys = (definition: AuditActionDefinition): void => {
  const seen = new Set<string>();
  for (const key of definition.detailKeys) {
    if (!DETAIL_KEY_PATTERN.test(key)) {
      fail(
        definition,
        `詳細の鍵は小文字の英字で始まる英数字で指定してください: ${JSON.stringify(key)}`,
      );
    }
    if (seen.has(key)) {
      fail(definition, `詳細の鍵が重複しています: ${JSON.stringify(key)}`);
    }
    seen.add(key);
  }
};

// 型を経ずに組み立てた定義も実行時に検出するため、列挙の値も確かめる
const assertValidDefinition = (definition: AuditActionDefinition): void => {
  if (!AUDIT_ACTION_NAME_PATTERN.test(definition.name)) {
    fail(definition, '名前は<対象の領域>.<動詞句>の形で指定してください');
  }
  if (trimWhiteSpace(definition.label) === '') {
    fail(definition, '表示名を指定してください');
  }
  if (
    definition.targetKind !== null &&
    !AUDIT_TARGET_KINDS.has(definition.targetKind)
  ) {
    fail(
      definition,
      `対象の種類が登録されていません: ${JSON.stringify(definition.targetKind)}`,
    );
  }
  if (!AUDIT_REASON_REQUIREMENTS.has(definition.reason)) {
    fail(
      definition,
      `理由の要否はrequired・optional・noneで指定してください: ${JSON.stringify(definition.reason)}`,
    );
  }
  assertValidDetailKeys(definition);
  if (!Number.isInteger(definition.maxTargets) || definition.maxTargets < 1) {
    fail(
      definition,
      `対象の上限は1以上の整数で指定してください: ${String(definition.maxTargets)}`,
    );
  }
};

export const defineAuditAction = (
  definition: AuditActionDefinition,
): AuditActionDefinition => {
  assertValidDefinition(definition);
  const { name, label, targetKind, reason, detailKeys, maxTargets } =
    definition;
  return Object.freeze({
    name,
    label,
    targetKind,
    reason,
    detailKeys: Object.freeze([...detailKeys]),
    maxTargets,
  });
};

export const createAuditActionCatalog = (
  actions: readonly AuditActionDefinition[],
): AuditActionCatalog => {
  const actionsByName = new Map<string, AuditActionDefinition>();
  for (const action of actions) {
    assertValidDefinition(action);
    if (actionsByName.has(action.name)) {
      fail(action, '名前が重複しています');
    }
    actionsByName.set(action.name, action);
  }
  const list = Object.freeze([...actionsByName.values()]);
  return Object.freeze({
    find: (name: string) => actionsByName.get(name),
    list: () => list,
  });
};
