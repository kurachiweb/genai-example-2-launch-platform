import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../../utilities/class-names.ts';

export type EmptyStateHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface EmptyStateProps extends Omit<
  ComponentProps<'div'>,
  'title' | 'children'
> {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly headingLevel?: EmptyStateHeadingLevel;
}

const FRAME_CLASS_NAME =
  'flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center';

const HEADING_TAGS = {
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
} as const satisfies Record<EmptyStateHeadingLevel, string>;

const TITLE_CLASS_NAME = 'text-lg font-extrabold';

export function EmptyState({
  title,
  description,
  action,
  headingLevel,
  className,
  ...props
}: EmptyStateProps) {
  const headingId = useId();
  const Frame = headingLevel === undefined ? 'div' : 'section';
  const Heading = headingLevel === undefined ? 'p' : HEADING_TAGS[headingLevel];

  return (
    <Frame
      aria-labelledby={headingLevel === undefined ? undefined : headingId}
      data-slot="empty-state"
      className={cn(FRAME_CLASS_NAME, className)}
      {...props}
    >
      <Heading id={headingId} className={TITLE_CLASS_NAME}>
        {title}
      </Heading>
      {description === undefined ? null : (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action === undefined ? null : (
        <div className="mt-6 flex max-w-full flex-wrap justify-center gap-2">
          {action}
        </div>
      )}
    </Frame>
  );
}
