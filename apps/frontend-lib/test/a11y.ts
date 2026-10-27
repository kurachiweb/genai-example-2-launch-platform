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

export async function runAxe(
  element: Element,
): Promise<readonly AxeViolationSummary[]> {
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
