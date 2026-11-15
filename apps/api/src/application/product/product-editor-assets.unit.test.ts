import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import {
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
  PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES,
} from '../../../common-lib/product/product-input-rules.ts';
import type { ProductSaveResult } from './ports.ts';
import {
  DEFAULT_FILES,
  FIRST_SCREENSHOT_ID,
  inputOf,
  NEW_LOGO_FILE_ID,
  NEW_SCREENSHOT_FILE_ID,
  PRODUCT_ID,
  rejectionOf,
  SECOND_SCREENSHOT_ID,
  setupEditor,
  snapshotOf,
} from './testing/product-editor-fixtures.ts';
import {
  currentUserOf,
  imageFileOf,
  LOGO_FILE_ID,
  SCREENSHOT_FILE_IDS,
} from './testing/product-fakes.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const warnings = (): LogRecord[] =>
  records.filter((record) => record.level === 'warning');

const WITH_NEW_SCREENSHOT = [...SCREENSHOT_FILE_IDS, NEW_SCREENSHOT_FILE_ID];

describe('ProductEditor.updateのハンドル', () => {
  test('予約語のハンドルは、使用中の判定をせずhandle_unavailableで拒否する', async () => {
    const { editor, calls } = setupEditor();

    const error = await rejectionOf(
      editor.update(currentUserOf(), inputOf({ handle: 'Admin' })),
    );

    expect(error.code).toBe('handle_unavailable');
    expect(error.details).toEqual([
      {
        field: 'handle',
        code: 'unavailable',
        message:
          'このハンドルは既に使われています。別の文字列を入力してください。',
      },
    ]);
    expect(calls).not.toContain('store.isHandleOccupied');
  });

  test('他のプロダクトの現在のハンドルは、自分を除いて判定しhandle_unavailableで拒否する', async () => {
    const { editor, store } = setupEditor({
      store: { snapshots: [snapshotOf()], occupiedHandles: ['launch-gauge'] },
    });

    const error = await rejectionOf(
      editor.update(currentUserOf(), inputOf({ handle: 'Launch-Gauge' })),
    );

    expect(error.code).toBe('handle_unavailable');
    expect(store.occupiedChecks).toEqual([
      { handle: 'Launch-Gauge', exceptProductId: PRODUCT_ID },
    ]);
    expect(store.saves).toEqual([]);
  });

  test('自分の旧ハンドルへの戻しは、大文字小文字が違っても使用中の判定をせずに保存する', async () => {
    const { editor, store } = setupEditor({
      store: {
        snapshots: [snapshotOf({ previousHandle: 'old-meter' })],
        occupiedHandles: ['old-meter'],
      },
    });

    await editor.update(currentUserOf(), inputOf({ handle: 'Old-Meter' }));

    expect(store.occupiedChecks).toEqual([]);
    expect(store.saves[0]?.plan.handle).toEqual({
      kind: 'changed',
      next: 'Old-Meter',
      previous: 'launch-meter',
    });
  });

  test('大文字小文字の表記だけの変更は、使用中の判定をせずに保存する', async () => {
    const { editor, store } = setupEditor();

    await editor.update(currentUserOf(), inputOf({ handle: 'Launch-Meter' }));

    expect(store.occupiedChecks).toEqual([]);
    expect(store.saves[0]?.plan.handle).toEqual({
      kind: 'case-only',
      next: 'Launch-Meter',
    });
  });
});

describe('ProductEditor.updateの画像', () => {
  test('画像を変えなければ、紐付けも合計の照会もせず以前の画像も削除しない', async () => {
    const { editor, calls } = setupEditor();

    await editor.update(currentUserOf(), inputOf({ name: '新しい名称' }));

    expect(calls).toEqual([
      'store.findForOwner',
      'evaluator.evaluate',
      'store.save',
      'store.findForOwner',
      'evaluator.evaluate',
    ]);
  });

  test('スクリーンショットを取り除くだけなら、紐付けも合計の照会もせず取り除いた画像の削除を依頼する', async () => {
    const { editor, calls, markedDeleted, erased } = setupEditor();

    await editor.update(
      currentUserOf(),
      inputOf({ screenshotFileIds: [SECOND_SCREENSHOT_ID] }),
    );

    expect(calls).not.toContain(`media.claim:${PRODUCT_SCREENSHOT_PURPOSE}`);
    expect(calls).not.toContain('media.findMany');
    expect(markedDeleted).toEqual([[FIRST_SCREENSHOT_ID]]);
    expect(erased).toEqual([]);
  });

  test('新しいロゴを紐付けられなければ、invalid_uploadで拒否し保存しない', async () => {
    const { editor, store } = setupEditor({
      media: {
        files: DEFAULT_FILES,
        claimResults: {
          [PRODUCT_LOGO_PURPOSE]: {
            ok: false,
            failures: [{ fileId: NEW_LOGO_FILE_ID, reason: 'owner_mismatch' }],
          },
        },
      },
    });

    const error = await rejectionOf(
      editor.update(currentUserOf(), inputOf({ logoFileId: NEW_LOGO_FILE_ID })),
    );

    expect(error.code).toBe('invalid_upload');
    expect(store.saves).toEqual([]);
  });

  test('追加したスクリーンショットを紐付けられなければ、invalid_uploadで拒否し保存しない', async () => {
    const { editor, store } = setupEditor({
      media: {
        files: DEFAULT_FILES,
        claimResults: {
          [PRODUCT_SCREENSHOT_PURPOSE]: {
            ok: false,
            failures: [
              { fileId: NEW_SCREENSHOT_FILE_ID, reason: 'not_stored' },
            ],
          },
        },
      },
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ screenshotFileIds: WITH_NEW_SCREENSHOT }),
      ),
    );

    expect(error.code).toBe('invalid_upload');
    expect(store.saves).toEqual([]);
  });

  test('追加した後のスクリーンショットの合計が10MBを超えると、残す画像も含めて数えscreenshot_limit_exceededで拒否する', async () => {
    const { editor, store, lookups } = setupEditor({
      media: {
        files: [
          imageFileOf(FIRST_SCREENSHOT_ID, PRODUCT_SCREENSHOT_PURPOSE, 1),
          imageFileOf(
            SECOND_SCREENSHOT_ID,
            PRODUCT_SCREENSHOT_PURPOSE,
            PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES / 2,
          ),
          imageFileOf(
            NEW_SCREENSHOT_FILE_ID,
            PRODUCT_SCREENSHOT_PURPOSE,
            PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES / 2,
          ),
        ],
      },
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ screenshotFileIds: WITH_NEW_SCREENSHOT }),
      ),
    );

    expect(error.code).toBe('screenshot_limit_exceeded');
    expect(lookups).toEqual([WITH_NEW_SCREENSHOT]);
    expect(store.saves).toEqual([]);
  });

  test('スクリーンショットのファイルを照会できなければ、invalid_uploadで拒否する', async () => {
    const { editor } = setupEditor({
      media: {
        files: [
          imageFileOf(NEW_SCREENSHOT_FILE_ID, PRODUCT_SCREENSHOT_PURPOSE, 1),
        ],
      },
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ screenshotFileIds: WITH_NEW_SCREENSHOT }),
      ),
    );

    expect(error.code).toBe('invalid_upload');
  });

  test('以前のロゴの物理削除に失敗しても保存の結果を変えず、ファイルのIDだけを添えてwarningを記録する', async () => {
    const { editor } = setupEditor({
      media: { files: DEFAULT_FILES, eraseNowError: new Error('保存先の障害') },
    });

    const view = await editor.update(
      currentUserOf(),
      inputOf({ logoFileId: NEW_LOGO_FILE_ID }),
    );

    expect(view.logoFileId).toBe(NEW_LOGO_FILE_ID);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]?.category).toEqual(['api', 'application', 'product']);
    expect(warnings()[0]?.properties).toEqual({ fileId: LOGO_FILE_ID });
  });

  test('取り除いたスクリーンショットの削除の依頼に失敗しても保存の結果を変えず、ファイルのIDだけを添えてwarningを記録する', async () => {
    const { editor, erased } = setupEditor({
      media: {
        files: DEFAULT_FILES,
        markDeletedError: new Error('保存先の障害'),
      },
    });

    const view = await editor.update(
      currentUserOf(),
      inputOf({ logoFileId: NEW_LOGO_FILE_ID, screenshotFileIds: [] }),
    );

    expect(view.screenshotFileIds).toEqual([]);
    expect(erased).toEqual([[LOGO_FILE_ID]]);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]?.properties).toEqual({
      fileIds: [...SCREENSHOT_FILE_IDS],
    });
  });
});

describe('ProductEditor.updateの保存の結果', () => {
  test.each([
    ['conflict', 'product_update_conflict', undefined],
    ['handle-unavailable', 'handle_unavailable', undefined],
    ['locked', 'product_locked', undefined],
    [
      'hidden',
      'product_hidden',
      'このプロダクトは公開が停止されているため、ローンチを予約できません。',
    ],
    ['account-unavailable', 'account_unavailable', undefined],
    ['not-found', 'product_not_found', undefined],
  ] as const satisfies readonly (readonly [
    Exclude<ProductSaveResult, 'saved'>,
    string,
    string | undefined,
  ])[])(
    'ストアが%sを返すと、%sで拒否し以前の画像を削除しない',
    async (result, code, message) => {
      const { editor, calls } = setupEditor({
        store: { snapshots: [snapshotOf()], saveResult: result },
      });

      const error = await rejectionOf(
        editor.update(
          currentUserOf(),
          inputOf({ logoFileId: NEW_LOGO_FILE_ID, screenshotFileIds: [] }),
        ),
      );

      expect(error.code).toBe(code);
      if (message !== undefined) {
        expect(error.message).toBe(message);
      }
      expect(calls).not.toContain('media.eraseNow');
      expect(calls).not.toContain('media.markDeleted');
    },
  );
});
