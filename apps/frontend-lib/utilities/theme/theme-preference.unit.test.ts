import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import {
  readThemePreference,
  setThemePreference,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  type ThemeRoot,
} from './theme-preference.ts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

interface FakeRoot extends ThemeRoot {
  readonly classes: ReadonlySet<string>;
  readonly style: { colorScheme: string };
}

const createRoot = (initialClasses: readonly string[] = []): FakeRoot => {
  const classes = new Set(initialClasses);
  return {
    classes,
    classList: {
      contains: (token) => classes.has(token),
      toggle: (token, force) => {
        const enabled = force ?? !classes.has(token);
        if (enabled) {
          classes.add(token);
        } else {
          classes.delete(token);
        }
        return enabled;
      },
    },
    style: { colorScheme: '' },
  };
};

const runBootstrap = (environment: {
  readonly stored?: string | null;
  readonly storageThrows?: boolean;
  readonly prefersDark?: boolean;
  readonly matchMediaThrows?: boolean;
}): FakeRoot => {
  const root = createRoot();
  const readKeys: string[] = [];
  runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
    document: { documentElement: root },
    localStorage: {
      getItem: (key: string) => {
        readKeys.push(key);
        if (environment.storageThrows === true) {
          throw new Error('SecurityError');
        }
        return environment.stored ?? null;
      },
    },
    matchMedia: (query: string) => {
      if (environment.matchMediaThrows === true) {
        throw new Error('matchMediaを使えない');
      }
      return {
        matches: query === DARK_QUERY && environment.prefersDark === true,
      };
    },
  });
  if (environment.storageThrows !== true) {
    expect(readKeys).toEqual([THEME_STORAGE_KEY]);
  }
  return root;
};

const expectTheme = (root: FakeRoot, theme: 'light' | 'dark'): void => {
  expect(root.classes.has('dark')).toBe(theme === 'dark');
  expect(root.style.colorScheme).toBe(theme);
};

describe('THEME_STORAGE_KEY', () => {
  test('モックアップと同じ保存キーを使う', () => {
    expect(THEME_STORAGE_KEY).toBe('ls-theme');
  });
});

describe('THEME_BOOTSTRAP_SCRIPT', () => {
  describe('保存値がある', () => {
    test('OSがライトでも保存値のダークを文書の要素へ設定する', () => {
      expectTheme(runBootstrap({ stored: 'dark', prefersDark: false }), 'dark');
    });

    test('OSがダークでも保存値のライトを文書の要素へ設定する', () => {
      expectTheme(
        runBootstrap({ stored: 'light', prefersDark: true }),
        'light',
      );
    });
  });

  describe('保存値が無い', () => {
    test('OSの配色の設定がダークならダークを設定する', () => {
      expectTheme(runBootstrap({ stored: null, prefersDark: true }), 'dark');
    });

    test('OSの配色の設定がライトならライトを設定する', () => {
      expectTheme(runBootstrap({ stored: null, prefersDark: false }), 'light');
    });

    test('配色として解釈できない保存値はOSの配色の設定に従う', () => {
      expectTheme(runBootstrap({ stored: 'sepia', prefersDark: true }), 'dark');
      expectTheme(runBootstrap({ stored: '', prefersDark: false }), 'light');
    });
  });

  describe('ブラウザの機能を使えない', () => {
    test('保存先の読み取りが例外を投げてもOSの配色の設定に従い、例外を外へ出さない', () => {
      expectTheme(
        runBootstrap({ storageThrows: true, prefersDark: true }),
        'dark',
      );
    });

    test('OSの配色の設定を読めなければライトにする', () => {
      expectTheme(
        runBootstrap({ stored: null, matchMediaThrows: true }),
        'light',
      );
    });
  });

  test('インラインスクリプトとしてheadに埋め込んでも要素を閉じない', () => {
    expect(THEME_BOOTSTRAP_SCRIPT.toLowerCase()).not.toContain('</script');
  });
});

describe('readThemePreference', () => {
  test('文書の要素にdarkクラスがあればダークを返す', () => {
    expect(readThemePreference(createRoot(['dark']))).toBe('dark');
  });

  test('文書の要素にdarkクラスが無ければライトを返す', () => {
    expect(readThemePreference(createRoot())).toBe('light');
  });
});

describe('setThemePreference', () => {
  const createStorage = () => {
    const saved = new Map<string, string>();
    return {
      saved,
      storage: {
        setItem: (key: string, value: string) => {
          saved.set(key, value);
        },
      },
    };
  };

  test('ダークを選ぶと文書の要素へ配色を設定し、選択を保存する', () => {
    const root = createRoot();
    const { saved, storage } = createStorage();

    setThemePreference(root, storage, 'dark');

    expectTheme(root, 'dark');
    expect(saved.get(THEME_STORAGE_KEY)).toBe('dark');
  });

  test('ライトを選ぶとdarkクラスを外し、選択を保存する', () => {
    const root = createRoot(['dark', 'antialiased']);
    const { saved, storage } = createStorage();

    setThemePreference(root, storage, 'light');

    expectTheme(root, 'light');
    expect(root.classes.has('antialiased')).toBe(true);
    expect(saved.get(THEME_STORAGE_KEY)).toBe('light');
  });

  test('保存に失敗しても表示を切り替え、例外を外へ出さない', () => {
    const root = createRoot();
    const failingStorage = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };

    expect(() => {
      setThemePreference(root, failingStorage, 'dark');
    }).not.toThrow();
    expectTheme(root, 'dark');
  });

  test('保存先が無くても表示を切り替える', () => {
    const root = createRoot(['dark']);

    setThemePreference(root, undefined, 'light');

    expectTheme(root, 'light');
  });
});
