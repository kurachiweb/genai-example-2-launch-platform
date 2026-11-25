import type { Page } from '@playwright/test';
import axe from 'axe-core';

export interface A11yViolation {
  readonly route: string;
  readonly state: string;
  readonly rule: string;
  readonly impact: string | null;
  readonly wcag: readonly string[];
  readonly targets: readonly string[];
}

export interface A11yScanContext {
  readonly route: string;
  readonly state: string;
}

export const WCAG22_AA_TAGS: readonly string[] = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

const WCAG_TAG_PATTERN = /^wcag\d+[a-z]*$/;

const toSelector = (target: axe.UnlabelledFrameSelector): string =>
  target.flat().join(' ');

export function toA11yViolations(
  violations: readonly axe.Result[],
  { route, state }: A11yScanContext,
): readonly A11yViolation[] {
  return violations.map(({ id, impact, tags, nodes }) => ({
    route,
    state,
    rule: id,
    impact: impact ?? null,
    wcag: tags.filter((tag) => WCAG_TAG_PATTERN.test(tag)),
    targets: nodes.map(({ target }) => toSelector(target)),
  }));
}

// ページの中で動かす。開閉や配色の切り替えの動きの途中は文字と背景が中間の色になりコントラストを誤って測るため、終わりのある動きは終わるまで待ってから検査する
async function runAxeInPage(options: axe.RunOptions): Promise<axe.AxeResults> {
  const finiteAnimations = document
    .getAnimations()
    .filter((animation) =>
      Number.isFinite(animation.effect?.getComputedTiming().endTime),
    );
  await Promise.allSettled(
    finiteAnimations.map((animation) => animation.finished),
  );
  const host = globalThis as unknown as { readonly axe: typeof axe };
  return host.axe.run(document, options);
}

// `page.addScriptTag`はページのCSPのscript-srcに阻まれるため、CSPの影響を受けない`evaluate`で本体を注入する
export async function scanPage(
  page: Page,
  context: A11yScanContext,
): Promise<readonly A11yViolation[]> {
  const options: axe.RunOptions = {
    runOnly: { type: 'tag', values: [...WCAG22_AA_TAGS] },
  };
  try {
    await page.evaluate(axe.source);
    const { violations } = await page.evaluate(runAxeInPage, options);
    return toA11yViolations(violations, context);
  } catch (error: unknown) {
    throw new Error(
      `${context.route}(${context.state})のアクセシビリティの検査を実行できませんでした。`,
      { cause: error },
    );
  }
}
