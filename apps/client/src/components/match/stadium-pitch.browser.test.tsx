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
import {
  GOAL_STAND_DOTS,
  MAX_CROWD_DOTS,
  type PitchOrientation,
  type PitchProps,
} from './pitch-model.ts';
import { StadiumPitch } from './stadium-pitch.tsx';

type MotionHost = 'on' | 'off' | 'none';

const ORIENTATIONS: readonly PitchOrientation[] = ['horizontal', 'vertical'];

const BASE_PROPS = {
  leftVotes: 12,
  rightVotes: 9,
  leftColors: ['#1d4ed8', '#f59e0b'],
  rightColors: ['#be123c', '#fbbf24'],
} as const satisfies Partial<PitchProps>;

function MotionHostFrame({
  host,
  children,
}: {
  readonly host: MotionHost;
  readonly children: ReactNode;
}) {
  const style = { width: 960, height: 360 };
  return host === 'none' ? (
    <div style={style}>{children}</div>
  ) : (
    <div data-auto-refresh={host} style={style}>
      {children}
    </div>
  );
}

const renderPitch = (
  props: Partial<PitchProps> = {},
  host: MotionHost = 'on',
) =>
  render(
    <MotionHostFrame host={host}>
      <StadiumPitch orientation="horizontal" {...BASE_PROPS} {...props} />
    </MotionHostFrame>,
  );

const all = (selector: string): Element[] =>
  Array.from(document.querySelectorAll(selector));

const crowdDots = (side: 'left' | 'right'): Element[] =>
  all(`[data-pitch-crowd="${side}"] circle`);

const animationNamesOf = (selector: string): string[] =>
  all(selector).map((element) => getComputedStyle(element).animationName);

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('StadiumPitch', () => {
  test.each(ORIENTATIONS)(
    '向きが%sのピッチは装飾として読み上げない',
    async (orientation) => {
      await renderPitch({ orientation });

      const svg = document.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(page.getByRole('img').elements()).toHaveLength(0);
    },
  );

  test.each(ORIENTATIONS)(
    '向きが%sのピッチを同じページに2つ描いても、照明の定義の識別子が重ならない',
    async (orientation) => {
      await render(
        <MotionHostFrame host="on">
          <StadiumPitch orientation={orientation} {...BASE_PROPS} />
          <StadiumPitch orientation={orientation} {...BASE_PROPS} />
        </MotionHostFrame>,
      );

      const ids = all('[id]').map((element) => element.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  test.each(ORIENTATIONS)(
    '向きが%sのピッチは、各側のUpvote数に応援の1人を加えた観客を、その側の主色で置く',
    async (orientation) => {
      await renderPitch({ orientation, leftVotes: 12, rightVotes: 0 });

      expect(crowdDots('left')).toHaveLength(13);
      expect(crowdDots('right')).toHaveLength(1);
      expect(crowdDots('left')[0]?.getAttribute('fill')).toBe('#1d4ed8');
      expect(crowdDots('right')[0]?.getAttribute('fill')).toBe('#be123c');
    },
  );

  test.each(ORIENTATIONS)(
    '向きが%sのピッチは、ゴール裏に収まらない観客をサイドスタンドへ置き、1つの側の観客を上限の数で止める',
    async (orientation) => {
      await renderPitch({ orientation, leftVotes: 250, rightVotes: 999 });

      expect(crowdDots('left')).toHaveLength(251);
      expect(crowdDots('right')).toHaveLength(MAX_CROWD_DOTS);
      expect(GOAL_STAND_DOTS).toBeLessThan(251);
    },
  );

  test('横向きのピッチは遠いスタンドに両側の配色の旗を立てる', async () => {
    await renderPitch();

    const fills = all('[data-pitch-flag]').map((flag) =>
      flag.getAttribute('fill'),
    );
    expect(fills).toHaveLength(12);
    expect(new Set(fills)).toStrictEqual(
      new Set(['#1d4ed8', '#f59e0b', '#be123c', '#fbbf24']),
    );
  });

  test.each(ORIENTATIONS)(
    '向きが%sの無人のピッチは観客と旗を置かない',
    async (orientation) => {
      await renderPitch({ orientation, isDeserted: true });

      expect(crowdDots('left')).toHaveLength(0);
      expect(crowdDots('right')).toHaveLength(0);
      expect(all('[data-pitch-flag]')).toHaveLength(0);
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each(ORIENTATIONS)(
      '向きが%sのピッチのアクセシビリティの検査の違反が0件',
      async (orientation) => {
        applyColorScheme(scheme);
        const { container } = await renderPitch({ orientation });

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});

describe('StadiumPitchの演出', () => {
  test('祖先の自動更新がオンなら、旗がはためき、照明が明滅する', async () => {
    await renderPitch({}, 'on');

    expect(new Set(animationNamesOf('[data-pitch-flag]'))).toStrictEqual(
      new Set(['stadium-flag-wave']),
    );
    expect(new Set(animationNamesOf('[data-pitch-floodlight]'))).toStrictEqual(
      new Set(['stadium-flood-pulse']),
    );
  });

  test.each(ORIENTATIONS)(
    '向きが%sで祖先の自動更新がオンなら、Upvoteの演出でその側の観客だけが跳ねる',
    async (orientation) => {
      await renderPitch({ orientation, excited: 'left' }, 'on');

      expect(new Set(crowdDots('left').map(animationOf))).toStrictEqual(
        new Set(['stadium-crowd-jump']),
      );
      expect(new Set(crowdDots('right').map(animationOf))).toStrictEqual(
        new Set(['none']),
      );
    },
  );

  test('結果が出た後は、敗者の側の観客はUpvoteの演出でも跳ねない', async () => {
    await renderPitch({ excited: 'right', finishedWinner: 'left' }, 'on');

    expect(new Set(crowdDots('right').map(animationOf))).toStrictEqual(
      new Set(['none']),
    );
  });

  test.each([
    ['自動更新がオフの祖先', 'off'],
    ['自動更新の属性の無い祖先(トップページの外)', 'none'],
  ] as const)(
    '%sの下では、旗・照明・Upvoteの演出の観客を動かさない',
    async (_label, host) => {
      await renderPitch({ excited: 'left' }, host);

      expect(new Set(animationNamesOf('[data-pitch-flag]'))).toStrictEqual(
        new Set(['none']),
      );
      expect(
        new Set(animationNamesOf('[data-pitch-floodlight]')),
      ).toStrictEqual(new Set(['none']));
      expect(new Set(crowdDots('left').map(animationOf))).toStrictEqual(
        new Set(['none']),
      );
    },
  );

  test('視差効果を減らす設定なら、自動更新がオンの祖先の下でも動かさない', async () => {
    await emulateReducedMotion('reduce');
    await renderPitch({ excited: 'left' }, 'on');

    expect(new Set(animationNamesOf('[data-pitch-flag]'))).toStrictEqual(
      new Set(['none']),
    );
    expect(new Set(animationNamesOf('[data-pitch-floodlight]'))).toStrictEqual(
      new Set(['none']),
    );
    expect(new Set(crowdDots('left').map(animationOf))).toStrictEqual(
      new Set(['none']),
    );
  });
});

function animationOf(element: Element): string {
  return getComputedStyle(element).animationName;
}
