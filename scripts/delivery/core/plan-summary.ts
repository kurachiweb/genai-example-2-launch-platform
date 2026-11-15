export type PlanAction =
  'create' | 'update' | 'replace' | 'delete' | 'read' | 'no-op';

export interface PlanChange {
  readonly address: string;
  readonly action: PlanAction;
}

type PlanError = { readonly error: string };

const PREFIX = '計画のJSON';

const SINGLE_ACTIONS: ReadonlySet<string> = new Set([
  'create',
  'update',
  'delete',
  'read',
  'no-op',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// 解析の失敗の理由は計画の一部を引用し得るため、誤りには計画の中身を含めない
const parseJson = (json: string): { readonly value: unknown } | undefined => {
  try {
    return { value: JSON.parse(json) };
  } catch {
    return undefined;
  }
};

const isPlanAction = (action: string): action is PlanAction =>
  SINGLE_ACTIONS.has(action);

const ACTION_NAME = /^[a-z-]+$/;

const actionOf = (
  actions: unknown,
): PlanAction | { readonly unknown: string } | undefined => {
  if (!Array.isArray(actions)) return undefined;
  const items: readonly unknown[] = actions;
  const names = items.filter((name) => typeof name === 'string');
  if (names.length !== items.length) return undefined;
  const [only] = names;
  if (names.length === 1 && only !== undefined && isPlanAction(only)) {
    return only;
  }
  if (names.toSorted().join(',') === 'create,delete') return 'replace';
  return {
    unknown: names.filter((name) => ACTION_NAME.test(name)).join(','),
  };
};

const changeOf = (item: unknown, index: number): PlanChange | PlanError => {
  const address =
    isRecord(item) && typeof item['address'] === 'string'
      ? item['address']
      : undefined;
  if (address === undefined || address === '') {
    return {
      error: `${PREFIX}の${String(index + 1)}番目の資源の変更にアドレスがありません`,
    };
  }
  const change = item as Record<string, unknown>;
  const action = actionOf(
    isRecord(change['change']) ? change['change']['actions'] : undefined,
  );
  if (action === undefined || typeof action !== 'string') {
    const detail =
      action === undefined || action.unknown === ''
        ? ''
        : `(${action.unknown})`;
    return {
      error: `${PREFIX}の${address}の操作の種類を判定できません${detail}`,
    };
  }
  return { address, action };
};

export function summarizePlan(
  planJson: string,
): readonly PlanChange[] | PlanError {
  const parsed = parseJson(planJson);
  if (parsed === undefined) return { error: `${PREFIX}を解析できません` };
  if (!isRecord(parsed.value)) {
    return { error: `${PREFIX}の最上位がオブジェクトではありません` };
  }
  const items = parsed.value['resource_changes'];
  if (items === undefined) return [];
  if (!Array.isArray(items)) {
    return { error: `${PREFIX}のresource_changesが配列ではありません` };
  }
  const changes: PlanChange[] = [];
  for (const [index, item] of (items as readonly unknown[]).entries()) {
    const change = changeOf(item, index);
    if ('error' in change) return change;
    changes.push(change);
  }
  return changes;
}

const COUNT_LABELS: readonly (readonly [PlanAction, string])[] = [
  ['create', '作成'],
  ['update', '更新'],
  ['replace', '作り直し'],
  ['delete', '削除'],
  ['no-op', '変更なし'],
];

const isDestructive = ({ action }: PlanChange): boolean =>
  action === 'delete' || action === 'replace';

const itemOf = ({ address, action }: PlanChange): string =>
  `${action}: \`${address}\``;

export function formatPlanSummary(changes: readonly PlanChange[]): string {
  const shown = changes.filter(({ action }) => action !== 'no-op');
  const destructive = shown.filter(isDestructive);
  const warning =
    destructive.length === 0
      ? []
      : [
          `警告: 計画に削除または作り直しが${String(destructive.length)}件あります(${destructive.map(itemOf).join('、')})。`,
          '',
        ];
  const body =
    shown.length === 0
      ? ['変更はありません。']
      : shown.map((change) => `- ${itemOf(change)}`);
  const counts = COUNT_LABELS.map(
    ([action, label]) =>
      `${label}${String(changes.filter((change) => change.action === action).length)}件`,
  ).join('・');
  return [...warning, ...body, '', counts, ''].join('\n');
}
