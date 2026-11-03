import type { ReactNode } from 'react';

export interface AdminPageHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: AdminPageHeaderProps) {
  return (
    <div
      data-slot="admin-page-header"
      className="flex flex-wrap items-end justify-between gap-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-extrabold break-words">{title}</h1>
        {description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex max-w-full flex-wrap gap-2">{actions}</div>
      )}
    </div>
  );
}
