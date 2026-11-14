import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { hasHorizontalScroll } from '../../test/overflow.ts';
import { Button } from '../ui/button/button.tsx';
import { AdminPageHeader } from './admin-page-header.tsx';

const TITLE = '管理者アカウント';
const DESCRIPTION = '管理者の招待・ロールの変更・削除を行います。';

afterEach(() => {
  applyColorScheme('light');
});

describe('AdminPageHeader', () => {
  test('題をページの最上位の見出しにし、説明と操作を見出しに続けて描く', async () => {
    const onInvite = vi.fn();
    await render(
      <AdminPageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <Button type="button" onClick={onInvite}>
            招待する
          </Button>
        }
      />,
    );

    await expect
      .element(page.getByRole('heading', { level: 1, name: TITLE }))
      .toBeInTheDocument();
    await expect.element(page.getByText(DESCRIPTION)).toBeInTheDocument();
    await page.getByRole('button', { name: '招待する' }).click();
    expect(onInvite).toHaveBeenCalledOnce();
  });

  test('説明と操作を省くと、見出しだけを描く', async () => {
    const { container } = await render(<AdminPageHeader title={TITLE} />);

    await expect
      .element(page.getByRole('heading', { level: 1, name: TITLE }))
      .toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  test('狭い画面では、操作を見出しの下へ折り返し、文書を横に広げない', async () => {
    await render(
      <div style={{ width: '240px' }}>
        <AdminPageHeader
          title="カテゴリマスタとユーザーの通報を担当する運営者の一覧"
          description={DESCRIPTION}
          actions={
            <>
              <Button type="button">招待する</Button>
              <Button type="button" variant="outline">
                書き出す
              </Button>
            </>
          }
        />
      </div>,
    );

    expect(hasHorizontalScroll()).toBe(false);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('題・説明・操作を持つ見出しで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="p-4">
          <AdminPageHeader
            title={TITLE}
            description={DESCRIPTION}
            actions={<Button type="button">招待する</Button>}
          />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
