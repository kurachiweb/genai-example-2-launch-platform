import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { ENTRY_IDS, matchOf } from './match-fixtures.ts';
import { MatchStage } from './match-stage.tsx';
import { type MotionHost, renderInMatchFrame } from './match-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const CARD_WIDTH = 960;

// Upvoteの操作のフックの代わりに、押した側をサーバーの結果としてUpvote済みにし、その側のUpvote数を1つ増やす
function UpvotingStage({ initial }: { readonly initial: MatchFragment }) {
  const [match, setMatch] = useState(initial);
  const toggle = (entryId: string) => {
    setMatch((current) => {
      const isCancel = current.viewerUpvotedEntryId === entryId;
      return {
        ...current,
        viewerUpvotedEntryId: isCancel ? null : entryId,
        entries: current.entries.map((entry) =>
          entry.id === entryId
            ? { ...entry, upvoteCount: entry.upvoteCount + (isCancel ? -1 : 1) }
            : entry,
        ),
      };
    });
  };
  return <MatchStage match={match} onToggleUpvote={toggle} />;
}

const renderStage = (host: MotionHost, match: MatchFragment = matchOf()) =>
  renderInMatchFrame(<UpvotingStage initial={match} />, {
    host,
    width: CARD_WIDTH,
  });

const visible = (selector: string): Element[] =>
  Array.from(document.querySelectorAll(selector)).filter(
    (element) => element.getClientRects().length > 0,
  );

const animationNamesOf = (selector: string): Set<string> =>
  new Set(
    visible(selector).map((element) => getComputedStyle(element).animationName),
  );

const crowdAnimationsOf = (side: 'left' | 'right'): Set<string> =>
  animationNamesOf(`[data-pitch-crowd="${side}"] circle`);

// 観客を盛り上げる状態は反映の2フレーム後に付くため、付いた後に動きを確かめないと、CSSが止めていることを確かめられない
const waitUntilExcited = (side: 'left' | 'right') =>
  expect
    .poll(() => visible(`[data-pitch-crowd="${side}"][data-excited="true"]`))
    .toHaveLength(1);

const upvote = (name: string) =>
  page.getByRole('button', { name: `${name}にUpvote` }).click();

afterEach(async () => {
  await emulateReducedMotion('no-preference');
});

describe('MatchStageの演出', () => {
  test('祖先の自動更新がオンなら、旗・照明・ボールの回転が動く', async () => {
    await renderStage('on');
    await expect.element(page.getByRole('img')).toBeVisible();

    expect(animationNamesOf('[data-pitch-flag]')).toStrictEqual(
      new Set(['stadium-flag-wave']),
    );
    expect(animationNamesOf('[data-pitch-floodlight]')).toStrictEqual(
      new Set(['stadium-flood-pulse']),
    );
    expect(animationNamesOf('[data-vote-ball-spin]')).toStrictEqual(
      new Set(['stadium-ball-spin']),
    );
  });

  test('祖先の自動更新がオンなら、Upvoteが反映された側の観客が跳ね、ボールが相手のゴールへ飛ぶ', async () => {
    await renderStage('on');
    expect(crowdAnimationsOf('left')).toStrictEqual(new Set(['none']));

    await upvote('Pitch Notes');

    await expect
      .poll(() => crowdAnimationsOf('left'))
      .toStrictEqual(new Set(['stadium-crowd-jump']));
    expect(crowdAnimationsOf('right')).toStrictEqual(new Set(['none']));
    expect(visible('[data-vote-ball][data-flying="true"]')).toHaveLength(1);
    const track = visible('[data-vote-ball-track]')[0] as HTMLElement;
    expect(track.style.getPropertyValue('--ball-at')).toBe('1');
  });

  test('Upvoteの演出は、ボールをゴールで止めてから比率の境目へ戻し、観客の盛り上がりとともに終える', async () => {
    await renderStage('on');
    await upvote('Pitch Notes');
    await waitUntilExcited('left');
    const trackStyleOf = (name: string): string =>
      (
        visible('[data-vote-ball-track]')[0] as HTMLElement
      ).style.getPropertyValue(name);
    await expect
      .poll(() => visible('[data-vote-ball][data-flying="true"]'))
      .toHaveLength(1);

    await expect
      .poll(() => visible('[data-vote-ball][data-flying="true"]'))
      .toHaveLength(0);
    expect(trackStyleOf('--ball-at')).toBe('1');
    await expect
      .poll(() => trackStyleOf('--ball-duration'), { timeout: 3000 })
      .toBe('2500ms');
    expect(trackStyleOf('--ball-at')).toBe(String(13 / 22));
    await expect
      .poll(() => trackStyleOf('--ball-duration'), { timeout: 5000 })
      .toBe('400ms');
    expect(trackStyleOf('--ball-at')).toBe(String(13 / 22));
    await expect
      .poll(() => visible('[data-pitch-crowd="left"][data-excited="true"]'), {
        timeout: 7000,
      })
      .toHaveLength(0);
  });

  test('同じ側へ続けてUpvoteが反映されると、観客の跳ねる演出をやり直す', async () => {
    await renderStage('on');
    await upvote('Pitch Notes');
    await expect
      .poll(() => crowdAnimationsOf('left'))
      .toStrictEqual(new Set(['stadium-crowd-jump']));
    await page
      .getByRole('button', { name: 'Pitch NotesへのUpvoteを取り消す' })
      .click();

    const started: string[] = [];
    document.addEventListener('animationstart', (event) => {
      started.push(event.animationName);
    });
    await upvote('Pitch Notes');

    await expect.poll(() => started).toContain('stadium-crowd-jump');
  });

  test('ページを開いた時点のUpvoteでは演出を動かさない', async () => {
    await renderStage('on', matchOf({ viewerUpvotedEntryId: ENTRY_IDS.left }));
    await expect.element(page.getByRole('img')).toBeVisible();

    expect(crowdAnimationsOf('left')).toStrictEqual(new Set(['none']));
    expect(visible('[data-vote-ball][data-flying="true"]')).toHaveLength(0);
  });

  test.each([
    ['自動更新がオフの祖先', 'off'],
    ['自動更新の属性の無い祖先(トップページの外)', 'none'],
  ] as const)(
    '%sの下では、常に動く演出もUpvoteの演出も動かさない',
    async (_label, host) => {
      await renderStage(host);
      await upvote('Pitch Notes');
      await waitUntilExcited('left');

      expect(animationNamesOf('[data-pitch-flag]')).toStrictEqual(
        new Set(['none']),
      );
      expect(animationNamesOf('[data-pitch-floodlight]')).toStrictEqual(
        new Set(['none']),
      );
      expect(animationNamesOf('[data-vote-ball-spin]')).toStrictEqual(
        new Set(['none']),
      );
      expect(crowdAnimationsOf('left')).toStrictEqual(new Set(['none']));
    },
  );

  test('視差効果を減らす設定なら、自動更新がオンの祖先の下でも演出を動かさない', async () => {
    await emulateReducedMotion('reduce');
    await renderStage('on');
    await upvote('Pitch Notes');
    await waitUntilExcited('left');

    expect(animationNamesOf('[data-pitch-flag]')).toStrictEqual(
      new Set(['none']),
    );
    expect(crowdAnimationsOf('left')).toStrictEqual(new Set(['none']));
  });
});
