import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
} from '../../../common-lib/reporting/report-rules.ts';
import { GUEST_VIEWER_QUERY } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import {
  ACCEPTED_MESSAGE,
  acceptedResult,
  BOT_FAILURE_MESSAGE,
  CONTACT_EMAIL,
  contactInput,
  dialog,
  fillValidReport,
  formAlert,
  openReportDialog,
  passBotCheck,
  pressFakeTurnstile,
  radio,
  REASON,
  reasonInput,
  rejectWith,
  respondWith,
  SPAM_CATEGORY_ID,
  submitButton,
  submitCalls,
} from './report-dialog-testing.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const PRODUCT_ID = '01JC0PRODUCT00000000000000';

const SIGNED_IN = signedInViewerQuery();

const SUSPENDED = signedInViewerQuery({ status: 'SUSPENDED' });

const CONTACT_DESCRIPTION =
  '権利侵害の申出への対応結果をお知らせするために使います。';

const INFRINGEMENT_GUIDE =
  '侵害されている権利、権利者との関係、対象の箇所を書いてください。';

const VALIDATION_MESSAGE = '入力内容を確認してください。';

const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const botVerificationFailed = () =>
  new GraphQLClientError({
    code: 'bot_verification_failed',
    message: BOT_FAILURE_MESSAGE,
    status: 200,
  });

const validationError = (field: string, message: string) =>
  new GraphQLClientError({
    code: 'validation_error',
    message: VALIDATION_MESSAGE,
    status: 400,
    details: [{ field, code: 'invalid', message }],
  });

const submittedInput = (index = 0): unknown =>
  (submitCalls()[index]?.[1] as { readonly input: unknown } | undefined)?.input;

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('ReportForm', () => {
  test('カテゴリはAPIサーバーの並びのまま「カテゴリ」の群のラジオボタンで示し、理由の欄を示す', async () => {
    respondWith();
    await openReportDialog();

    const group = dialog().getByRole('radiogroup', { name: 'カテゴリ' });
    await expect.element(group).toBeVisible();
    expect(
      group
        .getByRole('radio')
        .elements()
        .map((element) => element.getAttribute('value')),
    ).toEqual([
      SPAM_CATEGORY_ID,
      REPORT_CATEGORY_INFRINGEMENT_ID,
      REPORT_CATEGORY_OTHER_ID,
    ]);
    await expect.element(radio('スパム')).toBeVisible();
    await expect.element(radio('権利侵害')).toBeVisible();
    await expect.element(radio('その他')).toBeVisible();
    await expect.element(reasonInput()).toBeVisible();
    expect(contactInput().query()).toBeNull();
  });

  test('理由の入力中の書記素の数を上限とともに示し、上限を超えると誤りを示す', async () => {
    respondWith();
    await openReportDialog();

    await expect.element(dialog().getByText('0 / 1,000')).toBeVisible();
    await userEvent.fill(reasonInput(), ' 👨‍👩‍👧あい\n');
    await expect.element(dialog().getByText('3 / 1,000')).toBeVisible();

    await userEvent.fill(reasonInput(), 'あ'.repeat(1001));
    await expect.element(dialog().getByText('1,001 / 1,000')).toBeVisible();
    await userEvent.tab();
    await expect
      .element(reasonInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          '理由は1,000文字以内で入力してください。',
        ) as string,
      );
  });

  test('「権利侵害」を選ぶと、理由の欄に侵害の内容を書く案内を示す', async () => {
    respondWith();
    await openReportDialog({ viewer: SIGNED_IN });

    expect(dialog().getByText(INFRINGEMENT_GUIDE).query()).toBeNull();
    await userEvent.click(radio('権利侵害'));

    await expect
      .element(reasonInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(INFRINGEMENT_GUIDE) as string,
      );
    await userEvent.click(radio('その他'));
    expect(dialog().getByText(INFRINGEMENT_GUIDE).query()).toBeNull();
  });

  test.each([
    ['未ログイン', GUEST_VIEWER_QUERY],
    ['停止中', SUSPENDED],
  ])(
    '%sで「権利侵害」を選んだ時だけ、連絡先メールアドレスの欄を用途の案内とともに示して必須にする',
    async (_label, viewer) => {
      respondWith();
      await openReportDialog({ viewer });

      await userEvent.click(radio('スパム'));
      expect(contactInput().query()).toBeNull();

      await userEvent.click(radio('権利侵害'));
      await expect
        .element(contactInput())
        .toHaveAccessibleDescription(CONTACT_DESCRIPTION);
      await expect.element(contactInput()).toHaveAttribute('aria-required');

      await userEvent.click(contactInput());
      await userEvent.tab();
      await expect
        .element(contactInput())
        .toHaveAccessibleDescription(
          expect.stringContaining(
            '連絡先メールアドレスを入力してください。',
          ) as string,
        );
    },
  );

  test('ログイン中で停止中でなければ、「権利侵害」を選んでも連絡先メールアドレスの欄を示さない', async () => {
    respondWith();
    await openReportDialog({ viewer: SIGNED_IN });

    await userEvent.click(radio('権利侵害'));

    await expect.element(reasonInput()).toBeVisible();
    expect(contactInput().query()).toBeNull();
  });

  test('連絡先の欄を描いている間だけ連絡先を前後の空白を除いて送り、他のカテゴリへ変えて描かなくなると入力した値を送らない', async () => {
    respondWith(acceptedResult);
    await openReportDialog();
    passBotCheck();

    await fillValidReport('権利侵害');
    await userEvent.fill(contactInput(), ` ${CONTACT_EMAIL} `);
    await userEvent.click(radio('その他'));
    await userEvent.click(submitButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(submittedInput()).toStrictEqual({
      targetKind: 'PRODUCT',
      targetRef: PRODUCT_ID,
      categoryId: REPORT_CATEGORY_OTHER_ID,
      reason: REASON,
    });
  });

  test('未ログインの権利侵害の通報は、連絡先を前後の空白を除いて送る', async () => {
    respondWith(acceptedResult);
    await openReportDialog({
      targetKind: 'comment',
      targetRef: '01JC0C0MMENT00000000000000',
    });
    passBotCheck();

    await fillValidReport('権利侵害');
    await userEvent.fill(contactInput(), ` ${CONTACT_EMAIL}\n`);
    await userEvent.click(submitButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(submittedInput()).toStrictEqual({
      targetKind: 'COMMENT',
      targetRef: '01JC0C0MMENT00000000000000',
      categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
      reason: REASON,
      contactEmail: CONTACT_EMAIL,
    });
  });

  test('権利侵害で連絡先に誤りを入れてから他のカテゴリへ変えると、連絡先の誤りが残らず送信ボタンが有効になる', async () => {
    respondWith();
    await openReportDialog();

    await fillValidReport('権利侵害');
    await userEvent.fill(contactInput(), 'owner@');
    await userEvent.tab();
    await expect
      .element(contactInput())
      .toHaveAttribute('aria-invalid', 'true');
    await expect.element(submitButton()).toBeDisabled();

    await userEvent.click(radio('スパム'));

    expect(contactInput().query()).toBeNull();
    await expect.element(submitButton()).toBeEnabled();
  });

  test('描かれていない連絡先の欄へのサーバーの詳細は、フォーム全体の失敗として示し、送信ボタンを無効のまま残さない', async () => {
    respondWith(() =>
      rejectWith(
        validationError(
          'input.contactEmail',
          '連絡先メールアドレスを入力してください。',
        ),
      ),
    );
    await openReportDialog({ viewer: SIGNED_IN });
    passBotCheck();

    await fillValidReport('権利侵害');
    await userEvent.click(submitButton());

    await expect.element(formAlert()).toHaveTextContent(VALIDATION_MESSAGE);
    expect(contactInput().query()).toBeNull();
    await expect.element(submitButton()).toBeEnabled();
    await expect.element(reasonInput()).toHaveValue(REASON);
  });

  test('サーバーが返した欄の詳細は、その欄の誤りとして示し入力を保つ', async () => {
    respondWith(() =>
      rejectWith(validationError('input.reason', '理由を入力してください。')),
    );
    await openReportDialog();
    passBotCheck();

    await fillValidReport();
    await userEvent.click(submitButton());

    await expect.element(reasonInput()).toHaveFocus();
    await expect
      .element(reasonInput())
      .toHaveAccessibleDescription(
        expect.stringContaining('理由を入力してください。') as string,
      );
    expect(formAlert().query()).toBeNull();
    await expect.element(reasonInput()).toHaveValue(REASON);
  });

  test('欄に誤りがあると送信せずに欄ごとの誤りを示し、入力を保つ', async () => {
    respondWith();
    await openReportDialog();
    passBotCheck();

    await userEvent.fill(reasonInput(), REASON);
    // 送信ボタンは未選択の間は無効のため、Enterでの送信と同じくフォームの送信を直接起こす
    const form = dialog().getByRole('form').element();
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('フォームがありません。');
    }
    form.requestSubmit();

    await expect
      .element(dialog().getByRole('radiogroup', { name: 'カテゴリ' }))
      .toHaveAccessibleDescription('カテゴリを選んでください。');
    expect(submitCalls()).toHaveLength(0);
    await expect.element(reasonInput()).toHaveValue(REASON);
  });

  test('bot判定は操作名reportの非表示のウィジェットで行い、判定の枠と場所を画面に設けない', async () => {
    respondWith();
    await openReportDialog();

    const widget = page.getByTestId('fake-turnstile');
    await expect.element(widget).toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'report',
      size: 'invisible',
    });
    const { width, height } = widget.element().getBoundingClientRect();
    expect({ width, height }).toEqual({ width: 0, height: 0 });
    expect(getComputedStyle(widget.element()).position).toBe('absolute');
  });

  test('bot判定のトークンが届く前の送信がbot判定に失敗すると、新しいトークンで1回だけ送り直して受け付ける', async () => {
    respondWith(() => rejectWith(botVerificationFailed()), acceptedResult);
    await openReportDialog();

    await fillValidReport();
    await userEvent.click(submitButton());
    await expect.poll(() => submitCalls().length).toBe(1);
    passBotCheck();

    await expect.element(page.getByText(ACCEPTED_MESSAGE)).toBeVisible();
    expect(submitCalls().map(([, , options]) => options)).toEqual([
      { turnstileToken: undefined },
      { turnstileToken: 'turnstile-token-1' },
    ]);
  });

  test('送り直しもbot判定に失敗すると、それ以上送らずに判定の失敗の文言を示して入力を保つ', async () => {
    respondWith(() => rejectWith(botVerificationFailed()));
    await openReportDialog();
    passBotCheck();

    await fillValidReport();
    await userEvent.click(submitButton());
    await expect.poll(() => submitCalls().length).toBe(1);
    passBotCheck();

    await expect.element(formAlert()).toHaveTextContent(BOT_FAILURE_MESSAGE);
    expect(submitCalls()).toHaveLength(2);
    await expect.element(reasonInput()).toHaveValue(REASON);
  });

  test('bot判定のウィジェットが失敗すると、判定の失敗の文言を示す', async () => {
    respondWith();
    await openReportDialog();

    pressFakeTurnstile('判定を失敗させる');

    await expect.element(dialog().getByText(BOT_FAILURE_MESSAGE)).toBeVisible();
  });

  test('bot判定以外の失敗は送り直さない', async () => {
    respondWith(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'report_target_not_found',
          message:
            '通報の対象が見つかりません。ページを読み込み直してください。',
          status: 404,
        }),
      ),
    );
    await openReportDialog();
    passBotCheck();

    await fillValidReport();
    await userEvent.click(submitButton());

    await expect.element(formAlert()).toBeVisible();
    expect(submitCalls()).toHaveLength(1);
  });

  test.each([
    [
      'report_target_not_found',
      404,
      '通報の対象が見つかりません。ページを読み込み直してください。',
    ],
    ['report_own_content', 422, '自分のコンテンツは通報できません。'],
    [
      'rate_limited',
      429,
      '操作が集中しています。しばらく待ってから再度お試しください。',
    ],
    [
      'bot_verification_unavailable',
      503,
      '現在ご利用いただけません。時間をおいて再度お試しください。',
    ],
  ])(
    '%sの拒否はフォームの上部に文言を示し、ダイアログを開いたまま入力を保って再試行できる',
    async (code, status, message) => {
      respondWith(
        () => rejectWith(new GraphQLClientError({ code, message, status })),
        acceptedResult,
      );
      await openReportDialog();
      passBotCheck();
      await fillValidReport();

      await userEvent.click(submitButton());

      await expect.element(formAlert()).toHaveTextContent(message);
      await expect.element(reasonInput()).toHaveValue(REASON);
      await expect.element(radio('スパム')).toBeChecked();

      passBotCheck();
      await userEvent.click(submitButton());
      await expect.element(page.getByText(ACCEPTED_MESSAGE)).toBeVisible();
    },
  );

  test('GraphQLClientErrorでない例外は、例外の文言を出さず想定外の失敗の文言を示す', async () => {
    respondWith(() => Promise.reject(new TypeError('Failed to fetch')));
    await openReportDialog();
    passBotCheck();
    await fillValidReport();

    await userEvent.click(submitButton());

    await expect.element(formAlert()).toHaveTextContent(UNEXPECTED_MESSAGE);
    await expect.element(reasonInput()).toHaveValue(REASON);
  });

  test('ログイン状態はルートが入れた閲覧者の取得のキャッシュから読み、変わると連絡先の欄を出し分け直す', async () => {
    respondWith();
    const context = await openReportDialog({ viewer: SIGNED_IN });
    await userEvent.click(radio('権利侵害'));
    expect(contactInput().query()).toBeNull();

    context.queryClient.setQueryData(
      viewerQueryOptions().queryKey,
      GUEST_VIEWER_QUERY,
    );

    await expect.element(contactInput()).toBeVisible();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('連絡先の欄と誤りとフォームの上部の失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWith(() =>
        rejectWith(
          new GraphQLClientError({
            code: 'rate_limited',
            message:
              '操作が集中しています。しばらく待ってから再度お試しください。',
            status: 429,
          }),
        ),
      );
      await openReportDialog();
      passBotCheck();

      await fillValidReport('権利侵害');
      await userEvent.click(contactInput());
      await userEvent.tab();
      await expect
        .element(contactInput())
        .toHaveAttribute('aria-invalid', 'true');
      const invalid = await runAxe(dialog().element());

      await userEvent.fill(contactInput(), CONTACT_EMAIL);
      await userEvent.click(submitButton());
      await expect.element(formAlert()).toBeVisible();

      expect(invalid).toStrictEqual([]);
      expect(await runAxe(dialog().element())).toStrictEqual([]);
    });
  });
});
