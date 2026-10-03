// 表示状態パネルの「実際には起こりえない組み合わせ」を、最後に操作した項目を保ったまま整合する組み合わせへ直す

export type StateConstraint<TKey extends string, TState> = {
  keys: TKey[];
  test: (state: TState) => boolean;
  // パネル上部の説明に添える、組み合わせが起こりえない理由
  reason?: string;
};

type Config<TKey extends string, TState> = {
  options: Record<TKey, readonly string[]>;
  constraints: StateConstraint<TKey, TState>[];
  // 探索順。依存の少ない項目を先に決め、制約の検査をできるだけ早く行う
  searchKeys: TKey[];
  // 自動で切り替える際の変更コスト(既定は1)。表示全体への影響が大きい項目ほど変えにくくする
  weights?: Partial<Record<TKey, number>>;
  // 自動で選ばれにくくしたい選択肢の追加コスト
  penalties?: Partial<Record<TKey, Record<string, number>>>;
};

export type Normalized<TKey extends string, TState> = {
  state: TState;
  changed: TKey[];
  reasons: string[];
};

export type StateNormalizer<TKey extends string, TState> = {
  isConsistent: (state: TState) => boolean;
  normalize: (state: TState, fixedKey?: TKey) => Normalized<TKey, TState>;
};

export function createStateNormalizer<
  TKey extends string,
  TState extends Record<TKey, string>,
>({
  options,
  constraints,
  searchKeys,
  weights = {},
  penalties = {},
}: Config<TKey, TState>): StateNormalizer<TKey, TState> {
  const costOf = (key: TKey, value: string) =>
    (weights[key] ?? 1) + (penalties[key]?.[value] ?? 0);

  // 各探索段階で全項目が確定する制約
  const checksAt = searchKeys.map((key, index) =>
    constraints.filter(
      (constraint) =>
        constraint.keys.includes(key) &&
        constraint.keys.every((k) => searchKeys.indexOf(k) <= index),
    ),
  );

  const isConsistent = (state: TState) =>
    constraints.every((constraint) => constraint.test(state));

  const normalize = (
    state: TState,
    fixedKey?: TKey,
  ): Normalized<TKey, TState> => {
    if (isConsistent(state)) return { state, changed: [], reasons: [] };

    const current: Record<TKey, string> = { ...state };
    // visit内で更新するため、クロージャ越しでも型の絞り込みが外れないよう入れ物に持つ
    const best: { state: Record<TKey, string> | null; cost: number } = {
      state: null,
      cost: Number.POSITIVE_INFINITY,
    };

    // 全組み合わせを深さ優先で探索し、コストが現在の最良を超えた枝は打ち切る
    const visit = (index: number, cost: number) => {
      if (cost >= best.cost) return;
      if (index === searchKeys.length) {
        best.state = { ...current };
        best.cost = cost;
        return;
      }
      const key = searchKeys[index];
      const original = state[key];
      const domain =
        key === fixedKey
          ? [original]
          : [original, ...options[key].filter((value) => value !== original)];
      for (const value of domain) {
        current[key] = value;
        const ok = checksAt[index].every((constraint) =>
          constraint.test(current as TState),
        );
        if (ok) {
          visit(
            index + 1,
            cost + (value === original ? 0 : costOf(key, value)),
          );
        }
      }
      current[key] = original;
    };
    visit(0, 0);

    if (!best.state) return { state, changed: [], reasons: [] };
    const resolved = best.state as TState;
    const changed = searchKeys.filter((key) => resolved[key] !== state[key]);
    const reasons = constraints
      .filter((constraint) => !constraint.test(state) && constraint.reason)
      .map((constraint) => constraint.reason as string);
    return { state: resolved, changed, reasons: [...new Set(reasons)] };
  };

  return { isConsistent, normalize };
}

type Labels<TKey extends string> = Record<
  TKey,
  { title: string; values: Record<string, string> }
>;

// 「「A: X」と両立させるため、BをYに自動で変更しました。」の形でパネル上部に表示する説明
export function describeStateChanges<TKey extends string>(
  labels: Labels<TKey>,
  next: Record<TKey, string>,
  changed: TKey[],
  trigger: TKey,
  reasons: string[] = [],
): string {
  const titleOf = (key: TKey) => labels[key].title.replace(/\(.*\)$/, '');
  const labelOf = (key: TKey) => labels[key].values[next[key]];
  const items = changed
    .map((key) => `${titleOf(key)}を「${labelOf(key)}」`)
    .join('、');
  return [
    `「${titleOf(trigger)}: ${labelOf(trigger)}」と両立させるため、${items}に自動で変更しました。`,
    ...reasons,
  ].join('');
}
