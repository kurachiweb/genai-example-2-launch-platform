import type { LucideIcon } from 'lucide-react';

type Props = {
  id: string;
  icon: LucideIcon;
  title: string;
  meta?: React.ReactNode;
};

// トップページのセクション見出しと同じく、下線付きの太字見出しにする
export function SectionTitle({ id, icon: Icon, title, meta }: Props) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b-2 border-primary/20 pb-2">
      <h2
        id={id}
        className="flex items-center gap-2 text-xl font-extrabold tracking-tight"
      >
        <Icon className="size-5 text-primary" aria-hidden="true" />
        {title}
      </h2>
      {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
    </div>
  );
}
