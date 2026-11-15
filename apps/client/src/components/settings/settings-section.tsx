import { type ReactNode, useId } from 'react';

export interface SettingsSectionProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}

export function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
    >
      <div className="flex flex-col gap-2">
        <h2 id={headingId} className="text-lg font-bold">
          {title}
        </h2>
        {description === undefined ? null : (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      {children}
    </section>
  );
}
