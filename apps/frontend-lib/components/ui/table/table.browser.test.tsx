import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
  tokenColorOf,
} from '../../../test/computed-style.ts';
import { hasHorizontalScroll } from '../../../test/overflow.ts';
import { Table } from './table.tsx';
import { TableBody } from './table-body.tsx';
import { TableCaption } from './table-caption.tsx';
import { TableCell } from './table-cell.tsx';
import { TableFooter } from './table-footer.tsx';
import { TableHead } from './table-head.tsx';
import { TableHeader } from './table-header.tsx';
import { TableRow } from './table-row.tsx';

interface AdminRow {
  readonly nickname: string;
  readonly email: string;
  readonly role: string;
  readonly selected?: boolean;
}

const ROWS: readonly AdminRow[] = [
  { nickname: '山田', email: 'yamada@mail.example', role: '最上位管理者' },
  {
    nickname: '佐藤',
    email: 'sato@mail.example',
    role: '運営者',
    selected: true,
  },
];

function AdminTable({ rows = ROWS }: { readonly rows?: readonly AdminRow[] }) {
  return (
    <Table>
      <TableCaption>管理者の一覧</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">ニックネーム</TableHead>
          <TableHead scope="col">メールアドレス</TableHead>
          <TableHead scope="col">ロール</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ nickname, email, role, selected }) => (
          <TableRow
            key={email}
            data-state={selected === true ? 'selected' : undefined}
          >
            <TableHead scope="row">{nickname}</TableHead>
            <TableCell>{email}</TableCell>
            <TableCell>{role}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableHead scope="row">合計</TableHead>
          <TableCell colSpan={2}>{rows.length}人</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function WideTable({
  width,
  contentWidth = '600px',
}: {
  readonly width: string;
  readonly contentWidth?: string;
}) {
  return (
    <div style={{ width }}>
      <Table>
        <TableCaption>管理者の一覧</TableCaption>
        <TableBody>
          <TableRow>
            <TableCell>
              <span className="inline-block" style={{ width: contentWidth }}>
                幅の広い内容
              </span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

const table = () => page.getByRole('table', { name: '管理者の一覧' });

afterEach(() => {
  applyColorScheme('light');
});

describe('Table', () => {
  test('キャプションを表の名前にし、列の見出し・行の見出し・セルの役割で読める', async () => {
    await render(<AdminTable />);

    await expect.element(table()).toBeInTheDocument();
    expect(page.getByRole('columnheader').elements()).toHaveLength(3);
    await expect
      .element(page.getByRole('rowheader', { name: '佐藤' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('cell', { name: 'sato@mail.example' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('cell', { name: '2人' }))
      .toBeInTheDocument();
  });

  test('親の幅を超える表は、包む要素の中で横に移動し、文書を横に広げない', async () => {
    await render(<WideTable width="200px" />);
    const wrapper = table().element().parentElement;

    expect(wrapper).not.toBeNull();
    expect(wrapper?.scrollWidth).toBeGreaterThan(wrapper?.clientWidth ?? 0);
    expect(getComputedStyle(wrapper as Element).overflowX).toBe('auto');
    expect(hasHorizontalScroll()).toBe(false);
  });

  test('親の幅を超える間は、包む要素がキャプションの名前の領域としてTabで止まり、矢印キーで横に移動できる', async () => {
    await render(<WideTable width="200px" />);
    const region = page.getByRole('region', { name: '管理者の一覧' });

    await userEvent.tab();
    await expect.element(region).toHaveFocus();
    await expect
      .poll(() => outlineOf(region.element()))
      .toStrictEqual(ringOutline());
    await userEvent.keyboard('{ArrowRight}');

    await expect.poll(() => region.element().scrollLeft).toBeGreaterThan(0);
  });

  test('親の幅に収まる表は、包む要素がTabで止まらず、領域にならない', async () => {
    await render(
      <>
        <WideTable width="200px" contentWidth="100px" />
        <button type="button">次へ</button>
      </>,
    );

    await userEvent.tab();

    await expect
      .element(page.getByRole('button', { name: '次へ' }))
      .toHaveFocus();
    await expect.element(page.getByRole('region')).not.toBeInTheDocument();
  });

  test('親の幅が広がって表が収まると、包む要素がTabで止まらなくなる', async () => {
    const { rerender } = await render(<WideTable width="200px" />);
    await expect
      .element(page.getByRole('region', { name: '管理者の一覧' }))
      .toBeInTheDocument();

    await rerender(<WideTable width="800px" />);

    await expect.element(page.getByRole('region')).not.toBeInTheDocument();
    expect(table().element().parentElement).not.toHaveAttribute('tabindex');
  });

  test('見出しとセルの文言は、翻訳で長くなっても折り返して親の幅に収める', async () => {
    await render(
      <div style={{ width: '240px' }}>
        <AdminTable
          rows={[
            {
              nickname: 'とても長いニックネームを付けた管理者のアカウント',
              email: 'long@mail.example',
              role: 'カテゴリマスタとユーザーの通報を担当する運営者',
            },
          ]}
        />
      </div>,
    );
    const wrapper = table().element().parentElement as Element;

    expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、選択中の行を弱めた背景の色で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<AdminTable />);
      const selected = page.getByRole('row', { name: /佐藤/ }).element();
      const unselected = page.getByRole('row', { name: /山田/ }).element();

      expect(getComputedStyle(selected).backgroundColor).toBe(
        tokenColorOf('muted'),
      );
      expect(getComputedStyle(unselected).backgroundColor).not.toBe(
        tokenColorOf('muted'),
      );
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('見出し・本体・合計の行と選択中の行を持つ表で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="p-4">
          <AdminTable />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('親の幅を超えて横に移動する表で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(<WideTable width="200px" />);
      await expect
        .element(page.getByRole('region', { name: '管理者の一覧' }))
        .toBeInTheDocument();

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
