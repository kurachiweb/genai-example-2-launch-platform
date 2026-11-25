import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import type { ReportTargetKind } from '../../../common-lib/reporting/report-rules.ts';
import {
  ClientReportCategoriesDocument,
  ClientSubmitReportDocument,
} from '../../graphql/generated/graphql.ts';
import {
  ACCEPTED_MESSAGE,
  acceptedResult,
  cancelButton,
  categoriesResult,
  DIALOG_DESCRIPTION,
  dialog,
  fillValidReport,
  openReportDialog,
  opener,
  renderReportHarness,
  passBotCheck,
  radio,
  reasonInput,
  rejectWith,
  respondWith,
  submitButton,
  submitCalls,
} from './report-dialog-testing.tsx';

const { executeGraphQL: mockedExecuteGraphQL } = vi.hoisted(() => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: mockedExecuteGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const LOAD_ERROR = 'カテゴリを読み込めませんでした。';

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const categoryCalls = () =>
  vi
    .mocked(executeGraphQL)
    .mock.calls.filter(
      ([document]) => document === ClientReportCategoriesDocument,
    );

beforeEach(() => {
  mockedExecuteGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('ReportDialog', () => {
  test.each<[ReportTargetKind, string]>([
    ['user', 'このユーザーを通報'],
    ['product', 'このプロダクトを通報'],
    ['comment', 'このコメントを通報'],
  ])(
    '対象の種類が%sなら、ページを移動せず題「%s」と通報者の情報が伝わらない旨の説明のダイアログを開く',
    async (targetKind, title) => {
      respondWith();
      await openReportDialog({ targetKind });

      await expect
        .element(page.getByRole('dialog', { name: title }))
        .toHaveAccessibleDescription(DIALOG_DESCRIPTION);
      await expect
        .element(dialog().getByRole('heading', { name: title }))
        .toBeVisible();
    },
  );

  test('開くまでカテゴリを取得せず、開いた時に取得する', async () => {
    respondWith();
    await renderReportHarness();
    await expect.element(opener()).toBeVisible();
    expect(categoryCalls()).toHaveLength(0);

    await userEvent.click(opener());

    await expect.element(radio('スパム')).toBeVisible();
    expect(categoryCalls()).toHaveLength(1);
  });

  test('カテゴリの取得中は、見えない文言「読み込み中」を持つ状態の領域を示し、スケルトンを支援技術から隠す', async () => {
    mockedExecuteGraphQL.mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    await openReportDialog();

    const status = dialog().getByRole('status');
    await expect.element(status).toHaveTextContent('読み込み中');
    const skeletons = status
      .element()
      .querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
    for (const skeleton of skeletons) {
      expect(skeleton.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(dialog().getByRole('form').query()).toBeNull();
  });

  test('カテゴリの取得に失敗すると、ダイアログの中だけに文言と再試行を示し、再試行で取得し直してフォームを示す', async () => {
    mockedExecuteGraphQL
      .mockImplementationOnce(() => rejectWith(INTERNAL_ERROR))
      .mockImplementation(() => categoriesResult());
    await openReportDialog();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR);
    expect(dialog().getByRole('form').query()).toBeNull();
    await expect.element(dialog()).toBeVisible();

    await userEvent.click(dialog().getByRole('button', { name: '再試行' }));

    await expect.element(radio('スパム')).toBeVisible();
    expect(dialog().getByText(LOAD_ERROR).query()).toBeNull();
    expect(categoryCalls()).toHaveLength(2);
    expect(dialog().element().contains(document.activeElement)).toBe(true);
  });

  test('「キャンセル」で閉じ、開いた操作へフォーカスを戻し、開き直すと入力を破棄している', async () => {
    respondWith();
    await openReportDialog();
    await fillValidReport();

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(submitCalls()).toHaveLength(0);

    await userEvent.click(opener());
    await expect.element(reasonInput()).toHaveValue('');
    await expect.element(radio('スパム')).not.toBeChecked();
  });

  test('Escapeで閉じ、開いた操作へフォーカスを戻す', async () => {
    respondWith();
    await openReportDialog();
    await expect.element(radio('スパム')).toBeVisible();

    await userEvent.keyboard('{Escape}');

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  test('受け付けられると受け付けた旨を通知して閉じ、開いた操作へフォーカスを戻す', async () => {
    respondWith(acceptedResult);
    await openReportDialog({ targetKind: 'user', targetRef: 'pitch_maker' });
    passBotCheck();
    await fillValidReport();

    await userEvent.click(submitButton());

    await expect.element(page.getByText(ACCEPTED_MESSAGE)).toBeVisible();
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(submitCalls()).toEqual([
      [
        ClientSubmitReportDocument,
        {
          input: {
            targetKind: 'USER',
            targetRef: 'pitch_maker',
            categoryId: expect.any(String) as string,
            reason: expect.any(String) as string,
          },
        },
        { turnstileToken: 'turnstile-token-1' },
      ],
    ]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('開いた直後・カテゴリの取得の失敗・入力の誤りの表示で、アクセシビリティの検査の違反が0件', async () => {
      mockedExecuteGraphQL
        .mockImplementationOnce(() => rejectWith(INTERNAL_ERROR))
        .mockImplementation(() => categoriesResult());
      await openReportDialog();
      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(LOAD_ERROR);
      const failed = await runAxe(dialog().element());

      await userEvent.click(dialog().getByRole('button', { name: '再試行' }));
      await expect.element(radio('スパム')).toBeVisible();
      const loaded = await runAxe(dialog().element());

      await userEvent.click(reasonInput());
      await userEvent.tab();
      await expect
        .element(reasonInput())
        .toHaveAttribute('aria-invalid', 'true');

      expect(failed).toStrictEqual([]);
      expect(loaded).toStrictEqual([]);
      expect(await runAxe(dialog().element())).toStrictEqual([]);
    });
  });
});
