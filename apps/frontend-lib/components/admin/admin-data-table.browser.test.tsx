import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { hasHorizontalScroll } from '../../test/overflow.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTableProps,
} from './admin-data-table.tsx';

interface AdminRow {
  readonly id: string;
  readonly nickname: string;
  readonly email: string;
  readonly role: string;
}

const CAPTION = '管理者の一覧';
const EMPTY_MESSAGE = '管理者はまだいません。';
const LOAD_ERROR =
  '管理者の一覧を読み込めませんでした。時間をおいて再度お試しください。';

const ROWS: readonly AdminRow[] = [
  {
    id: 'a1',
    nickname: '山田',
    email: 'yamada@mail.example',
    role: '最上位管理者',
  },
  { id: 'a2', nickname: '佐藤', email: 'sato@mail.example', role: '運営者' },
];

const COLUMNS: readonly AdminDataTableColumn<AdminRow>[] = [
  { key: 'nickname', header: 'ニックネーム', cell: (row) => row.nickname },
  { key: 'email', header: 'メールアドレス', cell: (row) => row.email },
  {
    key: 'role',
    header: 'ロール',
    cell: (row) => row.role,
    className: 'text-end',
  },
];

function AdminTable(props: Partial<AdminDataTableProps<AdminRow>>) {
  return (
    <AdminDataTable
      caption={CAPTION}
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.id}
      emptyMessage={EMPTY_MESSAGE}
      {...props}
    />
  );
}

function pagination(
  overrides: Partial<NonNullable<AdminDataTableProps<AdminRow>['pagination']>>,
) {
  return {
    hasPrevious: false,
    hasNext: false,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
}

const table = () => page.getByRole('table', { name: CAPTION });
const pageNavigation = () =>
  page.getByRole('navigation', { name: 'ページ送り' });
const previousButton = () =>
  page.getByRole('button', { name: '前へ', exact: true });
const nextButton = () =>
  page.getByRole('button', { name: '次へ', exact: true });

afterEach(() => {
  applyColorScheme('light');
});

describe('AdminDataTable', () => {
  test('キャプションを表の名前にし、列の見出しを列の範囲で、行をセルで読める', async () => {
    await render(<AdminTable />);

    await expect.element(table()).toBeInTheDocument();
    const headers = page.getByRole('columnheader').elements();
    expect(headers.map((header) => header.textContent)).toStrictEqual([
      'ニックネーム',
      'メールアドレス',
      'ロール',
    ]);
    expect(headers.map((header) => header.getAttribute('scope'))).toStrictEqual(
      ['col', 'col', 'col'],
    );
    expect(page.getByRole('row').elements()).toHaveLength(3);
    await expect
      .element(page.getByRole('cell', { name: 'sato@mail.example' }))
      .toBeInTheDocument();
  });

  test('列の追加のクラスを、その列の見出しとセルの両方に付ける', async () => {
    await render(<AdminTable />);

    expect(
      page.getByRole('columnheader', { name: 'ロール' }).element(),
    ).toHaveClass('text-end');
    expect(page.getByRole('cell', { name: '運営者' }).element()).toHaveClass(
      'text-end',
    );
  });

  test('親の幅を超える間は、キャプションの名前の領域としてTabで止まり、文書を横に広げない', async () => {
    await render(
      <div style={{ width: '160px' }}>
        <AdminTable
          columns={[
            ...COLUMNS,
            {
              key: 'wide',
              header: '備考',
              cell: () => (
                <span className="inline-block" style={{ width: '600px' }}>
                  幅の広い内容
                </span>
              ),
            },
          ]}
        />
      </div>,
    );
    const region = page.getByRole('region', { name: CAPTION });

    await userEvent.tab();

    await expect.element(region).toHaveFocus();
    expect(hasHorizontalScroll()).toBe(false);
  });

  test('行がまだ無い間は、読み込み中であることを状態の領域の文言と表の領域のaria-busyで伝え、表を描かず、ページ送りを描いたまま押せなくする', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    await render(
      <AdminTable
        rows={undefined}
        pagination={pagination({
          hasPrevious: true,
          hasNext: true,
          onPrevious,
          onNext,
        })}
      />,
    );

    const status = page.getByRole('status');
    await expect.element(status).toHaveTextContent('読み込み中');
    expect(status.element().closest('[aria-busy="true"]')).not.toBeNull();
    await expect.element(page.getByRole('table')).not.toBeInTheDocument();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');

    previousButton().element().focus();
    await userEvent.keyboard('{Enter}');
    nextButton().element().focus();
    await userEvent.keyboard('{Enter}');

    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  test('行を表示している間は、表の領域にaria-busyを付けない', async () => {
    await render(<AdminTable />);

    await expect.element(table()).toBeInTheDocument();
    expect(table().element().closest('[aria-busy]')).toBeNull();
  });

  test('行が0件なら、空の文言を表示し、表を描かない', async () => {
    await render(<AdminTable rows={[]} />);

    await expect.element(page.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    await expect.element(page.getByRole('table')).not.toBeInTheDocument();
  });

  test('行が0件でも前のページがあれば、前のページへ戻るページ送りを描く', async () => {
    const onPrevious = vi.fn();
    await render(
      <AdminTable
        rows={[]}
        pagination={pagination({ hasPrevious: true, onPrevious })}
      />,
    );

    await previousButton().click();

    expect(onPrevious).toHaveBeenCalledOnce();
  });

  test('エラーの間は、文言を警告として伝えて再試行のボタンを描き、問い合わせのボタンとリンクを描かない', async () => {
    const onRetry = vi.fn();
    await render(
      <AdminTable
        error={{ message: LOAD_ERROR, onRetry }}
        pagination={pagination({ hasNext: true })}
      />,
    );

    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    await expect
      .element(page.getByRole('button', { name: 'お問い合わせ' }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'お問い合わせ' }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole('table')).not.toBeInTheDocument();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');

    await page.getByRole('button', { name: '再試行', exact: true }).click();

    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('読み込み中にエラーになっても、エラーを表示する', async () => {
    await render(
      <AdminTable
        rows={undefined}
        error={{ message: LOAD_ERROR, onRetry: vi.fn() }}
      />,
    );

    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    await expect.element(page.getByRole('status')).not.toBeInTheDocument();
  });

  test('前後のページがある間は、名前付きのページ送りの両方のボタンで移動できる', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    await render(
      <AdminTable
        pagination={pagination({
          hasPrevious: true,
          hasNext: true,
          onPrevious,
          onNext,
        })}
      />,
    );

    await expect.element(pageNavigation()).toBeInTheDocument();
    await previousButton().click();
    await nextButton().click();

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  test('最初のページでは前へのボタンを、最後のページでは次へのボタンを、Tabで止まるまま押せなくする', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const { rerender } = await render(
      <AdminTable pagination={pagination({ hasNext: true, onPrevious })} />,
    );

    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(nextButton()).not.toHaveAttribute('aria-disabled');
    await userEvent.tab();
    await expect.element(previousButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onPrevious).not.toHaveBeenCalled();

    await rerender(
      <AdminTable pagination={pagination({ hasPrevious: true, onNext })} />,
    );

    await expect.element(previousButton()).not.toHaveAttribute('aria-disabled');
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.tab();
    await expect.element(nextButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onNext).not.toHaveBeenCalled();
  });

  test.each([
    [
      '最後のページ',
      { rows: ROWS, pagination: pagination({ hasPrevious: true }) },
    ],
    [
      '次のページの読み込み中',
      {
        rows: undefined,
        pagination: pagination({ hasPrevious: true, hasNext: true }),
      },
    ],
  ])(
    'キーボードで次へを押した後に%sになっても、フォーカスが次へのボタンに残り、押しても移動しない',
    async (_state, nextProps) => {
      const onNext = vi.fn();
      const { rerender } = await render(
        <AdminTable
          pagination={pagination({ hasPrevious: true, hasNext: true, onNext })}
        />,
      );
      await userEvent.tab();
      await userEvent.tab();
      await expect.element(nextButton()).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      expect(onNext).toHaveBeenCalledOnce();

      await rerender(
        <AdminTable
          rows={nextProps.rows}
          pagination={{ ...nextProps.pagination, onNext }}
        />,
      );

      await expect.element(nextButton()).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);
      await expect
        .element(nextButton())
        .toHaveAttribute('aria-disabled', 'true');
      await userEvent.keyboard('{Enter}');
      expect(onNext).toHaveBeenCalledOnce();
    },
  );

  test('前後のページがどちらも無ければ、ページ送りの両方のボタンを押せなくする', async () => {
    await render(<AdminTable pagination={pagination({})} />);

    await expect.element(table()).toBeInTheDocument();
    await expect.element(pageNavigation()).toBeInTheDocument();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');
  });

  test('ページ送りを渡さなければ、ページ送りを描かない', async () => {
    await render(<AdminTable />);

    await expect.element(table()).toBeInTheDocument();
    await expect.element(pageNavigation()).not.toBeInTheDocument();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      [
        '行とページ送り',
        <AdminTable
          key="rows"
          pagination={pagination({ hasPrevious: true, hasNext: true })}
        />,
      ],
      [
        '読み込み中',
        <AdminTable
          key="loading"
          rows={undefined}
          pagination={pagination({ hasPrevious: true, hasNext: true })}
        />,
      ],
      [
        '最後のページ',
        <AdminTable
          key="last"
          pagination={pagination({ hasPrevious: true })}
        />,
      ],
      ['空', <AdminTable key="empty" rows={[]} />],
      [
        'エラー',
        <AdminTable
          key="error"
          error={{ message: LOAD_ERROR, onRetry: () => undefined }}
        />,
      ],
    ])(
      '%sの状態で、アクセシビリティの検査の違反が0件',
      async (_state, element) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="p-4">{element}</div>,
        );

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
