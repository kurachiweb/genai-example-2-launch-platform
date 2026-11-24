import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { observeSwaggerUiAccessibility } from './swagger-ui-accessibility.ts';

type Child = Element | string;

const h = (
  tag: string,
  attributes: Readonly<Record<string, string>> = {},
  ...children: readonly Child[]
): Element => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
};

const icon = (): Element => h('span', { 'aria-hidden': 'true' });

const SERVER_URL = 'https://api.example/v1';
const EXAMPLE = '{"id": 1}';

// Swagger UIのサーバーの選択欄と同じく、文言の無いlabelで包む
const serversMarkup = (): Element =>
  h(
    'div',
    { class: 'servers' },
    h(
      'label',
      { for: 'servers' },
      h(
        'select',
        { id: 'servers' },
        h('option', { value: SERVER_URL }, SERVER_URL),
      ),
    ),
  );

const operationMarkup = (): Element =>
  h(
    'div',
    {},
    h(
      'table',
      { class: 'parameters' },
      h(
        'tbody',
        {},
        h(
          'tr',
          { 'data-param-name': 'sort', 'data-param-in': 'query' },
          h('td', { class: 'parameters-col_name' }, 'sort'),
          h(
            'td',
            { class: 'parameters-col_description' },
            h(
              'select',
              {},
              h('option', { value: '' }, '--'),
              h('option', { value: 'new' }, 'new'),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'highlight-code' },
      h('pre', { class: 'example microlight' }, EXAMPLE),
    ),
  );

const dialogMarkup = (): Element =>
  h(
    'div',
    {},
    h(
      'div',
      { class: 'modal-ux-header' },
      h('h3', {}, 'Available authorizations'),
      h('button', { type: 'button', class: 'close-modal' }, icon()),
    ),
    h(
      'button',
      {
        type: 'submit',
        class: 'btn modal-btn auth authorize',
        'aria-label': 'Apply credentials',
      },
      'Authorize',
    ),
    h(
      'button',
      { type: 'button', class: 'btn', 'aria-label': 'Authorize the request' },
      'Authorize',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'expand-operation',
        'aria-label': 'Expand operation',
      },
      icon(),
    ),
  );

const mountRoot = (...children: readonly Element[]): HTMLElement => {
  const root = document.createElement('div');
  root.append(...children);
  document.body.append(root);
  return root;
};

const microlight = () => page.getByText(EXAMPLE, { exact: true }).element();

afterEach(() => {
  document.body.replaceChildren();
});

describe('observeSwaggerUiAccessibility', () => {
  test('描画済みのサーバーの選択欄に、日本語の名前を付ける', async () => {
    const root = mountRoot(serversMarkup());

    observeSwaggerUiAccessibility(root);

    await expect
      .element(page.getByRole('combobox', { name: 'サーバー', exact: true }))
      .toHaveValue(SERVER_URL);
  });

  test('引数の選択欄に引数の名前を付け、例の表示をキーボードでスクロールできるようにする', async () => {
    const root = mountRoot(operationMarkup());

    observeSwaggerUiAccessibility(root);

    await expect
      .element(page.getByRole('combobox', { name: 'sort', exact: true }))
      .toBeVisible();
    expect(microlight().getAttribute('tabindex')).toBe('0');
  });

  test('ダイアログの閉じるボタンに名前を付け、表示の文言を含まない名前のボタンは表示の文言を名前にする', async () => {
    const root = mountRoot(dialogMarkup());

    observeSwaggerUiAccessibility(root);

    await expect
      .element(page.getByRole('button', { name: '閉じる', exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Authorize', exact: true }))
      .toHaveClass('modal-btn');
    await expect
      .element(
        page.getByRole('button', {
          name: 'Authorize the request',
          exact: true,
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByRole('button', { name: 'Expand operation', exact: true }),
      )
      .toBeVisible();
  });

  test('観察を始めた後に描き直された部品にも、名前とフォーカスを付ける', async () => {
    const root = mountRoot();
    observeSwaggerUiAccessibility(root);

    root.append(serversMarkup(), operationMarkup(), dialogMarkup());

    await expect
      .element(page.getByRole('combobox', { name: 'サーバー', exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole('combobox', { name: 'sort', exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: '閉じる', exact: true }))
      .toBeVisible();
    expect(microlight().getAttribute('tabindex')).toBe('0');
  });

  test('同じ描画先で観察を始め直しても、描き直された部品に名前を付ける', async () => {
    const root = mountRoot();
    observeSwaggerUiAccessibility(root);
    observeSwaggerUiAccessibility(root);

    root.replaceChildren(serversMarkup());

    await expect
      .element(page.getByRole('combobox', { name: 'サーバー', exact: true }))
      .toBeVisible();
  });

  test('既に付いている名前は上書きしない', async () => {
    const root = mountRoot(
      h(
        'select',
        { id: 'servers', 'aria-label': 'Server URL' },
        h('option', {}, SERVER_URL),
      ),
    );

    observeSwaggerUiAccessibility(root);

    await expect
      .element(page.getByRole('combobox', { name: 'Server URL', exact: true }))
      .toBeVisible();
  });
});
