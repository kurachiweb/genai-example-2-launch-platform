import { type ComponentProps, useId } from 'react';

import { cn } from '../../utilities/class-names.ts';
import {
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
} from '../../utilities/messages/state-messages.ts';
import { Button } from '../ui/button/button.tsx';

export interface NotFoundLink {
  readonly href: string;
  readonly label: string;
}

export interface NotFoundViewProps extends Omit<
  ComponentProps<'section'>,
  'children'
> {
  readonly links: readonly NotFoundLink[];
}

export function NotFoundView({
  links,
  className,
  ...props
}: NotFoundViewProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-slot="not-found-view"
      className={cn(
        'mx-auto flex w-full max-w-xl flex-col items-center px-4 py-24 text-center',
        className,
      )}
      {...props}
    >
      <p
        aria-hidden="true"
        className="text-6xl font-extrabold text-muted-foreground"
      >
        404
      </p>
      <h1
        id={headingId}
        className="mt-4 text-2xl font-extrabold tracking-tight"
      >
        {NOT_FOUND_TITLE}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {NOT_FOUND_DESCRIPTION}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {links.map(({ href, label }, index) => (
          <Button
            key={href}
            variant={index === 0 ? 'default' : 'outline'}
            asChild
          >
            <a href={href}>{label}</a>
          </Button>
        ))}
      </div>
    </section>
  );
}
