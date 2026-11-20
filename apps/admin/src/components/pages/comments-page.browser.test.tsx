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
  ANONYMIZED_COMMENT_NODE,
  COMMENT_NODES,
  type CommentNode,
  commentsQueryOf,
  DELETED_COMMENT_NODE,
  HIDDEN_COMMENT_NODE,
  MARKDOWN_EXCERPT,
  SHOWN_COMMENT_NODE,
  UNAVAILABLE_AUTHOR_COMMENT_NODE,
} from '../../../test/moderation-comments-fixtures.tsx';
import {
  actionButton,
  actionNames,
  applyButton,
  cellsOf,
  cellTexts,
  commentsPageHarness,
  dateField,
  dialog,
  filterForm,
  listHeading,
  main,
  reasonBox,
  rowOf,
  table,
  textField,
} from '../../../test/moderation-comments-page.ts';
import {
  changedResult,
  MODERATION_DISPLAY,
  MODERATION_REASON,
  MODERATION_ROLES,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import {
  AdminHideCommentDocument,
  AdminUnhideCommentDocument,
} from '../../graphql/generated/graphql.ts';
import { Route as CommentsRoute } from '../../routes/_authenticated/comments/index.tsx';
import { loadCommentsPage } from '../moderation/comments/load-comments-page.ts';
import { toCommentModerationSearch } from '../moderation/shared/moderation-search.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith, lastVariables } = commentsPageHarness(executeGraphQL);

const HIDE_DESCRIPTION =
  'コメントは「このコメントは削除されました。」の表示に置き換わり、付いている返信はそのまま残ります。投稿者へ通知を送ります。';

const UNHIDE_DESCRIPTION =
  'コメントの表示を再開します。投稿者が削除・退会・停止したコメントと匿名化済みのコメントは、削除された旨の表示のままです。投稿者へ通知は送りません。';

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証・loaderの依存・読み込みの関数を使う', () => {
  const search = toCommentModerationSearch({
    authorHandle: 'maker',
    from: '2026-11-01',
    after: 'cursor-2',
  });

  expect(CommentsRoute.options.validateSearch).toBe(toCommentModerationSearch);
  expect(CommentsRoute.options.loader).toBe(loadCommentsPage);
  expect(
    (
      CommentsRoute.options.loaderDeps as (input: {
        search: unknown;
      }) => unknown
    )({ search }),
  ).toStrictEqual(search);
});

describe('コメントの一覧', () => {
  test('条件を付けずに1ページ目の50件を求め、題名と説明、本文・投稿者・プロダクト・ローンチ・投稿日時・状態・操作の列をAPIの順に示す', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('コメント');
    await expect
      .element(main().getByText('コメントを、投稿日時の新しい順に表示します。'))
      .toBeVisible();
    expect(lastVariables()).toStrictEqual({ filter: {}, first: 50 });
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([
      '本文',
      '投稿者',
      'プロダクト',
      'ローンチ',
      '投稿日時',
      '状態',
      '操作',
    ]);
    expect(
      table()
        .getByRole('row')
        .elements()
        .slice(1)
        .map((row) => row.querySelectorAll('td')[1]?.textContent),
    ).toStrictEqual([
      'サンプル太郎(@maker_ai)',
      'サンプル花子(@pixel_hanako)',
      'サンプル次郎(@spam_jiro)',
      '表示できない利用者',
      'サンプル三郎(@old_saburo)',
    ]);
    expect(cellTexts('サンプル太郎').slice(2, 6)).toStrictEqual([
      'Pitch Notes',
      '第3回',
      '2026年11月10日(火) 10:00',
      '表示中',
    ]);
    await expect
      .element(rowOf('サンプル太郎').getByText('2026年11月10日(火) 10:00'))
      .toHaveAttribute('datetime', SHOWN_COMMENT_NODE.createdAt);
  });

  test('本文の抜粋はマークダウンやHTMLとして解釈せず、改行を保った文字列として示し、空の本文は「本文なし」と示す', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    const [body] = cellsOf('サンプル太郎');
    expect(body?.textContent).toBe(MARKDOWN_EXCERPT);
    expect(body?.querySelector('strong, a, script')).toBeNull();
    const excerpt = body?.firstElementChild;
    expect(
      excerpt == null ? undefined : getComputedStyle(excerpt).whiteSpace,
    ).toBe('pre-wrap');
    expect(ANONYMIZED_COMMENT_NODE.excerpt).toBe('');
    expect(cellTexts('表示できない利用者')[0]).toBe('本文なし');
  });

  test('状態は表示中・管理者が非公開化・投稿者が削除・匿名化済み・投稿者が退会・停止中を区別し、非公開化したコメントには非公開化した日時と最新の理由を添える', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    const stateOf = (node: CommentNode) =>
      cellTexts(node.author?.nickname ?? '表示できない利用者')[5];
    expect(COMMENT_NODES.map(stateOf)).toStrictEqual([
      '表示中',
      `管理者が非公開化非公開化した日時2026年11月12日(木) 12:00理由${MODERATION_REASON}`,
      '投稿者が削除',
      '匿名化済み',
      '投稿者が退会・停止中',
    ]);
    await expect
      .element(rowOf('サンプル花子').getByText('2026年11月12日(木) 12:00'))
      .toHaveAttribute('datetime', HIDDEN_COMMENT_NODE.latestHide?.occurredAt);
  });

  test('ローンチは回を「第◯回」で示し、取り消したローンチは「取消」、読めないローンチと論理削除されたプロダクトは「—」と示す', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    expect(cellTexts('サンプル花子')[3]).toBe('第1回');
    expect(cellTexts(DELETED_COMMENT_NODE.excerpt)[3]).toBe('取消');
    expect(cellTexts('表示できない利用者').slice(2, 4)).toStrictEqual([
      '—',
      '—',
    ]);
  });

  test('該当するコメントが無ければ一覧の位置にその旨を示す', async () => {
    await renderWith({ comments: () => success(commentsQueryOf([])) });

    await expect
      .element(main().getByText('条件に一致するコメントはありません。'))
      .toBeVisible();
    expect(table().query()).toBeNull();
    await expect.element(filterForm()).toBeVisible();
  });

  test('取得の失敗は一覧の位置に文言と再試行の操作で示し、問い合わせの導線を出さず、再試行で一覧の見出しへフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith({
      comments: () =>
        available
          ? success(commentsQueryOf(COMMENT_NODES))
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
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(table()).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });
});

describe('措置の操作', () => {
  test('閲覧のみの管理者には非公開化・復元を出さない', async () => {
    await renderWith({ role: 'VIEWER' });
    await expect.element(table()).toBeVisible();

    expect(actionNames()).toStrictEqual([]);
  });

  test.each(MODERATION_ROLES)(
    '%sには、管理者が非公開化していないコメントに「非公開化」、管理者が非公開化したコメントに「復元」を、投稿者のニックネームを含む名前で置く',
    async (role) => {
      await renderWith({ role });
      await expect.element(table()).toBeVisible();

      expect(actionNames()).toStrictEqual([
        'サンプル太郎さんのコメントを非公開化',
        'サンプル花子さんのコメントを復元',
        'サンプル次郎さんのコメントを非公開化',
        '表示できない利用者さんのコメントを非公開化',
        'サンプル三郎さんのコメントを非公開化',
      ]);
      await expect
        .element(actionButton('サンプル太郎さんのコメントを非公開化'))
        .toHaveTextContent('非公開化');
      await expect
        .element(actionButton('サンプル花子さんのコメントを復元'))
        .toHaveTextContent('復元');
    },
  );

  test('非公開化は理由が必須で、確認に影響を説明の文で示し、確定すると非公開化して知らせ、一覧を新しい状態に取り直して一覧の見出しへフォーカスを移す', async () => {
    let hidden = false;
    await renderWith({
      role: 'MODERATOR',
      comments: () =>
        success(
          commentsQueryOf([
            hidden
              ? {
                  ...SHOWN_COMMENT_NODE,
                  state: 'HIDDEN',
                  latestHide: {
                    reason: MODERATION_REASON,
                    occurredAt: '2026-11-20T01:00:00.000Z',
                  },
                }
              : SHOWN_COMMENT_NODE,
          ]),
        ),
      handlers: new Map([
        [
          AdminHideCommentDocument,
          () => {
            hidden = true;
            return changedResult('hideComment', true);
          },
        ],
      ]),
    });
    await userEvent.click(actionButton('サンプル太郎さんのコメントを非公開化'));

    await expect
      .element(
        page.getByRole('dialog', {
          name: 'サンプル太郎さんのコメントを非公開にしますか?',
        }),
      )
      .toHaveAccessibleDescription(HIDE_DESCRIPTION);
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
    const confirm = dialog().getByRole('button', { name: '非公開にする' });
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill(MODERATION_REASON);
    await confirm.click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(variablesOf(executeGraphQL, AdminHideCommentDocument)).toStrictEqual(
      [{ id: SHOWN_COMMENT_NODE.id, reason: MODERATION_REASON }],
    );
    await expect
      .element(page.getByText('コメントを非公開にしました。'))
      .toBeVisible();
    await expect
      .element(actionButton('サンプル太郎さんのコメントを復元'))
      .toBeVisible();
    expect(cellTexts('サンプル太郎')[5]).toContain('管理者が非公開化');
    await expect.element(listHeading()).toHaveFocus();
  });

  test('復元も理由が必須で、確認に置き換えの表示のままになるコメントがある旨を示し、既に公開中なら変わらなかった旨を知らせる', async () => {
    await renderWith({
      role: 'SUPER_ADMIN',
      handlers: new Map([
        [
          AdminUnhideCommentDocument,
          () => changedResult('unhideComment', false),
        ],
      ]),
    });
    await userEvent.click(actionButton('サンプル花子さんのコメントを復元'));

    await expect
      .element(
        page.getByRole('dialog', {
          name: 'サンプル花子さんのコメントを復元しますか?',
        }),
      )
      .toHaveAccessibleDescription(UNHIDE_DESCRIPTION);
    const confirm = dialog().getByRole('button', { name: '復元する' });
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill('誤った非公開化だったため');
    await confirm.click();

    await expect.element(page.getByText('既に公開中です。')).toBeVisible();
    expect(
      variablesOf(executeGraphQL, AdminUnhideCommentDocument),
    ).toStrictEqual([
      { id: HIDDEN_COMMENT_NODE.id, reason: '誤った非公開化だったため' },
    ]);
  });

  test('投稿者を読めないコメントの確認の題名は投稿者を省く', async () => {
    await renderWith({ role: 'MODERATOR' });
    await userEvent.click(
      actionButton('表示できない利用者さんのコメントを非公開化'),
    );

    await expect
      .element(
        page.getByRole('dialog', { name: 'コメントを非公開にしますか?' }),
      )
      .toBeVisible();
  });

  test('確定の時点でコメントが見つからないと、一覧を取り直して行が消えても、ダイアログの中に文言を示して理由を保ち、閉じると一覧の見出しへフォーカスを移す', async () => {
    let missing = false;
    await renderWith({
      role: 'MODERATOR',
      comments: () =>
        success(
          commentsQueryOf(
            missing
              ? COMMENT_NODES.filter(
                  ({ id }) => id !== UNAVAILABLE_AUTHOR_COMMENT_NODE.id,
                )
              : COMMENT_NODES,
          ),
        ),
      handlers: new Map([
        [
          AdminHideCommentDocument,
          () => {
            missing = true;
            return failure({
              code: 'comment_not_found',
              message: 'コメントが見つかりません。',
              status: 404,
            });
          },
        ],
      ]),
    });
    await userEvent.click(actionButton('サンプル三郎さんのコメントを非公開化'));
    await reasonBox().fill(MODERATION_REASON);
    await dialog().getByRole('button', { name: '非公開にする' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('コメントが見つかりません。');
    await expect
      .element(buttonBehindDialog('サンプル三郎さんのコメントを非公開化'))
      .not.toBeInTheDocument();
    await expect
      .element(buttonBehindDialog('サンプル太郎さんのコメントを非公開化'))
      .toBeInTheDocument();
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);
    expect(variablesOf(executeGraphQL, AdminHideCommentDocument)).toStrictEqual(
      [{ id: UNAVAILABLE_AUTHOR_COMMENT_NODE.id, reason: MODERATION_REASON }],
    );

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('対象が見つからない以外の失敗では一覧を取り直さず、ダイアログの中に文言を示して理由を保つ', async () => {
    let listRequests = 0;
    await renderWith({
      role: 'MODERATOR',
      comments: () => {
        listRequests += 1;
        return success(commentsQueryOf(COMMENT_NODES));
      },
      handlers: new Map([
        [
          AdminHideCommentDocument,
          () =>
            failure({
              code: 'forbidden',
              message: 'この操作を行う権限がありません。',
              status: 403,
            }),
        ],
      ]),
    });
    await userEvent.click(actionButton('サンプル太郎さんのコメントを非公開化'));
    await reasonBox().fill(MODERATION_REASON);
    const requestsBeforeConfirm = listRequests;
    await dialog().getByRole('button', { name: '非公開にする' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('この操作を行う権限がありません。');
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);
    expect(listRequests).toBe(requestsBeforeConfirm);
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・措置の操作・非公開化の理由がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ role: 'SUPER_ADMIN' });
      await expect.element(table()).toBeVisible();
      await expect
        .element(actionButton('サンプル太郎さんのコメントを非公開化'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('検索語と期間の誤りを示した絞り込みがWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();
    await textField('投稿者のハンドル').fill('a'.repeat(101));
    await dateField('投稿日の開始日').fill('2026-11-05');
    await dateField('投稿日の終了日').fill('2026-11-01');
    await userEvent.click(applyButton());
    await expect.element(textField('投稿者のハンドル')).toHaveFocus();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('非公開化の確認のダイアログがWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderWith({ role: 'MODERATOR' });
    await userEvent.click(actionButton('サンプル太郎さんのコメントを非公開化'));
    await expect.element(dialog()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
