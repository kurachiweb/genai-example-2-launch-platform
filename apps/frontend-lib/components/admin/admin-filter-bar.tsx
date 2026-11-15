import type { ReactNode } from 'react';

import {
  ADMIN_FILTER_LABEL,
  APPLY_FILTER_LABEL,
  RESET_FILTER_LABEL,
} from '../../utilities/messages/admin-console-messages.ts';
import { Button } from '../ui/button/button.tsx';

export interface AdminFilterBarProps {
  readonly children: ReactNode;
  readonly onApply: () => void;
  readonly onReset: () => void;
}

export function AdminFilterBar({
  children,
  onApply,
  onReset,
}: AdminFilterBarProps) {
  return (
    <form
      role="search"
      aria-label={ADMIN_FILTER_LABEL}
      data-slot="admin-filter-bar"
      className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{APPLY_FILTER_LABEL}</Button>
        <Button type="button" variant="outline" onClick={onReset}>
          {RESET_FILTER_LABEL}
        </Button>
      </div>
    </form>
  );
}
