import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  type RouterHistory,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import { createPageRouterContext } from '../../../test/page-router.tsx';
import type { AdminLegalDocumentView } from '../../graphql/admin-legal-documents.ts';
import { toAdminViewer } from '../../graphql/admin-viewer.ts';
import type {
  AdminRole,
  DiscardLegalDocumentDraftInput,
  SaveLegalDocumentDraftInput,
} from '../../graphql/generated/graphql.ts';
import { AdminViewerProvider } from '../layout/admin-viewer-context.tsx';
import {
  LegalDraftForm,
  type LegalDraftFormProps,
} from './legal-draft-form.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const DRAFT_BODY = '下書きの本文';

const LATEST_BODY = '公開済みの本文';

const STATE_VERSION = 7;

const EDITOR = Object.freeze({
  id: '01JC0ADMIN000000000000000000',
  nickname: '運営の担当',
});

const DOCUMENT_WITH_DRAFT: AdminLegalDocumentView = Object.freeze({
  kind: 'terms',
  stateVersion: STATE_VERSION,
  latestBody: LATEST_BODY,
  draft: {
    body: DRAFT_BODY,
    savedAt: '2026-11-03T01:02:03.000Z',
    savedBy: EDITOR,
  },
  revisions: [
    {
      versionNumber: 1,
      publishedAt: '2026-11-01T00:00:00.000Z',
      changeSummary: '初版を公開',
      publishedBy: EDITOR,
    },
  ],
});

const PUBLISHED_WITHOUT_DRAFT: AdminLegalDocumentView = Object.freeze({
  ...DOCUMENT_WITH_DRAFT,
  kind: 'privacy',
  draft: null,
});

const UNPUBLISHED: AdminLegalDocumentView = Object.freeze({
  kind: 'legal-notice',
  stateVersion: 0,
  latestBody: null,
  draft: null,
  revisions: [],
});

const OTHER_PAGE_LINK = '法務文書の一覧へ';

const LEAVE_MESSAGE =
  '保存していない変更があります。このページを離れると変更は失われます。';

const SAVE_FIRST_MESSAGE = '公開する前に下書きを保存してください。';

type Handlers = Pick<
  LegalDraftFormProps,
  'onSave' | 'onSaveError' | 'onDiscard' | 'onPublishRequest'
>;

const createHandlers = () => ({
  onSave: vi.fn<(input: SaveLegalDocumentDraftInput) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  onSaveError: vi.fn<Handlers['onSaveError']>(),
  onDiscard: vi.fn<(input: DiscardLegalDocumentDraftInput) => Promise<void>>(
    () => Promise.resolve(),
  ),
  onPublishRequest: vi.fn<() => void>(),
});

interface RenderOptions {
  readonly role?: AdminRole;
  readonly handlers?: Partial<Handlers>;
  readonly notice?: LegalDraftFormProps['notice'];
  readonly history?: RouterHistory;
}

// 画面内の遷移を確かめるため、入力欄の外に別の経路へのリンクを置いたルーターで描く
async function renderForm(
  document: AdminLegalDocumentView,
  {
    role = 'SUPER_ADMIN',
    handlers = {},
    notice,
    history = createMemoryHistory({ initialEntries: ['/'] }),
  }: RenderOptions = {},
) {
  const viewer = toAdminViewer(adminWithRole(role));
  if (viewer === null) {
    throw new Error('ログイン中の管理者を作れませんでした。');
  }
  const props = createHandlers();
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <AdminViewerProvider viewer={viewer}>
        <button type="button">前の要素</button>
        <LegalDraftForm
          document={document}
          notice={notice}
          {...props}
          {...handlers}
        />
        <Link to="/legal-documents">{OTHER_PAGE_LINK}</Link>
        <Outlet />
      </AdminViewerProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/' }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: 'legal-documents',
        component: () => <p>法務文書の一覧の画面</p>,
      }),
    ]),
    history,
    context: createPageRouterContext('local'),
  });
  await render(<RouterProvider router={router} />);
  return { router, props };
}

const editable = () => page.getByRole('textbox', { name: '本文' });

const toolbar = () => page.getByRole('toolbar', { name: '書式' });

const button = (name: string) =>
  page.getByRole('button', { name, exact: true });

const dialogNamed = (name: string) => page.getByRole('dialog', { name });

async function waitForEditor(): Promise<HTMLElement> {
  await expect.element(editable()).toBeInTheDocument();
  await expect
    .element(toolbar().getByRole('button', { name: '太字', exact: true }))
    .not.toHaveAttribute('disabled');
  return editable().element() as HTMLElement;
}

async function replaceBody(text: string): Promise<void> {
  const body = await waitForEditor();
  await userEvent.click(body);
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
  await userEvent.keyboard(text);
}

const dispatchBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('初期値', () => {
  test.each([
    ['下書きがあれば下書きの本文', DOCUMENT_WITH_DRAFT, DRAFT_BODY],
    ['下書きが無ければ最新版の本文', PUBLISHED_WITHOUT_DRAFT, LATEST_BODY],
  ])('%sを入力欄に表示する', async (_case, document, expected) => {
    await renderForm(document);

    const body = await waitForEditor();

    expect(body.textContent).toBe(expected);
    await expect
      .element(page.getByText(`${String(expected.length)} / 100,000`))
      .toBeVisible();
  });

  test('未公開で下書きも無ければ空の入力欄を表示し、保存できない', async () => {
    await renderForm(UNPUBLISHED);

    const body = await waitForEditor();

    expect(body.textContent).toBe('');
    await expect.element(page.getByText('0 / 100,000')).toBeVisible();
    await expect.element(button('下書きを保存')).toBeDisabled();
  });
});

describe('入力欄', () => {
  test('見出しレベル1と画像を除く書式のツールと、表示場所と同じ指定のプレビューを備える', async () => {
    await renderForm({
      ...DOCUMENT_WITH_DRAFT,
      draft: {
        body: '## 第1条\n\n[外部のサイト](https://other.example/page)',
        savedAt: '2026-11-03T01:02:03.000Z',
        savedBy: EDITOR,
      },
    });
    await waitForEditor();

    const names = toolbar()
      .getByRole('button')
      .elements()
      .map(
        (element) => element.getAttribute('aria-label') ?? element.textContent,
      );
    expect(names).toContain('見出し');
    expect(names).toContain('太字');
    expect(names).not.toContain('画像');

    await userEvent.click(page.getByRole('tab', { name: 'プレビュー' }));

    await expect
      .element(page.getByRole('heading', { level: 2, name: '第1条' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: '外部のサイト' }))
      .toHaveAttribute('rel', 'noopener');
  });

  test('ラベルを押すと本文の編集領域へフォーカスが移る', async () => {
    await renderForm(DOCUMENT_WITH_DRAFT);
    await waitForEditor();

    await userEvent.click(page.getByText('本文', { exact: true }));

    await expect.element(editable()).toHaveFocus();
  });

  test('本文の欄に関係するサーバーの検証の違反を、入力の名前を外して入力欄に示す', async () => {
    const onSave = vi.fn(() =>
      Promise.reject(
        new GraphQLClientError({
          code: 'validation_error',
          status: 400,
          message: '入力内容を確認してください。',
          details: [
            {
              field: 'input.body',
              code: 'too_big',
              message: '本文は100,000文字以内で入力してください。',
            },
          ],
        }),
      ),
    );
    const { props } = await renderForm(DOCUMENT_WITH_DRAFT, {
      handlers: { onSave },
    });
    await waitForEditor();

    await userEvent.click(button('下書きを保存'));

    await expect
      .element(page.getByText('本文は100,000文字以内で入力してください。'))
      .toBeVisible();
    await expect
      .element(editable())
      .toHaveAttribute('aria-describedby', expect.stringContaining('message'));
    expect(props.onSaveError).not.toHaveBeenCalled();
  });
});

describe('保存', () => {
  test('入力した本文に文書の種類と読み込んだ状態の版を足して保存する', async () => {
    const { props } = await renderForm(DOCUMENT_WITH_DRAFT);
    await replaceBody('改訂した本文');

    await userEvent.click(button('下書きを保存'));

    await expect
      .poll(() => props.onSave.mock.calls)
      .toStrictEqual([
        [
          {
            kind: 'TERMS',
            expectedStateVersion: STATE_VERSION,
            body: '改訂した本文',
          },
        ],
      ]);
  });

  test('最新版の本文を変えずに下書きとして保存できる', async () => {
    const { props } = await renderForm(PUBLISHED_WITHOUT_DRAFT);
    await waitForEditor();

    await userEvent.click(button('下書きを保存'));

    await expect
      .poll(() => props.onSave.mock.calls)
      .toStrictEqual([
        [
          {
            kind: 'PRIVACY',
            expectedStateVersion: STATE_VERSION,
            body: LATEST_BODY,
          },
        ],
      ]);
  });

  test('欄に対応しない保存の失敗を呼び出し元へ渡し、渡された案内をフォームに表示する', async () => {
    const conflict = new GraphQLClientError({
      code: 'legal_document_conflict',
      status: 409,
      message: '他の管理者がこの文書を更新しました。',
    });
    const { props } = await renderForm(DOCUMENT_WITH_DRAFT, {
      handlers: { onSave: () => Promise.reject(conflict) },
      notice: <p role="alert">競合の案内</p>,
    });
    await replaceBody('残す本文');

    await userEvent.click(button('下書きを保存'));

    await expect
      .poll(() => props.onSaveError.mock.calls[0]?.[0])
      .toBe(conflict);
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('競合の案内');
    expect(editable().element().textContent).toBe('残す本文');
  });
});

describe('破棄', () => {
  test('下書きが無ければ破棄と公開の操作を描かない', async () => {
    await renderForm(PUBLISHED_WITHOUT_DRAFT);
    await waitForEditor();

    await expect.element(button('下書きを保存')).toBeVisible();
    expect(button('下書きを破棄').query()).toBeNull();
    expect(button('公開する').query()).toBeNull();
  });

  test('確認を経て、文書の種類と読み込んだ状態の版で下書きを破棄する', async () => {
    const { props } = await renderForm(DOCUMENT_WITH_DRAFT);
    await waitForEditor();

    await userEvent.click(button('下書きを破棄'));

    const dialog = dialogNamed('利用規約の下書きを破棄しますか?');
    await expect.element(dialog).toBeVisible();
    expect(dialog.getByRole('textbox').query()).toBeNull();
    expect(dialog.element().textContent).not.toContain('監査ログ');
    expect(props.onDiscard).not.toHaveBeenCalled();

    await userEvent.click(
      dialog.getByRole('button', { name: '破棄', exact: true }),
    );

    await expect.element(dialog).not.toBeInTheDocument();
    expect(props.onDiscard.mock.calls).toStrictEqual([
      [{ kind: 'TERMS', expectedStateVersion: STATE_VERSION }],
    ]);
  });

  test('キャンセルすると破棄しない', async () => {
    const { props } = await renderForm(DOCUMENT_WITH_DRAFT);
    await waitForEditor();

    await userEvent.click(button('下書きを破棄'));
    await userEvent.click(
      dialogNamed('利用規約の下書きを破棄しますか?').getByRole('button', {
        name: 'キャンセル',
      }),
    );

    await expect
      .element(dialogNamed('利用規約の下書きを破棄しますか?'))
      .not.toBeInTheDocument();
    expect(props.onDiscard).not.toHaveBeenCalled();
    await expect.element(button('下書きを破棄')).toHaveFocus();
  });

  test.each([
    [
      'APIの拒否はその文言',
      new GraphQLClientError({
        code: 'legal_document_conflict',
        status: 409,
        message: '他の管理者がこの文書を更新しました。',
      }),
      '他の管理者がこの文書を更新しました。',
    ],
    [
      '想定外の失敗は問い合わせを促さない文言',
      new Error('内部の詳細'),
      UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
    ],
  ])('破棄の失敗をダイアログの中に示す(%s)', async (_case, error, message) => {
    await renderForm(DOCUMENT_WITH_DRAFT, {
      handlers: { onDiscard: () => Promise.reject(error) },
    });
    await waitForEditor();

    await userEvent.click(button('下書きを破棄'));
    const dialog = dialogNamed('利用規約の下書きを破棄しますか?');
    await userEvent.click(
      dialog.getByRole('button', { name: '破棄', exact: true }),
    );

    await expect.element(dialog.getByRole('alert')).toHaveTextContent(message);
    expect(dialog.element().textContent).not.toContain('内部の詳細');
    expect(dialog.element().textContent).not.toContain('お問い合わせ');
  });
});

describe('公開', () => {
  test('保存していない変更が無ければ、公開の操作を始める', async () => {
    const { props } = await renderForm(DOCUMENT_WITH_DRAFT);
    await waitForEditor();

    await expect.element(button('公開する')).toBeEnabled();
    expect(page.getByText(SAVE_FIRST_MESSAGE).query()).toBeNull();

    await userEvent.click(button('公開する'));

    expect(props.onPublishRequest).toHaveBeenCalledOnce();
  });

  test('保存していない変更があると公開できず、先に保存する必要がある旨を公開の操作に関連付けて示す', async () => {
    await renderForm(DOCUMENT_WITH_DRAFT);
    await replaceBody('保存していない本文');

    await expect.element(button('公開する')).toBeDisabled();
    const hint = page.getByText(SAVE_FIRST_MESSAGE);
    await expect.element(hint).toBeVisible();
    await expect
      .element(button('公開する'))
      .toHaveAccessibleDescription(SAVE_FIRST_MESSAGE);
    await expect.element(button('下書きを保存')).toBeEnabled();
  });

  test('入力を元の本文に戻すと、再び公開できる', async () => {
    await renderForm(DOCUMENT_WITH_DRAFT);
    await replaceBody('一時的な本文');
    await expect.element(button('公開する')).toBeDisabled();

    await replaceBody(DRAFT_BODY);

    await expect.element(button('公開する')).toBeEnabled();
    expect(page.getByText(SAVE_FIRST_MESSAGE).query()).toBeNull();
  });
});

describe('最上位管理者でない管理者', () => {
  test.each<AdminRole>(['VIEWER', 'MODERATOR'])(
    '%sには本文を読み取り専用で表示し、保存・破棄・公開の操作を描かない',
    async (role) => {
      await renderForm(DOCUMENT_WITH_DRAFT, { role });

      await expect.element(editable()).toBeInTheDocument();
      await expect.element(editable()).toHaveAttribute('aria-disabled', 'true');
      expect(editable().element().getAttribute('contenteditable')).toBe(
        'false',
      );
      expect(editable().element().textContent).toBe(DRAFT_BODY);
      for (const name of ['下書きを保存', '下書きを破棄', '公開する']) {
        expect(button(name).query()).toBeNull();
      }
    },
  );
});

describe('離脱の確認', () => {
  test('保存していない変更があると、画面内の遷移の前に確認し、留まれば入力を残す', async () => {
    const { router } = await renderForm(DOCUMENT_WITH_DRAFT);
    await replaceBody('離れる前の本文');

    await userEvent.click(page.getByRole('link', { name: OTHER_PAGE_LINK }));

    const dialog = dialogNamed('このページを離れますか?');
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog).toHaveAccessibleDescription(LEAVE_MESSAGE);
    await userEvent.click(dialog.getByRole('button', { name: 'キャンセル' }));

    await expect.element(dialog).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(editable().element().textContent).toBe('離れる前の本文');
  });

  test('確認で「離れる」を選ぶと遷移する', async () => {
    const { router } = await renderForm(DOCUMENT_WITH_DRAFT);
    await replaceBody('捨てる本文');

    await userEvent.click(page.getByRole('link', { name: OTHER_PAGE_LINK }));
    await userEvent.click(
      dialogNamed('このページを離れますか?').getByRole('button', {
        name: '離れる',
      }),
    );

    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/legal-documents');
    await expect.element(page.getByText('法務文書の一覧の画面')).toBeVisible();
  });

  test('保存していない変更が無ければ、確認せずに遷移する', async () => {
    const { router } = await renderForm(DOCUMENT_WITH_DRAFT);
    await waitForEditor();

    await userEvent.click(page.getByRole('link', { name: OTHER_PAGE_LINK }));

    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/legal-documents');
    expect(dialogNamed('このページを離れますか?').query()).toBeNull();
  });

  test('保存していない変更がある間だけ、再読み込みやタブを閉じる前にブラウザの確認を求める', async () => {
    const history = createBrowserHistory();
    try {
      await renderForm(DOCUMENT_WITH_DRAFT, { history });
      await waitForEditor();
      expect(dispatchBeforeUnload()).toBe(false);

      await replaceBody('閉じる前の本文');

      await expect.poll(dispatchBeforeUnload).toBe(true);
    } finally {
      history.destroy();
    }
  });
});

describe('キーボードでの操作', () => {
  test('キーボードだけで本文を書き換えて保存できる', async () => {
    const { props } = await renderForm(DOCUMENT_WITH_DRAFT);
    await waitForEditor();
    button('前の要素').element().focus();

    for (let count = 0; count < 20; count += 1) {
      if (document.activeElement === editable().element()) {
        break;
      }
      await userEvent.keyboard('{Tab}');
    }
    await expect.element(editable()).toHaveFocus();
    await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
    await userEvent.keyboard('キーボードの本文');
    for (let count = 0; count < 20; count += 1) {
      if (document.activeElement === button('下書きを保存').element()) {
        break;
      }
      await userEvent.keyboard('{Tab}');
    }
    await expect.element(button('下書きを保存')).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await expect
      .poll(() => props.onSave.mock.calls[0]?.[0].body)
      .toBe('キーボードの本文');
  });

  test('キーボードで破棄の確認を開いて確定できる', async () => {
    const { props } = await renderForm(DOCUMENT_WITH_DRAFT);
    await waitForEditor();
    button('下書きを破棄').element().focus();

    await userEvent.keyboard('{Enter}');
    const dialog = dialogNamed('利用規約の下書きを破棄しますか?');
    await expect.element(dialog).toBeVisible();
    for (let count = 0; count < 5; count += 1) {
      if (
        document.activeElement ===
        dialog.getByRole('button', { name: '破棄', exact: true }).element()
      ) {
        break;
      }
      await userEvent.keyboard('{Tab}');
    }
    await userEvent.keyboard('{Enter}');

    await expect.poll(() => props.onDiscard.mock.calls.length).toBe(1);
  });

  test('離脱の確認はEscapeで閉じて画面に留まる', async () => {
    const { router } = await renderForm(DOCUMENT_WITH_DRAFT);
    await replaceBody('留まる本文');
    (
      page.getByRole('link', { name: OTHER_PAGE_LINK }).element() as HTMLElement
    ).focus();

    await userEvent.keyboard('{Enter}');
    const dialog = dialogNamed('このページを離れますか?');
    await expect.element(dialog).toBeVisible();
    await userEvent.keyboard('{Escape}');

    await expect.element(dialog).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、編集・公開できない状態・読み取り専用の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderForm(DOCUMENT_WITH_DRAFT);
      await replaceBody('検査する本文');
      await expect.element(page.getByText(SAVE_FIRST_MESSAGE)).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、読み取り専用の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderForm(DOCUMENT_WITH_DRAFT, { role: 'VIEWER' });
      await expect.element(editable()).toHaveAttribute('aria-disabled', 'true');

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、破棄と離脱の確認がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderForm(DOCUMENT_WITH_DRAFT);
      await waitForEditor();
      await userEvent.click(button('下書きを破棄'));
      await expect
        .element(dialogNamed('利用規約の下書きを破棄しますか?'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.keyboard('{Escape}');
      await replaceBody('離脱の検査');
      await userEvent.click(page.getByRole('link', { name: OTHER_PAGE_LINK }));
      await expect
        .element(dialogNamed('このページを離れますか?'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
