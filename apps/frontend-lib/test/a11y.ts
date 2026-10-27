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
  const { violations } = await axe.run(element, {
    runOnly: { type: 'tag', values: [...WCAG_22_AA_TAGS] },
  });
  return violations.map(({ id, impact, help, helpUrl, nodes }) => ({
    id,
    impact,
    help,
    helpUrl,
    nodes: nodes.map(({ html }) => html),
  }));
}
