import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  type AdminYearFinalDateSetting,
  adminYearFinalDateSettingsQueryOptions,
} from '../../graphql/admin-year-final-date.ts';
import {
  AdminUpdateYearFinalDateDocument,
  type AdminUpdateYearFinalDateMutationVariables,
  type AdminYearFinalDateSettingsQuery,
} from '../../graphql/generated/graphql.ts';
import {
  CURRENT_YEAR_SETTING,
  NEXT_YEAR_SETTING,
  settingOf,
} from './final-date-fixtures.ts';
import { FinalDateForm } from './final-date-form.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

type UpdateHandler = (
  variables: AdminUpdateYearFinalDateMutationVariables,
) => Promise<unknown>;

const FIELD_LABEL = '決勝実施日';

const SUBMIT_LABEL = '保存する';

const NO_CHOICES_MESSAGE = '選べる日付がありません。';

const SAVED_MESSAGE = '決勝実施日を保存しました。';

const REASON_LABEL = '理由(任意)';

const REASON_NOTICE =
  '理由には、ユーザーや管理者のメールアドレス・氏名などの個人情報を含めないでください。';

const REASON_TOO_LONG_MESSAGE = '理由は500文字以内で入力してください。';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const CONFIRM_TITLE = '2027年の決勝実施日を2027年6月6日(日)に変更しますか?';

const CONFIRM_DESCRIPTION =
  '受付期限は2027年6月1日(火) 16:00、組み合わせ決定は2027年6月1日(火) 16:45になり、対象となるWeek優勝の期間も変わります。';

const LOCKED_MESSAGE = '決勝実施日の7日前を過ぎたため変更できません。';

const CONFLICT_MESSAGE =
  '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。';

const CONTACT_PHRASE = 'お問い合わせ';

const TOKYO: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

const HONOLULU: DisplayPreferences = Object.freeze({
  timeZone: 'Pacific/Honolulu',
  locale: 'ja-JP',
});

const SAVED_SETTING: AdminYearFinalDateSetting = Object.freeze({
  ...NEXT_YEAR_SETTING,
  finalDate: '2027-06-06',
  acceptUntil: '2027-06-01T07:00:00.000Z',
  deadlineAt: '2027-06-01T07:35:00.000Z',
  drawAt: '2027-06-01T07:45:00.000Z',
  changeLockAt: '2027-05-30T08:00:00.000Z',
  version: 3,
  updatedAt: '2026-11-18T01:00:00.000Z',
});

const SETTINGS_QUERY: AdminYearFinalDateSettingsQuery = Object.freeze({
  yearFinalDateSettings: {
    serverTime: '2026-11-18T00:00:00.000Z',
    settings: [CURRENT_YEAR_SETTING, NEXT_YEAR_SETTING],
  },
});

const unexpectedOperation = (): never => {
  throw new Error('想定していない操作が実行されました。');
};

const respond = (update: UpdateHandler = unexpectedOperation): void => {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === AdminUpdateYearFinalDateDocument) {
      return update(variables as AdminUpdateYearFinalDateMutationVariables);
    }
    return unexpectedOperation();
  });
};

interface RenderOptions {
  readonly display?: DisplayPreferences;
}

// 7.4の区画が年ごとのカードの中に置くのと同じく、照会の結果をキャッシュに置いて描く
async function renderForm(
  setting: AdminYearFinalDateSetting,
  { display = TOKYO }: RenderOptions = {},
) {
  await emulateBrowserDisplay(display);
  await render(<Toaster />);
  const router = await renderInRouter(
    <DisplayPreferencesProvider initial={display}>
      <main className="p-4">
        <FinalDateForm setting={setting} />
      </main>
    </DisplayPreferencesProvider>,
  );
  const { queryClient } = router.options.context;
  const { queryKey } = adminYearFinalDateSettingsQueryOptions();
  queryClient.setQueryData(queryKey, SETTINGS_QUERY);
  return {
    settingsInvalidated: () =>
      queryClient.getQueryState(queryKey)?.isInvalidated ?? false,
  };
}

const select = () => page.getByRole('combobox', { name: FIELD_LABEL });
const option = (name: string) =>
  page.getByRole('option', { name, exact: true });
const submitButton = () =>
  page.getByRole('button', { name: SUBMIT_LABEL, exact: true });
const dialog = () => page.getByRole('dialog');
const reasonField = () => dialog().getByRole('textbox', { name: REASON_LABEL });
const confirmButton = () =>
  dialog().getByRole('button', { name: SUBMIT_LABEL, exact: true });
const cancelButton = () => dialog().getByRole('button', { name: 'キャンセル' });

async function chooseDate(label: string): Promise<void> {
  await userEvent.click(select());
  await userEvent.click(option(label));
}

async function openConfirm(label = '2027年6月6日(日)'): Promise<void> {
  await chooseDate(label);
  await userEvent.click(submitButton());
  await expect.element(dialog()).toBeVisible();
}

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('候補の選択', () => {
  test('ラベル付きの選択の欄は現在の決勝実施日を既定に選び、サーバーが返した候補だけを曜日つきの業務日付の<time>で並べる', async () => {
    respond();
    await renderForm(NEXT_YEAR_SETTING);

    await expect.element(select()).toHaveTextContent('2027年5月30日(日)');
    expect(
      select().element().querySelector('time')?.getAttribute('datetime'),
    ).toBe('2027-05-30');

    await userEvent.click(select());

    const options = page.getByRole('option').elements();
    expect(options.map((element) => element.textContent)).toStrictEqual([
      '2027年5月23日(日)',
      '2027年5月30日(日)',
      '2027年6月6日(日)',
    ]);
    expect(
      options.map((element) =>
        element.querySelector('time')?.getAttribute('datetime'),
      ),
    ).toStrictEqual(['2027-05-23', '2027-05-30', '2027-06-06']);
    await expect
      .element(option('2027年5月30日(日)'))
      .toHaveAttribute('aria-selected', 'true');
  });

  test('現在の決勝実施日が候補に無い時は、最初の候補を既定に選ぶ', async () => {
    respond();
    await renderForm(settingOf({ choices: ['2027-06-06', '2027-06-13'] }));

    await expect.element(select()).toHaveTextContent('2027年6月6日(日)');
  });

  test('候補が無い時は選べる日付が無い旨を示し、選択の欄と保存のボタンを置かない', async () => {
    respond();
    await renderForm(settingOf({ choices: [] }));

    await expect.element(page.getByText(NO_CHOICES_MESSAGE)).toBeVisible();
    expect(page.getByRole('combobox').elements()).toHaveLength(0);
    expect(submitButton().query()).toBeNull();
  });
});

describe('確認のダイアログ', () => {
  test('保存のボタンは、選んだ日付の題名と変更後の受付期限・組み合わせ決定・Week優勝の期間が変わる旨の説明、理由(任意)の欄と注記を持つ確認のダイアログを開き、キャンセルで送らずに閉じる', async () => {
    const update = vi.fn<UpdateHandler>();
    respond(update);
    await renderForm(NEXT_YEAR_SETTING);

    await openConfirm();

    await expect
      .element(page.getByRole('dialog', { name: CONFIRM_TITLE }))
      .toBeVisible();
    await expect.element(dialog().getByText(CONFIRM_DESCRIPTION)).toBeVisible();
    await expect.element(reasonField()).toBeVisible();
    await expect.element(dialog().getByText(REASON_NOTICE)).toBeVisible();
    await expect.element(dialog().getByText(AUDITED_NOTICE)).toBeVisible();
    await expect.element(confirmButton()).toBeVisible();

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(submitButton()).toHaveFocus();
    expect(update).not.toHaveBeenCalled();
  });

  test('変更後の日時は閲覧者のタイムゾーンで示す', async () => {
    respond();
    await renderForm(NEXT_YEAR_SETTING, { display: HONOLULU });

    await openConfirm();

    await expect
      .element(
        dialog().getByText(
          '受付期限は2027年5月31日(月) 21:00、組み合わせ決定は2027年5月31日(月) 21:45になり、対象となるWeek優勝の期間も変わります。',
        ),
      )
      .toBeVisible();
  });

  test('理由は500文字まで受け付け、超えると上限の文言を示して確定を押せなくする', async () => {
    const update = vi.fn<UpdateHandler>(() =>
      success({ updateYearFinalDate: SAVED_SETTING }),
    );
    respond(update);
    await renderForm(NEXT_YEAR_SETTING);

    await openConfirm();
    await userEvent.fill(reasonField(), 'あ'.repeat(501));
    await userEvent.tab();

    await expect
      .element(dialog().getByText(REASON_TOO_LONG_MESSAGE))
      .toBeVisible();
    await expect.element(confirmButton()).toBeDisabled();

    await userEvent.fill(reasonField(), 'あ'.repeat(500));
    await userEvent.click(confirmButton());

    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0].input.reason).toBe('あ'.repeat(500));
  });
});

describe('保存', () => {
  test('確定で対象年・選んだ日付・読み取った版・理由を送り、トーストで知らせて照会を読み直させる', async () => {
    const update = vi.fn<UpdateHandler>(() =>
      success({ updateYearFinalDate: SAVED_SETTING }),
    );
    respond(update);
    const { settingsInvalidated } = await renderForm(NEXT_YEAR_SETTING);

    await openConfirm();
    await userEvent.fill(reasonField(), 'リーグ最終節の変更');
    await userEvent.click(confirmButton());

    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toStrictEqual({
      input: {
        year: 2027,
        finalDate: '2027-06-06',
        expectedVersion: 2,
        reason: 'リーグ最終節の変更',
      },
    });
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(settingsInvalidated()).toBe(true);
  });

  test('現在の決勝実施日のまま保存でき、理由が空なら送らない', async () => {
    const update = vi.fn<UpdateHandler>(() =>
      success({ updateYearFinalDate: NEXT_YEAR_SETTING }),
    );
    respond(update);
    await renderForm(NEXT_YEAR_SETTING);

    await userEvent.click(submitButton());
    await expect
      .element(
        page.getByRole('dialog', {
          name: '2027年の決勝実施日を2027年5月30日(日)に変更しますか?',
        }),
      )
      .toBeVisible();
    await userEvent.click(confirmButton());

    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();
    const input = update.mock.calls[0]?.[0].input;
    expect(input).toMatchObject({ year: 2027, finalDate: '2027-05-30' });
    expect(input?.reason ?? undefined).toBeUndefined();
  });
});

describe('保存の失敗', () => {
  test.each([
    {
      name: '日曜日でない',
      code: 'not_sunday',
      message: '日曜日を選んでください。',
      expected: '日曜日を選んでください。',
    },
    {
      name: '8日後より前',
      code: 'too_soon',
      message: '現在から8日後以降の日付を選んでください。',
      expected: '現在から8日後以降の日付を選んでください。',
    },
    {
      name: '前年の決勝実施日との間隔の超過',
      code: 'too_far_from_previous',
      message:
        '前年の決勝実施日(2026年5月31日(日))から64週以上空く日付は選べません。',
      expected:
        '前年の決勝実施日(2026年5月31日(日))から64週以上空く日付は選べません。',
    },
    {
      name: '翌年の決勝実施日との間隔の超過',
      code: 'too_far_from_next',
      message:
        '翌年の決勝実施日(2028年5月28日(日))まで64週以上空く日付は選べません。',
      expected:
        '翌年の決勝実施日(2028年5月28日(日))まで64週以上空く日付は選べません。',
    },
    {
      name: '表示の後に変わった前年の決勝実施日との間隔の超過',
      code: 'too_far_from_previous',
      message:
        '前年の決勝実施日(2026年5月24日(日))から64週以上空く日付は選べません。',
      expected:
        '前年の決勝実施日(2026年5月24日(日))から64週以上空く日付は選べません。',
    },
    {
      name: '表示の後に変わった翌年の決勝実施日との間隔の超過',
      code: 'too_far_from_next',
      message:
        '翌年の決勝実施日(2028年6月4日(日))まで64週以上空く日付は選べません。',
      expected:
        '翌年の決勝実施日(2028年6月4日(日))まで64週以上空く日付は選べません。',
    },
    {
      name: 'サーバーの文が空の日曜日でない',
      code: 'not_sunday',
      message: '',
      expected: '日曜日を選んでください。',
    },
    {
      name: 'サーバーの文が空の前年の決勝実施日との間隔の超過',
      code: 'too_far_from_previous',
      message: '',
      expected:
        '前年の決勝実施日(2026年5月31日(日))から64週以上空く日付は選べません。',
    },
  ])(
    '選択の違反($name)は、理由の入力を保ったまま理由の文言をダイアログの中に示し、閉じた後に照会を読み直させる',
    async ({ code, message, expected }) => {
      respond(() =>
        failure({
          code: 'validation_error',
          message: '入力内容に誤りがあります。',
          status: 400,
          details: [{ field: 'input.finalDate', code, message }],
        }),
      );
      const { settingsInvalidated } = await renderForm(NEXT_YEAR_SETTING);

      await openConfirm();
      await userEvent.fill(reasonField(), '確認のため');
      await userEvent.click(confirmButton());

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(expected);
      expect(dialog().getByRole('alert').element().textContent).toBe(expected);
      await expect.element(reasonField()).toHaveValue('確認のため');
      await expect
        .element(page.getByRole('dialog', { name: CONFIRM_TITLE }))
        .toBeVisible();
      expect(settingsInvalidated()).toBe(false);

      await userEvent.click(cancelButton());

      await expect.element(dialog()).not.toBeInTheDocument();
      expect(settingsInvalidated()).toBe(true);
    },
  );

  test.each([
    {
      name: '変更期限の後',
      error: {
        code: 'final_date_locked',
        message: '変更期限を過ぎています。',
        status: 422,
      },
      expected: LOCKED_MESSAGE,
    },
    {
      name: '変更の競合',
      error: {
        code: 'version_conflict',
        message: '設定の版が一致しません。',
        status: 409,
      },
      expected: CONFLICT_MESSAGE,
    },
  ])(
    '$nameは、理由の入力を保ったまま案内の文言をダイアログの中に示し、閉じた後に照会を読み直させる',
    async ({ error, expected }) => {
      respond(() => failure(error));
      const { settingsInvalidated } = await renderForm(NEXT_YEAR_SETTING);

      await openConfirm();
      await userEvent.fill(reasonField(), '確認のため');
      await userEvent.click(confirmButton());

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(expected);
      expect(dialog().getByRole('alert').element().textContent).toBe(expected);
      await expect.element(reasonField()).toHaveValue('確認のため');

      await userEvent.click(cancelButton());

      await expect.element(dialog()).not.toBeInTheDocument();
      expect(settingsInvalidated()).toBe(true);
    },
  );

  test('その他のエラーコードの失敗は、APIの文言を示して照会を読み直させない', async () => {
    respond(() =>
      failure({
        code: 'forbidden',
        message: 'この操作を行う権限がありません。',
        status: 403,
      }),
    );
    const { settingsInvalidated } = await renderForm(NEXT_YEAR_SETTING);

    await openConfirm();
    await userEvent.fill(reasonField(), '確認のため');
    await userEvent.click(confirmButton());

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('この操作を行う権限がありません。');
    await expect.element(reasonField()).toHaveValue('確認のため');

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(settingsInvalidated()).toBe(false);
  });

  test('GraphQLClientErrorでない失敗は、理由の入力を保ったまま問い合わせを促す文を含まない文言を示す', async () => {
    respond(() => Promise.reject(new Error('通信の失敗')));
    await renderForm(NEXT_YEAR_SETTING);

    await openConfirm();
    await userEvent.fill(reasonField(), '確認のため');
    await userEvent.click(confirmButton());

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    expect(dialog().element().textContent).not.toContain(CONTACT_PHRASE);
    await expect.element(reasonField()).toHaveValue('確認のため');
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、選択の欄・候補の一覧・確認のダイアログ・保存の失敗がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(() =>
        failure({
          code: 'version_conflict',
          message: '設定の版が一致しません。',
          status: 409,
        }),
      );
      await renderForm(NEXT_YEAR_SETTING);
      await expect.element(select()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(select());
      await expect.element(option('2027年6月6日(日)')).toBeVisible();

      // 一覧を開くと外側はaria-hiddenになり、外側のフォーカスできる要素が違反に数えられるため、開いた一覧だけを検査する
      expect(await runAxe(page.getByRole('listbox').element())).toStrictEqual(
        [],
      );

      await userEvent.click(option('2027年6月6日(日)'));
      await userEvent.click(submitButton());
      await expect.element(dialog()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(confirmButton());
      await expect.element(dialog().getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、選べる日付が無い時の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond();
      await renderForm(settingOf({ choices: [] }));
      await expect.element(page.getByText(NO_CHOICES_MESSAGE)).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
