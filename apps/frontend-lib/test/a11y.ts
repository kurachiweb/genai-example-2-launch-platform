import axe from 'axe-core';

export interface AxeViolationSummary {
  readonly id: string;
  readonly impact: axe.ImpactValue | undefined;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly string[];
}

const WCAG_22_AA_TAGS: readonly string[] = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

const AXE_RUN_OPTIONS: axe.RunOptions = {
  runOnly: { type: 'tag', values: [...WCAG_22_AA_TAGS] },
};

// 別の文書のaxe-coreが返す配列はその文書の配列のため、比較の対象にできるようこの文書の配列へ作り直す
const summarize = (
  violations: readonly axe.Result[],
): readonly AxeViolationSummary[] =>
  Array.from(violations, ({ id, impact, help, helpUrl, nodes }) => ({
    id,
    impact,
    help,
    helpUrl,
    nodes: Array.from(nodes, ({ html }) => html),
  }));

// 開閉や配色の切り替えの動きの途中は文字と背景が中間の色になり、コントラストを誤って測るため、終わりのある動きは終わるまで待つ
async function waitForFiniteAnimations(): Promise<void> {
  const finiteAnimations = document
    .getAnimations()
    .filter((animation) =>
      Number.isFinite(animation.effect?.getComputedTiming().endTime),
    );
  await Promise.allSettled(
    finiteAnimations.map((animation) => animation.finished),
  );
}

export async function runAxe(
  element: Element,
): Promise<readonly AxeViolationSummary[]> {
  await waitForFiniteAnimations();
  const { violations } = await axe.run(element, AXE_RUN_OPTIONS);
  return summarize(violations);
}

interface AxeHostWindow {
  readonly axe?: typeof axe;
}

// html要素ごと描画した別の文書は、その文書の中でaxe-coreを動かして文書全体(言語・タイトル・ランドマーク)を検査する
export async function runAxeOnDocument(
  target: Document,
): Promise<readonly AxeViolationSummary[]> {
  const host = target.defaultView as (Window & AxeHostWindow) | null;
  if (host === null) {
    throw new Error('検査する文書がウィンドウに表示されていません。');
  }
  if (host.axe === undefined) {
    const script = target.createElement('script');
    script.textContent = axe.source;
    target.head.append(script);
    script.remove();
  }
  if (host.axe === undefined) {
    throw new Error('検査する文書でaxe-coreを読み込めません。');
  }
  const { violations } = await host.axe.run(target, AXE_RUN_OPTIONS);
  return summarize(violations);
}
