import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { buttonBehindDialog } from '../../../test/moderation-render.tsx';
import {
  ACTIVE_USER_NODE,
  changedResult,
  MODERATION_DISPLAY,
  MODERATION_REASON,
  MODERATION_ROLES,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import {
  PUBLIC_AVATAR_USER_NODE,
  SUSPENDED_USER_NODE,
  UNRECORDED_SUSPENDED_USER_NODE,
  type UserNode,
  USER_NODES,
  usersQueryOf,
  userTransitionVariablesOf,
} from '../../../test/moderation-users-fixtures.tsx';
import {
  actionButton,
  actionNames,
  cellTexts,
  dialog,
  filterForm,
  listHeading,
  main,
  reasonBox,
  rowOf,
  table,
  usersPageHarness,
} from '../../../test/moderation-users-page.ts';
import { loadAdminModerationUsersPage } from '../../graphql/admin-moderation-users.ts';
import {
  AdminQuarantineImageDocument,
  AdminSuspendUserDocument,
  AdminUnsuspendUserDocument,
} from '../../graphql/generated/graphql.ts';
import { Route as UsersRoute } from '../../routes/_authenticated/users/index.tsx';
import {
  toUserModerationSearch,
  userModerationListArgsOf,
} from '../moderation/shared/moderation-search.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith, lastVariables } = usersPageHarness(executeGraphQL);

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

const SUSPEND_DESCRIPTION =
  'この利用者のプロフィール・プロダクト・コメント・評価は他の利用者に表示されなくなり、未開始のマッチ予定は取り消されます(停止を解除しても戻りません)。利用者へ停止の通知を送ります。';

const UNSUSPEND_DESCRIPTION =
  'この利用者のプロフィール・プロダクト・コメント・評価の表示を再開します。停止の時に取り消したマッチ予定は戻らず、他の理由で隔離された画像は公開に戻りません。利用者へ通知は送りません。';

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証・loaderの依存・読み込みの関数を使う', () => {
  const search = toUserModerationSearch({ handle: 'maker', after: 'cursor-2' });

  expect(UsersRoute.options.validateSearch).toBe(toUserModerationSearch);
  expect(UsersRoute.options.loader).toBe(loadAdminModerationUsersPage);
  expect(
    (UsersRoute.options.loaderDeps as (input: { search: unknown }) => unknown)({
      search,
    }),
  ).toStrictEqual(userModerationListArgsOf(search));
});

describe('ユーザーの一覧', () => {
  test('条件を付けずに1ページ目の50件を求め、題名と説明、画像・ニックネーム・ハンドル・登録日時・使い捨て判定・状態・操作の列をAPIの順に示し、メールアドレスを示さない', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('ユーザー');
    await expect
      .element(
        main().getByText(
          '退会していない利用者を、登録日時の新しい順に表示します。',
        ),
      )
      .toBeVisible();
    expect(lastVariables()).toStrictEqual({ filter: {}, first: 50 });
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([
      '画像',
      'ニックネーム',
      'ハンドル',
      '登録日時',
      '使い捨て判定',
      '状態',
      '操作',
    ]);
    expect(
      table()
        .getByRole('row')
        .elements()
        .slice(1)
        .map((row) => row.querySelectorAll('td')[1]?.textContent),
    ).toStrictEqual(USER_NODES.map((node) => node.nickname));
    expect(cellTexts(ACTIVE_USER_NODE.nickname).slice(1, 6)).toStrictEqual([
      'サンプル太郎',
      '@maker_ai',
      '2026年10月1日(木) 09:00',
      '通常',
      '利用中',
    ]);
    await expect
      .element(
        rowOf(ACTIVE_USER_NODE.nickname).getByText('2026年10月1日(木) 09:00'),
      )
      .toHaveAttribute('datetime', ACTIVE_USER_NODE.registeredAt);
    expect(cellTexts(PUBLIC_AVATAR_USER_NODE.nickname)[4]).toBe('使い捨て');
    expect(cellTexts(SUSPENDED_USER_NODE.nickname)[4]).toBe('未確認');
    expect(cellTexts(UNRECORDED_SUSPENDED_USER_NODE.nickname)[4]).toBe(
      '判定できず',
    );
    expect(table().element().textContent).not.toMatch(/@[^@\s]+\.example/u);
  });

  test('プロフィール画像は同一オリジンの中継から表示し、隔離中なら「隔離中」の印を添え、登録の無い利用者はニックネームから作るアイコンを示す', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    const imageOf = (node: UserNode) =>
      rowOf(node.nickname).element().querySelector('td img');
    expect(imageOf(PUBLIC_AVATAR_USER_NODE)?.getAttribute('src')).toBe(
      PUBLIC_AVATAR_USER_NODE.avatar?.path,
    );
    expect(cellTexts(PUBLIC_AVATAR_USER_NODE.nickname)[0]).toBe('');
    await expect
      .element(rowOf(SUSPENDED_USER_NODE.nickname).getByText('隔離中'))
      .toBeVisible();
    expect(imageOf(ACTIVE_USER_NODE)).toBeNull();
    expect(
      rowOf(ACTIVE_USER_NODE.nickname)
        .element()
        .querySelector('td [data-slot="media-placeholder"]'),
    ).not.toBeNull();
  });

  test('停止中の利用者には停止日時と最新の停止の理由を添え、措置の記録が無ければ理由を「記録なし」と示す', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    expect(cellTexts(SUSPENDED_USER_NODE.nickname)[5]).toBe(
      `停止中停止日時2026年11月12日(木) 12:00理由${MODERATION_REASON}`,
    );
    await expect
      .element(
        rowOf(SUSPENDED_USER_NODE.nickname).getByText(
          '2026年11月12日(木) 12:00',
        ),
      )
      .toHaveAttribute('datetime', SUSPENDED_USER_NODE.suspendedAt);
    expect(cellTexts(UNRECORDED_SUSPENDED_USER_NODE.nickname)[5]).toBe(
      '停止中停止日時2023年5月1日(月) 09:00理由記録なし',
    );
  });

  test('該当する利用者がいなければ一覧の位置にその旨を示す', async () => {
    await renderWith({ users: () => success(usersQueryOf([])) });

    await expect
      .element(main().getByText('条件に一致するユーザーはいません。'))
      .toBeVisible();
    expect(table().query()).toBeNull();
    await expect.element(filterForm()).toBeVisible();
  });

  test('取得の失敗は一覧の位置に文言と再試行の操作で示し、問い合わせの導線を出さず、再試行で一覧の見出しへフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith({
      users: () =>
        available
          ? success(usersQueryOf(USER_NODES))
          : failure({
              code: 'internal_error',
              message: '処理中に問題が発生しました。',
              status: 500,
            }),
    });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    expect(
      main()
        .getByRole('link', { name: /問い合わせ/u })
        .query(),
    ).toBeNull();
    await expect.element(filterForm()).toBeVisible();
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(table()).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });
});

describe('措置の操作', () => {
  test('閲覧のみの管理者には停止・停止解除・プロフィール画像の隔離を出さない', async () => {
    await renderWith({ role: 'VIEWER' });
    await expect.element(table()).toBeVisible();

    expect(actionNames()).toStrictEqual([]);
  });

  test.each(MODERATION_ROLES)(
    '%sには、利用中の行に「停止」、停止中の行に「停止解除」、公開中のプロフィール画像がある行に「プロフィール画像を隔離」を、対象のニックネームを含む名前で置く',
    async (role) => {
      await renderWith({ role });
      await expect.element(table()).toBeVisible();

      // 最上位管理者だけに置く代理の退会はusers-page-withdrawal.browser.test.tsxが確かめる
      expect(
        actionNames().filter((name) => !name?.endsWith('の代理の退会')),
      ).toStrictEqual([
        '「サンプル太郎」を停止',
        '「サンプル花子」を停止',
        '「サンプル花子」のプロフィール画像を隔離',
        '「サンプル次郎」の停止解除',
        '「サンプル三郎」の停止解除',
      ]);
      await expect
        .element(actionButton('「サンプル太郎」を停止'))
        .toHaveTextContent('停止');
      await expect
        .element(actionButton('「サンプル花子」のプロフィール画像を隔離'))
        .toHaveTextContent('プロフィール画像を隔離');
    },
  );

  test('停止の確認に影響を説明の文で示し、理由を付けて確定すると停止して知らせ、一覧を新しい状態に取り直して一覧の見出しへフォーカスを移す', async () => {
    let suspended = false;
    await renderWith({
      role: 'MODERATOR',
      users: () =>
        success(
          usersQueryOf([
            suspended
              ? {
                  ...ACTIVE_USER_NODE,
                  status: 'SUSPENDED',
                  suspendedAt: '2026-11-20T01:00:00.000Z',
                  latestSuspension: {
                    reason: MODERATION_REASON,
                    occurredAt: '2026-11-20T01:00:00.000Z',
                  },
                }
              : ACTIVE_USER_NODE,
          ]),
        ),
      handlers: new Map([
        [
          AdminSuspendUserDocument,
          () => {
            suspended = true;
            return changedResult('suspendUser', true);
          },
        ],
      ]),
    });
    await userEvent.click(actionButton('「サンプル太郎」を停止'));

    await expect
      .element(
        page.getByRole('dialog', {
          name: 'ユーザー「サンプル太郎」を停止しますか?',
        }),
      )
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(SUSPEND_DESCRIPTION);
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
    await reasonBox().fill(MODERATION_REASON);
    await dialog().getByRole('button', { name: '停止する' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      userTransitionVariablesOf(executeGraphQL, AdminSuspendUserDocument),
    ).toStrictEqual([{ id: ACTIVE_USER_NODE.id, reason: MODERATION_REASON }]);
    await expect
      .element(page.getByText('ユーザーを停止しました。'))
      .toBeVisible();
    await expect
      .element(actionButton('「サンプル太郎」の停止解除'))
      .toBeVisible();
    expect(cellTexts(ACTIVE_USER_NODE.nickname)[5]).toContain('停止中');
    await expect.element(listHeading()).toHaveFocus();
  });

  test('停止解除の確認に影響を説明の文で示し、既に利用中だった時は状態が変わらなかった旨を知らせる', async () => {
    await renderWith({
      role: 'SUPER_ADMIN',
      handlers: new Map([
        [
          AdminUnsuspendUserDocument,
          () => changedResult('unsuspendUser', false),
        ],
      ]),
    });
    await userEvent.click(actionButton('「サンプル次郎」の停止解除'));

    await expect
      .element(
        page.getByRole('dialog', {
          name: 'ユーザー「サンプル次郎」の停止を解除しますか?',
        }),
      )
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(UNSUSPEND_DESCRIPTION);
    await reasonBox().fill('誤った停止だったため');
    await dialog().getByRole('button', { name: '停止を解除する' }).click();

    await expect.element(page.getByText('既に利用中です。')).toBeVisible();
    expect(
      userTransitionVariablesOf(executeGraphQL, AdminUnsuspendUserDocument),
    ).toStrictEqual([
      { id: SUSPENDED_USER_NODE.id, reason: '誤った停止だったため' },
    ]);
  });

  test('確定の失敗はダイアログの中に示し、入力した理由を保つ', async () => {
    await renderWith({
      role: 'MODERATOR',
      handlers: new Map([
        [
          AdminSuspendUserDocument,
          () =>
            failure({
              code: 'account_state_conflict',
              message:
                '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
              status: 409,
            }),
        ],
      ]),
    });
    await userEvent.click(actionButton('「サンプル太郎」を停止'));
    await reasonBox().fill(MODERATION_REASON);
    await dialog().getByRole('button', { name: '停止する' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(
        '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
      );
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);
  });

  test('確定の時点で利用者が見つからないと、一覧を取り直して行が消えても、ダイアログの中に文言を示して理由を保ち、閉じると一覧の見出しへフォーカスを移す', async () => {
    let missing = false;
    await renderWith({
      role: 'MODERATOR',
      users: () =>
        success(
          usersQueryOf(
            missing
              ? USER_NODES.filter((node) => node.id !== ACTIVE_USER_NODE.id)
              : USER_NODES,
          ),
        ),
      handlers: new Map([
        [
          AdminSuspendUserDocument,
          () => {
            missing = true;
            return failure({
              code: 'user_not_found',
              message: '利用者が見つかりません。',
              status: 404,
            });
          },
        ],
      ]),
    });
    await userEvent.click(actionButton('「サンプル太郎」を停止'));
    await reasonBox().fill(MODERATION_REASON);
    await dialog().getByRole('button', { name: '停止する' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('利用者が見つかりません。');
    await expect
      .element(buttonBehindDialog('「サンプル太郎」を停止'))
      .not.toBeInTheDocument();
    await expect
      .element(buttonBehindDialog('「サンプル花子」を停止'))
      .toBeInTheDocument();
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('取り消すと停止せずに閉じ、押した「停止」へフォーカスを戻す', async () => {
    await renderWith({ role: 'MODERATOR' });
    await userEvent.click(actionButton('「サンプル太郎」を停止'));
    await expect.element(dialog()).toBeVisible();

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(actionButton('「サンプル太郎」を停止')).toHaveFocus();
    expect(
      userTransitionVariablesOf(executeGraphQL, AdminSuspendUserDocument),
    ).toStrictEqual([]);
  });

  test('「プロフィール画像を隔離」で画像の隔離の確認を開き、理由が無くても確定できる', async () => {
    await renderWith({
      role: 'MODERATOR',
      handlers: new Map([
        [
          AdminQuarantineImageDocument,
          () => changedResult('quarantineImage', true),
        ],
      ]),
    });
    await userEvent.click(
      actionButton('「サンプル花子」のプロフィール画像を隔離'),
    );

    await expect
      .element(page.getByRole('dialog', { name: 'この画像を隔離しますか?' }))
      .toBeVisible();
    await dialog().getByRole('button', { name: '隔離する' }).click();

    await expect.element(page.getByText('画像を隔離しました。')).toBeVisible();
    expect(variablesOf(executeGraphQL, AdminQuarantineImageDocument)).toEqual([
      { fileId: PUBLIC_AVATAR_USER_NODE.avatar?.id, reason: '' },
    ]);
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・措置の操作・停止中の理由・隔離中の印がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ role: 'SUPER_ADMIN' });
      await expect.element(table()).toBeVisible();
      await expect
        .element(actionButton('「サンプル太郎」を停止'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('停止の確認のダイアログがWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderWith({ role: 'MODERATOR' });
    await userEvent.click(actionButton('「サンプル太郎」を停止'));
    await expect.element(dialog()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
