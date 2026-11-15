import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { renderInRouter } from '../../../test/page-router.tsx';
import { SiteFooter } from './site-footer.tsx';

// 取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const LEGAL_DOCUMENT_LINKS = [
  ['利用規約', '/terms'],
  ['プライバシーポリシー', '/privacy'],
  ['法的通知', '/legal'],
] as const;

const DOCUMENT_LOADING_LINKS = [
  ['ヘルプ', 'ヘルプ', '/help'],
  ['規約・問い合わせ', '料金', '/pricing'],
  ['規約・問い合わせ', 'お問い合わせ', '/contact'],
] as const;

const policyNavigation = () =>
  page
    .getByRole('contentinfo')
    .getByRole('navigation', { name: '規約・問い合わせ' });

let removeClickRecorder: (() => void) | undefined;

// リンクの既定の動作(文書の読み込み直し)をアプリが止めたかを記録する。止めていない時にテストのページが移動しないよう、記録の後で止める
function recordClickDefaultPrevented(): readonly boolean[] {
  const values: boolean[] = [];
  const listener = (event: MouseEvent) => {
    values.push(event.defaultPrevented);
    event.preventDefault();
  };
  window.addEventListener('click', listener);
  removeClickRecorder = () => {
    window.removeEventListener('click', listener);
  };
  return values;
}

function renderFooter(path = '/') {
  return renderInRouter(<SiteFooter helpLinks={[]} />, { path });
}

afterEach(() => {
  removeClickRecorder?.();
  removeClickRecorder = undefined;
});

describe('SiteFooter', () => {
  test.each(LEGAL_DOCUMENT_LINKS)(
    '%sのリンクを選ぶと、ページを読み込み直さずにルーターで%sへ遷移する',
    async (name, href) => {
      const router = await renderFooter();
      const defaultPrevented = recordClickDefaultPrevented();

      await userEvent.click(
        policyNavigation().getByRole('link', { name, exact: true }),
      );

      expect(defaultPrevented).toStrictEqual([true]);
      await expect.poll(() => router.state.location.pathname).toBe(href);
    },
  );

  test.each(LEGAL_DOCUMENT_LINKS)(
    '%sのページとその過去版のページでは、%sへのリンクだけを現在のページとして示す',
    async (name, href) => {
      await renderFooter(`${href}/revisions/1`);

      await expect
        .element(policyNavigation().getByRole('link', { name, exact: true }))
        .toHaveAttribute('aria-current', 'page');
      expect(
        policyNavigation()
          .getByRole('link')
          .elements()
          .filter((element) => element.getAttribute('aria-current') === 'page'),
      ).toHaveLength(1);
    },
  );

  test.each(DOCUMENT_LOADING_LINKS)(
    '%sの%sのリンクは、行き先の経路が無いためルーターで遷移せずに%sの文書を読み込む',
    async (navigationName, name, href) => {
      await renderFooter();
      const defaultPrevented = recordClickDefaultPrevented();
      const link = page
        .getByRole('contentinfo')
        .getByRole('navigation', { name: navigationName })
        .getByRole('link', { name, exact: true });

      await expect.element(link).toHaveAttribute('href', href);
      await userEvent.click(link);

      expect(defaultPrevented).toStrictEqual([false]);
    },
  );
});
