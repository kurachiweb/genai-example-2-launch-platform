import { describe, expect, test } from 'bun:test';

import {
  installPreloadRecovery,
  PRELOAD_ERROR_EVENT,
  PRELOAD_RECOVERY_STORAGE_KEY,
} from './preload-recovery.ts';

interface FakeStorage {
  readonly items: Map<string, string>;
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

const createStorage = (
  options: { readonly getThrows?: boolean; readonly setThrows?: boolean } = {},
): FakeStorage => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => {
      if (options.getThrows === true) {
        throw new Error('SecurityError');
      }
      return items.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (options.setThrows === true) {
        throw new Error('QuotaExceededError');
      }
      items.set(key, value);
    },
  };
};

interface PageHarness {
  readonly target: EventTarget;
  readonly reloads: () => number;
  readonly uninstall: () => void;
  readonly firePreloadError: () => Promise<Event>;
}

const openPage = (storage: FakeStorage | undefined): PageHarness => {
  const target = new EventTarget();
  let reloadCount = 0;
  const uninstall = installPreloadRecovery({
    target,
    storage,
    reload: () => {
      reloadCount += 1;
    },
  });
  return {
    target,
    reloads: () => reloadCount,
    uninstall,
    // 判定は通知の全ての聞き手が終わった後に行われるため、通知の後の処理まで待つ
    firePreloadError: async () => {
      const event = new Event(PRELOAD_ERROR_EVENT, { cancelable: true });
      target.dispatchEvent(event);
      await Promise.resolve();
      return event;
    },
  };
};

describe('installPreloadRecovery', () => {
  test('印の保存先のキーは設計の値である', () => {
    expect(PRELOAD_RECOVERY_STORAGE_KEY).toBe('ls-preload-reloaded');
  });

  test('Viteの読み込みの失敗の通知を受け取る', () => {
    expect(PRELOAD_ERROR_EVENT).toBe('vite:preloadError');
  });

  test('印が無ければ印を付けて1回だけ再読み込みする', async () => {
    const storage = createStorage();
    const page = openPage(storage);

    await page.firePreloadError();

    expect(page.reloads()).toBe(1);
    expect(storage.items.has(PRELOAD_RECOVERY_STORAGE_KEY)).toBe(true);
  });

  test('印があれば再読み込みせず、印も書き換えない', async () => {
    const storage = createStorage();
    storage.items.set(PRELOAD_RECOVERY_STORAGE_KEY, '既存の印');
    const page = openPage(storage);

    await page.firePreloadError();

    expect(page.reloads()).toBe(0);
    expect(storage.items.get(PRELOAD_RECOVERY_STORAGE_KEY)).toBe('既存の印');
  });

  test('同じページで失敗が続いても再読み込みは1回だけ', async () => {
    const page = openPage(createStorage());

    await page.firePreloadError();
    await page.firePreloadError();
    await page.firePreloadError();

    expect(page.reloads()).toBe(1);
  });

  test('再読み込みした後のページで再び失敗しても、続けて再読み込みしない', async () => {
    const storage = createStorage();
    const before = openPage(storage);
    await before.firePreloadError();

    const after = openPage(storage);
    await after.firePreloadError();

    expect(before.reloads()).toBe(1);
    expect(after.reloads()).toBe(0);
  });

  test('読み込みの失敗を取り消さず、画面のエラーの処理へそのまま伝える', async () => {
    const page = openPage(createStorage());

    const event = await page.firePreloadError();

    expect(event.defaultPrevented).toBe(false);
  });

  test('先に受けた処理が既定の動作を止めた通知では、再読み込みせず印も書かない', async () => {
    const storage = createStorage();
    const page = openPage(storage);
    page.target.addEventListener(
      PRELOAD_ERROR_EVENT,
      (event) => {
        event.preventDefault();
      },
      { capture: true },
    );

    await page.firePreloadError();

    expect(page.reloads()).toBe(0);
    expect(storage.items.has(PRELOAD_RECOVERY_STORAGE_KEY)).toBe(false);
  });

  test('後から加えた聞き手が通知の中で既定の動作を止めても、再読み込みせず印も書かない', async () => {
    const storage = createStorage();
    const page = openPage(storage);
    page.target.addEventListener(PRELOAD_ERROR_EVENT, (event) => {
      event.preventDefault();
    });

    await page.firePreloadError();

    expect(page.reloads()).toBe(0);
    expect(storage.items.has(PRELOAD_RECOVERY_STORAGE_KEY)).toBe(false);
  });

  test('既定の動作を止めた通知の後でも、止められていない通知では1回だけ再読み込みする', async () => {
    const storage = createStorage();
    const page = openPage(storage);
    const prevent = (event: Event): void => {
      event.preventDefault();
    };
    page.target.addEventListener(PRELOAD_ERROR_EVENT, prevent, {
      capture: true,
    });
    await page.firePreloadError();
    page.target.removeEventListener(PRELOAD_ERROR_EVENT, prevent, {
      capture: true,
    });

    await page.firePreloadError();
    await page.firePreloadError();

    expect(page.reloads()).toBe(1);
    expect(storage.items.has(PRELOAD_RECOVERY_STORAGE_KEY)).toBe(true);
  });

  test('保存先が無ければ再読み込みの繰り返しを防げないため、再読み込みしない', async () => {
    const page = openPage(undefined);

    await page.firePreloadError();

    expect(page.reloads()).toBe(0);
  });

  test.each([
    ['読み取り', { getThrows: true }],
    ['書き込み', { setThrows: true }],
  ])(
    '保存先の%sが例外を投げたら再読み込みせず、例外を伝えない',
    async (_label, options) => {
      const storage = createStorage(options);
      const page = openPage(storage);

      const event = await page.firePreloadError();

      expect(event.type).toBe(PRELOAD_ERROR_EVENT);
      expect(page.reloads()).toBe(0);
      expect(storage.items.size).toBe(0);
    },
  );

  test('他のイベントでは再読み込みしない', () => {
    const page = openPage(createStorage());

    page.target.dispatchEvent(new Event('error'));

    expect(page.reloads()).toBe(0);
  });

  test('解除の関数を呼んだ後は通知を受け取らない', async () => {
    const storage = createStorage();
    const page = openPage(storage);

    page.uninstall();
    await page.firePreloadError();

    expect(page.reloads()).toBe(0);
    expect(storage.items.size).toBe(0);
  });
});
