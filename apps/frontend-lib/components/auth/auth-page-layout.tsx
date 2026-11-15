import { type ReactNode, useId } from 'react';

export interface AuthPageLayoutProps {
  readonly title: string;
  readonly children: ReactNode;
}

export function AuthPageLayout({ title, children }: AuthPageLayoutProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12 sm:py-16"
    >
      <h1
        id={headingId}
        className="text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {title}
      </h1>
      <div className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        {children}
      </div>
    </section>
  );
}
