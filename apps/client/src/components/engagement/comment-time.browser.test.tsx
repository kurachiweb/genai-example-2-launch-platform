import { act, type ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { CommentTime } from './comment-time.tsx';

const NOW = new Date('2026-11-15T07:40:00.000Z');

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const OUTSIDE = '投稿日時の外の領域';

const isoBefore = (elapsedMs: number): string =>
  new Date(NOW.getTime() - elapsedMs).toISOString();

// 前に実行したテストのポインターの位置が残ると、同じ位置に描いた投稿日時へポインターが重なった扱いになりツールチップが開くため、描画の後にポインターを外へ移す
async function renderAwayFromPointer(element: ReactNode) {
  const screen = await render(
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <TooltipProvider>
        <div className="p-12">
          {element}
          <p>{OUTSIDE}</p>
        </div>
      </TooltipProvider>
    </DisplayPreferencesProvider>,
  );
  await userEvent.hover(page.getByText(OUTSIDE));
  return screen;
}

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const actEnvironment = globalThis as ActEnvironment;

const hydratedRoots: Root[] = [];

// vitest-browser-reactのrenderは自分のactの後にactの環境の指定を戻すため、Reactのactを直接呼ぶたびに指定し直す
async function actInTestEnvironment(
  callback: () => Promise<void>,
): Promise<void> {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(callback);
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

const timeElement = (): HTMLTimeElement => {
  const time = document.querySelector('time');
  if (time === null) {
    throw new Error('time要素がありません。');
  }
  return time;
};

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  await actInTestEnvironment(async () => {
    for (const root of hydratedRoots.splice(0)) {
      root.unmount();
    }
    await Promise.resolve();
  });
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('CommentTime', () => {
  test.each<[string, number, string]>([
    ['1分未満', 30 * SECOND_MS, 'たった今'],
    ['1時間未満', 12 * MINUTE_MS, '12分前'],
    ['1日未満', 3 * HOUR_MS + 59 * MINUTE_MS, '3時間前'],
    ['30日未満', 5 * DAY_MS, '5日前'],
    ['30日の直前', 30 * DAY_MS - SECOND_MS, '29日前'],
  ])('%sは経過の表現で示す', async (_name, elapsedMs, expected) => {
    await renderAwayFromPointer(<CommentTime value={isoBefore(elapsedMs)} />);

    await expect
      .element(page.getByText(expected, { exact: true }))
      .toBeVisible();
    expect(timeElement().dateTime).toBe(isoBefore(elapsedMs));
  });

  test.each<[string, string, string]>([
    ['ちょうど30日前', isoBefore(30 * DAY_MS), '10月16日(金)'],
    ['前の年', '2025-09-15T07:40:00.000Z', '9月15日(月)'],
  ])(
    '30日以上前(%s)は月日と曜日で示し、年を付けない',
    async (_name, value, expected) => {
      await renderAwayFromPointer(<CommentTime value={value} />);

      await expect
        .element(page.getByText(expected, { exact: true }))
        .toBeVisible();
      expect(timeElement().textContent).toBe(expected);
      expect(timeElement().dateTime).toBe(value);
    },
  );

  test('ホバーで、閲覧者のタイムゾーンの完全な日時をツールチップに示す', async () => {
    await renderAwayFromPointer(<CommentTime value={isoBefore(3 * HOUR_MS)} />);

    await userEvent.hover(page.getByText('3時間前'));

    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent('2026年11月15日(日) 13:40');
  });

  test('キーボードでフォーカスでき、フォーカスで完全な日時をツールチップに示し、説明として伝える', async () => {
    await renderAwayFromPointer(
      <CommentTime value="2025-09-15T07:40:00.000Z" />,
    );

    await userEvent.tab();

    const trigger = page.getByRole('button', { name: '9月15日(月)' });
    await expect.element(trigger).toHaveFocus();
    expect(outlineOf(trigger.element())).toStrictEqual(ringOutline());
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent('2025年9月15日(月) 16:40');
    await expect
      .element(trigger)
      .toHaveAccessibleDescription('2025年9月15日(月) 16:40');
  });

  test('ツールチップが閉じている間も、完全な日時を説明として伝える', async () => {
    await renderAwayFromPointer(<CommentTime value={isoBefore(3 * HOUR_MS)} />);

    const trigger = page.getByRole('button', { name: '3時間前' });
    await expect.element(trigger).toBeVisible();
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(0);
    await expect
      .element(trigger)
      .toHaveAccessibleDescription('2026年11月15日(日) 13:40');
  });

  test('サーバー側の描画とハイドレーションの間は、30日未満でも月日と曜日で示し、ハイドレーションの後に経過の表現へ替える', async () => {
    const value = isoBefore(3 * HOUR_MS);
    const tree = (
      <DisplayPreferencesProvider initial={TOKYO_JA}>
        <TooltipProvider>
          <CommentTime value={value} />
        </TooltipProvider>
      </DisplayPreferencesProvider>
    );
    const recoverableErrors: unknown[] = [];

    const serverHtml = renderToString(tree);
    const container = document.body.appendChild(document.createElement('div'));
    container.replaceChildren(
      ...new DOMParser().parseFromString(serverHtml, 'text/html').body
        .childNodes,
    );
    await actInTestEnvironment(async () => {
      hydratedRoots.push(
        hydrateRoot(container, tree, {
          onRecoverableError: (error) => {
            recoverableErrors.push(error);
          },
        }),
      );
      await Promise.resolve();
    });

    expect(serverHtml).toContain('11月15日(日)');
    expect(serverHtml).not.toContain('時間前');
    expect(container.querySelector('time')?.textContent).toBe('3時間前');
    expect(recoverableErrors).toEqual([]);
    container.remove();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('ツールチップを開いた状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderAwayFromPointer(
        <CommentTime value={isoBefore(3 * HOUR_MS)} />,
      );
      await userEvent.tab();
      await expect.element(page.getByRole('tooltip')).toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
