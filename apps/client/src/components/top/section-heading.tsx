import type { ReactNode } from 'react';

export interface SectionHeadingProps {
  // 区画の`aria-labelledby`が指す見出しのid
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: string;
  // 見出しの右に添える試合数や時刻などの補足
  readonly meta: ReactNode;
}

export function SectionHeading({ id, icon, title, meta }: SectionHeadingProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-primary/20 pb-2">
      <h2
        id={id}
        className="flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl"
      >
        {icon}
        {title}
      </h2>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {meta}
      </p>
    </div>
  );
}
