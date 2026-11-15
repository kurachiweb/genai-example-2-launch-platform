import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import type { MatchByeFragment } from '../../graphql/generated/graphql.ts';
import { ByeList } from './bye-list.tsx';
import { byeOf, ENTRY_IDS, entryOf } from './match-fixtures.ts';
import { renderInMatchFrame } from './match-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const BYES: readonly MatchByeFragment[] = [
  byeOf(),
  {
    ...byeOf({ match: { id: '01JD0MATCH0000000000000003', endedEarly: true } }),
    entry: entryOf('right', { result: 'WALKOVER' }),
  },
];

const renderList = async (byes: readonly MatchByeFragment[] = BYES) => {
  await renderInMatchFrame(
    <section aria-label="予選">
      <h2>予選</h2>
      <ByeList byes={byes} />
    </section>,
    { width: 1280 },
  );
};

afterEach(() => {
  applyColorScheme('light');
});

describe('ByeList', () => {
  test('見出し「不戦勝」の下に不戦勝の項目を一覧で並べ、Upvoteのボタンを出さない', async () => {
    await renderList();

    await expect
      .element(page.getByRole('heading', { name: '不戦勝', level: 3 }))
      .toBeVisible();
    const items = page.getByRole('listitem');
    expect(items.elements()).toHaveLength(2);
    await expect
      .element(page.getByRole('article', { name: 'Pitch Notes(不戦勝)' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('article', { name: 'Tactics Board(不戦勝)' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { name: 'Pitch Notes', level: 4 }))
      .toBeVisible();
    await expect.element(page.getByRole('list')).toHaveAccessibleName('不戦勝');
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  test('項目ごとにマッチの種別と早期の勝利で説明文を切り替える', async () => {
    await renderList();

    await expect
      .element(
        page.getByText(
          '対戦相手不在のため不戦勝。ディレクトリに掲載されます。',
          { exact: true },
        ),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          '対戦相手が不在になったためマッチ終了。9票のUpvoteで確定し、不戦勝でディレクトリに掲載されます。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  test('トーナメントの不戦勝も同じ一覧で示す', async () => {
    await renderList([
      byeOf({ match: { kind: 'WEEK', round: 1 } }),
      {
        ...byeOf({
          match: {
            id: '01JD0MATCH0000000000000003',
            kind: 'YEAR',
            stage: 'SEMIFINAL',
            endedEarly: true,
          },
        }),
        entry: entryOf('right', { id: ENTRY_IDS.right, result: 'WALKOVER' }),
      },
    ]);

    await expect
      .element(
        page.getByText('対戦相手不在のため不戦勝。次のラウンドへ進みます。', {
          exact: true,
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          '対戦相手が不在になったためマッチ終了。9票のUpvoteで確定し、次のラウンドへ進みます。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  test('不戦勝が無ければ見出しごと何も描かない', async () => {
    await renderList([]);

    await expect
      .element(page.getByRole('heading', { name: '予選' }))
      .toBeVisible();
    expect(
      page.getByRole('heading', { name: '不戦勝' }).elements(),
    ).toHaveLength(0);
    expect(page.getByRole('list').elements()).toHaveLength(0);
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、一覧のアクセシビリティの検査の違反が0件',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderList();
      await expect
        .element(page.getByRole('heading', { name: '不戦勝' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
