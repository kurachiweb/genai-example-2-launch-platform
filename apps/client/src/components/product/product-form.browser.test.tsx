import { useId } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import type { TurnstileTokenController } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type {
  LaunchPlanView,
  ProductCategoryView,
} from '../../graphql/my-products.ts';
import { ProductForm, type ProductFormCurrent } from './product-form.tsx';
import {
  EDIT_PRODUCT_FORM_SCHEMAS,
  type EditProductFormOutput,
  type ProductFormInput,
  REGISTER_PRODUCT_FORM_SCHEMA,
} from './product-form-schema.ts';
import { EMPTY_PRODUCT_FORM_VALUES } from './product-form-values.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

// 業務日付2026-11-09の15:00(UTC-08:00)
const NOW = new Date('2026-11-09T23:00:00.000Z');

const HEADING = 'プロダクトの確認';

const LOCK_MESSAGE =
  'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。';

const CATEGORIES: readonly ProductCategoryView[] = [
  {
    id: '01JD0CATEGORY0000000000001',
    name: '開発ツール',
    handle: 'dev-tools',
    systemDefault: false,
  },
  {
    id: '01JD0CATEGORY0000000000000',
    name: 'その他',
    handle: 'other',
    systemDefault: true,
  },
];

const WINDOW = {
  earliest: '2026-11-10',
  latest: '2027-02-07',
  unavailable: [],
  relaunchIntervalDays: null,
} as const;

const RESCHEDULE_PLAN: LaunchPlanView = {
  mode: 'reschedule',
  currentLaunchDate: '2026-11-20',
  window: WINDOW,
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
};

const LOCKED_PLAN: LaunchPlanView = {
  ...RESCHEDULE_PLAN,
  locked: true,
  locks: [{ code: 'match_imminent', message: LOCK_MESSAGE }],
};

const LOADED_VALUES: ProductFormInput = {
  fields: {
    name: 'Pitch Notes',
    tagline: 'ピッチの台本を整える',
    categoryId: CATEGORIES[0]?.id ?? '',
    handle: 'pitch-notes',
    websiteUrl: 'https://pitch.example/',
    description: '[外部のサイト](https://other.example/page)の紹介',
    logoFileId: '01JD0FILE00000000000000001',
    screenshotFileIds: [],
  },
  launchDate: '2026-11-20',
};

const CURRENT: ProductFormCurrent = {
  handle: 'pitch-notes',
  previousHandle: null,
  logo: {
    fileId: '01JD0FILE00000000000000001',
    image: null,
    productName: 'Pitch Notes',
    productHandle: 'pitch-notes',
  },
  screenshots: [],
};

type SaveMock = ReturnType<
  typeof vi.fn<
    (values: unknown, turnstile: TurnstileTokenController) => Promise<void>
  >
>;

interface HarnessProps {
  readonly kind: 'register' | 'edit-reschedule' | 'edit-locked';
  readonly disabled: boolean;
  readonly onSave: SaveMock;
}

function Harness({ kind, disabled, onSave }: HarnessProps) {
  const headingId = useId();
  const heading = (
    <h1 id={headingId} className="text-2xl font-bold">
      {HEADING}
    </h1>
  );
  if (kind === 'register') {
    return (
      <main className="mx-auto max-w-3xl p-4">
        {heading}
        <ProductForm
          schema={REGISTER_PRODUCT_FORM_SCHEMA}
          defaultValues={EMPTY_PRODUCT_FORM_VALUES}
          categories={CATEGORIES}
          launchDate={{ kind: 'register', window: WINDOW }}
          disabled={disabled}
          labelledBy={headingId}
          onSave={onSave}
        />
      </main>
    );
  }
  const locked = kind === 'edit-locked';
  return (
    <main className="mx-auto max-w-3xl p-4">
      {heading}
      <ProductForm
        schema={
          locked
            ? EDIT_PRODUCT_FORM_SCHEMAS.withoutLaunchDate
            : EDIT_PRODUCT_FORM_SCHEMAS.withLaunchDate
        }
        defaultValues={LOADED_VALUES}
        categories={CATEGORIES}
        launchDate={{
          kind: 'edit',
          plan: locked ? LOCKED_PLAN : RESCHEDULE_PLAN,
          productHandle: 'pitch-notes',
        }}
        current={CURRENT}
        {...(locked ? { categoryDisabledReason: LOCK_MESSAGE } : {})}
        disabled={disabled}
        labelledBy={headingId}
        onSave={onSave}
      />
    </main>
  );
}

async function renderForm({
  kind = 'edit-reschedule',
  disabled = false,
  onSave = vi.fn(() => Promise.resolve()),
}: {
  readonly kind?: HarnessProps['kind'];
  readonly disabled?: boolean;
  readonly onSave?: SaveMock;
} = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  await renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <TooltipProvider>
        <Harness kind={kind} disabled={disabled} onSave={onSave} />
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { path: '/my/products/new' },
  );
  return { onSave };
}

const form = () => page.getByRole('form', { name: HEADING });
const nameInput = () => form().getByRole('textbox', { name: '名称(必須)' });
const taglineInput = () =>
  form().getByRole('textbox', { name: 'タグライン(必須)' });
const handleInput = () =>
  form().getByRole('textbox', { name: 'ハンドル(必須)' });
const websiteUrlInput = () =>
  form().getByRole('textbox', { name: '外部WebサイトURL(必須)' });
const descriptionInput = () =>
  form().getByRole('textbox', { name: '説明文(必須)' });
const categoryTrigger = () =>
  form().getByRole('combobox', { name: 'カテゴリ(必須)' });
const toolbar = () => form().getByRole('toolbar', { name: '書式' });
const launchDateGroup = () =>
  form().getByRole('group', { name: 'ローンチ日(必須)' });
const saveButton = () =>
  form().getByRole('button', { name: '変更を保存', exact: true });
const registerButton = () =>
  form().getByRole('button', { name: 'ローンチを予約', exact: true });

async function waitForEditor(): Promise<void> {
  await expect.element(descriptionInput()).toBeInTheDocument();
  await expect
    .element(toolbar().getByRole('button', { name: '太字', exact: true }))
    .not.toHaveAttribute('disabled');
}

const rejectWith = (error: Error): SaveMock =>
  vi.fn(() => Promise.reject(error));

const validationError = (field: string, message: string) =>
  new GraphQLClientError({
    code: 'validation_error',
    message: '入力内容を確認してください。',
    status: 400,
    details: [{ field, code: 'custom', message }],
  });

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      data: { productHandleAvailability: 'AVAILABLE' },
    }),
  );
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  vi.useRealTimers();
  applyColorScheme('light');
});

describe('区画の並び', () => {
  test('見出し付きの区画を基本情報・説明文・スクリーンショット・ローンチ日の順に置き、基本情報の欄を設計の順に並べる', async () => {
    await renderForm({ kind: 'register' });
    await waitForEditor();

    expect(
      form()
        .getByRole('heading', { level: 2 })
        .elements()
        .map((element) => element.textContent),
    ).toEqual(['基本情報', '説明文', 'スクリーンショット', 'ローンチ日']);
    const basic = form().getByRole('region', { name: '基本情報' });
    expect(
      Array.from(
        basic.element().querySelectorAll('[data-slot="form-label"], label'),
      )
        .map((element) => element.textContent)
        .filter((text, index, all) => all.indexOf(text) === index),
    ).toEqual([
      'ロゴ(必須)',
      '名称(必須)',
      'タグライン(必須)',
      'カテゴリ(必須)',
      'ハンドル(必須)',
      '外部WebサイトURL(必須)',
    ]);
    await expect.element(registerButton()).toBeInTheDocument();
    expect(registerButton().element().textContent).toBe('ローンチを予約🚀');
  });
});

describe('フォーカスアウトの検証', () => {
  test('名称・タグライン・外部WebサイトURLは、フォーカスを外すとその欄に最初の違反を示す', async () => {
    await renderForm({ kind: 'register' });

    await userEvent.click(nameInput());
    await userEvent.tab();
    await expect
      .element(nameInput())
      .toHaveAccessibleDescription('名称を入力してください。');

    await userEvent.fill(taglineInput(), 'あ'.repeat(101));
    await userEvent.tab();
    await expect
      .element(taglineInput())
      .toHaveAccessibleDescription(
        'タグラインは100文字以内で入力してください。',
      );

    await userEvent.fill(websiteUrlInput(), 'javascript:alert(1)');
    await userEvent.tab();
    await expect
      .element(websiteUrlInput())
      .toHaveAccessibleDescription(
        '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。',
      );
    await expect.element(websiteUrlInput()).toHaveAttribute('type', 'url');
  });

  test('説明文は、空のままフォーカスを外すと必須の違反を示す', async () => {
    await renderForm({ kind: 'register' });
    await waitForEditor();

    await userEvent.click(descriptionInput());
    await userEvent.tab();

    await expect
      .element(form().getByText('説明文を入力してください。'))
      .toBeVisible();
    await expect
      .element(descriptionInput())
      .toHaveAttribute('aria-invalid', 'true');
  });
});

describe('説明文のマークダウンの入力欄', () => {
  test('書式のツールバー・書くとプレビューの切り替え・上限20,000文字のカウンターを備え、例文を示す', async () => {
    await renderForm();
    await waitForEditor();

    await expect
      .element(form().getByRole('tab', { name: '書く' }))
      .toBeVisible();
    await expect
      .element(form().getByRole('tab', { name: 'プレビュー' }))
      .toBeVisible();
    await expect
      .element(form().getByText('/ 20,000', { exact: false }))
      .toBeVisible();
  });

  test('ラベルを押すと編集領域へフォーカスが移る', async () => {
    await renderForm({ kind: 'register' });
    await waitForEditor();

    await userEvent.click(form().getByText('説明文(必須)', { exact: true }));

    await expect.element(descriptionInput()).toHaveFocus();
  });

  test('プレビューを、プロダクト詳細と同じrelの指定で描く', async () => {
    await renderForm();
    await waitForEditor();

    await userEvent.click(form().getByRole('tab', { name: 'プレビュー' }));

    await expect
      .element(form().getByRole('link', { name: '外部のサイト' }))
      .toHaveAttribute('rel', 'noopener');
  });

  test('入力した説明文を、末尾の改行を除いた原文のまま保存の値に渡す', async () => {
    const { onSave } = await renderForm();
    await waitForEditor();

    await userEvent.click(descriptionInput());
    await userEvent.keyboard('{ControlOrMeta>}{End}{/ControlOrMeta}');
    await userEvent.keyboard('を追記');
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(
      (onSave.mock.calls[0]?.[0] as EditProductFormOutput).fields.description,
    ).toBe('[外部のサイト](https://other.example/page)の紹介を追記');
  });
});

describe('保存の送信', () => {
  test('bot対策のウィジェットを、判定の枠と場所を設けずプロダクトの保存の操作名で置き、トークンの取り出し口を渡す', async () => {
    const { onSave } = await renderForm();

    await expect
      .poll(() => lastTurnstileProps().options?.action)
      .toBe('product_save');
    expect(lastTurnstileProps().options?.size).toBe('invisible');
    expect(
      form()
        .element()
        .querySelector('[data-slot="turnstile-widget"]')
        ?.parentElement?.getAttribute('data-slot'),
    ).not.toBe('form-field');

    await userEvent.click(saveButton());
    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    const [values, turnstile] = onSave.mock.calls[0] ?? [];
    expect(values).toEqual({
      fields: { ...LOADED_VALUES.fields },
      launchDate: '2026-11-20',
    });
    expect(typeof turnstile?.waitForToken).toBe('function');
  });

  test('固定の期間はカテゴリを無効にして理由を示し、送る値からカテゴリとローンチ日を外す', async () => {
    const { onSave } = await renderForm({ kind: 'edit-locked' });

    await expect.element(categoryTrigger()).toBeDisabled();
    await expect
      .element(categoryTrigger())
      .toHaveAccessibleDescription(LOCK_MESSAGE);
    expect(launchDateGroup().query()).toBeNull();
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    const values = onSave.mock.calls[0]?.[0] as EditProductFormOutput;
    expect(values).not.toHaveProperty('launchDate');
    expect(values.fields).not.toHaveProperty('categoryId');
    expect(values.fields.name).toBe('Pitch Notes');
  });

  test('サーバーの欄の詳細(input.fields.<名前>)をその欄に示す', async () => {
    const taken =
      'このハンドルは既に使われています。別の文字列を入力してください。';
    await renderForm({
      onSave: rejectWith(
        new GraphQLClientError({
          code: 'handle_unavailable',
          message: taken,
          status: 409,
          details: [
            {
              field: 'input.fields.handle',
              code: 'unavailable',
              message: taken,
            },
          ],
        }),
      ),
    });

    await userEvent.click(saveButton());

    await expect.element(handleInput()).toHaveAccessibleDescription(taken);
    await expect.element(handleInput()).toHaveAttribute('aria-invalid', 'true');
    expect(form().getByRole('alert').query()).toBeNull();
  });

  test('ローンチ日の詳細(input.launchDate)をローンチ日の欄に、選べる最も早い日を含む文言で示す', async () => {
    const message = 'ローンチ日は11月10日〜2027年2月7日の間で選んでください。';
    await renderForm({
      onSave: rejectWith(
        new GraphQLClientError({
          code: 'launch_date_unavailable',
          message,
          status: 422,
          details: [
            { field: 'input.launchDate', code: 'out_of_range', message },
          ],
        }),
      ),
    });

    await userEvent.click(saveButton());

    await expect
      .element(launchDateGroup())
      .toHaveAccessibleDescription(new RegExp(message, 'u'));
    await expect.element(form().getByText(message)).toBeVisible();
    expect(form().getByRole('alert').query()).toBeNull();
  });

  test('欄をまとめた値(input.fields)の詳細はフォーム全体の失敗として示し、送信ボタンを無効のまま残さない', async () => {
    const error = validationError(
      'input.fields',
      '入力内容を確認してください。',
    );
    await renderForm({ onSave: rejectWith(error) });

    await userEvent.click(saveButton());

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(error.message);
    await expect.element(saveButton()).toBeEnabled();
  });

  test('GraphQLClientErrorでない例外は、問い合わせの導線を持つ利用者側の固定の文言で示す', async () => {
    await renderForm({ onSave: rejectWith(new TypeError('内部の詳細')) });

    await userEvent.click(saveButton());

    await expect
      .element(form().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE);
    expect(form().element().textContent).not.toContain('内部の詳細');
  });
});

describe('無効のフォーム', () => {
  test('全欄をFormFieldのdisabledで無効にし、送信ボタンを無効にする', async () => {
    const { onSave } = await renderForm({ kind: 'register', disabled: true });
    await expect
      .element(descriptionInput())
      .toHaveAttribute('aria-disabled', 'true');

    await expect.element(nameInput()).toBeDisabled();
    await expect.element(taglineInput()).toBeDisabled();
    await expect.element(handleInput()).toBeDisabled();
    await expect.element(websiteUrlInput()).toBeDisabled();
    await expect.element(categoryTrigger()).toBeDisabled();
    await expect
      .element(
        form()
          .getByRole('button', { name: /画像を選択/u })
          .first(),
      )
      .toBeDisabled();
    await expect
      .element(
        form()
          .getByRole('button', { name: /画像を選択/u })
          .last(),
      )
      .toBeDisabled();
    for (const dayButton of launchDateGroup()
      .element()
      .querySelectorAll('[data-slot="calendar-day-button"]')) {
      expect(dayButton).toBeDisabled();
    }
    await expect.element(registerButton()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、登録・無効・プレビュー・違反の表示の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderForm({ kind: 'register' });
      await waitForEditor();
      await userEvent.click(nameInput());
      await userEvent.tab();
      await expect.element(nameInput()).toHaveAttribute('aria-invalid', 'true');

      expect(await runAxe(document.body)).toEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sで、編集の固定の期間と無効のフォームの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderForm({ kind: 'edit-locked', disabled: true });
      await expect
        .element(descriptionInput())
        .toHaveAttribute('aria-disabled', 'true');

      expect(await runAxe(document.body)).toEqual([]);
    },
  );
});
