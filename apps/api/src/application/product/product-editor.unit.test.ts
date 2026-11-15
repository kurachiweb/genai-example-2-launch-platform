import { describe, expect, test } from 'bun:test';

import {
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../../../common-lib/product/product-input-rules.ts';
import {
  day,
  FINISHED_LAUNCH,
  FIRST_SCREENSHOT_ID,
  generatedIdOf,
  inputOf,
  LAUNCH_ID,
  LOCKED,
  LOCKS_UNKNOWN,
  NEW_LOGO_FILE_ID,
  NEW_PLAN,
  NEW_SCREENSHOT_FILE_ID,
  OTHER_CATEGORY_ID,
  PRODUCT_ID,
  rejectionOf,
  RESCHEDULE_PLAN,
  SECOND_SCREENSHOT_ID,
  setupEditor,
  stateWith,
} from './testing/product-editor-fixtures.ts';
import {
  currentUserOf,
  LOGO_FILE_ID,
  PRODUCT_NOW,
  USER_ID,
} from './testing/product-fakes.ts';

const RESERVATION_HIDDEN_MESSAGE =
  'このプロダクトは公開が停止されているため、ローンチを予約できません。';

describe('ProductEditor.update', () => {
  test('版→状態の判定→計画→固定→ローンチ日→ハンドル→画像→保存→以前の画像の削除の順に進め、保存したプロダクトを状態付きで返す', async () => {
    const { editor, store, calls, requests, erased, markedDeleted, claims } =
      setupEditor();

    const view = await editor.update(
      currentUserOf(),
      inputOf({
        name: '新しいローンチ計測',
        categoryId: OTHER_CATEGORY_ID,
        handle: 'launch-gauge',
        logoFileId: NEW_LOGO_FILE_ID,
        screenshotFileIds: [NEW_SCREENSHOT_FILE_ID, SECOND_SCREENSHOT_ID],
        launchDate: day('2026-10-24'),
      }),
    );

    expect(calls).toEqual([
      'store.findForOwner',
      'evaluator.evaluate',
      'store.isHandleOccupied',
      `media.claim:${PRODUCT_LOGO_PURPOSE}`,
      `media.claim:${PRODUCT_SCREENSHOT_PURPOSE}`,
      'media.findMany',
      'store.save',
      'media.eraseNow',
      'media.markDeleted',
      'store.findForOwner',
      'evaluator.evaluate',
    ]);
    expect(requests[0]).toEqual({
      ownerUserId: USER_ID,
      products: [
        { productId: PRODUCT_ID, hidden: false, launches: [FINISHED_LAUNCH] },
      ],
      at: PRODUCT_NOW,
    });
    expect(store.occupiedChecks).toEqual([
      { handle: 'launch-gauge', exceptProductId: PRODUCT_ID },
    ]);
    expect(claims).toEqual([
      {
        fileIds: [NEW_LOGO_FILE_ID],
        purpose: PRODUCT_LOGO_PURPOSE,
        owner: { kind: 'user', id: USER_ID },
      },
      {
        fileIds: [NEW_SCREENSHOT_FILE_ID],
        purpose: PRODUCT_SCREENSHOT_PURPOSE,
        owner: { kind: 'user', id: USER_ID },
      },
    ]);
    expect(store.saves).toEqual([
      {
        productId: PRODUCT_ID,
        expectedVersion: 3,
        fields: {
          name: '新しいローンチ計測',
          tagline: '公開の反応をまとめて見る',
          categoryId: OTHER_CATEGORY_ID,
          handle: 'launch-gauge',
          websiteUrl: 'https://launch-meter.example/',
          descriptionMarkdown: '# 概要',
          logoFileId: NEW_LOGO_FILE_ID,
          screenshotFileIds: [NEW_SCREENSHOT_FILE_ID, SECOND_SCREENSHOT_ID],
        },
        plan: {
          handle: {
            kind: 'changed',
            next: 'launch-gauge',
            previous: 'launch-meter',
          },
          logo: {
            kind: 'replace',
            fileId: NEW_LOGO_FILE_ID,
            replaced: LOGO_FILE_ID,
          },
          screenshots: {
            added: [NEW_SCREENSHOT_FILE_ID],
            removed: [FIRST_SCREENSHOT_ID],
            order: [NEW_SCREENSHOT_FILE_ID, SECOND_SCREENSHOT_ID],
          },
          categoryChanged: true,
          launch: { kind: 'reserve', date: day('2026-10-24') },
        },
        previousHandleId: generatedIdOf(1),
        newLaunchId: generatedIdOf(2),
        screenshotIds: [generatedIdOf(3), generatedIdOf(4)],
        now: PRODUCT_NOW,
      },
    ]);
    expect(erased).toEqual([[LOGO_FILE_ID]]);
    expect(markedDeleted).toEqual([[FIRST_SCREENSHOT_ID]]);
    expect(view).toMatchObject({
      productId: PRODUCT_ID,
      handle: 'launch-gauge',
      previousHandle: 'launch-meter',
      name: '新しいローンチ計測',
      logoFileId: NEW_LOGO_FILE_ID,
      version: 4,
      listed: true,
    });
    expect(view.state).toEqual(stateWith(NEW_PLAN));
    expect(view).not.toHaveProperty('ownerUserId');
    expect(view).not.toHaveProperty('launches');
  });

  test('現在のハンドルで本人のプロダクトが見つからなければ、product_not_foundで拒否し判定もしない', async () => {
    const { editor, calls } = setupEditor({ store: { snapshots: [] } });

    const error = await rejectionOf(editor.update(currentUserOf(), inputOf()));

    expect(error.code).toBe('product_not_found');
    expect(error.kind).toBe('not_found');
    expect(calls).toEqual(['store.findForOwner']);
  });

  test('画面を開いた後に版が変わっていれば、product_update_conflictで拒否し判定もしない', async () => {
    const { editor, calls } = setupEditor();

    const error = await rejectionOf(
      editor.update(currentUserOf(), inputOf({ expectedVersion: 2 })),
    );

    expect(error.code).toBe('product_update_conflict');
    expect(calls).toEqual(['store.findForOwner']);
  });
});

describe('ProductEditor.updateの次回の予約とローンチ日の変更', () => {
  test.each([
    [
      'launch_scheduled',
      'このプロダクトはローンチ予定があるため再ローンチできません。',
    ],
    [
      'qualifier_in_progress',
      'このプロダクトは予選マッチに参加中のため再ローンチできません。',
    ],
  ] as const)(
    '禁止の理由%sの間に日を選ぶと、最初の理由の文言のrelaunch_blockedで拒否し保存しない',
    async (code, message) => {
      const { editor, store } = setupEditor({
        state: stateWith({
          mode: 'blocked',
          blocks: [
            { code, message, releaseAt: null },
            {
              code: 'week_tournament',
              message: '供給元の理由',
              releaseAt: null,
            },
          ],
        }),
      });

      const error = await rejectionOf(
        editor.update(
          currentUserOf(),
          inputOf({ launchDate: day('2026-10-24') }),
        ),
      );

      expect(error.code).toBe('relaunch_blocked');
      expect(error.kind).toBe('conflict');
      expect(error.message).toBe(message);
      expect(store.saves).toEqual([]);
    },
  );

  test('供給元の禁止の理由の間に日を選ぶと、供給元の文言のrelaunch_blockedで拒否する', async () => {
    const message =
      'このプロダクトはWeekトーナメント参加中のため再ローンチできません。';
    const { editor } = setupEditor({
      state: stateWith({
        mode: 'blocked',
        blocks: [{ code: 'week_tournament', message, releaseAt: null }],
      }),
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ launchDate: day('2026-10-24') }),
      ),
    );

    expect(error.code).toBe('relaunch_blocked');
    expect(error.message).toBe(message);
  });

  test('非公開化中に日を選ぶと、予約の文言のproduct_hiddenで拒否する', async () => {
    const { editor, store } = setupEditor({
      state: stateWith({
        mode: 'blocked',
        blocks: [
          {
            code: 'product_hidden',
            message: RESERVATION_HIDDEN_MESSAGE,
            releaseAt: null,
          },
        ],
      }),
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ launchDate: day('2026-10-24') }),
      ),
    );

    expect(error.code).toBe('product_hidden');
    expect(error.kind).toBe('conflict');
    expect(error.message).toBe(RESERVATION_HIDDEN_MESSAGE);
    expect(store.saves).toEqual([]);
  });

  test('禁止の条件を確認できない間に日を選ぶと、decision_unavailableで拒否する', async () => {
    const { editor, store } = setupEditor({
      state: stateWith({ mode: 'unknown' }),
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ launchDate: day('2026-10-24') }),
      ),
    );

    expect(error.code).toBe('decision_unavailable');
    expect(error.kind).toBe('unavailable');
    expect(store.saves).toEqual([]);
  });

  test('予約が禁止されていても、日を選ばない内容の編集は保存する', async () => {
    const { editor, store } = setupEditor({
      state: stateWith({
        mode: 'blocked',
        blocks: [
          {
            code: 'product_hidden',
            message: RESERVATION_HIDDEN_MESSAGE,
            releaseAt: null,
          },
        ],
      }),
    });

    await editor.update(currentUserOf(), inputOf({ name: '新しい名称' }));

    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]?.plan.launch).toEqual({ kind: 'none' });
  });

  test('予定のローンチの日を変えると、そのローンチの変更として保存する', async () => {
    const { editor, store } = setupEditor({
      state: stateWith(RESCHEDULE_PLAN),
    });

    await editor.update(
      currentUserOf(),
      inputOf({ launchDate: day('2026-11-05') }),
    );

    expect(store.saves[0]?.plan.launch).toEqual({
      kind: 'reschedule',
      launchId: LAUNCH_ID,
      date: day('2026-11-05'),
    });
  });

  test('選べない日は、選べる期間を示すlaunch_date_unavailableで拒否しハンドルも画像も調べない', async () => {
    const { editor, calls, store } = setupEditor();

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({
          handle: 'launch-gauge',
          logoFileId: NEW_LOGO_FILE_ID,
          launchDate: day('2026-10-23'),
        }),
      ),
    );

    expect(error.code).toBe('launch_date_unavailable');
    expect(error.message).toBe(
      'ローンチ日は10月24日〜2027年1月21日の間で選んでください。',
    );
    expect(calls).toEqual(['store.findForOwner', 'evaluator.evaluate']);
    expect(store.saves).toEqual([]);
  });

  test('選べる日が無い状態で日を選ぶと、判定できないものとしてdecision_unavailableで拒否する', async () => {
    const { editor } = setupEditor({
      state: { ...stateWith(NEW_PLAN), window: null },
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ launchDate: day('2026-10-24') }),
      ),
    );

    expect(error.code).toBe('decision_unavailable');
  });
});

describe('ProductEditor.updateのマッチ直前・マッチ中の固定', () => {
  test.each([
    ['カテゴリ', { categoryId: OTHER_CATEGORY_ID }, NEW_PLAN],
    ['ローンチ日', { launchDate: day('2026-11-05') }, RESCHEDULE_PLAN],
  ] as const)(
    '固定の期間に%sを変えると、product_lockedで拒否しローンチ日も調べない',
    async (_, overrides, plan) => {
      const { editor, calls } = setupEditor({ state: stateWith(plan, LOCKED) });

      const error = await rejectionOf(
        editor.update(currentUserOf(), inputOf(overrides)),
      );

      expect(error.code).toBe('product_locked');
      expect(error.message).toBe(
        'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。',
      );
      expect(calls).toEqual(['store.findForOwner', 'evaluator.evaluate']);
    },
  );

  test('固定の判定に失敗した状態でカテゴリを変えると、decision_unavailableで拒否する', async () => {
    const { editor, store } = setupEditor({
      state: stateWith(NEW_PLAN, LOCKS_UNKNOWN),
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ categoryId: OTHER_CATEGORY_ID }),
      ),
    );

    expect(error.code).toBe('decision_unavailable');
    expect(store.saves).toEqual([]);
  });

  test('固定の印があれば、他の供給元の判定に失敗していても固定を優先してproduct_lockedにする', async () => {
    const { editor } = setupEditor({
      state: stateWith(NEW_PLAN, { ...LOCKED, unknown: true }),
    });

    const error = await rejectionOf(
      editor.update(
        currentUserOf(),
        inputOf({ categoryId: OTHER_CATEGORY_ID }),
      ),
    );

    expect(error.code).toBe('product_locked');
  });

  test.each([
    ['固定の期間', LOCKED],
    ['固定の判定に失敗した状態', LOCKS_UNKNOWN],
  ])(
    '%sでも、名称などを変え予定のローンチ日を同じ日で送る保存は通す',
    async (_, locks) => {
      const { editor, store } = setupEditor({
        state: stateWith(RESCHEDULE_PLAN, locks),
      });

      await editor.update(
        currentUserOf(),
        inputOf({
          name: '新しい名称',
          tagline: '新しいタグライン',
          launchDate: day('2026-10-30'),
        }),
      );

      expect(store.saves).toHaveLength(1);
      expect(store.saves[0]?.plan).toMatchObject({
        categoryChanged: false,
        launch: { kind: 'none' },
      });
      expect(store.saves[0]?.fields).toMatchObject({
        name: '新しい名称',
        tagline: '新しいタグライン',
      });
    },
  );
});
