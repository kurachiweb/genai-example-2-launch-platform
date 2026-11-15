import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { adminUltrasPromotionSettingQueryOptions } from '../../graphql/admin-ultras-promotion.ts';
import { toAdminViewer } from '../../graphql/admin-viewer.ts';
import {
  type AdminRole,
  AdminUltrasPromotionSettingDocument,
  type AdminUltrasPromotionSettingQuery,
  AdminUpdateUltrasPromotionSettingDocument,
  type AdminUpdateUltrasPromotionSettingMutationVariables,
} from '../../graphql/generated/graphql.ts';
import { AdminViewerProvider } from '../layout/admin-viewer-context.tsx';
import { PromotionSettingSection } from './promotion-setting-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

type Setting = AdminUltrasPromotionSettingQuery['ultrasPromotionSetting'];

type SettingHandler = () => Promise<unknown>;

type UpdateHandler = (
  variables: AdminUpdateUltrasPromotionSettingMutationVariables,
) => Promise<unknown>;

const TITLE = 'Ultras導線の機能フラグ';

const DESCRIPTION =
  'オフにすると未加入者への導線と新規加入を止めます。加入中の利用者には影響しません。';

const SWITCH_LABEL = '未加入者への導線と新規加入';

const UPDATED_AT_LABEL = '最後に変更した日時';

const UPDATED_BY_LABEL = '変更した管理者';

const NONE_LABEL = 'なし';

const READ_ONLY_NOTICE = '最上位管理者だけが変更できます。';

const DISABLE_TITLE = 'Ultras導線の機能フラグをオフにしますか?';

const ENABLE_TITLE = 'Ultras導線の機能フラグをオンにしますか?';

const DISABLE_DESCRIPTION =
  '未加入者への導線と新規加入を止めます。加入中の利用者には影響しません。';

const ENABLE_DESCRIPTION = '未加入者への導線と新規加入を始めます。';

const DISABLED_MESSAGE = 'Ultras導線の機能フラグをオフにしました。';

const ENABLED_MESSAGE = 'Ultras導線の機能フラグをオンにしました。';

const CONFLICT_MESSAGE =
  '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。';

const CONTACT_PHRASE = 'お問い合わせ';

const ENABLED_SETTING: Setting = Object.freeze({
  enabled: true,
  updatedAt: '2026-11-05T01:02:03.000Z',
  updatedByNickname: '統括の担当',
  version: 3,
});

// 初期行は固定の初期化日時を持ち、管理者の変更は無い
const INITIAL_SETTING: Setting = Object.freeze({
  enabled: false,
  updatedAt: '2026-11-06T00:00:00.000Z',
  updatedByNickname: null,
  version: 0,
});

const DISABLED_SETTING: Setting = Object.freeze({
  enabled: false,
  updatedAt: '2026-11-07T04:05:00.000Z',
  updatedByNickname: '運営の担当',
  version: 4,
});

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

const unexpectedOperation = (): never => {
  throw new Error('想定していない操作が実行されました。');
};

const settingOf =
  (setting: Setting): SettingHandler =>
  () =>
    success({ ultrasPromotionSetting: setting });

const respond = (
  setting: SettingHandler,
  update: UpdateHandler = unexpectedOperation,
): void => {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === AdminUltrasPromotionSettingDocument) {
      return setting();
    }
    if (document === AdminUpdateUltrasPromotionSettingDocument) {
      return update(
        variables as AdminUpdateUltrasPromotionSettingMutationVariables,
      );
    }
    return unexpectedOperation();
  });
};

// 8.2の設定ページが包むのと同じく区画のエラーの境界に包み、日時の部品のための表示設定とログイン中の管理者を外側に置く
async function renderSection(role: AdminRole = 'SUPER_ADMIN') {
  const viewer = toAdminViewer(adminWithRole(role));
  if (viewer === null) {
    throw new Error('ログイン中の管理者を作れませんでした。');
  }
  await render(<Toaster />);
  return renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <AdminViewerProvider viewer={viewer}>
        <main className="p-4">
          <RecoverableSlot contactAvailable={false}>
            <PromotionSettingSection />
          </RecoverableSlot>
        </main>
      </AdminViewerProvider>
    </DisplayPreferencesProvider>,
  );
}

const section = () => page.getByRole('region', { name: TITLE });
const toggle = () => page.getByRole('switch', { name: SWITCH_LABEL });
// ダイアログを開いている間は背後の区画がaria-hiddenになるため、隠れたままの状態を確かめる時に使う
const hiddenToggle = () =>
  page.getByRole('switch', { name: SWITCH_LABEL, includeHidden: true });
const stateText = (label: string) =>
  section().getByText(label, { exact: true });
const dialog = () => page.getByRole('dialog');
const reasonField = () => dialog().getByRole('textbox', { name: '理由(任意)' });
const confirmButton = (name: string) =>
  dialog().getByRole('button', { name, exact: true });
const cancelButton = () => dialog().getByRole('button', { name: 'キャンセル' });
const valueOf = (term: string) =>
  section().getByRole('term').filter({ hasText: term }).element()
    .nextElementSibling?.textContent;
const updatedAtTime = () =>
  section().element().querySelector('time')?.getAttribute('datetime');
const settingCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === AdminUltrasPromotionSettingDocument,
  );

beforeEach(async () => {
  executeGraphQL.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await emulateBrowserDisplay(DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('現在の値と最後の変更', () => {
  test('見出しと説明の下に、オンの現在の値と、最後に変更した日時と変更した管理者を表示する', async () => {
    respond(settingOf(ENABLED_SETTING));
    await renderSection('VIEWER');

    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    await expect
      .element(section().getByRole('heading', { level: 2, name: TITLE }))
      .toBeVisible();
    await expect.element(section().getByText(DESCRIPTION)).toBeVisible();
    await expect.element(stateText('オン')).toBeVisible();
    expect(valueOf(UPDATED_AT_LABEL)).toContain('2026年11月5日');
    expect(updatedAtTime()).toBe(ENABLED_SETTING.updatedAt);
    expect(valueOf(UPDATED_BY_LABEL)).toBe('統括の担当');
  });

  test('一度も変更していない初期の設定は、オフの現在の値と、日時と管理者を「なし」で表示する', async () => {
    respond(settingOf(INITIAL_SETTING));
    await renderSection('VIEWER');

    await expect.element(toggle()).toHaveAttribute('aria-checked', 'false');
    await expect.element(stateText('オフ')).toBeVisible();
    expect(valueOf(UPDATED_AT_LABEL)).toBe(NONE_LABEL);
    expect(valueOf(UPDATED_BY_LABEL)).toBe(NONE_LABEL);
    expect(section().element().querySelector('time')).toBeNull();
  });

  test('削除済みの管理者が変更した設定は、日時を表示し、管理者を「なし」にする', async () => {
    respond(settingOf({ ...ENABLED_SETTING, updatedByNickname: null }));
    await renderSection('VIEWER');

    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(updatedAtTime()).toBe(ENABLED_SETTING.updatedAt);
    expect(valueOf(UPDATED_BY_LABEL)).toBe(NONE_LABEL);
  });

  test('取り直しの失敗では、表示中の値を残して失敗を示さない', async () => {
    let failing = false;
    respond(() =>
      failing ? failure(INTERNAL_ERROR) : settingOf(ENABLED_SETTING)(),
    );
    const router = await renderSection('VIEWER');
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    const { queryClient } = router.options.context;
    const { queryKey } = adminUltrasPromotionSettingQueryOptions();

    failing = true;
    await queryClient.refetchQueries({ queryKey });

    expect(queryClient.getQueryState(queryKey)?.status).toBe('error');
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(settingCalls()).toHaveLength(2);
  });
});

describe('ロールによる出し分け', () => {
  test.each<AdminRole>(['VIEWER', 'MODERATOR'])(
    '%sにはスイッチを無効にして参照だけにし、最上位管理者だけが変更できる旨を結び付けて添える',
    async (role) => {
      respond(settingOf(ENABLED_SETTING));
      await renderSection(role);

      await expect.element(toggle()).toBeDisabled();
      const notice = section().getByText(READ_ONLY_NOTICE);
      await expect.element(notice).toBeVisible();
      expect(toggle().element().getAttribute('aria-describedby')).toBe(
        notice.element().id,
      );

      await toggle().click({ force: true });

      expect(dialog().query()).toBeNull();
      await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    },
  );

  test('最上位管理者にはスイッチを有効にし、参照だけの案内を出さない', async () => {
    respond(settingOf(ENABLED_SETTING));
    await renderSection('SUPER_ADMIN');

    await expect.element(toggle()).toBeEnabled();
    expect(section().getByText(READ_ONLY_NOTICE).query()).toBeNull();
  });
});

describe('切り替え', () => {
  test('スイッチを押すと理由(任意)と監査ログの注記を持つ確認のダイアログを開き、確定するまで切り替えず、キャンセルで元のまま閉じる', async () => {
    const update = vi.fn<UpdateHandler>();
    respond(settingOf(ENABLED_SETTING), update);
    await renderSection();
    await expect.element(toggle()).toBeEnabled();

    await userEvent.click(toggle());

    await expect
      .element(page.getByRole('dialog', { name: DISABLE_TITLE }))
      .toBeVisible();
    await expect.element(dialog().getByText(DISABLE_DESCRIPTION)).toBeVisible();
    await expect.element(reasonField()).toBeVisible();
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
    await expect.element(confirmButton('オフにする')).toBeVisible();
    await expect
      .element(hiddenToggle())
      .toHaveAttribute('aria-checked', 'true');

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    await expect.element(toggle()).toHaveFocus();
    expect(update).not.toHaveBeenCalled();
  });

  test('確定で新しい値・読み取った版・理由を送り、表示を新しい値に置き換えてトーストで知らせる', async () => {
    const update = vi.fn<UpdateHandler>(() =>
      success({ updateUltrasPromotionSetting: DISABLED_SETTING }),
    );
    respond(settingOf(ENABLED_SETTING), update);
    await renderSection();
    await expect.element(toggle()).toBeEnabled();

    await userEvent.click(toggle());
    await userEvent.fill(reasonField(), '販売を一時停止');
    await userEvent.click(confirmButton('オフにする'));

    await expect.element(page.getByText(DISABLED_MESSAGE)).toBeVisible();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toStrictEqual({
      input: { enabled: false, expectedVersion: 3, reason: '販売を一時停止' },
    });
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'false');
    await expect.element(stateText('オフ')).toBeVisible();
    expect(updatedAtTime()).toBe(DISABLED_SETTING.updatedAt);
    expect(valueOf(UPDATED_BY_LABEL)).toBe('運営の担当');
    expect(settingCalls()).toHaveLength(1);
  });

  test('オフの設定をオンにする時は、始める旨の説明と「オンにする」の確定を出し、理由が空なら送らず、オンにした旨をトーストで知らせる', async () => {
    const update = vi.fn<UpdateHandler>(() =>
      success({
        updateUltrasPromotionSetting: {
          ...ENABLED_SETTING,
          updatedByNickname: '運営の担当',
          version: 1,
        },
      }),
    );
    respond(settingOf(INITIAL_SETTING), update);
    await renderSection();
    await expect.element(toggle()).toBeEnabled();

    await userEvent.click(toggle());

    await expect
      .element(page.getByRole('dialog', { name: ENABLE_TITLE }))
      .toBeVisible();
    await expect.element(dialog().getByText(ENABLE_DESCRIPTION)).toBeVisible();

    await userEvent.click(confirmButton('オンにする'));

    await expect.element(page.getByText(ENABLED_MESSAGE)).toBeVisible();
    const input = update.mock.calls[0]?.[0].input;
    expect(input).toMatchObject({ enabled: true, expectedVersion: 0 });
    expect(input?.reason ?? undefined).toBeUndefined();
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(valueOf(UPDATED_BY_LABEL)).toBe('運営の担当');
  });

  test('他の管理者が先に変更していた時は、理由の入力を保ったまま競合の文言を示して最新の値を読み直し、閉じた後に最新の値を見せる', async () => {
    let current: Setting = ENABLED_SETTING;
    const update = vi.fn<UpdateHandler>(() => {
      current = { ...DISABLED_SETTING, updatedByNickname: '別の担当' };
      return failure({
        code: 'version_conflict',
        message: '設定の版が一致しません。',
        status: 409,
      });
    });
    respond(() => settingOf(current)(), update);
    await renderSection();
    await expect.element(toggle()).toBeEnabled();

    await userEvent.click(toggle());
    await userEvent.fill(reasonField(), '確認のため');
    await userEvent.click(confirmButton('オフにする'));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(CONFLICT_MESSAGE);
    expect(dialog().getByRole('alert').element().textContent).toBe(
      CONFLICT_MESSAGE,
    );
    await expect.element(reasonField()).toHaveValue('確認のため');
    await expect
      .element(page.getByRole('dialog', { name: DISABLE_TITLE }))
      .toBeVisible();
    await expect.poll(() => settingCalls().length).toBe(2);

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(valueOf(UPDATED_BY_LABEL)).toBe('別の担当');
  });

  test('GraphQLClientErrorでない失敗は、理由の入力を保ったまま問い合わせを促す文を含まない文言を示し、切り替えない', async () => {
    respond(settingOf(ENABLED_SETTING), () =>
      Promise.reject(new Error('通信の失敗')),
    );
    await renderSection();
    await expect.element(toggle()).toBeEnabled();

    await userEvent.click(toggle());
    await userEvent.fill(reasonField(), '確認のため');
    await userEvent.click(confirmButton('オフにする'));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    expect(dialog().element().textContent).not.toContain(CONTACT_PHRASE);
    await expect.element(reasonField()).toHaveValue('確認のため');
    await expect
      .element(hiddenToggle())
      .toHaveAttribute('aria-checked', 'true');
    expect(settingCalls()).toHaveLength(1);
  });
});

describe('取得の失敗', () => {
  test('取得の失敗は区画の位置に問い合わせの導線の無い失敗と再試行で示し、再試行で区画を表示する', async () => {
    let available = false;
    respond(() =>
      available ? settingOf(ENABLED_SETTING)() : failure(INTERNAL_ERROR),
    );
    await renderSection();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(
      page.getByRole('button', { name: CONTACT_PHRASE }).elements(),
    ).toHaveLength(0);
    expect(document.body.textContent).not.toContain(CONTACT_PHRASE);
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();

    available = true;
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test('GraphQLClientErrorでない取得の失敗は、問い合わせを促さない固定の文言で示し、エラートラッキングへ送る', async () => {
    respond(() => Promise.reject(new Error('取得の失敗')));
    await renderSection();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    expect(document.body.textContent).not.toContain(CONTACT_PHRASE);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.any(Error),
      'render',
    );
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、区画と確認のダイアログがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(settingOf(ENABLED_SETTING));
      await renderSection();
      await expect.element(toggle()).toBeEnabled();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(toggle());
      await expect.element(dialog()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、参照だけの区画がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(settingOf(INITIAL_SETTING));
      await renderSection('VIEWER');
      await expect.element(toggle()).toBeDisabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(() => failure(INTERNAL_ERROR));
      await renderSection();
      await expect.element(page.getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
