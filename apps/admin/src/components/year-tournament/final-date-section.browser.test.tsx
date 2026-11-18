import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { adminYearFinalDateSettingsQueryOptions } from '../../graphql/admin-year-final-date.ts';
import { toAdminViewer } from '../../graphql/admin-viewer.ts';
import {
  type AdminRole,
  AdminYearFinalDateSettingsDocument,
  type AdminYearFinalDateSettingsQuery,
} from '../../graphql/generated/graphql.ts';
import { AdminViewerProvider } from '../layout/admin-viewer-context.tsx';
import {
  CURRENT_YEAR_SETTING,
  NEXT_YEAR_SETTING,
} from './final-date-fixtures.ts';
import { FinalDateSection } from './final-date-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈とログイン中の管理者の型の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

type SettingsHandler = () => Promise<unknown>;

const TITLE = 'Yearトーナメントの決勝実施日';

const DESCRIPTION =
  '欧州サッカーのリーグ最終節に合わせて、各年の決勝実施日(日曜日)を設定します。未設定の年は5月の最終日曜日に行います。';

const FIELD_LABEL = '決勝実施日';

const SUPER_ADMIN_ONLY_NOTICE = '最上位管理者だけが変更できます。';

const LOCKED_NOTICE = '変更期限(決勝の7日前)を過ぎたため変更できません。';

const CONTACT_PHRASE = 'お問い合わせ';

const SETTINGS_QUERY: AdminYearFinalDateSettingsQuery = Object.freeze({
  yearFinalDateSettings: {
    serverTime: '2026-11-18T00:00:00.000Z',
    settings: [CURRENT_YEAR_SETTING, NEXT_YEAR_SETTING],
  },
});

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const TOKYO: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

const unexpectedOperation = (): never => {
  throw new Error('想定していない操作が実行されました。');
};

const settingsSuccess: SettingsHandler = () => success(SETTINGS_QUERY);

const respond = (settings: SettingsHandler): void => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === AdminYearFinalDateSettingsDocument
      ? settings()
      : unexpectedOperation(),
  );
};

// 設定のページが包むのと同じく、管理画面の問い合わせの有無を渡した区画のエラーの境界に包む
async function renderSection(role: AdminRole = 'SUPER_ADMIN') {
  const viewer = toAdminViewer(adminWithRole(role));
  if (viewer === null) {
    throw new Error('ログイン中の管理者を作れませんでした。');
  }
  return renderInRouter(
    <DisplayPreferencesProvider initial={TOKYO}>
      <AdminViewerProvider viewer={viewer}>
        <main className="p-4">
          <RecoverableSlot contactAvailable={ADMIN_PROFILE.contactAvailable}>
            <FinalDateSection />
          </RecoverableSlot>
        </main>
      </AdminViewerProvider>
    </DisplayPreferencesProvider>,
  );
}

const section = () => page.getByRole('region', { name: TITLE, exact: true });
const card = (year: number) =>
  section().getByRole('region', { name: `${String(year)}年`, exact: true });
const finalDateField = (year: number) =>
  card(year).getByRole('combobox', { name: FIELD_LABEL });
const cardHeadings = () =>
  section()
    .getByRole('heading', { level: 3 })
    .elements()
    .map((heading) => heading.textContent);
const settingsCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === AdminYearFinalDateSettingsDocument,
  );

beforeEach(async () => {
  executeGraphQL.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await emulateBrowserDisplay(TOKYO);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('見出しと2年分のカード', () => {
  test('見出しと説明の下に、現在の年と翌年のカードをこの順に並べる', async () => {
    respond(settingsSuccess);
    await renderSection('VIEWER');

    await expect
      .element(section().getByRole('heading', { level: 2, name: TITLE }))
      .toBeVisible();
    await expect.element(section().getByText(DESCRIPTION)).toBeVisible();
    await expect.element(card(2026)).toBeVisible();
    await expect.element(card(2027)).toBeVisible();
    expect(cardHeadings()).toStrictEqual(['2026年', '2027年']);
    expect(
      card(2026).element().querySelector('time')?.getAttribute('datetime'),
    ).toBe(CURRENT_YEAR_SETTING.finalDate);
    expect(
      card(2027).element().querySelector('time')?.getAttribute('datetime'),
    ).toBe(NEXT_YEAR_SETTING.finalDate);
  });

  test('最上位管理者には変更期限より前の年のカードにだけ選択の欄を置き、期限を過ぎた年には理由を添える', async () => {
    respond(settingsSuccess);
    await renderSection('SUPER_ADMIN');

    await expect.element(finalDateField(2027)).toBeVisible();
    expect(
      card(2026).getByRole('combobox', { name: FIELD_LABEL }).elements(),
    ).toHaveLength(0);
    await expect.element(card(2026).getByText(LOCKED_NOTICE)).toBeVisible();
    expect(
      section().getByText(SUPER_ADMIN_ONLY_NOTICE).elements(),
    ).toHaveLength(0);
  });

  test.each<AdminRole>(['VIEWER', 'MODERATOR'])(
    '%sには選択の欄を置かず、変更期限より前の年に最上位管理者だけが変更できる旨を添える',
    async (role) => {
      respond(settingsSuccess);
      await renderSection(role);

      await expect
        .element(card(2027).getByText(SUPER_ADMIN_ONLY_NOTICE))
        .toBeVisible();
      expect(section().getByRole('combobox').elements()).toHaveLength(0);
      await expect.element(card(2026).getByText(LOCKED_NOTICE)).toBeVisible();
    },
  );

  test('取り直しの失敗では、表示中のカードを残して失敗を示さない', async () => {
    let failing = false;
    respond(() => (failing ? failure(INTERNAL_ERROR) : settingsSuccess()));
    const router = await renderSection('VIEWER');
    await expect.element(card(2027)).toBeVisible();
    const { queryClient } = router.options.context;
    const { queryKey } = adminYearFinalDateSettingsQueryOptions();

    failing = true;
    await queryClient.refetchQueries({ queryKey });

    expect(queryClient.getQueryState(queryKey)?.status).toBe('error');
    await expect.element(card(2027)).toBeVisible();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(settingsCalls()).toHaveLength(2);
  });
});

describe('取得の失敗', () => {
  test('取得の失敗は区画の位置にAPIの文言と再試行で示し、問い合わせのボタンと問い合わせを促す文を出さず、再試行で区画を表示する', async () => {
    let available = false;
    respond(() => (available ? settingsSuccess() : failure(INTERNAL_ERROR)));
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

    await expect.element(finalDateField(2027)).toBeVisible();
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
    '%sの配色で、最上位管理者の区画がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(settingsSuccess);
      await renderSection();
      await expect.element(finalDateField(2027)).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、参照だけの区画がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(settingsSuccess);
      await renderSection('VIEWER');
      await expect
        .element(card(2027).getByText(SUPER_ADMIN_ONLY_NOTICE))
        .toBeVisible();

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
