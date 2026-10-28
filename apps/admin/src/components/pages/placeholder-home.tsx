import { useId } from 'react';

import { ADMIN_SITE_NAME } from '../layout/admin-site.ts';

const PREPARING_MESSAGE = 'トップページは準備中です。';

export function PlaceholderHome() {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-24 text-center"
    >
      <h1
        id={headingId}
        className="text-3xl font-extrabold tracking-tight sm:text-4xl"
      >
        {ADMIN_SITE_NAME}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">{PREPARING_MESSAGE}</p>
    </section>
  );
}
