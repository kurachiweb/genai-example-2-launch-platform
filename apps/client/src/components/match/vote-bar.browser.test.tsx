import type { ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { VoteBar } from './vote-bar.tsx';
import type { BallShot } from './vote-bar-model.ts';

const BAR_WIDTH = 420;

type MotionHost = 'on' | 'off' | 'none';

type BarOptions = {
  readonly leftVotes?: number;
  readonly rightVotes?: number;
  readonly shot?: BallShot;
  readonly isThick?: boolean;
  readonly host?: MotionHost;
};

function MotionHostFrame({
  host,
  children,
}: {
  readonly host: MotionHost;
  readonly children: ReactNode;
}) {
  const style = { width: BAR_WIDTH, padding: 24 };
  return host === 'none' ? (
    <div style={style}>{children}</div>
  ) : (
    <div data-auto-refresh={host} style={style}>
      {children}
    </div>
  );
}

const renderBar = ({
  leftVotes = 12,
  rightVotes = 9,
  shot = null,
  isThick = false,
  host = 'on',
}: BarOptions = {}) =>
  render(
    <MotionHostFrame host={host}>
      <VoteBar
        leftName="Pitch Notes"
        rightName="Tactics Board"
        leftVotes={leftVotes}
        rightVotes={rightVotes}
        leftColor="#1d4ed8"
        rightColor="#be123c"
        isThick={isThick}
        shot={shot}
      />
    </MotionHostFrame>,
  );

const barElement = (): HTMLElement =>
  page.getByRole('img').element() as HTMLElement;

const fillsOf = (bar: HTMLElement): HTMLElement[] =>
  Array.from(bar.querySelectorAll<HTMLElement>('[data-vote-bar-fill]'));

const ballPart = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`${selector}が描かれていない`);
  }
  return element;
};

const ballOffsetRatio = (): number => {
  const bar = barElement().getBoundingClientRect();
  const track = ballPart('[data-vote-ball-track]').getBoundingClientRect();
  return (track.left - bar.left) / bar.width;
};

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('VoteBar', () => {
  test('左の側から順に各側の名称とUpvote数を代替テキストで示す', async () => {
    await renderBar();

    await expect
      .element(
        page.getByRole('img', { name: 'Pitch Notes12票、Tactics Board9票' }),
      )
      .toBeVisible();
  });

  test('両側のUpvote数の比率で左右の色の幅を分ける', async () => {
    await renderBar({ leftVotes: 12, rightVotes: 9 });

    const bar = barElement();
    const [left, right] = fillsOf(bar);
    const barWidth = bar.clientWidth;

    expect(left?.getBoundingClientRect().width).toBeCloseTo(
      (barWidth * 12) / 21,
      0,
    );
    expect(right?.getBoundingClientRect().width).toBeCloseTo(
      (barWidth * 9) / 21,
      0,
    );
    expect(getComputedStyle(left as HTMLElement).backgroundColor).toBe(
      'rgb(29, 78, 216)',
    );
  });

  test('0対0は色を塗らない空のバーにし、代替テキストで0票を示す', async () => {
    await renderBar({ leftVotes: 0, rightVotes: 0 });

    await expect
      .element(
        page.getByRole('img', { name: 'Pitch Notes0票、Tactics Board0票' }),
      )
      .toBeVisible();
    expect(fillsOf(barElement())).toHaveLength(0);
    expect(ballOffsetRatio()).toBeCloseTo(0.5, 2);
  });

  test('ボールは装飾として読み上げず、比率の境目に置く', async () => {
    await renderBar({ leftVotes: 12, rightVotes: 9 });

    expect(page.getByRole('img').elements()).toHaveLength(1);
    expect(ballPart('[data-vote-ball-track]').getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(ballOffsetRatio()).toBeCloseTo(12 / 21, 2);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([false, true])(
      '太さの指定が%sでもアクセシビリティの検査の違反が0件',
      async (isThick) => {
        applyColorScheme(scheme);
        const { container } = await renderBar({ isThick });

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});

describe('VoteBarの演出', () => {
  const ballSpin = () => getComputedStyle(ballPart('[data-vote-ball-spin]'));
  const fastSpin = () =>
    getComputedStyle(ballPart('[data-vote-ball-spin-fast]'));

  test('祖先の自動更新がオンなら、ボールが常に回り、比率のバーの幅が動く', async () => {
    await renderBar({ host: 'on' });

    expect(ballSpin().animationName).toBe('stadium-ball-spin');
    expect(fastSpin().animationPlayState).toBe('paused');
    const [left] = fillsOf(barElement());
    expect(
      Number.parseFloat(
        getComputedStyle(left as HTMLElement).transitionDuration,
      ),
    ).toBe(0.7);
  });

  test('祖先の自動更新がオンなら、Upvoteの演出でボールが速く回りながらゴールへ飛ぶ', async () => {
    await renderBar({ host: 'on', shot: { target: 'right', phase: 'flying' } });

    expect(fastSpin().animationName).toBe('stadium-ball-spin');
    expect(fastSpin().animationPlayState).toBe('running');
    expect(
      Number.parseFloat(
        getComputedStyle(ballPart('[data-vote-ball-track]')).transitionDuration,
      ),
    ).toBe(0.4);
  });

  test('祖先の自動更新がオンなら、ゴールで止まる間はボールを飛び込んだ側の端に置く', async () => {
    await renderBar({
      host: 'on',
      shot: { target: 'right', phase: 'holding' },
    });

    expect(ballOffsetRatio()).toBeCloseTo(1, 2);
  });

  test.each([
    ['自動更新がオフの祖先', 'off'],
    ['自動更新の属性の無い祖先(トップページの外)', 'none'],
  ] as const)(
    '%sの下では、ボールを回さず、Upvoteの演出でもボールを比率の境目に留め、バーの幅を動かさない',
    async (_label, host) => {
      await renderBar({ host, shot: { target: 'right', phase: 'holding' } });

      expect(ballSpin().animationName).toBe('none');
      expect(fastSpin().animationName).toBe('none');
      expect(ballOffsetRatio()).toBeCloseTo(12 / 21, 2);
      const [left] = fillsOf(barElement());
      expect(
        Number.parseFloat(
          getComputedStyle(left as HTMLElement).transitionDuration,
        ),
      ).toBe(0);
    },
  );

  test('視差効果を減らす設定なら、自動更新がオンの祖先の下でもボールを回さず、比率の境目に留める', async () => {
    await emulateReducedMotion('reduce');
    await renderBar({ host: 'on', shot: { target: 'left', phase: 'flying' } });

    expect(ballSpin().animationName).toBe('none');
    expect(fastSpin().animationName).toBe('none');
    expect(ballOffsetRatio()).toBeCloseTo(12 / 21, 2);
  });
});
