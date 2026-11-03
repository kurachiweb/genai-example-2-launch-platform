import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { hasHorizontalScroll } from '../../test/overflow.ts';
import { Input } from '../ui/input/input.tsx';
import { Label } from '../ui/label/label.tsx';
import { Select } from '../ui/select/select.tsx';
import { SelectContent } from '../ui/select/select-content.tsx';
import { SelectItem } from '../ui/select/select-item.tsx';
import { SelectTrigger } from '../ui/select/select-trigger.tsx';
import { SelectValue } from '../ui/select/select-value.tsx';
import { AdminFilterBar } from './admin-filter-bar.tsx';

interface Filters {
  readonly keyword: string;
  readonly role: string;
}

const INITIAL_FILTERS: Filters = { keyword: '', role: 'all' };

function AuditLogFilters({
  onApply,
  onReset,
}: {
  readonly onApply: (filters: Filters) => void;
  readonly onReset?: () => void;
}) {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  return (
    <AdminFilterBar
      onApply={() => {
        onApply(filters);
      }}
      onReset={() => {
        setFilters(INITIAL_FILTERS);
        onReset?.();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="keyword">キーワード</Label>
        <Input
          id="keyword"
          value={filters.keyword}
          onChange={(event) => {
            setFilters({ ...filters, keyword: event.target.value });
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="role">ロール</Label>
        <Select
          value={filters.role}
          onValueChange={(role) => {
            setFilters({ ...filters, role });
          }}
        >
          <SelectTrigger id="role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全て</SelectItem>
            <SelectItem value="operator">運営者</SelectItem>
            <SelectItem value="viewer">閲覧者</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </AdminFilterBar>
  );
}

const filterRegion = () => page.getByRole('search', { name: '絞り込み' });
const applyButton = () =>
  page.getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  page.getByRole('button', { name: '解除', exact: true });
const keywordInput = () => page.getByRole('textbox', { name: 'キーワード' });

afterEach(() => {
  applyColorScheme('light');
});

describe('AdminFilterBar', () => {
  test('入力欄の並びと操作を、名前付きの検索の領域にまとめる', async () => {
    await render(<AuditLogFilters onApply={vi.fn()} />);

    await expect.element(filterRegion()).toBeInTheDocument();
    expect(filterRegion().element()).toContainElement(keywordInput().element());
    expect(filterRegion().element()).toContainElement(applyButton().element());
    expect(filterRegion().element()).toContainElement(resetButton().element());
  });

  test('適用のボタンで、選んだ条件を呼び出す側へ渡し、ページを移動しない', async () => {
    const onApply = vi.fn();
    await render(<AuditLogFilters onApply={onApply} />);
    const roleTrigger = page.getByRole('combobox', { name: 'ロール' });
    const locationBefore = window.location.href;

    await keywordInput().fill('招待');
    await roleTrigger.click();
    await page.getByRole('option', { name: '運営者', exact: true }).click();
    await applyButton().click();

    expect(onApply).toHaveBeenCalledExactlyOnceWith({
      keyword: '招待',
      role: 'operator',
    });
    expect(window.location.href).toBe(locationBefore);
  });

  test('入力欄でEnterを押すと、適用のボタンと同じく条件を渡す', async () => {
    const onApply = vi.fn();
    await render(<AuditLogFilters onApply={onApply} />);

    await keywordInput().fill('削除');
    await userEvent.keyboard('{Enter}');

    expect(onApply).toHaveBeenCalledExactlyOnceWith({
      keyword: '削除',
      role: 'all',
    });
  });

  test('解除のボタンで、呼び出す側に条件を戻させ、適用はしない', async () => {
    const onApply = vi.fn();
    const onReset = vi.fn();
    await render(<AuditLogFilters onApply={onApply} onReset={onReset} />);
    await keywordInput().fill('招待');

    await resetButton().click();

    expect(onReset).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
    await expect.element(keywordInput()).toHaveValue('');
  });

  test('狭い画面では、入力欄と操作を折り返し、文書を横に広げない', async () => {
    await render(
      <div style={{ width: '240px' }}>
        <AuditLogFilters onApply={vi.fn()} />
      </div>,
    );

    await expect.element(filterRegion()).toBeInTheDocument();
    const region = filterRegion().element();
    expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth);
    expect(hasHorizontalScroll()).toBe(false);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('入力欄と選択欄を並べた絞り込みで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="p-4">
          <AuditLogFilters onApply={vi.fn()} />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
