import type { LucideIcon } from 'lucide-react';

type Props = {
  icon: LucideIcon;
  title: string;
  // 本人には次の行動への説明と導線を添え、他者には事実だけを示す
  description?: string;
  action?: React.ReactNode;
};

export function TabEmpty({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <Icon className="size-10 text-muted-foreground/60" aria-hidden="true" />
      <p className="mt-4 text-lg font-extrabold">{title}</p>
      {description && (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
