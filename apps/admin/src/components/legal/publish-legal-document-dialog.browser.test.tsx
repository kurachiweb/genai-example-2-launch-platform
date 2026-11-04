import { useRef, useState } from 'react';
import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import type { AdminLegalDocumentView } from '../../graphql/admin-legal-documents.ts';
import type { PublishLegalDocumentInput } from '../../graphql/generated/graphql.ts';
import { PublishLegalDocumentDialog } from './publish-legal-document-dialog.tsx';

// 文書の種類の変換と同じファイルの取得の設定が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const STATE_VERSION = 7;

const DOCUMENT: AdminLegalDocumentView = Object.freeze({
  kind: 'privacy',
  stateVersion: STATE_VERSION,
  latestBody: '公開済みの本文',
  draft: {
    body: '下書きの本文',
    savedAt: '2026-11-03T01:02:03.000Z',
    savedBy: { id: '01JC0ADMIN000000000000000000', nickname: '運営の担当' },
  },
  revisions: [],
});

const OPENER = '公開する';

const AFTER_PUBLISH = '下書きを保存';

const TITLE = 'プライバシーポリシーを公開しますか?';

const DESCRIPTION =
  '公開すると利用者側のページに直ちに表示されます。公開した版は後から変更・削除できません。';

const PUBLIC_NOTICE = '変更概要は利用者側のページに公開されます。';

const EMPTY_MESSAGE = '変更概要を入力してください。';

const TOO_LONG_MESSAGE = '変更概要は200文字以内で入力してください。';

const OVER_LIMIT_ANNOUNCEMENT = '文字数が上限の200文字を超えています。';

const LINE_BREAK_MESSAGE = '変更概要に改行は使用できません。';

const CONFLICT_MESSAGE =
  '他の管理者がこの文書を更新しました。最新の内容を読み込んでから、もう一度操作してください。';

type OnPublish = (input: PublishLegalDocumentInput) => Promise<void>;

interface HarnessProps {
  readonly onPublish: Mock<OnPublish>;
  readonly onReload?: Mock<() => void>;
}

// 公開に成功すると開いた元の「公開する」が消えるため、成功した時だけ戻り先に別のボタンを渡す
function Harness({ onPublish, onReload = vi.fn() }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const afterPublishRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return (
    <div>
      <button type="button" ref={afterPublishRef}>
        {AFTER_PUBLISH}
      </button>
      <button
        type="button"
        onClick={() => {
          returnFocusRef.current = null;
          setOpen(true);
        }}
      >
        {OPENER}
      </button>
      <PublishLegalDocumentDialog
        open={open}
        onOpenChange={setOpen}
        document={DOCUMENT}
        onPublish={async (input) => {
          await onPublish(input);
          returnFocusRef.current = afterPublishRef.current;
        }}
        onReload={onReload}
        returnFocusRef={returnFocusRef}
      />
    </div>
  );
}

const dialog = () => page.getByRole('dialog', { name: TITLE });

const summaryBox = () =>
  dialog().getByRole('textbox', { name: '変更概要(必須)', exact: true });

const publishButton = () =>
  dialog().getByRole('button', { name: '公開', exact: true });

const cancelButton = () =>
  dialog().getByRole('button', { name: 'キャンセル', exact: true });

const opener = () => page.getByRole('button', { name: OPENER, exact: true });

const publishMock = (): Mock<OnPublish> =>
  vi.fn<OnPublish>(() => Promise.resolve());

const rejectWith = (error: Error): Mock<OnPublish> =>
  vi.fn<OnPublish>(() => Promise.reject(error));

const renderDialog = async (props: HarnessProps): Promise<void> => {
  await render(<Harness {...props} />);
  await opener().click();
  await expect.element(dialog()).toBeVisible();
};

const fillValidSummary = async (): Promise<void> => {
  await summaryBox().fill('第3条を改めました');
  await userEvent.tab();
};

afterEach(() => {
  applyColorScheme('light');
});

describe('公開の確認', () => {
  test('文書の名前の題名と、直ちに表示され後から変更・削除できない旨を示す', async () => {
    await renderDialog({ onPublish: publishMock() });

    await expect.element(dialog()).toHaveAccessibleDescription(DESCRIPTION);
    await expect.element(summaryBox()).toHaveFocus();
    await expect.element(summaryBox()).toHaveValue('');
    await expect.element(summaryBox()).toHaveAttribute('aria-required', 'true');
  });

  test('変更概要が利用者側のページに公開される旨を入力欄の説明として示す', async () => {
    await renderDialog({ onPublish: publishMock() });

    await expect.element(dialog().getByText(PUBLIC_NOTICE)).toBeVisible();
    await expect
      .element(summaryBox())
      .toHaveAccessibleDescription(PUBLIC_NOTICE);
  });

  test('変更概要の書記素の数を「現在の数 / 200」で示す', async () => {
    await renderDialog({ onPublish: publishMock() });

    await expect.element(dialog().getByText('0 / 200')).toBeVisible();
    await summaryBox().fill('👨‍👩‍👧');
    await expect.element(dialog().getByText('1 / 200')).toBeVisible();
    await summaryBox().fill('あ'.repeat(201));
    await expect.element(dialog().getByText('201 / 200')).toBeVisible();
  });

  test('文字数は検証と同じく前後の空白を除いて数え、前後に空白を付けた200書記素を上限の超過として示さない', async () => {
    await renderDialog({ onPublish: publishMock() });

    await summaryBox().fill(` ${'👨‍👩‍👧'.repeat(200)}\u3000`);

    const counter = dialog().getByText('200 / 200');
    await expect.element(counter).toBeVisible();
    await expect.element(counter).not.toHaveClass('text-destructive');
    expect(dialog().getByText(OVER_LIMIT_ANNOUNCEMENT).elements()).toHaveLength(
      0,
    );
  });

  test.each([
    ['空のまま', '', EMPTY_MESSAGE],
    ['空白だけ', ' 　', EMPTY_MESSAGE],
    ['201文字', 'あ'.repeat(201), TOO_LONG_MESSAGE],
  ])(
    '変更概要が%sのとき、フォーカスを外した時点で欄に関連付けた文言を示し、公開を送信しない',
    async (_, value, message) => {
      const onPublish = publishMock();
      await renderDialog({ onPublish });

      await summaryBox().fill(value);
      expect(dialog().getByText(message).elements()).toHaveLength(0);
      await userEvent.tab();

      await expect.element(dialog().getByText(message)).toBeVisible();
      await expect
        .element(summaryBox())
        .toHaveAttribute('aria-invalid', 'true');
      await expect
        .element(summaryBox())
        .toHaveAccessibleDescription(`${PUBLIC_NOTICE} ${message}`);
      await expect.element(publishButton()).toBeDisabled();
      await summaryBox().click();
      await userEvent.keyboard('{Enter}');
      expect(onPublish).not.toHaveBeenCalled();
      await expect.element(dialog()).toBeVisible();
    },
  );

  test('前後の空白を除いて200書記素までの変更概要は検証を通る', async () => {
    const onPublish = publishMock();
    const summary = '👨‍👩‍👧'.repeat(200);
    await renderDialog({ onPublish });

    await summaryBox().fill(` ${summary} `);
    await userEvent.tab();

    expect(dialog().getByText(TOO_LONG_MESSAGE).elements()).toHaveLength(0);
    await publishButton().click();
    expect(onPublish).toHaveBeenCalledExactlyOnceWith({
      kind: 'PRIVACY',
      expectedStateVersion: STATE_VERSION,
      changeSummary: summary,
    });
  });

  test('1行の入力欄は貼り付けた改行を値に含めず、改行を含む変更概要を送らない', async () => {
    const onPublish = publishMock();
    await renderDialog({ onPublish });

    await summaryBox().fill('前半\n後半');
    await userEvent.tab();
    await publishButton().click();

    expect(onPublish).toHaveBeenCalledOnce();
    expect(onPublish.mock.calls[0]?.[0].changeSummary).not.toMatch(/[\n\r]/u);
  });

  test('サーバーが変更概要を改行などの規則で拒否した時は、その文言を入力欄に関連付けて示し、入力欄へフォーカスを移す', async () => {
    const onPublish = rejectWith(
      new GraphQLClientError({
        code: 'validation_error',
        status: 400,
        message: '入力内容を確認してください。',
        details: [
          {
            field: 'input.changeSummary',
            code: 'custom',
            message: LINE_BREAK_MESSAGE,
          },
        ],
      }),
    );
    await renderDialog({ onPublish });

    await fillValidSummary();
    await publishButton().click();

    await expect
      .element(summaryBox())
      .toHaveAccessibleDescription(`${PUBLIC_NOTICE} ${LINE_BREAK_MESSAGE}`);
    await expect.element(summaryBox()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(summaryBox()).toHaveFocus();
    await expect.element(dialog()).toBeVisible();
  });

  test('公開で文書の種類と読み込んだ状態の版を足して前後の空白を除いた変更概要を送り、成功すると閉じて戻り先へフォーカスを移す', async () => {
    const onPublish = publishMock();
    await renderDialog({ onPublish });

    await summaryBox().fill('  第3条を改めました　');
    await publishButton().click();

    expect(onPublish).toHaveBeenCalledExactlyOnceWith({
      kind: 'PRIVACY',
      expectedStateVersion: STATE_VERSION,
      changeSummary: '第3条を改めました',
    });
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: AFTER_PUBLISH, exact: true }))
      .toHaveFocus();
  });

  test.each([
    [
      '変更なし',
      new GraphQLClientError({
        code: 'legal_document_unchanged',
        status: 422,
        message: 'サーバーの文言',
      }),
      '公開中の版から本文が変更されていません。',
    ],
    [
      '下書きなし',
      new GraphQLClientError({
        code: 'legal_document_draft_missing',
        status: 422,
        message: 'サーバーの文言',
      }),
      '公開する下書きがありません。',
    ],
    [
      '想定外',
      new Error('通信の失敗'),
      UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
    ],
  ])(
    '%sで拒否された時は、ダイアログの中に文言を示し、入力を残して開いたままにする',
    async (_, error, message) => {
      await renderDialog({ onPublish: rejectWith(error) });

      await fillValidSummary();
      await publishButton().click();

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(message);
      await expect.element(summaryBox()).toHaveValue('第3条を改めました');
      await expect.element(publishButton()).toBeEnabled();
    },
  );

  test('競合で拒否された時は競合の案内を示し、「最新の内容を読み込む」で再読み込みを求めて閉じる', async () => {
    const onReload = vi.fn<() => void>();
    await renderDialog({
      onPublish: rejectWith(
        new GraphQLClientError({
          code: 'legal_document_conflict',
          status: 409,
          message: 'サーバーの文言',
        }),
      ),
      onReload,
    });

    await fillValidSummary();
    await publishButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(CONFLICT_MESSAGE);
    await expect.element(summaryBox()).toHaveValue('第3条を改めました');
    await dialog()
      .getByRole('button', { name: '最新の内容を読み込む' })
      .click();

    expect(onReload).toHaveBeenCalledOnce();
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  test('拒否の後に送り直して成功すると、前の失敗の文言を消して閉じる', async () => {
    const onPublish = vi
      .fn<OnPublish>()
      .mockRejectedValueOnce(
        new GraphQLClientError({
          code: 'legal_document_unchanged',
          status: 422,
          message: 'サーバーの文言',
        }),
      )
      .mockResolvedValueOnce(undefined);
    await renderDialog({ onPublish });

    await fillValidSummary();
    await publishButton().click();
    await expect.element(dialog().getByRole('alert')).toBeVisible();
    await publishButton().click();

    expect(onPublish).toHaveBeenCalledTimes(2);
    await expect.element(dialog()).not.toBeInTheDocument();
  });
});

describe('キーボードでの操作', () => {
  test('キーボードで開いて入力し、Enterで公開を送信できる', async () => {
    const onPublish = publishMock();
    await render(<Harness onPublish={onPublish} />);

    await userEvent.keyboard('{Tab}{Tab}');
    await expect.element(opener()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect.element(summaryBox()).toHaveFocus();
    await userEvent.keyboard('第3条を改めました');
    await userEvent.keyboard('{Tab}');
    await expect.element(cancelButton()).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    await expect.element(publishButton()).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{Tab}{/Shift}');
    await expect.element(summaryBox()).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onPublish).toHaveBeenCalledExactlyOnceWith({
      kind: 'PRIVACY',
      expectedStateVersion: STATE_VERSION,
      changeSummary: '第3条を改めました',
    });
  });

  test('Escで送信せずに閉じ、開いた元の操作へフォーカスを戻す', async () => {
    const onPublish = publishMock();
    await render(<Harness onPublish={onPublish} />);

    await opener().click();
    await expect.element(summaryBox()).toHaveFocus();
    await userEvent.keyboard('{Escape}');

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(onPublish).not.toHaveBeenCalled();
  });

  test('「キャンセル」で送信せずに閉じる', async () => {
    const onPublish = publishMock();
    await renderDialog({ onPublish });

    await cancelButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onPublish).not.toHaveBeenCalled();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('入力の検証のエラーを示したダイアログがWCAG 2.2 AAの自動検査に違反しない', async () => {
    applyColorScheme(scheme);
    await renderDialog({ onPublish: publishMock() });
    await userEvent.tab();
    await expect.element(dialog().getByText(EMPTY_MESSAGE)).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('競合の案内と失敗の文言を示したダイアログがWCAG 2.2 AAの自動検査に違反しない', async () => {
    applyColorScheme(scheme);
    await renderDialog({
      onPublish: rejectWith(
        new GraphQLClientError({
          code: 'legal_document_conflict',
          status: 409,
          message: 'サーバーの文言',
        }),
      ),
    });
    await fillValidSummary();
    await publishButton().click();
    await expect.element(dialog().getByRole('alert')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
