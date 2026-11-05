import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  INQUIRY_DETAIL_ACTIONS,
  type InquiryDetailAction,
  type InquiryDetailActionContext,
} from '../../composition/inquiry-detail-actions.ts';
import { InquiryDetailActionsView } from './inquiry-detail-actions-view.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。';

const MEMBER_CONTEXT: InquiryDetailActionContext = Object.freeze({
  inquiryId: '01JC0MINQUIRY0000000000001',
  kind: 'member',
  userId: '01JC0USER00000000000000001',
  withdrawn: false,
  contactEmail: null,
});

const actionOf = (
  id: string,
  order: number,
  component: InquiryDetailAction['component'],
): InquiryDetailAction => ({ id, order, component });

function AccountAction({
  inquiry,
}: {
  readonly inquiry: InquiryDetailActionContext;
}) {
  return (
    <section aria-label="アカウントの操作">
      <p>
        {inquiry.kind}:{inquiry.userId ?? 'なし'}:{String(inquiry.withdrawn)}:
        {inquiry.contactEmail ?? 'なし'}
      </p>
    </section>
  );
}

function HelpAction() {
  return <section aria-label="ヘルプ記事の操作">ヘルプ記事の作成</section>;
}

let actionFailing = false;

// Reactは失敗した描画をやり直すため、テストが失敗を止めるまで描画のたびに失敗する
function ThrowingAction() {
  if (actionFailing) {
    throw new Error('操作の描画の失敗');
  }
  return <section aria-label="回復した操作">回復した操作</section>;
}

function ThrowingGraphQLAction(): never {
  throw new GraphQLClientError({
    code: 'upstream_unavailable',
    message: '現在ご利用いただけません。時間をおいて再度お試しください。',
    status: 503,
  });
}

const renderActions = (
  actions: readonly InquiryDetailAction[],
  inquiry: InquiryDetailActionContext = MEMBER_CONTEXT,
) =>
  renderInRouter(
    <main className="p-4">
      <p>問い合わせの情報</p>
      <InquiryDetailActionsView actions={actions} inquiry={inquiry} />
    </main>,
  );

const regionNames = () =>
  page
    .getByRole('region')
    .elements()
    .map((region) => region.getAttribute('aria-label'));

beforeEach(() => {
  actionFailing = false;
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('InquiryDetailActionsView', () => {
  test('初版の登録箇所は空で凍結されている', () => {
    expect(INQUIRY_DETAIL_ACTIONS).toStrictEqual([]);
    expect(Object.isFrozen(INQUIRY_DETAIL_ACTIONS)).toBe(true);
  });

  test('登録が空なら、見出しや空状態を含めて何も描画しない', async () => {
    await renderInRouter(
      <div data-testid="actions">
        <InquiryDetailActionsView
          actions={INQUIRY_DETAIL_ACTIONS}
          inquiry={MEMBER_CONTEXT}
        />
      </div>,
    );
    const container = page.getByTestId('actions').element();

    expect(container.childElementCount).toBe(0);
    expect(container.textContent).toBe('');
  });

  test('登録の順によらず操作をorderの順に並べ、各操作へ問い合わせの文脈の値を渡す', async () => {
    await renderActions([
      actionOf('help-center.create-article', 20, HelpAction),
      actionOf('ugc-moderation.account', 10, AccountAction),
    ]);

    await expect.element(page.getByText('ヘルプ記事の作成')).toBeVisible();
    expect(regionNames()).toStrictEqual([
      'アカウントの操作',
      'ヘルプ記事の操作',
    ]);
    await expect
      .element(page.getByRole('region', { name: 'アカウントの操作' }))
      .toHaveTextContent(`member:${MEMBER_CONTEXT.userId ?? ''}:false:なし`);
  });

  test('1つの操作の描画の失敗はその位置に問い合わせを促さない文言と再試行で示し、詳細と他の操作の表示を続け、エラートラッキングへ送る', async () => {
    actionFailing = true;
    await renderActions([
      actionOf('a.throwing', 10, ThrowingAction),
      actionOf('b.help', 20, HelpAction),
    ]);

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    await expect.element(page.getByText('問い合わせの情報')).toBeVisible();
    await expect.element(page.getByText('ヘルプ記事の作成')).toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('お問い合わせ');
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.any(Error),
      'render',
    );

    actionFailing = false;
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(page.getByText('回復した操作')).toBeVisible();
  });

  test('GraphQLの失敗はAPIの文言で示し、取得の補助が送るためエラートラッキングへ送り直さない', async () => {
    await renderActions([actionOf('a.graphql', 10, ThrowingGraphQLAction)]);

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('現在ご利用いただけません。');
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、操作の並びと失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      actionFailing = true;
      await renderActions([
        actionOf('a.throwing', 10, ThrowingAction),
        actionOf('b.account', 20, AccountAction),
      ]);
      await expect.element(page.getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
