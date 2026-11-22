import { useRef, useState } from 'react';
import { expect, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import type { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
  type ReportTargetKind,
} from '../../../common-lib/reporting/report-rules.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  ClientReportCategoriesDocument,
  type ClientReportCategoriesQuery,
  ClientSubmitReportDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { ReportDialog } from './report-dialog.tsx';

// 呼び出す側のテストのファイルがvi.mockで模擬に替えた取得の関数を操る
const mockedExecuteGraphQL = vi.mocked(executeGraphQL);

export const SPAM_CATEGORY_ID = '01JE0SPAM00000000000000001';

export const CATEGORIES: ClientReportCategoriesQuery = Object.freeze({
  reportCategories: [
    { id: SPAM_CATEGORY_ID, name: 'スパム', infringement: false },
    {
      id: REPORT_CATEGORY_INFRINGEMENT_ID,
      name: '権利侵害',
      infringement: true,
    },
    { id: REPORT_CATEGORY_OTHER_ID, name: 'その他', infringement: false },
  ],
});

export const OPENER = '通報を開く';

export const DIALOG_DESCRIPTION =
  '通報内容は運営チームが確認します。通報者の情報が投稿者に伝わることはありません。';

export const ACCEPTED_MESSAGE =
  '通報を受け付けました。ご協力ありがとうございます。';

export const BOT_FAILURE_MESSAGE =
  '認証に失敗しました。ページを再読み込みして再度お試しください。';

export const CONTACT_EMAIL = 'owner@rights.example';

export const REASON = '私が撮影した写真が\n無断で使われています。';

export interface ReportHarnessOptions {
  readonly targetKind?: ReportTargetKind;
  readonly targetRef?: string;
  readonly viewer?: ClientViewerQuery;
}

function Harness({
  targetKind,
  targetRef,
}: {
  readonly targetKind: ReportTargetKind;
  readonly targetRef: string;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <main className="bg-background p-4 text-foreground">
        <button
          ref={openerRef}
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          {OPENER}
        </button>
        <ReportDialog
          targetKind={targetKind}
          targetRef={targetRef}
          open={open}
          onOpenChange={setOpen}
          returnFocusRef={openerRef}
        />
      </main>
      <Toaster />
    </>
  );
}

export const categoriesResult = (
  data: ClientReportCategoriesQuery = CATEGORIES,
) => Promise.resolve({ ok: true, data });

export const acceptedResult = () =>
  Promise.resolve({ ok: true, data: { submitReport: { accepted: true } } });

export const rejectWith = (error: GraphQLClientError) =>
  Promise.resolve({ ok: false, error });

type SubmitResponder = () => Promise<unknown>;

// カテゴリの照会には常に一覧を返し、通報の送信には渡した応答を順に返す(尽きたら最後の応答を繰り返す)
export function respondWith(...submitResponses: SubmitResponder[]): void {
  let submitted = 0;
  mockedExecuteGraphQL.mockImplementation(((document: unknown) => {
    if (document === ClientReportCategoriesDocument) {
      return categoriesResult();
    }
    if (document === ClientSubmitReportDocument) {
      const responder =
        submitResponses[Math.min(submitted, submitResponses.length - 1)];
      submitted += 1;
      return responder === undefined ? acceptedResult() : responder();
    }
    throw new Error('想定していない操作です。');
  }) as unknown as typeof executeGraphQL);
}

export const submitCalls = () =>
  mockedExecuteGraphQL.mock.calls.filter(
    ([document]) => document === ClientSubmitReportDocument,
  );

export const dialog = () => page.getByRole('dialog');

export const opener = () => page.getByRole('button', { name: OPENER });

export const radio = (name: string) => dialog().getByRole('radio', { name });

export const reasonInput = () =>
  dialog().getByRole('textbox', { name: '理由(必須)' });

export const contactInput = () =>
  dialog().getByRole('textbox', { name: '連絡先メールアドレス(必須)' });

export const submitButton = () =>
  dialog().getByRole('button', { name: '通報する' });

export const cancelButton = () =>
  dialog().getByRole('button', { name: 'キャンセル' });

export const formAlert = () => dialog().getByRole('form').getByRole('alert');

// ダイアログを閉じたまま、開く操作だけを描く
export async function renderReportHarness({
  targetKind = 'product',
  targetRef = '01JC0PRODUCT00000000000000',
  viewer,
}: ReportHarnessOptions = {}): Promise<RouterContext> {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <Harness targetKind={targetKind} targetRef={targetRef} />,
    { context, ...(viewer === undefined ? {} : { cachedViewer: viewer }) },
  );
  return context;
}

export async function openReportDialog(
  options: ReportHarnessOptions = {},
): Promise<RouterContext> {
  const context = await renderReportHarness(options);
  await userEvent.click(opener());
  await expect.element(dialog()).toBeVisible();
  return context;
}

// モーダルのダイアログの間は外側の要素が支援技術とポインターから隠れるため、ダイアログの外に描く判定の偽物のボタンは要素を直接押す
export function pressFakeTurnstile(name: string): void {
  const button = page.getByText(name).element();
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`判定の偽物のボタン「${name}」がありません。`);
  }
  button.click();
}

export const passBotCheck = () => {
  pressFakeTurnstile('判定を成功させる');
};

export async function fillValidReport(category = 'スパム'): Promise<void> {
  await userEvent.click(radio(category));
  await userEvent.fill(reasonInput(), REASON);
}
