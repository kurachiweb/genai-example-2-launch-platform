import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import type {
  ByeReason,
  MatchByeFragment,
  MatchKind,
} from '../../graphql/generated/graphql.ts';
import { ByeCard } from './bye-card.tsx';
import { byeOf, productOf } from './match-fixtures.ts';
import { renderInMatchFrame } from './match-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const renderByeCard = async (bye: MatchByeFragment = byeOf()) => {
  await renderInMatchFrame(<ByeCard bye={bye} />, { width: 480 });
};

const card = () => page.getByRole('article');

const siteLink = () => page.getByRole('link', { name: /サイトを開く/u });

afterEach(() => {
  applyColorScheme('light');
});

describe('ByeCard', () => {
  test('ロゴ・「不戦勝」のバッジ・カテゴリ・名称・タグライン・「サイトを開く」を示し、Upvoteのボタンを出さない', async () => {
    await renderByeCard();

    await expect.element(card()).toHaveAccessibleName('Pitch Notes(不戦勝)');
    await expect
      .element(page.getByRole('heading', { name: 'Pitch Notes' }))
      .toBeVisible();
    await expect
      .element(page.getByText('不戦勝', { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText('開発ツール')).toBeVisible();
    await expect
      .element(page.getByText('ピッチの台本を書いて練習できるノートアプリ'))
      .toBeVisible();
    expect(
      document.querySelector('[data-slot="media-placeholder"], img'),
    ).not.toBeNull();
    await expect.element(siteLink()).toBeVisible();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  test.each<readonly [MatchKind, boolean, ByeReason, string]>([
    [
      'QUALIFIER',
      false,
      'ABSENT',
      '対戦相手不在のため不戦勝。ディレクトリに掲載されます。',
    ],
    [
      'QUALIFIER',
      false,
      'FORFEIT',
      '対戦相手不在のため不戦勝。ディレクトリに掲載されます。',
    ],
    [
      'QUALIFIER',
      true,
      'EARLY',
      '対戦相手が不在になったためマッチ終了。12票のUpvoteで確定し、不戦勝でディレクトリに掲載されます。',
    ],
    [
      'WEEK',
      false,
      'ABSENT',
      '対戦相手不在のため不戦勝。次のラウンドへ進みます。',
    ],
    [
      'WEEK',
      false,
      'FORFEIT',
      '対戦相手不在のため不戦勝。次のラウンドへ進みます。',
    ],
    [
      'WEEK',
      true,
      'EARLY',
      '対戦相手が不在になったためマッチ終了。12票のUpvoteで確定し、次のラウンドへ進みます。',
    ],
    [
      'YEAR',
      false,
      'ABSENT',
      '対戦相手不在のため不戦勝。次のラウンドへ進みます。',
    ],
    [
      'YEAR',
      false,
      'FORFEIT',
      '対戦相手不在のため不戦勝。次のラウンドへ進みます。',
    ],
    [
      'YEAR',
      true,
      'EARLY',
      '対戦相手が不在になったためマッチ終了。12票のUpvoteで確定し、次のラウンドへ進みます。',
    ],
  ])(
    '種別が%sで早期の勝利が%s(理由は%s)なら説明文を「%s」にする',
    async (kind, endedEarly, reason, description) => {
      await renderByeCard(
        byeOf({
          match: { kind, endedEarly, round: kind === 'QUALIFIER' ? null : 1 },
          reason,
        }),
      );

      await expect
        .element(page.getByText(description, { exact: true }))
        .toBeVisible();
    },
  );

  test('早期の勝利の判定はreasonではなくmatch.endedEarlyに従う', async () => {
    await renderByeCard(
      byeOf({ match: { kind: 'WEEK', endedEarly: true }, reason: 'ABSENT' }),
    );

    await expect
      .element(
        page.getByText(
          '対戦相手が不在になったためマッチ終了。12票のUpvoteで確定し、次のラウンドへ進みます。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  test('早期の勝利の票数は確定時のUpvote数を表示設定の区切りで示す', async () => {
    await renderByeCard(
      byeOf({ match: { endedEarly: true }, entry: { upvoteCount: 1234 } }),
    );

    await expect
      .element(
        page.getByText(
          '対戦相手が不在になったためマッチ終了。1,234票のUpvoteで確定し、不戦勝でディレクトリに掲載されます。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  test.each<readonly [MatchKind, string]>([
    ['QUALIFIER', 'noopener ugc'],
    ['WEEK', 'noopener'],
    ['YEAR', 'noopener'],
  ])(
    '種別が%sの「サイトを開く」は外部Webサイトを別タブで開き、relを%sにする',
    async (kind, rel) => {
      await renderByeCard(byeOf({ match: { kind } }));

      const link = siteLink();
      await expect
        .element(link)
        .toHaveAttribute('href', 'https://pitch-notes.example/');
      await expect.element(link).toHaveAttribute('target', '_blank');
      await expect.element(link).toHaveAttribute('rel', rel);
      await expect
        .element(link)
        .toHaveAccessibleName(
          /^Pitch Notesの\s*サイトを開く\s*\(新しいタブで開きます\)$/u,
        );
    },
  );

  test('ディレクトリに掲載されたプロダクトは、名称をプロダクト詳細へのリンクにする', async () => {
    await renderByeCard();

    await expect
      .element(page.getByRole('link', { name: 'Pitch Notes', exact: true }))
      .toHaveAttribute('href', '/p/pitch-notes');
  });

  test('掲載されていない他人のプロダクトは、名称をリンクにしない', async () => {
    await renderByeCard(
      byeOf({ entry: { product: productOf('left', { listed: false }) } }),
    );

    await expect
      .element(page.getByRole('heading', { name: 'Pitch Notes' }))
      .toBeVisible();
    expect(
      page.getByRole('link', { name: 'Pitch Notes', exact: true }).elements(),
    ).toHaveLength(0);
  });

  test('閲覧者自身のプロダクトは、掲載されていなくても名称をリンクにする', async () => {
    await renderByeCard(
      byeOf({
        entry: {
          isViewerOwn: true,
          product: productOf('left', { listed: false }),
        },
      }),
    );

    await expect
      .element(page.getByRole('link', { name: 'Pitch Notes', exact: true }))
      .toHaveAttribute('href', '/p/pitch-notes');
  });

  test('外部Webサイトのアドレスがhttp・httpsの絶対URLでなければ「サイトを開く」を出さない', async () => {
    await renderByeCard(
      byeOf({
        entry: {
          product: productOf('left', { websiteUrl: 'javascript:alert(1)' }),
        },
      }),
    );

    await expect
      .element(page.getByRole('heading', { name: 'Pitch Notes' }))
      .toBeVisible();
    expect(siteLink().elements()).toHaveLength(0);
  });

  test('表示できないプロダクトは「非公開のプロダクト」と示し、リンク・カテゴリ・「サイトを開く」を出さず、バッジと説明文は残す', async () => {
    await renderByeCard(byeOf({ entry: { product: null } }));

    await expect
      .element(card())
      .toHaveAccessibleName('非公開のプロダクト(不戦勝)');
    await expect
      .element(page.getByRole('heading', { name: '非公開のプロダクト' }))
      .toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(page.getByText('開発ツール').elements()).toHaveLength(0);
    await expect
      .element(page.getByText('不戦勝', { exact: true }))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          '対戦相手不在のため不戦勝。ディレクトリに掲載されます。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['予選の不戦勝', byeOf()],
      [
        'トーナメントの早期の勝利',
        byeOf({ match: { kind: 'YEAR', round: 2, endedEarly: true } }),
      ],
      ['表示できないプロダクトの不戦勝', byeOf({ entry: { product: null } })],
    ] as const)(
      '%sの項目のアクセシビリティの検査の違反が0件',
      async (_label, bye) => {
        applyColorScheme(scheme);
        await renderByeCard(bye);
        await expect.element(page.getByRole('heading')).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
