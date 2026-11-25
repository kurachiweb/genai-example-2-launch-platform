import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import type { AdminYearFinalDateSetting } from '../../graphql/admin-year-final-date.ts';
import { toAdminViewer } from '../../graphql/admin-viewer.ts';
import type { AdminRole } from '../../graphql/generated/graphql.ts';
import { AdminViewerProvider } from '../layout/admin-viewer-context.tsx';
import {
  CURRENT_YEAR_SETTING,
  NEXT_YEAR_SETTING,
  settingOf,
} from './final-date-fixtures.ts';
import { FinalDateYearCard } from './final-date-year-card.tsx';

// ログイン中の管理者の型の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const SUPER_ADMIN_ONLY_NOTICE = '最上位管理者だけが変更できます。';

const LOCKED_NOTICE = '変更期限(決勝の7日前)を過ぎたため変更できません。';

const EDITOR_TEXT = '決勝実施日の変更の欄';

const NONE_LABEL = 'なし';

const TOKYO: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

const HONOLULU: DisplayPreferences = Object.freeze({
  timeZone: 'Pacific/Honolulu',
  locale: 'ja-JP',
});

const KIRITIMATI: DisplayPreferences = Object.freeze({
  timeZone: 'Pacific/Kiritimati',
  locale: 'ja-JP',
});

interface RenderOptions {
  readonly role?: AdminRole;
  readonly display?: DisplayPreferences;
}

async function renderCard(
  setting: AdminYearFinalDateSetting,
  { role = 'SUPER_ADMIN', display = TOKYO }: RenderOptions = {},
) {
  const viewer = toAdminViewer(adminWithRole(role));
  if (viewer === null) {
    throw new Error('ログイン中の管理者を作れませんでした。');
  }
  await emulateBrowserDisplay(display);
  return render(
    <DisplayPreferencesProvider initial={display}>
      <AdminViewerProvider viewer={viewer}>
        <main className="p-4">
          <FinalDateYearCard setting={setting}>
            <p>{EDITOR_TEXT}</p>
          </FinalDateYearCard>
        </main>
      </AdminViewerProvider>
    </DisplayPreferencesProvider>,
  );
}

const card = (year: number) =>
  page.getByRole('region', { name: `${String(year)}年` });

const valueOf = (year: number, term: string) =>
  card(year).getByRole('term').filter({ hasText: term }).element()
    .nextElementSibling;

const timeOf = (year: number, term: string) =>
  valueOf(year, term)?.querySelector('time');

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('決勝実施日と日程', () => {
  test('対象年の見出しの下に、実効の決勝実施日を業務日付の<time>で曜日つきに示し、設定済みの印を添える', async () => {
    await renderCard(NEXT_YEAR_SETTING);

    await expect
      .element(card(2027).getByRole('heading', { level: 3, name: '2027年' }))
      .toBeVisible();
    const finalDate = timeOf(2027, '決勝実施日');
    expect(finalDate?.getAttribute('datetime')).toBe('2027-05-30');
    expect(finalDate?.textContent).toBe('2027年5月30日(日)');
    await expect
      .element(card(2027).getByText('設定済み', { exact: true }))
      .toBeVisible();
    expect(card(2027).getByText('既定(5月の最終日曜日)').query()).toBeNull();
  });

  test('未設定の年は既定の印を添える', async () => {
    await renderCard(CURRENT_YEAR_SETTING, { role: 'VIEWER' });

    await expect
      .element(card(2026).getByText('既定(5月の最終日曜日)', { exact: true }))
      .toBeVisible();
    expect(
      card(2026).getByText('設定済み', { exact: true }).query(),
    ).toBeNull();
    expect(timeOf(2026, '決勝実施日')?.getAttribute('datetime')).toBe(
      '2026-05-31',
    );
  });

  test('受付期限・組み合わせ決定・変更期限を表示のタイムゾーンの日時で示す', async () => {
    await renderCard(NEXT_YEAR_SETTING);

    await expect.element(card(2027)).toBeVisible();
    expect(timeOf(2027, '受付期限')?.getAttribute('datetime')).toBe(
      NEXT_YEAR_SETTING.acceptUntil,
    );
    expect(timeOf(2027, '受付期限')?.textContent).toContain('2027年5月25日');
    expect(timeOf(2027, '受付期限')?.textContent).toContain('16:00');
    expect(timeOf(2027, '組み合わせ決定')?.getAttribute('datetime')).toBe(
      NEXT_YEAR_SETTING.drawAt,
    );
    expect(timeOf(2027, '組み合わせ決定')?.textContent).toContain('16:45');
    expect(timeOf(2027, '変更期限')?.getAttribute('datetime')).toBe(
      NEXT_YEAR_SETTING.changeLockAt,
    );
    expect(timeOf(2027, '変更期限')?.textContent).toContain('2027年5月23日');
    expect(timeOf(2027, '変更期限')?.textContent).toContain('17:00');
  });

  test.each([
    ['UTC-10', HONOLULU, '2027年5月22日', '22:00'],
    ['UTC+14', KIRITIMATI, '2027年5月23日', '22:00'],
  ])(
    '表示のタイムゾーンが%sでも決勝実施日は業務日付のまま示し、変更期限だけを表示のタイムゾーンで示す',
    async (_label, display, lockDate, lockTime) => {
      await renderCard(NEXT_YEAR_SETTING, { display });

      await expect.element(card(2027)).toBeVisible();
      expect(timeOf(2027, '決勝実施日')?.textContent).toBe('2027年5月30日(日)');
      expect(timeOf(2027, '変更期限')?.textContent).toContain(lockDate);
      expect(timeOf(2027, '変更期限')?.textContent).toContain(lockTime);
    },
  );
});

describe('最後の変更', () => {
  test('最後に変更した日時と変更した管理者のニックネームを示す', async () => {
    await renderCard(NEXT_YEAR_SETTING);

    await expect.element(card(2027)).toBeVisible();
    expect(timeOf(2027, '最後に変更した日時')?.getAttribute('datetime')).toBe(
      NEXT_YEAR_SETTING.updatedAt,
    );
    expect(timeOf(2027, '最後に変更した日時')?.textContent).toContain(
      '2026年11月5日',
    );
    expect(valueOf(2027, '変更した管理者')?.textContent).toBe('統括の担当');
  });

  test('一度も変更していない年は日時も管理者も「なし」にする', async () => {
    await renderCard(CURRENT_YEAR_SETTING);

    await expect.element(card(2026)).toBeVisible();
    expect(valueOf(2026, '最後に変更した日時')?.textContent).toBe(NONE_LABEL);
    expect(timeOf(2026, '最後に変更した日時')).toBeNull();
    expect(valueOf(2026, '変更した管理者')?.textContent).toBe(NONE_LABEL);
  });

  test('変更した管理者が削除済みの年は日時を示し、管理者だけ「なし」にする', async () => {
    await renderCard(settingOf({ updatedBy: { nickname: null } }));

    await expect.element(card(2027)).toBeVisible();
    expect(timeOf(2027, '最後に変更した日時')?.getAttribute('datetime')).toBe(
      NEXT_YEAR_SETTING.updatedAt,
    );
    expect(valueOf(2027, '変更した管理者')?.textContent).toBe(NONE_LABEL);
  });
});

describe('変更の可否', () => {
  test('最上位管理者が変更期限より前の年を開くと変更の欄を出し、参照だけの案内を出さない', async () => {
    await renderCard(NEXT_YEAR_SETTING);

    await expect.element(card(2027).getByText(EDITOR_TEXT)).toBeVisible();
    expect(card(2027).getByText(SUPER_ADMIN_ONLY_NOTICE).query()).toBeNull();
    expect(card(2027).getByText(LOCKED_NOTICE).query()).toBeNull();
  });

  test.each<AdminRole>(['VIEWER', 'MODERATOR'])(
    '%sには変更の欄を出さず、最上位管理者だけが変更できる旨を示す',
    async (role) => {
      await renderCard(NEXT_YEAR_SETTING, { role });

      await expect
        .element(card(2027).getByText(SUPER_ADMIN_ONLY_NOTICE))
        .toBeVisible();
      expect(card(2027).getByText(EDITOR_TEXT).query()).toBeNull();
    },
  );

  test.each<AdminRole>(['SUPER_ADMIN', 'VIEWER'])(
    '変更期限を過ぎた年は%sにも変更の欄を出さず、変更期限を過ぎた旨を示す',
    async (role) => {
      await renderCard(CURRENT_YEAR_SETTING, { role });

      await expect.element(card(2026).getByText(LOCKED_NOTICE)).toBeVisible();
      expect(card(2026).getByText(EDITOR_TEXT).query()).toBeNull();
      expect(card(2026).getByText(SUPER_ADMIN_ONLY_NOTICE).query()).toBeNull();
    },
  );
});

describe('翌年の注意', () => {
  const WARNING =
    '翌年の決勝実施日が未設定のため、既定の2028年5月28日(日)では64週以上空きます。参加数を64以下に保つため、翌年の決勝実施日を設定してください。';

  test('翌年の既定の日までの間隔が64週以上になる年は、翌年の設定を促す注意を示す', async () => {
    await renderCard(
      settingOf({
        finalDate: '2027-03-07',
        nextYearGapWarningDate: '2028-05-28',
      }),
    );

    const note = card(2027).getByRole('note');
    await expect.element(note).toBeVisible();
    await expect.element(note).toHaveTextContent(WARNING);
  });

  test('注意の対象でない年は注意を示さない', async () => {
    await renderCard(NEXT_YEAR_SETTING);

    await expect.element(card(2027)).toBeVisible();
    expect(card(2027).getByRole('note').query()).toBeNull();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each<[string, AdminYearFinalDateSetting, AdminRole]>([
    [
      '変更できる年と注意',
      settingOf({ nextYearGapWarningDate: '2028-05-28' }),
      'SUPER_ADMIN',
    ],
    ['参照だけの年', CURRENT_YEAR_SETTING, 'VIEWER'],
  ])('%sのアクセシビリティの検査の違反が0件', async (_label, setting, role) => {
    applyColorScheme(scheme);
    const { container } = await renderCard(setting, { role });
    await expect.element(card(setting.year)).toBeVisible();

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
