import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import { CategoryBreakdown } from './category-breakdown.tsx';

const COUNTS = Object.freeze([
  { categoryId: '01JE0000000000000000000001', name: '権利侵害', count: 1_200 },
  { categoryId: '01JE0000000000000000000002', name: 'その他', count: 1 },
]);

afterEach(() => {
  applyColorScheme('light');
});

describe('CategoryBreakdown', () => {
  test('カテゴリごとに1行で、カテゴリ名と3桁区切りの件数を受け取った順に示す', async () => {
    await render(<CategoryBreakdown counts={COUNTS} />);

    const items = page.getByRole('listitem');
    await expect.element(items.first()).toHaveTextContent('権利侵害 1,200件');
    expect(items.elements().map((item) => item.textContent)).toStrictEqual([
      '権利侵害 1,200件',
      'その他 1件',
    ]);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('カテゴリごとの件数のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <main className="bg-background p-4">
        <CategoryBreakdown counts={COUNTS} />
      </main>,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
