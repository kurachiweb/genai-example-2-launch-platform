import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import type { MatchEntryView } from './match-card-model.ts';
import { entryOf, productOf } from './match-fixtures.ts';
import { renderInMatchFrame } from './match-testing.tsx';
import { ProductPanel } from './product-panel.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const OWN_REASON = '自身のプロダクトとその対戦相手にはUpvoteできません。';

type PanelOptions = {
  readonly entry?: MatchEntryView;
  readonly siteRel?: string;
  readonly disabledReason?: string | null;
  readonly pressed?: boolean;
};

const renderPanel = async ({
  entry = entryOf('left'),
  siteRel = 'noopener ugc',
  disabledReason = null,
  pressed = false,
}: PanelOptions = {}) => {
  const onUpvote = vi.fn<() => void>();
  await renderInMatchFrame(
    <div className="@container">
      <ProductPanel
        entry={entry}
        side="left"
        siteRel={siteRel}
        pressed={pressed}
        pending={false}
        disabledReason={disabledReason}
        outcome={null}
        onUpvote={onUpvote}
      />
    </div>,
    { width: 480 },
  );
  return { onUpvote };
};

const siteLink = () => page.getByRole('link', { name: /サイトを開く/u });

afterEach(() => {
  applyColorScheme('light');
});

describe('ProductPanel', () => {
  test('ロゴ・カテゴリ・名称・タグライン・「サイトを開く」・Upvoteのボタンを示す', async () => {
    await renderPanel();

    await expect
      .element(page.getByRole('heading', { name: 'Pitch Notes' }))
      .toBeVisible();
    await expect.element(page.getByText('開発ツール')).toBeVisible();
    await expect
      .element(page.getByText('ピッチの台本を書いて練習できるノートアプリ'))
      .toBeVisible();
    expect(
      document.querySelector('[data-slot="media-placeholder"], img'),
    ).not.toBeNull();
    await expect.element(siteLink()).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Pitch NotesにUpvote' }))
      .toBeVisible();
  });

  test('ディレクトリに掲載されたプロダクトは、名称をプロダクト詳細へのリンクにする', async () => {
    await renderPanel();

    await expect
      .element(page.getByRole('link', { name: 'Pitch Notes', exact: true }))
      .toHaveAttribute('href', '/p/pitch-notes');
  });

  test('掲載されていない他人のプロダクトは、名称をリンクにしない', async () => {
    await renderPanel({
      entry: entryOf('left', { product: productOf('left', { listed: false }) }),
    });

    await expect
      .element(page.getByRole('heading', { name: 'Pitch Notes' }))
      .toBeVisible();
    expect(
      page.getByRole('link', { name: 'Pitch Notes', exact: true }).elements(),
    ).toHaveLength(0);
  });

  test('閲覧者自身のプロダクトは、掲載されていなくても名称をリンクにし、Upvoteのボタンを出さずUpvote数だけを示す', async () => {
    await renderPanel({
      entry: entryOf('left', {
        isViewerOwn: true,
        upvoteCount: 1234,
        product: productOf('left', { listed: false }),
      }),
      disabledReason: OWN_REASON,
    });

    await expect
      .element(page.getByRole('link', { name: 'Pitch Notes', exact: true }))
      .toHaveAttribute('href', '/p/pitch-notes');
    expect(page.getByRole('button').elements()).toHaveLength(0);
    await expect.element(page.getByText('1,234票')).toBeInTheDocument();
  });

  test.each([
    ['予選', 'noopener ugc'],
    ['トーナメント', 'noopener'],
  ] as const)(
    '%sの「サイトを開く」は外部Webサイトを別タブで開き、relを%sにする',
    async (_label, siteRel) => {
      await renderPanel({ siteRel });

      const link = siteLink();
      await expect
        .element(link)
        .toHaveAttribute('href', 'https://pitch-notes.example/');
      await expect.element(link).toHaveAttribute('target', '_blank');
      await expect.element(link).toHaveAttribute('rel', siteRel);
      await expect
        .element(link)
        .toHaveAccessibleName(
          /^Pitch Notesの\s*サイトを開く\s*\(新しいタブで開きます\)$/u,
        );
    },
  );

  test('外部Webサイトのアドレスがhttp・httpsの絶対URLでなければ「サイトを開く」を出さない', async () => {
    await renderPanel({
      entry: entryOf('left', {
        product: productOf('left', { websiteUrl: 'javascript:alert(1)' }),
      }),
    });

    await expect
      .element(page.getByRole('heading', { name: 'Pitch Notes' }))
      .toBeVisible();
    expect(siteLink().elements()).toHaveLength(0);
  });

  test('表示できないプロダクトは「非公開のプロダクト」と示し、リンク・「サイトを開く」・Upvoteのボタンを出さずUpvote数を示す', async () => {
    await renderPanel({ entry: entryOf('left', { product: null }) });

    await expect
      .element(page.getByRole('heading', { name: '非公開のプロダクト' }))
      .toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(page.getByRole('button').elements()).toHaveLength(0);
    expect(page.getByText('開発ツール').elements()).toHaveLength(0);
    await expect.element(page.getByText('12票')).toBeInTheDocument();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['Upvoteできる', {}],
      ['閲覧者自身の', { entry: entryOf('left', { isViewerOwn: true }) }],
      ['表示できない', { entry: entryOf('left', { product: null }) }],
    ] as const)(
      '%sプロダクトのパネルのアクセシビリティの検査の違反が0件',
      async (_label, options) => {
        applyColorScheme(scheme);
        await renderPanel(options);
        await expect.element(page.getByRole('heading')).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
