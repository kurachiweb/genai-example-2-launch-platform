import { beforeEach, describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../../styles.css';
import { success } from '../../../test/admin-accounts-fixtures.ts';
import {
  ARTICLE,
  availabilityCalls,
  availabilityOf,
  button,
  fillAndBlur,
  graphql,
  HANDLE_UNAVAILABLE_MESSAGE,
  handleInput,
  PREVIOUS_HANDLE_GUIDANCE,
  RELEASES_PREVIOUS_MESSAGE,
  renderCreateForm,
  renderEditForm,
  respond,
} from './help-article-form-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

beforeEach(() => {
  graphql.mockReset();
  respond();
});

describe('ハンドルの使用可否', () => {
  test('作成では、形式を満たすハンドルを記事のIDを持たない新しい記事として確かめ、使用中なら使用中の文言を示す', async () => {
    respond({ availability: availabilityOf('UNAVAILABLE') });
    await renderCreateForm();

    await fillAndBlur(handleInput(), 'Taken-Handle');

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(HANDLE_UNAVAILABLE_MESSAGE);
    await expect.element(handleInput()).toHaveAttribute('aria-invalid', 'true');
    expect(availabilityCalls()[0]?.[1]).toEqual({
      handle: 'Taken-Handle',
      articleId: null,
    });
  });

  test('編集では記事のIDを添えて確かめ、他の記事の旧ハンドルなら保存でその転送が無くなる旨を示し、保存はできる', async () => {
    respond({ availability: availabilityOf('AVAILABLE_RELEASES_PREVIOUS') });
    await renderEditForm();

    await fillAndBlur(handleInput(), 'old-handle');

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(
        `${PREVIOUS_HANDLE_GUIDANCE} ${RELEASES_PREVIOUS_MESSAGE}`,
      );
    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
    expect(availabilityCalls()[0]?.[1]).toEqual({
      handle: 'old-handle',
      articleId: ARTICLE.id,
    });
    await expect.element(button('保存する')).toBeEnabled();
  });

  test('他の記事の旧ハンドルの案内は、ハンドルを書き換えると消える', async () => {
    respond({ availability: availabilityOf('AVAILABLE_RELEASES_PREVIOUS') });
    await renderEditForm();
    await fillAndBlur(handleInput(), 'old-handle');
    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(
        `${PREVIOUS_HANDLE_GUIDANCE} ${RELEASES_PREVIOUS_MESSAGE}`,
      );

    await userEvent.fill(handleInput(), 'old-handle2');

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(PREVIOUS_HANDLE_GUIDANCE);
  });

  test('使えるハンドルは文言を出さず、読み込んだ記事のハンドルのままなら問い合わせない', async () => {
    await renderEditForm();

    await userEvent.click(handleInput());
    await userEvent.tab();
    expect(availabilityCalls()).toHaveLength(0);

    await fillAndBlur(handleInput(), 'free-handle');

    await expect.poll(() => availabilityCalls().length).toBe(1);
    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(PREVIOUS_HANDLE_GUIDANCE);
    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
  });

  test('応答を待つ間にハンドルが変わったら、古い応答の使用中を示さない', async () => {
    let resolveAvailability: (value: unknown) => void = () => undefined;
    respond({
      availability: () =>
        new Promise((resolve) => {
          resolveAvailability = resolve;
        }),
    });
    await renderCreateForm();

    await fillAndBlur(handleInput(), 'first-handle');
    await expect.poll(() => availabilityCalls().length).toBe(1);
    await userEvent.fill(handleInput(), 'second-handle');
    resolveAvailability(
      await success({ helpArticleHandleAvailability: 'UNAVAILABLE' }),
    );

    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(handleInput()).not.toHaveAccessibleDescription();
  });

  test('確かめる問い合わせの失敗では、文言を出さず保存を妨げない', async () => {
    respond({
      availability: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await renderEditForm();

    await fillAndBlur(handleInput(), 'free-handle');

    await expect.poll(() => availabilityCalls().length).toBe(1);
    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(button('保存する')).toBeEnabled();
  });

  test('旧ハンドルを持たない記事では、旧ハンドルの案内を出さない', async () => {
    await renderEditForm({ article: { ...ARTICLE, previousHandle: null } });

    await expect.element(handleInput()).not.toHaveAccessibleDescription();
  });
});
