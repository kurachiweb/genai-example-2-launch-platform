import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  ADMIN_NICKNAME,
  adminViewerResult,
  adminWithRole,
} from '../../../test/admin-viewer-fixtures.ts';
import {
  LEGAL_DOCUMENT_SUMMARIES,
  renderLegalDocumentEditorPage,
} from '../../../test/legal-documents-fixtures.ts';
import {
  type AdminLegalDocumentFields,
  adminLegalDocumentsQueryOptions,
} from '../../graphql/admin-legal-documents.ts';
import {
  AdminDiscardLegalDocumentDraftDocument,
  AdminLegalDocumentDocument,
  AdminPublishLegalDocumentDocument,
  type AdminRole,
  AdminSaveLegalDocumentDraftDocument,
  AdminViewerDocument,
  type DiscardLegalDocumentDraftInput,
  type PublishLegalDocumentInput,
  type SaveLegalDocumentDraftInput,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const EDITOR_PATH = '/legal-documents/terms';

const SIGNED_IN_ADMIN = Object.freeze({
  id: '01JC0ADMIN000000000000000000',
  nickname: ADMIN_NICKNAME,
});

const OTHER_ADMIN = Object.freeze({
  id: '01JC0ADMIN000000000000000002',
  nickname: '統括の担当',
});

const SAVED_AT = '2026-11-04T05:06:07.000Z';

const PUBLISHED_AT = '2026-11-04T06:07:08.000Z';

const FIRST_REVISION = Object.freeze({
  versionNumber: 1,
  publishedAt: '2026-11-01T00:00:00.000Z',
  changeSummary: '初版を公開しました。',
  publishedBy: OTHER_ADMIN,
});

// 第1版を公開済みで下書きなし
const PUBLISHED: AdminLegalDocumentFields = Object.freeze({
  kind: 'TERMS',
  stateVersion: 3,
  latestBody: '第1版の本文',
  draft: null,
  revisions: [FIRST_REVISION],
});

const WITH_DRAFT: AdminLegalDocumentFields = Object.freeze({
  ...PUBLISHED,
  stateVersion: 4,
  draft: {
    body: '下書きの本文',
    savedAt: '2026-11-03T01:02:03.000Z',
    savedBy: OTHER_ADMIN,
  },
});

const CONFLICT = Object.freeze({
  code: 'legal_document_conflict',
  message:
    '他の管理者がこの文書を更新しました。最新の内容を読み込んでから、もう一度操作してください。',
  status: 409,
});

type Handler = (input: never) => Promise<unknown>;

interface FakeServer {
  // 他の管理者の操作を表すため、テストが書き換える
  current: AdminLegalDocumentFields;
  documentFails: boolean;
  // 照会の応答を遅らせる間、テストが置く
  documentGate: Promise<void> | undefined;
  readonly overrides: Map<unknown, Handler>;
}

const conflictOf = (
  server: FakeServer,
  expectedStateVersion: number,
): boolean => server.current.stateVersion !== expectedStateVersion;

// 状態の版を照合して保存・破棄・公開を行うAPIサーバーの偽物
function startServer(initial: AdminLegalDocumentFields): FakeServer {
  const server: FakeServer = {
    current: initial,
    documentFails: false,
    documentGate: undefined,
    overrides: new Map(),
  };
  const save = ({
    expectedStateVersion,
    body,
  }: SaveLegalDocumentDraftInput) => {
    if (conflictOf(server, expectedStateVersion)) {
      return failure(CONFLICT);
    }
    server.current = {
      ...server.current,
      stateVersion: server.current.stateVersion + 1,
      draft: { body, savedAt: SAVED_AT, savedBy: SIGNED_IN_ADMIN },
    };
    return success({ saveLegalDocumentDraft: server.current });
  };
  const discard = ({
    expectedStateVersion,
  }: DiscardLegalDocumentDraftInput) => {
    if (conflictOf(server, expectedStateVersion)) {
      return failure(CONFLICT);
    }
    server.current = {
      ...server.current,
      stateVersion: server.current.stateVersion + 1,
      draft: null,
    };
    return success({ discardLegalDocumentDraft: server.current });
  };
  const publish = ({
    expectedStateVersion,
    changeSummary,
  }: PublishLegalDocumentInput) => {
    const { draft, revisions } = server.current;
    if (conflictOf(server, expectedStateVersion) || draft === null) {
      return failure(CONFLICT);
    }
    server.current = {
      ...server.current,
      stateVersion: server.current.stateVersion + 1,
      latestBody: draft.body,
      draft: null,
      revisions: [
        {
          versionNumber: (revisions[0]?.versionNumber ?? 0) + 1,
          publishedAt: PUBLISHED_AT,
          changeSummary,
          publishedBy: SIGNED_IN_ADMIN,
        },
        ...revisions,
      ],
    };
    return success({ publishLegalDocument: server.current });
  };
  const handlers = new Map<unknown, (input: never) => Promise<unknown>>([
    [AdminSaveLegalDocumentDraftDocument, save],
    [AdminDiscardLegalDocumentDraftDocument, discard],
    [AdminPublishLegalDocumentDocument, publish],
  ]);
  executeGraphQL.mockImplementation(
    (document: unknown, variables: { readonly input?: unknown }) => {
      if (document === AdminViewerDocument) {
        return Promise.resolve(adminViewerResult(adminWithRole('SUPER_ADMIN')));
      }
      if (document === AdminLegalDocumentDocument) {
        const respond = () =>
          server.documentFails
            ? failure({
                code: 'internal_error',
                message: '処理中に問題が発生しました。',
                status: 500,
              })
            : success({ adminLegalDocument: server.current });
        return server.documentGate === undefined
          ? respond()
          : server.documentGate.then(respond);
      }
      const handler = server.overrides.get(document) ?? handlers.get(document);
      if (handler === undefined || variables.input === undefined) {
        throw new Error('想定していない操作が実行されました。');
      }
      return handler(variables.input as never);
    },
  );
  return server;
}

const main = () => page.getByRole('main');
const button = (name: string) =>
  main().getByRole('button', { name, exact: true });
const editable = () => main().getByRole('textbox', { name: '本文' });
const toolbar = () => main().getByRole('toolbar', { name: '書式' });
const revisionTable = () => main().getByRole('table', { name: '改訂履歴' });
const dialogNamed = (name: string) => page.getByRole('dialog', { name });
const mutationInputsOf = (document: unknown): unknown[] =>
  executeGraphQL.mock.calls
    .filter(([called]) => called === document)
    .map(([, variables]) => (variables as { readonly input: unknown }).input);

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

async function renderEditor(
  initial: AdminLegalDocumentFields,
  role: AdminRole = 'SUPER_ADMIN',
) {
  const server = startServer(initial);
  if (role !== 'SUPER_ADMIN') {
    executeGraphQL.mockImplementation((document: unknown) =>
      document === AdminViewerDocument
        ? Promise.resolve(adminViewerResult(adminWithRole(role)))
        : success({ adminLegalDocument: server.current }),
    );
  }
  await render(<Toaster />);
  const router = await renderLegalDocumentEditorPage(role, EDITOR_PATH);
  await expect
    .element(main().getByRole('heading', { level: 1 }))
    .toHaveTextContent('利用規約');
  return { server, context: router.options.context };
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('画面の構成', () => {
  test('見出し(文書の名前と公開ページへのリンク)・下書きの状態・入力欄・改訂履歴を順に表示する', async () => {
    await renderEditor(WITH_DRAFT);

    await expect
      .element(main().getByRole('link', { name: '公開ページを開く' }))
      .toHaveAttribute('href', 'https://client.example/terms');
    await expect.element(main().getByText('下書きがあります')).toBeVisible();
    const body = await waitForEditor();
    expect(body.textContent).toBe('下書きの本文');
    await expect.element(revisionTable()).toBeVisible();
    expect(revisionTable().getByRole('row').elements()).toHaveLength(2);

    const order = [
      main().getByRole('heading', { level: 1 }).element(),
      main().getByText('下書きがあります').element(),
      body,
      revisionTable().element(),
    ];
    for (const [index, element] of order.slice(1).entries()) {
      expect(
        order[index]?.compareDocumentPosition(element) ??
          Node.DOCUMENT_POSITION_PRECEDING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  test('最上位管理者でない管理者には、本文を読み取り専用で示し保存・破棄・公開の操作を描かない', async () => {
    await renderEditor(WITH_DRAFT, 'VIEWER');

    await expect.element(main().getByText('下書きがあります')).toBeVisible();
    await expect.element(revisionTable()).toBeVisible();
    await expect
      .element(editable())
      .toHaveAttribute('contenteditable', 'false');
    expect(button('下書きを保存').query()).toBeNull();
    expect(button('下書きを破棄').query()).toBeNull();
    expect(button('公開する').query()).toBeNull();
  });
});

describe('保存', () => {
  test('保存の後に、応答の内容で下書きの状態を更新し、トーストを出し、次の保存は新しい状態の版で送る', async () => {
    const { context } = await renderEditor(PUBLISHED);
    const listKey = adminLegalDocumentsQueryOptions().queryKey;
    context.queryClient.setQueryData(listKey, LEGAL_DOCUMENT_SUMMARIES);
    await expect.element(main().getByText('下書きはありません')).toBeVisible();

    await replaceBody('改訂した本文');
    await userEvent.click(button('下書きを保存'));

    await expect
      .element(page.getByText('下書きを保存しました。'))
      .toBeVisible();
    await expect.element(main().getByText('下書きがあります')).toBeVisible();
    expect(
      main().element().querySelector(`time[datetime="${SAVED_AT}"]`),
    ).not.toBeNull();
    await expect.element(button('公開する')).toBeEnabled();
    await expect.element(button('下書きを保存')).toHaveFocus();
    expect(editable().element().textContent).toBe('改訂した本文');
    expect(context.queryClient.getQueryState(listKey)?.isInvalidated).toBe(
      true,
    );

    await replaceBody('もう一度改訂した本文');
    await userEvent.click(button('下書きを保存'));

    await expect.element(main().getByText('下書きがあります')).toBeVisible();
    await vi.waitFor(() => {
      expect(
        mutationInputsOf(AdminSaveLegalDocumentDraftDocument),
      ).toStrictEqual([
        { kind: 'TERMS', expectedStateVersion: 3, body: '改訂した本文' },
        {
          kind: 'TERMS',
          expectedStateVersion: 4,
          body: 'もう一度改訂した本文',
        },
      ]);
    });
  });

  test('本文が大きすぎる失敗は入力欄の前に文言で示し、入力を残す', async () => {
    const { server } = await renderEditor(PUBLISHED);
    server.overrides.set(AdminSaveLegalDocumentDraftDocument, () =>
      failure({
        code: 'payload_too_large',
        message: '要求が大きすぎます。',
        status: 413,
      }),
    );

    await replaceBody('大きな本文');
    await userEvent.click(button('下書きを保存'));

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('本文が大きすぎるため保存できません。');
    expect(editable().element().textContent).toBe('大きな本文');
  });

  test('GraphQLの失敗でない例外は、例外の文言を出さずに問い合わせを促さない文言で示す', async () => {
    const { server } = await renderEditor(PUBLISHED);
    server.overrides.set(AdminSaveLegalDocumentDraftDocument, () =>
      Promise.reject(new TypeError('secret detail')),
    );

    await replaceBody('改訂した本文');
    await userEvent.click(button('下書きを保存'));

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    expect(main().element().textContent).not.toContain('secret detail');
  });
});

describe('破棄', () => {
  test('破棄の後に、下書きが無い状態と最新版の本文に戻し、トーストを出し、保存のボタンへフォーカスを移す', async () => {
    await renderEditor(WITH_DRAFT);
    await waitForEditor();

    await userEvent.click(button('下書きを破棄'));
    await userEvent.click(
      dialogNamed('利用規約の下書きを破棄しますか?').getByRole('button', {
        name: '破棄',
      }),
    );

    await expect
      .element(page.getByText('下書きを破棄しました。'))
      .toBeVisible();
    await expect.element(main().getByText('下書きはありません')).toBeVisible();
    await expect.element(button('下書きを保存')).toHaveFocus();
    await vi.waitFor(() => {
      expect(editable().element().textContent).toBe('第1版の本文');
    });
    expect(button('下書きを破棄').query()).toBeNull();
  });

  test('競合はダイアログの中に警告として示し、ページにも二重に読み上げない案内と「最新の内容を読み込む」を示す', async () => {
    const { server } = await renderEditor(WITH_DRAFT);
    await waitForEditor();
    server.current = { ...WITH_DRAFT, stateVersion: 5 };

    await userEvent.click(button('下書きを破棄'));
    const dialog = dialogNamed('利用規約の下書きを破棄しますか?');
    await userEvent.click(dialog.getByRole('button', { name: '破棄' }));

    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
    await expect
      .element(main().getByText(CONFLICT.message))
      .toBeInTheDocument();
    expect(main().getByRole('alert').query()).toBeNull();

    await userEvent.click(dialog.getByRole('button', { name: 'キャンセル' }));

    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(main().getByText(CONFLICT.message)).toBeVisible();
    await expect.element(button('最新の内容を読み込む')).toBeVisible();
    expect(main().getByRole('alert').query()).toBeNull();
  });
});

describe('公開', () => {
  test('公開の後に、改訂履歴の先頭に新しい版を出し、下書きを無くし、トーストを出し、保存のボタンへフォーカスを移す', async () => {
    const { context } = await renderEditor(WITH_DRAFT);
    const listKey = adminLegalDocumentsQueryOptions().queryKey;
    context.queryClient.setQueryData(listKey, LEGAL_DOCUMENT_SUMMARIES);
    await waitForEditor();

    await userEvent.click(button('公開する'));
    const dialog = dialogNamed('利用規約を公開しますか?');
    await userEvent.fill(
      dialog.getByRole('textbox', { name: '変更概要(必須)' }),
      '第2条を改めました。',
    );
    await userEvent.click(dialog.getByRole('button', { name: '公開' }));

    await expect.element(page.getByText('公開しました。')).toBeVisible();
    await expect.element(dialog).not.toBeInTheDocument();
    const rows = revisionTable().getByRole('row').elements();
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain('第2版');
    expect(rows[1]?.textContent).toContain('第2条を改めました。');
    await expect.element(main().getByText('下書きはありません')).toBeVisible();
    expect(button('公開する').query()).toBeNull();
    await expect.element(button('下書きを保存')).toHaveFocus();
    expect(editable().element().textContent).toBe('下書きの本文');
    expect(mutationInputsOf(AdminPublishLegalDocumentDocument)).toStrictEqual([
      {
        kind: 'TERMS',
        expectedStateVersion: 4,
        changeSummary: '第2条を改めました。',
      },
    ]);
    expect(context.queryClient.getQueryState(listKey)?.isInvalidated).toBe(
      true,
    );
  });

  test('競合の後にダイアログの「最新の内容を読み込む」で、ダイアログを閉じて最新の状態に戻し、保存のボタンへフォーカスを移す', async () => {
    const { server } = await renderEditor(WITH_DRAFT);
    await waitForEditor();
    server.current = {
      ...WITH_DRAFT,
      stateVersion: 5,
      latestBody: '他の管理者が公開した本文',
      draft: null,
      revisions: [
        {
          versionNumber: 2,
          publishedAt: '2026-11-04T00:00:00.000Z',
          changeSummary: '他の管理者が公開しました。',
          publishedBy: OTHER_ADMIN,
        },
        FIRST_REVISION,
      ],
    };

    await userEvent.click(button('公開する'));
    const dialog = dialogNamed('利用規約を公開しますか?');
    await userEvent.fill(
      dialog.getByRole('textbox', { name: '変更概要(必須)' }),
      '第2条を改めました。',
    );
    await userEvent.click(dialog.getByRole('button', { name: '公開' }));
    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
    await expect
      .element(main().getByText(CONFLICT.message))
      .toBeInTheDocument();
    expect(main().getByRole('alert').query()).toBeNull();
    await userEvent.click(
      dialog.getByRole('button', { name: '最新の内容を読み込む' }),
    );

    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(main().getByText('下書きはありません')).toBeVisible();
    expect(
      revisionTable().getByRole('row').elements()[1]?.textContent,
    ).toContain('他の管理者が公開しました。');
    await vi.waitFor(() => {
      expect(editable().element().textContent).toBe('他の管理者が公開した本文');
    });
    expect(main().getByText(CONFLICT.message).query()).toBeNull();
    await expect.element(button('下書きを保存')).toHaveFocus();
  });
});

describe('競合', () => {
  const OTHER_DRAFT: AdminLegalDocumentFields = Object.freeze({
    ...PUBLISHED,
    stateVersion: 4,
    draft: {
      body: '他の管理者の下書き',
      savedAt: '2026-11-04T01:00:00.000Z',
      savedBy: OTHER_ADMIN,
    },
  });

  test('保存の競合で入力を残して案内を出し、「最新の内容を読み込む」で最新の状態に戻して保存のボタンへフォーカスを移す', async () => {
    const { server } = await renderEditor(PUBLISHED);
    server.current = OTHER_DRAFT;

    await replaceBody('自分の本文');
    await userEvent.click(button('下書きを保存'));

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
    expect(editable().element().textContent).toBe('自分の本文');
    await expect.element(main().getByText('下書きはありません')).toBeVisible();

    await userEvent.click(button('最新の内容を読み込む'));

    await expect.element(main().getByText('下書きがあります')).toBeVisible();
    await vi.waitFor(() => {
      expect(editable().element().textContent).toBe('他の管理者の下書き');
    });
    expect(main().getByRole('alert').query()).toBeNull();
    await expect.element(button('下書きを保存')).toHaveFocus();
    await expect.element(button('公開する')).toBeEnabled();

    await replaceBody('読み込み直した後の本文');
    await userEvent.click(button('下書きを保存'));

    await expect
      .element(page.getByText('下書きを保存しました。'))
      .toBeVisible();
    expect(
      mutationInputsOf(AdminSaveLegalDocumentDraftDocument).at(-1),
    ).toStrictEqual({
      kind: 'TERMS',
      expectedStateVersion: 4,
      body: '読み込み直した後の本文',
    });
  });

  test('案内を出したまま再び競合すると、読み上げられるよう案内を描き直す', async () => {
    const { server } = await renderEditor(PUBLISHED);
    server.current = OTHER_DRAFT;
    await replaceBody('自分の本文');
    await userEvent.click(button('下書きを保存'));
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
    const first = main().getByRole('alert').element();

    await userEvent.click(button('下書きを保存'));

    await vi.waitFor(() => {
      expect(main().getByRole('alert').element()).not.toBe(first);
    });
    expect(first.isConnected).toBe(false);
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
  });

  test('読み込み直しの取得の間は、「最新の内容を読み込む」を重ねて押しても取得し直さない', async () => {
    const { server } = await renderEditor(PUBLISHED);
    server.current = OTHER_DRAFT;
    await replaceBody('自分の本文');
    await userEvent.click(button('下書きを保存'));
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
    let open: () => void = () => undefined;
    server.documentGate = new Promise((resolve) => {
      open = resolve;
    });
    const before = executeGraphQL.mock.calls.filter(
      ([called]) => called === AdminLegalDocumentDocument,
    ).length;

    await userEvent.click(button('最新の内容を読み込む'));
    await userEvent.click(button('最新の内容を読み込む'));
    open();

    await expect.element(main().getByText('下書きがあります')).toBeVisible();
    expect(
      executeGraphQL.mock.calls.filter(
        ([called]) => called === AdminLegalDocumentDocument,
      ),
    ).toHaveLength(before + 1);
  });

  test('読み込み直しに失敗したら、案内を残してトーストで失敗を知らせる', async () => {
    const { server } = await renderEditor(PUBLISHED);
    server.current = OTHER_DRAFT;
    await replaceBody('自分の本文');
    await userEvent.click(button('下書きを保存'));
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
    server.documentFails = true;

    await userEvent.click(button('最新の内容を読み込む'));

    await expect
      .element(page.getByText('処理中に問題が発生しました。'))
      .toBeVisible();
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
    expect(editable().element().textContent).toBe('自分の本文');
  });
});

describe('初期値の本文が空になる時のフォーカス', () => {
  const UNPUBLISHED_WITH_DRAFT: AdminLegalDocumentFields = Object.freeze({
    kind: 'TERMS',
    stateVersion: 2,
    latestBody: null,
    draft: {
      body: '最初の下書き',
      savedAt: '2026-11-03T01:02:03.000Z',
      savedBy: OTHER_ADMIN,
    },
    revisions: [],
  });

  const UNPUBLISHED_WITHOUT_DRAFT: AdminLegalDocumentFields = Object.freeze({
    ...UNPUBLISHED_WITH_DRAFT,
    stateVersion: 3,
    draft: null,
  });

  async function emptyBody(): Promise<void> {
    const body = await waitForEditor();
    await userEvent.click(body);
    await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}{Backspace}');
    await userEvent.tab();
    await expect.element(button('下書きを保存')).toBeDisabled();
  }

  async function conflictOnSave(server: FakeServer): Promise<void> {
    await replaceBody('自分の本文');
    server.current = { ...server.current, stateVersion: 9 };
    await userEvent.click(button('下書きを保存'));
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(CONFLICT.message);
  }

  test('未公開の文書の下書きを破棄した後は、押せない保存のボタンでなく本文の欄へフォーカスを移す', async () => {
    await renderEditor(UNPUBLISHED_WITH_DRAFT);
    await waitForEditor();

    await userEvent.click(button('下書きを破棄'));
    await userEvent.click(
      dialogNamed('利用規約の下書きを破棄しますか?').getByRole('button', {
        name: '破棄',
      }),
    );

    await expect.element(main().getByText('下書きはありません')).toBeVisible();
    await expect.element(button('下書きを保存')).toBeDisabled();
    await expect.element(editable()).toHaveFocus();
  });

  test('本文を空にしてから「最新の内容を読み込む」を押すと、読み込んだ本文があれば押せるようになった保存のボタンへフォーカスを移す', async () => {
    const { server } = await renderEditor(UNPUBLISHED_WITH_DRAFT);
    await conflictOnSave(server);
    await emptyBody();

    await userEvent.click(button('最新の内容を読み込む'));

    await expect
      .element(button('最新の内容を読み込む'))
      .not.toBeInTheDocument();
    await expect.element(button('下書きを保存')).toBeEnabled();
    await expect.element(button('下書きを保存')).toHaveFocus();
  });

  test('読み込んだ最新の内容の本文が空なら、本文の欄へフォーカスを移す', async () => {
    const { server } = await renderEditor(UNPUBLISHED_WITH_DRAFT);
    await conflictOnSave(server);
    server.current = UNPUBLISHED_WITHOUT_DRAFT;

    await userEvent.click(button('最新の内容を読み込む'));

    await expect.element(main().getByText('下書きはありません')).toBeVisible();
    await expect.element(button('下書きを保存')).toBeDisabled();
    await expect.element(editable()).toHaveFocus();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、編集の画面がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderEditor(WITH_DRAFT);
      await waitForEditor();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、競合の案内を出した編集の画面がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      const { server } = await renderEditor(PUBLISHED);
      server.current = { ...PUBLISHED, stateVersion: 9 };
      await replaceBody('自分の本文');
      await userEvent.click(button('下書きを保存'));
      await expect
        .element(main().getByRole('alert'))
        .toHaveTextContent(CONFLICT.message);

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
