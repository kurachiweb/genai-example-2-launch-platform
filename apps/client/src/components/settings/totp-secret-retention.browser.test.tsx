import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';

import '../../styles.css';
import {
  mySessionsResult,
  RECOVERY_CODES,
  renderSecurityPage,
  TOTP_SECRET,
  TOTP_SETUP,
} from '../../../test/security-fixtures.tsx';
import { CURRENT_PASSWORD } from '../../../test/settings-fixtures.ts';
import {
  signedInViewerQuery,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientEnableTotpDocument,
  ClientMySessionsDocument,
  ClientRegenerateRecoveryCodesDocument,
  ClientStartTotpSetupDocument,
  ClientViewerDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const totpRegion = () => page.getByRole('region', { name: '多要素認証' });
const setupDialog = () =>
  page.getByRole('dialog', { name: '多要素認証の設定' });
const regenerateForm = () =>
  page.getByRole('form', { name: 'リカバリコードの再発行' });
const codesDialog = () =>
  page.getByRole('dialog', { name: '新しいリカバリコード' });

type Handler = () => Promise<unknown>;

const ok = (data: unknown) => () => Promise.resolve({ ok: true, data });

function respond(handlers: ReadonlyMap<unknown, Handler>): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    const handler = handlers.get(document);
    if (handler === undefined) {
      throw new Error('想定していない操作が実行されました。');
    }
    return handler();
  });
}

const refetched = (totpEnabled: boolean) =>
  new Map<unknown, Handler>([
    [
      ClientMySessionsDocument,
      () => Promise.resolve(mySessionsResult({ totpEnabled })),
    ],
    [
      ClientViewerDocument,
      () => Promise.resolve(viewerResult(signedInViewerQuery({ totpEnabled }))),
    ],
  ]);

// 変更の結果の保管場所に、この時だけ見せる値の平文が残っていないか
const mutationCacheText = (queryClient: QueryClient): string =>
  JSON.stringify(
    queryClient
      .getMutationCache()
      .getAll()
      .map(({ state }) => state.data ?? null),
  );

const PLAINTEXTS: readonly string[] = [TOTP_SECRET, ...RECOVERY_CODES];

async function expectNoPlaintext(queryClient: QueryClient): Promise<void> {
  await expect
    .poll(() => {
      const text = mutationCacheText(queryClient);
      return PLAINTEXTS.filter((value) => text.includes(value));
    })
    .toEqual([]);
}

async function startSetup(): Promise<void> {
  await userEvent.type(
    totpRegion().getByLabelText('現在のパスワード(必須)', { exact: true }),
    CURRENT_PASSWORD,
  );
  await userEvent.click(
    totpRegion().getByRole('button', { name: '設定を始める' }),
  );
  await expect.element(setupDialog().getByText(TOTP_SECRET)).toBeVisible();
}

async function regenerateCodes(): Promise<void> {
  await userEvent.type(
    regenerateForm().getByLabelText('現在のパスワード(必須)', { exact: true }),
    CURRENT_PASSWORD,
  );
  await userEvent.type(
    regenerateForm().getByRole('textbox', { name: '認証コード(必須)' }),
    '123456',
  );
  await userEvent.click(
    regenerateForm().getByRole('button', {
      name: 'リカバリコードを再発行する',
    }),
  );
  await expect
    .element(codesDialog().getByText(RECOVERY_CODES[0] ?? ''))
    .toBeVisible();
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

describe('秘密鍵とリカバリコードの平文を変更の結果の保管場所に残さない', () => {
  test('設定を有効にしてダイアログを閉じた後、秘密鍵とリカバリコードが残らない', async () => {
    respond(
      new Map<unknown, Handler>([
        [ClientStartTotpSetupDocument, ok({ startTotpSetup: TOTP_SETUP })],
        [
          ClientEnableTotpDocument,
          ok({ enableTotp: { codes: RECOVERY_CODES } }),
        ],
        ...refetched(true),
      ]),
    );
    const { context } = await renderSecurityPage();

    await startSetup();
    await userEvent.type(
      setupDialog().getByRole('textbox', { name: '認証コード(必須)' }),
      '123456',
    );
    await userEvent.click(
      setupDialog().getByRole('button', { name: '有効にする' }),
    );
    await expect
      .element(setupDialog().getByText(RECOVERY_CODES[0] ?? ''))
      .toBeVisible();
    await userEvent.click(
      setupDialog().getByRole('button', { name: '閉じる' }).last(),
    );
    await expect.element(setupDialog()).not.toBeInTheDocument();

    await expectNoPlaintext(context.queryClient);
  });

  test('設定のダイアログを開いたまま画面を離れた後、秘密鍵が残らない', async () => {
    respond(
      new Map<unknown, Handler>([
        [ClientStartTotpSetupDocument, ok({ startTotpSetup: TOTP_SETUP })],
      ]),
    );
    const { context } = await renderSecurityPage();

    await startSetup();
    await cleanup();

    await expectNoPlaintext(context.queryClient);
  });

  test('設定を始めずにダイアログを閉じると、開き直しても前の秘密鍵を描かない', async () => {
    respond(
      new Map<unknown, Handler>([
        [ClientStartTotpSetupDocument, ok({ startTotpSetup: TOTP_SETUP })],
      ]),
    );
    const { context } = await renderSecurityPage();

    await startSetup();
    await userEvent.click(
      setupDialog().getByRole('button', { name: 'キャンセル' }),
    );
    await expect.element(setupDialog()).not.toBeInTheDocument();

    expect(page.getByText(TOTP_SECRET).elements()).toHaveLength(0);
    await expectNoPlaintext(context.queryClient);
  });

  test('再発行したリカバリコードのダイアログを閉じた後、リカバリコードが残らない', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRegenerateRecoveryCodesDocument,
          ok({ regenerateRecoveryCodes: { codes: RECOVERY_CODES } }),
        ],
        ...refetched(true),
      ]),
    );
    const { context } = await renderSecurityPage({ totpEnabled: true });

    await regenerateCodes();
    await userEvent.click(
      codesDialog().getByRole('button', { name: '閉じる' }).last(),
    );
    await expect.element(codesDialog()).not.toBeInTheDocument();

    expect(page.getByText(RECOVERY_CODES[0] ?? '').elements()).toHaveLength(0);
    await expectNoPlaintext(context.queryClient);
  });

  test('再発行したリカバリコードのダイアログを開いたまま画面を離れた後、リカバリコードが残らない', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRegenerateRecoveryCodesDocument,
          ok({ regenerateRecoveryCodes: { codes: RECOVERY_CODES } }),
        ],
        ...refetched(true),
      ]),
    );
    const { context } = await renderSecurityPage({ totpEnabled: true });

    await regenerateCodes();
    await cleanup();

    await expectNoPlaintext(context.queryClient);
  });
});
