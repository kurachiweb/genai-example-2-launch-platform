import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  UnlistedBanner,
  type UnlistedBannerProps,
} from './unlisted-banner.tsx';

const NOTICE =
  'このページはあなたにだけ表示されています。予選で勝利するとディレクトリに掲載され、誰でも見られるようになります。';

const renderBanner = (props: UnlistedBannerProps) =>
  render(
    <main className="bg-background p-4 text-foreground">
      <UnlistedBanner {...props} />
    </main>,
  );

afterEach(() => {
  applyColorScheme('light');
});

describe('UnlistedBanner', () => {
  test('投稿者本人が未掲載のプロダクトを見ている時に、案内を示す', async () => {
    await renderBanner({ listed: false, viewerIsOwner: true });

    await expect.element(page.getByRole('note')).toHaveTextContent(NOTICE);
  });

  test.each([
    [
      '掲載中のプロダクトを本人が見ている',
      { listed: true, viewerIsOwner: true },
    ],
    [
      '掲載中のプロダクトを他者が見ている',
      { listed: true, viewerIsOwner: false },
    ],
    [
      '未掲載のプロダクトを本人以外が見ている',
      { listed: false, viewerIsOwner: false },
    ],
  ] as const)('%s時は何も描かない', async (_case, props) => {
    const { container } = await renderBanner(props);

    expect(page.getByRole('note').elements()).toStrictEqual([]);
    expect(container.querySelector('main')?.childElementCount).toBe(0);
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);
    await renderBanner({ listed: false, viewerIsOwner: true });

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
