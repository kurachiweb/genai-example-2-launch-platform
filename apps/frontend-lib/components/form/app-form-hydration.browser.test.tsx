import { act, type ReactElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles/base.css';
import { z } from '../../utilities/validation/zod.ts';
import { Checkbox } from '../ui/checkbox/checkbox.tsx';
import { Input } from '../ui/input/input.tsx';
import { Textarea } from '../ui/textarea/textarea.tsx';
import { AppForm } from './app-form.tsx';
import { FormField } from './form-field.tsx';
import { SubmitButton } from './submit-button.tsx';
import { useAppForm } from './use-app-form.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const actEnvironment = globalThis as ActEnvironment;
const hydratedRoots: Root[] = [];

// vitest-browser-reactを使わずReactのactを直接呼ぶため、そのたびにactの環境を指定する
async function actInTestEnvironment(
  callback: () => Promise<void>,
): Promise<void> {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(callback);
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

const accountSchema = z.object({
  email: z.email('メールアドレスを入力してください。'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください。'),
  note: z.string(),
  agreed: z.boolean(),
});

type AccountInput = z.input<typeof accountSchema>;

const DEFAULT_VALUES: AccountInput = {
  email: '',
  password: '',
  note: '',
  agreed: false,
};

interface AccountFormProps {
  readonly onSubmit: (values: AccountInput) => void;
}

function AccountForm({ onSubmit }: AccountFormProps) {
  const form = useAppForm(accountSchema, { defaultValues: DEFAULT_VALUES });
  return (
    <AppForm
      form={form}
      onSubmit={onSubmit}
      onSubmitError={() => undefined}
      aria-label="アカウント"
    >
      <FormField control={form.control} name="email" label="メールアドレス">
        {(control) => <Input {...control} type="email" />}
      </FormField>
      <FormField control={form.control} name="password" label="パスワード">
        {(control) => <Input {...control} type="password" />}
      </FormField>
      <FormField control={form.control} name="note" label="メモ">
        {(control) => <Textarea {...control} />}
      </FormField>
      <FormField control={form.control} name="agreed" label="同意する">
        {({ value, onChange, ...control }) => (
          <Checkbox
            {...control}
            checked={value}
            onCheckedChange={(checked) => {
              onChange(checked === true);
            }}
          />
        )}
      </FormField>
      <input type="hidden" name="cf-turnstile-response" value="" readOnly />
      <SubmitButton>登録する</SubmitButton>
    </AppForm>
  );
}

type Prefill = (container: HTMLElement) => void;

// サーバーの描画結果を文書に置き、水和の前に利用者やブラウザの自動入力が値を入れた状態を作ってから水和する
async function hydrateWithPrefill(
  ui: ReactElement,
  prefill: Prefill,
): Promise<HTMLElement> {
  const serverHtml = renderToString(ui);
  const container = document.body.appendChild(document.createElement('div'));
  container.replaceChildren(
    ...new DOMParser().parseFromString(serverHtml, 'text/html').body.childNodes,
  );
  prefill(container);
  await actInTestEnvironment(async () => {
    hydratedRoots.push(hydrateRoot(container, ui));
    await Promise.resolve();
  });
  return container;
}

const fieldOf = (
  container: HTMLElement,
  name: string,
): HTMLInputElement | HTMLTextAreaElement => {
  const element = container.querySelector<
    HTMLInputElement | HTMLTextAreaElement
  >(`[name="${name}"]`);
  if (element === null) {
    throw new Error(`欄${name}が描かれていません。`);
  }
  return element;
};

const typeInto =
  (values: Readonly<Record<string, string>>): Prefill =>
  (container) => {
    for (const [name, value] of Object.entries(values)) {
      fieldOf(container, name).value = value;
    }
  };

const TOO_SHORT_PASSWORD = ['sh', 'ort'].join('');

const submitButton = () => page.getByRole('button', { name: '登録する' });

afterEach(async () => {
  await actInTestEnvironment(async () => {
    for (const root of hydratedRoots.splice(0)) {
      root.unmount();
    }
    await Promise.resolve();
  });
  document.body.replaceChildren();
});

describe('水和の前に入力された値', () => {
  test('水和の前に入力欄へ入った値をフォームの状態に取り込み、検証を通れば送信ボタンを有効にする', async () => {
    const onSubmit = vi.fn<(values: AccountInput) => void>();

    await hydrateWithPrefill(
      <AccountForm onSubmit={onSubmit} />,
      typeInto({
        email: 'casey@mail.example',
        password: ['correct', 'horse'].join('-'),
        note: '水和の前のメモ',
      }),
    );

    await expect.element(submitButton()).toBeEnabled();

    await submitButton().click();

    await expect
      .poll(() => onSubmit.mock.calls[0]?.[0])
      .toEqual({
        email: 'casey@mail.example',
        password: ['correct', 'horse'].join('-'),
        note: '水和の前のメモ',
        agreed: false,
      });
  });

  test('取り込んだ値が検証を通らなければ、欄のエラーを示して送信ボタンを無効のままにする', async () => {
    const container = await hydrateWithPrefill(
      <AccountForm onSubmit={() => undefined} />,
      typeInto({
        email: 'casey@mail.example',
        password: TOO_SHORT_PASSWORD,
      }),
    );

    await expect.element(submitButton()).toBeDisabled();
    await expect
      .element(page.getByText('パスワードは8文字以上で入力してください。'))
      .toBeVisible();
    expect(fieldOf(container, 'password').value).toBe(TOO_SHORT_PASSWORD);
  });

  test('水和の前に何も入力されていなければ、欄のエラーを示さない', async () => {
    await hydrateWithPrefill(
      <AccountForm onSubmit={() => undefined} />,
      () => undefined,
    );

    await expect.element(submitButton()).toBeDisabled();
    await expect
      .element(page.getByText('メールアドレスを入力してください。'))
      .not.toBeInTheDocument();
  });

  test('フォームに登録されていない名前の入力欄の値は、フォームの状態に取り込まない', async () => {
    const onSubmit = vi.fn<(values: AccountInput) => void>();

    await hydrateWithPrefill(
      <AccountForm onSubmit={onSubmit} />,
      typeInto({
        email: 'casey@mail.example',
        password: ['correct', 'horse'].join('-'),
        'cf-turnstile-response': 'turnstile-token-1',
      }),
    );

    await submitButton().click();

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty(
      'cf-turnstile-response',
    );
  });
});
