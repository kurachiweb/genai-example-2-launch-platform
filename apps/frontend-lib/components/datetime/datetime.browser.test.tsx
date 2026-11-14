import {
  act,
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactElement,
} from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { emulateBrowserDisplay } from '../../test/display-emulation.ts';
import type { DisplayPreferences } from '../../utilities/datetime/display-preferences.ts';
import { DateTime } from './date-time.tsx';
import { DisplayPreferencesProvider } from './display-preferences-provider.tsx';
import { NumberText } from './number-text.tsx';
import { RelativeTime } from './relative-time.tsx';

const KICKOFF = new Date('2026-01-15T07:40:00.000Z');
const KICKOFF_ISO = '2026-01-15T07:40:00.000Z';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};
const LOS_ANGELES_JA: DisplayPreferences = {
  timeZone: 'America/Los_Angeles',
  locale: 'ja-JP',
};
const BERLIN_DE: DisplayPreferences = {
  timeZone: 'Europe/Berlin',
  locale: 'de-DE',
};

// 表示設定の提供はサーバーの値のオブジェクトごとにブラウザの値を保持するため、ブラウザの値を変えるテストごとに新しいオブジェクトを渡す
const serverValueOf = (
  preferences: DisplayPreferences,
): DisplayPreferences => ({
  ...preferences,
});

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface HydratedMarkup {
  readonly container: HTMLElement;
  readonly serverHtml: string;
  readonly commits: readonly string[];
  readonly recoverableErrors: readonly unknown[];
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

// サーバー側の描画結果をそのまま文書に置き、Reactにハイドレーションさせて、食い違いの検出と描画の回数を記録する
async function hydrateServerMarkup(ui: ReactElement): Promise<HydratedMarkup> {
  const commits: string[] = [];
  const recoverableErrors: unknown[] = [];
  const onRender: ProfilerOnRenderCallback = (_id, phase) => {
    commits.push(phase);
  };
  const tree = (
    <Profiler id="display" onRender={onRender}>
      {ui}
    </Profiler>
  );
  const serverHtml = renderToString(tree);
  const container = document.body.appendChild(document.createElement('div'));
  container.replaceChildren(
    ...new DOMParser().parseFromString(serverHtml, 'text/html').body.childNodes,
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
  return { container, serverHtml, commits, recoverableErrors };
}

async function renderWithBrowserDisplay(
  ui: ReactElement,
  preferences: DisplayPreferences,
) {
  await emulateBrowserDisplay(preferences);
  return render(
    <DisplayPreferencesProvider initial={serverValueOf(preferences)}>
      {ui}
    </DisplayPreferencesProvider>,
  );
}

const timeElementsOf = (container: HTMLElement): HTMLTimeElement[] => [
  ...container.querySelectorAll('time'),
];

let consoleError: MockInstance<Console['error']>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});

afterEach(async () => {
  await actInTestEnvironment(async () => {
    for (const root of hydratedRoots.splice(0)) {
      root.unmount();
    }
    await Promise.resolve();
  });
  document.body.replaceChildren();
  consoleError.mockRestore();
  vi.useRealTimers();
  await emulateBrowserDisplay(null);
});

describe('DisplayPreferencesProvider', () => {
  test('サーバーの値で描画した直後はサーバーの値で整形し、ブラウザのタイムゾーンが異なればハイドレーションの後にブラウザの値で整形し直し、不一致の警告を出さない', async () => {
    await emulateBrowserDisplay(LOS_ANGELES_JA);

    const hydrated = await hydrateServerMarkup(
      <DisplayPreferencesProvider initial={serverValueOf(TOKYO_JA)}>
        <DateTime value={KICKOFF} format="longDateTime" />
      </DisplayPreferencesProvider>,
    );

    expect(hydrated.serverHtml).toContain('2026年1月15日(木) 16:40');
    expect(hydrated.container).toHaveTextContent('2026年1月14日(水) 23:40');
    expect(hydrated.commits).toEqual(['mount', 'update']);
    expect(hydrated.recoverableErrors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('ブラウザのロケールが異なれば、日時と数値をブラウザのロケールで整形し直す', async () => {
    await emulateBrowserDisplay(BERLIN_DE);

    const hydrated = await hydrateServerMarkup(
      <DisplayPreferencesProvider initial={serverValueOf(TOKYO_JA)}>
        <DateTime value={KICKOFF} format="yearDate" />
        <NumberText value={1234567} />
      </DisplayPreferencesProvider>,
    );

    expect(hydrated.serverHtml).toContain('2026年1月15日');
    expect(hydrated.serverHtml).toContain('1,234,567');
    expect(hydrated.container).toHaveTextContent('15. Januar 2026');
    expect(hydrated.container).toHaveTextContent('1.234.567');
    expect(hydrated.recoverableErrors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('ブラウザの値がサーバーの値と同じなら、切り替えのための再描画をしない', async () => {
    await emulateBrowserDisplay(TOKYO_JA);

    const hydrated = await hydrateServerMarkup(
      <DisplayPreferencesProvider initial={serverValueOf(TOKYO_JA)}>
        <DateTime value={KICKOFF} format="longDateTime" />
      </DisplayPreferencesProvider>,
    );

    expect(hydrated.container).toHaveTextContent('2026年1月15日(木) 16:40');
    expect(hydrated.commits).toEqual(['mount']);
    expect(hydrated.recoverableErrors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('ブラウザで新しく描画する時は、最初からブラウザの値で整形する', async () => {
    await emulateBrowserDisplay(LOS_ANGELES_JA);

    await render(
      <DisplayPreferencesProvider initial={serverValueOf(TOKYO_JA)}>
        <DateTime value={KICKOFF} format="longDateTime" />
      </DisplayPreferencesProvider>,
    );

    await expect
      .element(page.getByText('2026年1月14日(水) 23:40'))
      .toBeInTheDocument();
  });

  test('表示設定の提供の外で日時の部品を使うと、提供が無いことを示す例外を投げる', async () => {
    await expect(
      render(<DateTime value={KICKOFF} format="date" />),
    ).rejects.toThrow('DisplayPreferencesProvider');
  });
});

describe('DateTime', () => {
  test('time要素のdatetime属性に、入力のタイムゾーンに関わらずUTCのISO形式の日時を設定する', async () => {
    const { container } = await renderWithBrowserDisplay(
      <>
        <DateTime value={KICKOFF} format="longDateTime" />
        <DateTime value="2026-01-15T16:40:00+09:00" format="longDateTime" />
        <DateTime value="2026-01-15T07:40:00Z" format="time" />
      </>,
      TOKYO_JA,
    );

    const times = timeElementsOf(container);
    expect(times.map((time) => time.dateTime)).toEqual([
      KICKOFF_ISO,
      KICKOFF_ISO,
      KICKOFF_ISO,
    ]);
    expect(times.map((time) => time.textContent)).toEqual([
      '2026年1月15日(木) 16:40',
      '2026年1月15日(木) 16:40',
      '16:40',
    ]);
  });

  test.each([
    ['日時として解釈できない文字列', 'not a date'],
    ['タイムゾーンを含まない文字列', '2026-01-15T16:40:00'],
    ['日付だけの文字列', '2026-01-15'],
  ])('%sを渡すと例外を投げる', async (_name, value) => {
    await expect(
      render(
        <DisplayPreferencesProvider initial={serverValueOf(TOKYO_JA)}>
          <DateTime value={value} format="date" />
        </DisplayPreferencesProvider>,
      ),
    ).rejects.toThrow(RangeError);
  });

  test('不正なDateを渡すと例外を投げる', async () => {
    await expect(
      render(
        <DisplayPreferencesProvider initial={serverValueOf(TOKYO_JA)}>
          <DateTime value={new Date(Number.NaN)} format="date" />
        </DisplayPreferencesProvider>,
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('RelativeTime', () => {
  const useClockAt = (now: Date): void => {
    vi.useFakeTimers({
      now,
      toFake: ['Date', 'setInterval', 'clearInterval'],
    });
  };

  test('残り時間を、time要素の日時と併記する', async () => {
    useClockAt(new Date(KICKOFF.getTime() - 3 * HOUR_MS));

    const { container } = await renderWithBrowserDisplay(
      <RelativeTime target={KICKOFF_ISO} kind="remaining" format="dateTime" />,
      TOKYO_JA,
    );

    await expect.element(page.getByText('(あと3時間)')).toBeInTheDocument();
    const [time] = timeElementsOf(container);
    expect(time?.dateTime).toBe(KICKOFF_ISO);
    expect(time?.textContent).toBe('1月15日(木) 16:40');
  });

  test('経過時間を日時と併記し、30日以上前は日時だけを表示する', async () => {
    useClockAt(new Date(KICKOFF.getTime() + 3 * DAY_MS));

    const { container } = await renderWithBrowserDisplay(
      <>
        <p>
          <RelativeTime target={KICKOFF} kind="elapsed" format="date" />
        </p>
        <p>
          <RelativeTime
            target={new Date(KICKOFF.getTime() - 30 * DAY_MS)}
            kind="elapsed"
            format="yearDate"
          />
        </p>
      </>,
      TOKYO_JA,
    );

    await expect.element(page.getByText('(3日前)')).toBeInTheDocument();
    const [recent, old] = container.querySelectorAll('p');
    expect(recent).toHaveTextContent('1月15日(3日前)');
    expect(old?.textContent).toBe('2025年12月16日');
  });

  test('マウントの後、1分ごとに現在時刻へ合わせて相対表現を更新する', async () => {
    useClockAt(new Date(KICKOFF.getTime() - HOUR_MS - MINUTE_MS));

    await renderWithBrowserDisplay(
      <RelativeTime target={KICKOFF} kind="remaining" format="time" />,
      TOKYO_JA,
    );

    await expect.element(page.getByText('(あと1時間)')).toBeInTheDocument();
    await actInTestEnvironment(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE_MS);
    });
    await expect.element(page.getByText('(あと1時間)')).toBeInTheDocument();
    await actInTestEnvironment(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE_MS);
    });
    await expect.element(page.getByText('(あと59分)')).toBeInTheDocument();
    await actInTestEnvironment(async () => {
      await vi.advanceTimersByTimeAsync(59 * MINUTE_MS);
    });
    await expect.element(page.getByText('(期限切れ)')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('いくつ並べても更新のタイマーは1つで、すべてアンマウントするとタイマーを止める', async () => {
    useClockAt(new Date(KICKOFF.getTime() - 3 * HOUR_MS));

    const { unmount } = await renderWithBrowserDisplay(
      <>
        <RelativeTime target={KICKOFF} kind="remaining" format="time" />
        <RelativeTime target={KICKOFF} kind="remaining" format="date" />
        <RelativeTime target={KICKOFF} kind="elapsed" format="date" />
      </>,
      TOKYO_JA,
    );

    expect(vi.getTimerCount()).toBe(1);
    await unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('サーバー側の描画とハイドレーションの間は相対表現を出さず、マウントの後に併記し、不一致の警告を出さない', async () => {
    useClockAt(new Date(KICKOFF.getTime() - 3 * HOUR_MS));
    await emulateBrowserDisplay(LOS_ANGELES_JA);

    const hydrated = await hydrateServerMarkup(
      <DisplayPreferencesProvider initial={serverValueOf(TOKYO_JA)}>
        <RelativeTime target={KICKOFF} kind="remaining" format="dateTime" />
      </DisplayPreferencesProvider>,
    );

    expect(hydrated.serverHtml).toContain('1月15日(木) 16:40');
    expect(hydrated.serverHtml).not.toContain('あと');
    expect(hydrated.container).toHaveTextContent(
      '1月14日(水) 23:40(あと3時間)',
    );
    expect(hydrated.recoverableErrors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('NumberText', () => {
  test.each([
    [TOKYO_JA, '1,234,567.5'],
    [BERLIN_DE, '1.234.567,5'],
  ])(
    '%oのロケールに従って3桁区切りと小数点を整形する',
    async (preferences, expected) => {
      await renderWithBrowserDisplay(
        <NumberText value={1234567.5} />,
        preferences,
      );

      await expect.element(page.getByText(expected)).toBeInTheDocument();
    },
  );

  test('整形の指定を受け付ける', async () => {
    await renderWithBrowserDisplay(
      <NumberText
        value={0.256}
        options={{ style: 'percent', maximumFractionDigits: 1 }}
      />,
      TOKYO_JA,
    );

    await expect.element(page.getByText('25.6%')).toBeInTheDocument();
  });
});
