import { useRef, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import {
  ApiKeyFormDialog,
  type ApiKeyFormRequest,
  type ApiKeyFormTarget,
} from './api-key-form-dialog.tsx';

// 権限の写しと同じファイルの取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const NAME_REQUIRED = '名前を入力してください。';
const NAME_TOO_LONG = '名前は50文字以内で入力してください。';
const NAME_DESCRIPTION = '50文字以内で入力してください。';
const SCOPE_NOT_ALLOWED = '選べない権限が指定されています。';
const RATE_LIMIT_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';
const SCOPES_DESCRIPTION =
  '機能ごとに、このキーで行える操作を選びます。読み書きはプロフィールとプロダクトの説明文だけで選べます。';

const OPENER = 'フォームを開く';

const EDITED_KEY = Object.freeze({
  id: '01JD0000000000000000000001',
  name: '集計スクリプト',
  scopes: Object.freeze({
    products: 'NONE',
    launches: 'READ',
    upvotes: 'NONE',
    comments: 'READ',
    ratings: 'NONE',
    profile: 'READ_WRITE',
    productDescriptions: 'READ',
  }),
} as const);

const ISSUE_TARGET: ApiKeyFormTarget = Object.freeze({ mode: 'issue' });

const EDIT_TARGET: ApiKeyFormTarget = Object.freeze({
  mode: 'edit',
  apiKey: EDITED_KEY,
});

type SubmitMock = ReturnType<
  typeof vi.fn<(request: ApiKeyFormRequest) => Promise<void>>
>;

interface HarnessProps {
  readonly target: ApiKeyFormTarget;
  readonly onSubmit: SubmitMock;
}

function Harness({ target, onSubmit }: HarnessProps) {
  const [current, setCurrent] = useState<ApiKeyFormTarget | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <main className="bg-background p-4 text-foreground">
      <button
        ref={openerRef}
        type="button"
        onClick={() => {
          setCurrent(target);
        }}
      >
        {OPENER}
      </button>
      <ApiKeyFormDialog
        target={current}
        onClose={() => {
          setCurrent(null);
        }}
        returnFocusRef={openerRef}
        onSubmit={onSubmit}
      />
    </main>
  );
}

const resolvingSubmit = (): SubmitMock => vi.fn(() => Promise.resolve());

const issueTitle = 'APIキーを発行';
const editTitle = 'APIキーを編集';

const dialog = () => page.getByRole('dialog');

const nameInput = () => dialog().getByRole('textbox', { name: '名前(必須)' });

const scopeGroup = (label: string) =>
  dialog().getByRole('radiogroup', { name: label, exact: true });

const scopeRadio = (group: string, level: string) =>
  scopeGroup(group).getByRole('radio', { name: level, exact: true });

const submitButton = (label: string) =>
  dialog().getByRole('button', { name: label, exact: true });

const openDialog = async (
  target: ApiKeyFormTarget = ISSUE_TARGET,
  onSubmit: SubmitMock = resolvingSubmit(),
): Promise<SubmitMock> => {
  await render(<Harness target={target} onSubmit={onSubmit} />);
  await userEvent.click(page.getByRole('button', { name: OPENER }));
  await expect.element(dialog()).toBeVisible();
  return onSubmit;
};

const fillAndBlur = async (value: string): Promise<void> => {
  await userEvent.fill(nameInput(), value);
  await userEvent.tab();
};

const fieldError = (
  field: string,
  message: string,
  code = 'too_long',
): { field: string; message: string; code: string } => ({
  field,
  message,
  code,
});

const validationError = (
  details: readonly ReturnType<typeof fieldError>[],
): GraphQLClientError =>
  new GraphQLClientError({
    code: 'validation_error',
    message: '入力内容を確認してください。',
    status: 400,
    details,
  });

afterEach(() => {
  applyColorScheme('light');
});

describe('発行のフォーム', () => {
  test('題名「APIキーを発行」で、空の名前と説明、「キャンセル」「発行」を示す', async () => {
    await openDialog();

    await expect.element(dialog()).toHaveAccessibleName(issueTitle);
    await expect.element(nameInput()).toHaveValue('');
    await expect.element(nameInput()).toHaveAttribute('aria-required', 'true');
    await expect
      .element(nameInput())
      .toHaveAccessibleDescription(NAME_DESCRIPTION);
    await expect
      .element(dialog().getByRole('button', { name: 'キャンセル' }))
      .toBeVisible();
    await expect.element(submitButton('発行')).toBeVisible();
  });

  test('権限の欄を説明付きのまとまりにし、7機能を機能の並びで置く', async () => {
    await openDialog();

    const group = dialog().getByRole('group', { name: '権限' });
    await expect.element(group).toHaveAccessibleDescription(SCOPES_DESCRIPTION);
    const names = Array.from(
      group.element().querySelectorAll('[role="radiogroup"]'),
      (element) => element.getAttribute('aria-labelledby'),
    ).map((id) => document.getElementById(id ?? '')?.textContent);
    expect(names).toEqual([
      'プロダクト',
      'ローンチ履歴',
      'Upvote',
      'コメント',
      '評価',
      'プロフィール',
      'プロダクトの説明文',
    ]);
  });

  test.each(['プロダクト', 'ローンチ履歴', 'Upvote', 'コメント', '評価'])(
    '%sは「無効」「読み取り」の2択',
    async (feature) => {
      await openDialog();

      const radios = scopeGroup(feature).getByRole('radio').elements();
      expect(
        radios.map(
          (radio) =>
            document.querySelector(`label[for="${radio.id}"]`)?.textContent,
        ),
      ).toEqual(['無効', '読み取り']);
    },
  );

  test.each(['プロフィール', 'プロダクトの説明文'])(
    '%sは「無効」「読み取り」「読み書き」の3択',
    async (feature) => {
      await openDialog();

      const radios = scopeGroup(feature).getByRole('radio').elements();
      expect(
        radios.map(
          (radio) =>
            document.querySelector(`label[for="${radio.id}"]`)?.textContent,
        ),
      ).toEqual(['無効', '読み取り', '読み書き']);
    },
  );

  test('初期値は読み取りの5機能を「読み取り」、プロフィールとプロダクトの説明文を「無効」にする', async () => {
    await openDialog();

    for (const feature of [
      'プロダクト',
      'ローンチ履歴',
      'Upvote',
      'コメント',
      '評価',
    ]) {
      await expect.element(scopeRadio(feature, '読み取り')).toBeChecked();
    }
    await expect.element(scopeRadio('プロフィール', '無効')).toBeChecked();
    await expect
      .element(scopeRadio('プロダクトの説明文', '無効'))
      .toBeChecked();
  });

  test('名前と権限を選んで「発行」を押すと、前後の空白を除いた名前と大文字の権限で発行を送り、閉じて開いた元へフォーカスを戻す', async () => {
    const onSubmit = await openDialog();

    await userEvent.fill(nameInput(), '  連携ツール\u3000');
    await userEvent.click(scopeRadio('プロフィール', '読み書き'));
    await userEvent.click(scopeRadio('コメント', '無効'));
    await userEvent.click(submitButton('発行'));

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      mode: 'issue',
      variables: {
        input: {
          name: '連携ツール',
          scopes: {
            products: 'READ',
            launches: 'READ',
            upvotes: 'READ',
            comments: 'NONE',
            ratings: 'READ',
            profile: 'READ_WRITE',
            productDescriptions: 'NONE',
          },
        },
      },
    });
    await expect
      .element(page.getByRole('button', { name: OPENER }))
      .toHaveFocus();
  });

  test('「キャンセル」で送らずに閉じ、開き直すと入力を初期値に戻す', async () => {
    const onSubmit = await openDialog();
    await userEvent.fill(nameInput(), '途中の名前');
    await userEvent.click(scopeRadio('プロフィール', '読み書き'));

    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));
    await expect.element(dialog()).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: OPENER }));

    await expect.element(nameInput()).toHaveValue('');
    await expect.element(scopeRadio('プロフィール', '無効')).toBeChecked();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('名前の検証', () => {
  test.each([
    ['空', '', NAME_REQUIRED],
    ['空白だけ', '\u3000 ', NAME_REQUIRED],
    ['51文字', 'あ'.repeat(51), NAME_TOO_LONG],
  ])(
    '%sなら、フォーカスを外すと欄に文言を示し、「発行」を押せない',
    async (_label, value, message) => {
      await openDialog();

      await userEvent.fill(nameInput(), value);
      await expect.element(nameInput()).not.toHaveAttribute('aria-invalid');
      await userEvent.tab();

      await expect
        .element(nameInput())
        .toHaveAccessibleDescription(new RegExp(message, 'u'));
      await expect.element(nameInput()).toHaveAttribute('aria-invalid', 'true');
      await expect.element(submitButton('発行')).toBeDisabled();
    },
  );

  test('前後の空白を除いて50文字なら受け付け、直すと文言が消えて「発行」を押せる', async () => {
    await openDialog();
    await fillAndBlur('あ'.repeat(51));
    await expect.element(nameInput()).toHaveAttribute('aria-invalid', 'true');

    await userEvent.fill(nameInput(), ` ${'あ'.repeat(50)} `);

    await expect.element(nameInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(submitButton('発行')).toBeEnabled();
  });

  test('送信の時にサーバーが返した名前と権限の誤りを、それぞれの欄に示して名前の欄へフォーカスを移し、ダイアログを開いたままにする', async () => {
    const onSubmit = resolvingSubmit();
    onSubmit.mockRejectedValueOnce(
      validationError([
        fieldError('input.name', NAME_TOO_LONG),
        fieldError('input.scopes.profile', SCOPE_NOT_ALLOWED, 'not_allowed'),
      ]),
    );
    await openDialog(ISSUE_TARGET, onSubmit);
    await userEvent.fill(nameInput(), '連携ツール');

    await userEvent.click(submitButton('発行'));

    await expect
      .element(nameInput())
      .toHaveAccessibleDescription(new RegExp(NAME_TOO_LONG, 'u'));
    await expect.element(nameInput()).toHaveFocus();
    await expect
      .element(scopeGroup('プロフィール'))
      .toHaveAccessibleDescription(SCOPE_NOT_ALLOWED);
    await expect
      .element(scopeGroup('プロフィール'))
      .toHaveAttribute('aria-invalid', 'true');
    await expect.element(dialog()).toBeVisible();
    expect(dialog().element().querySelector('[role="alert"]')).toBeNull();
  });
});

describe('名前の文字数のカウンター', () => {
  test('40文字までは示さない', async () => {
    await openDialog();

    await userEvent.fill(nameInput(), 'あ'.repeat(40));

    await expect.element(dialog().getByText('40/50')).not.toBeInTheDocument();
    await expect
      .element(nameInput())
      .toHaveAccessibleDescription(NAME_DESCRIPTION);
  });

  test('40文字を超えたら前後の空白を除いた書記素の数と上限を示し、欄に結び付ける', async () => {
    await openDialog();

    await userEvent.fill(nameInput(), ` ${'あ'.repeat(44)}👨‍👩‍👧 `);

    await expect.element(dialog().getByText('45/50')).toBeVisible();
    await expect
      .element(nameInput())
      .toHaveAccessibleDescription(`文字数 45/50 ${NAME_DESCRIPTION}`);
  });

  test('上限を超えても数え続ける', async () => {
    await openDialog();

    await fillAndBlur('あ'.repeat(51));

    await expect.element(dialog().getByText('51/50')).toBeVisible();
  });

  test('上限を超えた時と上限以内に戻った時だけ、支援技術へ丁寧に伝える', async () => {
    await openDialog();
    const liveRegion = () =>
      dialog().element().querySelector('[aria-live="polite"]');
    expect(liveRegion()?.textContent).toBe('');

    await userEvent.fill(nameInput(), 'あ'.repeat(45));
    expect(liveRegion()?.textContent).toBe('');
    await userEvent.fill(nameInput(), 'あ'.repeat(51));

    await expect
      .poll(() => liveRegion()?.textContent)
      .toBe('文字数が上限の50文字を超えています。');

    await userEvent.fill(nameInput(), 'あ'.repeat(52));
    expect(liveRegion()?.textContent).toBe(
      '文字数が上限の50文字を超えています。',
    );
    await userEvent.fill(nameInput(), 'あ'.repeat(50));

    await expect
      .poll(() => liveRegion()?.textContent)
      .toBe('文字数が上限以内に戻りました。');
  });
});

describe('閉じる動きの間の表示', () => {
  const closingDialog = (): HTMLElement => {
    const element = document.querySelector('[role="dialog"]');
    if (!(element instanceof HTMLElement)) {
      throw new Error('閉じる途中のダイアログがありません。');
    }
    return element;
  };

  test('「キャンセル」の直後も、閉じ終えるまで編集の題名と入力を保つ', async () => {
    await openDialog(EDIT_TARGET);

    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));

    const element = closingDialog();
    expect(element.dataset.state).toBe('closed');
    expect(element.querySelector('h2')?.textContent).toBe(editTitle);
    expect(element.querySelector('input')?.value).toBe('集計スクリプト');
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  test('保存の成功で閉じる時も、閉じ終えるまで編集の題名と入力を保つ', async () => {
    await openDialog(EDIT_TARGET);

    await userEvent.click(submitButton('保存'));
    await expect.poll(() => closingDialog().dataset.state).toBe('closed');

    const element = closingDialog();
    expect(element.querySelector('h2')?.textContent).toBe(editTitle);
    expect(element.querySelector('form')).not.toBeNull();
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  test('編集を閉じてから発行を開くと、発行の題名と初期値で始める', async () => {
    let target: ApiKeyFormTarget = EDIT_TARGET;
    function Switcher() {
      const [current, setCurrent] = useState<ApiKeyFormTarget | null>(null);
      const openerRef = useRef<HTMLButtonElement>(null);
      return (
        <main className="bg-background p-4 text-foreground">
          <button
            ref={openerRef}
            type="button"
            onClick={() => {
              setCurrent(target);
            }}
          >
            {OPENER}
          </button>
          <ApiKeyFormDialog
            target={current}
            onClose={() => {
              setCurrent(null);
            }}
            returnFocusRef={openerRef}
            onSubmit={resolvingSubmit()}
          />
        </main>
      );
    }
    await render(<Switcher />);
    await userEvent.click(page.getByRole('button', { name: OPENER }));
    await userEvent.fill(nameInput(), '編集中の名前');
    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));
    await expect.element(dialog()).not.toBeInTheDocument();

    target = ISSUE_TARGET;
    await userEvent.click(page.getByRole('button', { name: OPENER }));

    await expect.element(dialog()).toHaveAccessibleName(issueTitle);
    await expect.element(nameInput()).toHaveValue('');
    await expect.element(scopeRadio('プロフィール', '無効')).toBeChecked();
  });

  test('開いたまま別のキーの編集へ切り替わると、そのキーの値で作り直し、同じキーの取り直しでは入力を保つ', async () => {
    const otherKey = {
      ...EDITED_KEY,
      id: '01JD0000000000000000000002',
      name: '別のキー',
    };
    const props = {
      onClose: vi.fn(),
      returnFocusRef: { current: null },
      onSubmit: resolvingSubmit(),
    };
    const screen = await render(
      <ApiKeyFormDialog {...props} target={EDIT_TARGET} />,
    );
    await userEvent.fill(nameInput(), '入力中');

    await screen.rerender(
      <ApiKeyFormDialog
        {...props}
        target={{ mode: 'edit', apiKey: { ...EDITED_KEY } }}
      />,
    );
    await expect.element(nameInput()).toHaveValue('入力中');

    await screen.rerender(
      <ApiKeyFormDialog
        {...props}
        target={{ mode: 'edit', apiKey: otherKey }}
      />,
    );
    await expect.element(nameInput()).toHaveValue('別のキー');
  });

  test('同じキーの編集を閉じて開き直すと、入力を現在の値に戻す', async () => {
    await openDialog(EDIT_TARGET);
    await userEvent.fill(nameInput(), '途中の名前');
    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));
    await expect.element(dialog()).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: OPENER }));

    await expect.element(nameInput()).toHaveValue('集計スクリプト');
  });
});

describe('編集のフォーム', () => {
  test('題名「APIキーを編集」で、現在の名前と権限を入れて開く', async () => {
    await openDialog(EDIT_TARGET);

    await expect.element(dialog()).toHaveAccessibleName(editTitle);
    await expect.element(nameInput()).toHaveValue('集計スクリプト');
    await expect.element(scopeRadio('プロダクト', '無効')).toBeChecked();
    await expect.element(scopeRadio('ローンチ履歴', '読み取り')).toBeChecked();
    await expect.element(scopeRadio('Upvote', '無効')).toBeChecked();
    await expect.element(scopeRadio('コメント', '読み取り')).toBeChecked();
    await expect.element(scopeRadio('評価', '無効')).toBeChecked();
    await expect.element(scopeRadio('プロフィール', '読み書き')).toBeChecked();
    await expect
      .element(scopeRadio('プロダクトの説明文', '読み取り'))
      .toBeChecked();
    await expect.element(submitButton('保存')).toBeEnabled();
  });

  test('「保存」を押すと、キーのIDを足して編集を送り、閉じる', async () => {
    const onSubmit = await openDialog(EDIT_TARGET);

    await userEvent.fill(nameInput(), '新しい名前');
    await userEvent.click(scopeRadio('評価', '読み取り'));
    await userEvent.click(submitButton('保存'));

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      mode: 'edit',
      variables: {
        id: EDITED_KEY.id,
        input: {
          name: '新しい名前',
          scopes: {
            products: 'NONE',
            launches: 'READ',
            upvotes: 'NONE',
            comments: 'READ',
            ratings: 'READ',
            profile: 'READ_WRITE',
            productDescriptions: 'READ',
          },
        },
      },
    });
  });
});

describe('欄に対応しない失敗', () => {
  test('発行の回数の上限(429)は、文言規則のレート制限の文言をフォームに示し、ダイアログを開いたままにする', async () => {
    const onSubmit = resolvingSubmit();
    onSubmit.mockRejectedValueOnce(
      new GraphQLClientError({
        code: 'rate_limit_exceeded',
        message: '発行の回数の上限を超えました。',
        status: 429,
        retryAfterSeconds: 1200,
      }),
    );
    await openDialog(ISSUE_TARGET, onSubmit);
    await userEvent.fill(nameInput(), '連携ツール');

    await userEvent.click(submitButton('発行'));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(RATE_LIMIT_MESSAGE);
    await expect.element(dialog()).toBeVisible();
  });

  test('その他の想定内の失敗はエラーの文言を示し、送り直すと文言を消す', async () => {
    const onSubmit = resolvingSubmit();
    onSubmit.mockRejectedValueOnce(
      new GraphQLClientError({
        code: 'account_unavailable',
        message: 'このアカウントは利用できません。',
        status: 403,
      }),
    );
    await openDialog(EDIT_TARGET, onSubmit);

    await userEvent.click(submitButton('保存'));
    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('このアカウントは利用できません。');

    await userEvent.click(submitButton('保存'));

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  test('想定外の失敗は問い合わせの案内を含む文言を示す', async () => {
    const onSubmit = resolvingSubmit();
    onSubmit.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await openDialog(EDIT_TARGET, onSubmit);

    await userEvent.click(submitButton('保存'));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE);
  });

  test('欄をまとめた権限の値への詳細は、欄に付けずフォーム全体の失敗として示す', async () => {
    const onSubmit = resolvingSubmit();
    onSubmit.mockRejectedValueOnce(
      validationError([
        fieldError('input.scopes', '入力内容を確認してください。', 'custom'),
      ]),
    );
    await openDialog(EDIT_TARGET, onSubmit);

    await userEvent.click(submitButton('保存'));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('入力内容を確認してください。');
    await expect.element(submitButton('保存')).toBeEnabled();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('発行のフォームのアクセシビリティの違反が0件', async () => {
    applyColorScheme(scheme);
    await openDialog();

    expect(await runAxe(dialog().element())).toEqual([]);
  });

  test('名前の誤りとカウンターと失敗の文言を出した編集のフォームの違反が0件', async () => {
    applyColorScheme(scheme);
    const onSubmit = resolvingSubmit();
    onSubmit.mockRejectedValueOnce(
      validationError([
        fieldError('input.scopes.profile', SCOPE_NOT_ALLOWED, 'not_allowed'),
        fieldError('input.scopes', '入力内容を確認してください。', 'custom'),
      ]),
    );
    await openDialog(EDIT_TARGET, onSubmit);
    await userEvent.click(submitButton('保存'));
    await expect.element(dialog().getByRole('alert')).toBeVisible();
    await fillAndBlur('あ'.repeat(51));
    await expect.element(nameInput()).toHaveAttribute('aria-invalid', 'true');

    expect(await runAxe(dialog().element())).toEqual([]);
  });
});
