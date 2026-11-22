import { useId, useRef } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

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
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientMyDataExportsDocument,
  ClientRequestDataExportDocument,
  ClientResendVerificationEmailDocument,
  type DataExportFieldsFragment,
} from '../../graphql/generated/graphql.ts';
import { DataExportPanel } from './data-export-panel.tsx';
import { pendingExportOf, readyExportOf } from './data-export-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const HEADING = 'データエクスポート';
const VIEWER_ID = signedInViewerQuery().viewer?.id ?? '';
const RETRY_AFTER_SECONDS = 5400;
const MILLISECONDS_PER_SECOND = 1000;

const FAILED_MESSAGE =
  '要求を受け付けられませんでした。時間をおいて再度お試しください。';
const NOT_VERIFIED_MESSAGE =
  'データエクスポートはメールアドレスの確認後に利用できます。';
const REQUESTED_MESSAGE =
  'エクスポートを受け付けました。準備ができたらメールでお知らせします。';

const failure = (
  init: ConstructorParameters<typeof GraphQLClientError>[0],
) => ({
  ok: false,
  error: new GraphQLClientError(init),
});

const RATE_LIMITED = failure({
  code: 'rate_limit_exceeded',
  message: '操作が集中しています。しばらく待ってから再度お試しください。',
  status: 429,
  retryAfterSeconds: RETRY_AFTER_SECONDS,
});

const listResult = (nodes: readonly DataExportFieldsFragment[]) => ({
  ok: true,
  data: {
    myDataExports: {
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  },
});

interface Responders {
  readonly list?: () => Promise<unknown>;
  readonly request?: () => Promise<unknown>;
  readonly resend?: () => Promise<unknown>;
}

const respond = ({
  list = () => Promise.resolve(listResult([readyExportOf(1)])),
  request = () =>
    Promise.resolve({
      ok: true,
      data: { requestDataExport: pendingExportOf(2) },
    }),
  resend = () =>
    Promise.resolve({
      ok: true,
      data: { resendVerificationEmail: 'SENT' },
    }),
}: Responders = {}): void => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientMyDataExportsDocument) {
      return list();
    }
    if (document === ClientRequestDataExportDocument) {
      return request();
    }
    if (document === ClientResendVerificationEmailDocument) {
      return resend();
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

function Harness({ emailVerified }: { readonly emailVerified: boolean }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main className="bg-background p-4 text-foreground">
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>
          {HEADING}
        </h1>
        <DataExportPanel
          viewerId={VIEWER_ID}
          emailVerified={emailVerified}
          labelledBy={headingId}
          retryFocusRef={headingRef}
        />
      </main>
      <Toaster />
    </DisplayPreferencesProvider>
  );
}

const renderPanel = ({ emailVerified = true } = {}) =>
  renderInRouter(<Harness emailVerified={emailVerified} />, {
    path: '/settings/export',
    cachedViewer: signedInViewerQuery({ emailVerified }),
  });

const main = () => page.getByRole('main');
const requestButton = () =>
  main().getByRole('button', { name: 'エクスポートを要求' });
const busyButton = () => main().getByRole('button', { name: '送信中' });
const alert = () => main().getByRole('alert');

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('DataExportPanel', () => {
  test('含まれるデータ・24時間に3回の上限・7日間・メールでの通知の説明と、有効な要求のボタンを示し、確認の案内は出さない', async () => {
    respond();

    await renderPanel();

    await expect
      .element(
        main().getByText(
          'プロフィール・プロダクト・コメント・決済履歴・問い合わせなど、あなたのデータを1つのZIPファイルにまとめてダウンロードできます。',
        ),
      )
      .toBeVisible();
    await expect
      .element(
        main().getByText(
          '要求は24時間に3回までです。準備ができたらメールでお知らせします。ダウンロードできる期間は準備ができてから7日間です。',
        ),
      )
      .toBeVisible();
    await expect.element(requestButton()).toBeEnabled();
    expect(main().getByText(NOT_VERIFIED_MESSAGE).elements()).toHaveLength(0);
    await expect
      .poll(() => main().getByRole('listitem').elements())
      .toHaveLength(1);
  });

  test('メールアドレスが未確認なら、要求のボタンを無効にして確認の案内と確認メールの再送を示し、再送を送れる', async () => {
    respond();

    await renderPanel({ emailVerified: false });

    await expect.element(requestButton()).toBeDisabled();
    const note = main().getByRole('note', { name: 'メールアドレスの確認' });
    await expect.element(note).toHaveTextContent(NOT_VERIFIED_MESSAGE);

    await userEvent.click(
      note.getByRole('button', { name: '確認メールを再送' }),
    );

    await expect
      .poll(() => callsOf(ClientResendVerificationEmailDocument))
      .toHaveLength(1);
    expect(callsOf(ClientRequestDataExportDocument)).toHaveLength(0);
  });

  test('要求の送信中はボタンを操作できず送信中であることを示し、重ねて押しても1回だけ送る', async () => {
    const pending = Promise.withResolvers<unknown>();
    respond({ request: () => pending.promise });
    await renderPanel();
    await expect.element(requestButton()).toBeEnabled();

    await userEvent.click(requestButton());

    await expect.element(busyButton()).toHaveAttribute('aria-busy', 'true');
    await expect.element(busyButton()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(busyButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(callsOf(ClientRequestDataExportDocument)).toHaveLength(1);

    pending.resolve({
      ok: true,
      data: { requestDataExport: pendingExportOf(2) },
    });
    await expect.element(requestButton()).toBeEnabled();
    await expect.element(requestButton()).not.toHaveAttribute('aria-busy');
  });

  test('受け付けたら受け付けの通知を示し、一覧を取り直して作成中の要求を加える', async () => {
    let requested = false;
    respond({
      list: () =>
        Promise.resolve(
          listResult(
            requested
              ? [pendingExportOf(2), readyExportOf(1)]
              : [readyExportOf(1)],
          ),
        ),
      request: () => {
        requested = true;
        return Promise.resolve({
          ok: true,
          data: { requestDataExport: pendingExportOf(2) },
        });
      },
    });
    await renderPanel();
    await expect
      .poll(() => main().getByRole('listitem').elements())
      .toHaveLength(1);

    await userEvent.click(requestButton());

    await expect.element(page.getByText(REQUESTED_MESSAGE)).toBeVisible();
    await expect
      .poll(() => main().getByRole('listitem').elements())
      .toHaveLength(2);
    await expect
      .element(main().getByRole('listitem').first())
      .toHaveTextContent('作成中');
    expect(callsOf(ClientMyDataExportsDocument)).toHaveLength(2);
    expect(alert().elements()).toHaveLength(0);
  });

  test('回数の上限で拒否されたら、再び要求できる日時を<time datetime>で示し、ボタンは操作できるままにする', async () => {
    respond({ request: () => Promise.resolve(RATE_LIMITED) });
    await renderPanel();
    await expect.element(requestButton()).toBeEnabled();

    const before = Date.now();
    await userEvent.click(requestButton());

    await expect
      .element(alert())
      .toHaveTextContent(
        /^要求の上限\(24時間に3回\)に達しました。.+以降に再度お試しください。$/u,
      );
    const time = alert().element().querySelector('time');
    const retryAt = new Date(time?.getAttribute('datetime') ?? '').getTime();
    expect(retryAt).toBeGreaterThanOrEqual(
      before + RETRY_AFTER_SECONDS * MILLISECONDS_PER_SECOND,
    );
    expect(retryAt).toBeLessThanOrEqual(
      Date.now() + RETRY_AFTER_SECONDS * MILLISECONDS_PER_SECOND,
    );
    expect(time?.textContent).toMatch(/\d{1,2}:\d{2}/u);
    await expect.element(requestButton()).toBeEnabled();
    expect(page.getByText(REQUESTED_MESSAGE).elements()).toHaveLength(0);
  });

  test.each([
    [
      'サーバーがメールアドレスの未確認で拒否した',
      failure({
        code: 'email_not_verified',
        message: 'この操作にはメールアドレスの確認が必要です。',
        status: 200,
      }),
      NOT_VERIFIED_MESSAGE,
    ],
    [
      '生成の依頼を送れなかった',
      failure({
        code: 'data_export_unavailable',
        message: FAILED_MESSAGE,
        status: 503,
      }),
      FAILED_MESSAGE,
    ],
    [
      '通信が失敗した',
      failure({
        code: 'network_error',
        message: '通信に失敗しました。時間をおいて再度お試しください。',
        status: 0,
      }),
      FAILED_MESSAGE,
    ],
  ])(
    '%sときは、理由に応じた文言を示し、再び要求すると文言を消して受け付ける',
    async (_name, result, message) => {
      let attempts = 0;
      respond({
        request: () => {
          attempts += 1;
          return attempts === 1
            ? Promise.resolve(result)
            : Promise.resolve({
                ok: true,
                data: { requestDataExport: pendingExportOf(2) },
              });
        },
      });
      await renderPanel();
      await expect.element(requestButton()).toBeEnabled();

      await userEvent.click(requestButton());

      await expect.element(alert()).toHaveTextContent(message);
      await expect.element(requestButton()).toBeEnabled();

      await userEvent.click(requestButton());

      await expect.element(page.getByText(REQUESTED_MESSAGE)).toBeVisible();
      expect(alert().elements()).toHaveLength(0);
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([
      ['確認済み', true],
      ['未確認', false],
    ])(
      '%sの利用者で、アクセシビリティの検査の違反が0件',
      async (_name, verified) => {
        respond();
        await renderPanel({ emailVerified: verified });
        await expect
          .poll(() => main().getByRole('listitem').elements())
          .toHaveLength(1);

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );

    test('回数の上限の文言を示した状態で、アクセシビリティの検査の違反が0件', async () => {
      respond({ request: () => Promise.resolve(RATE_LIMITED) });
      await renderPanel();
      await expect.element(requestButton()).toBeEnabled();
      await userEvent.click(requestButton());
      await expect.element(alert()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
