import { ChevronRightIcon } from 'lucide-react';

import { withConditions } from '../../../common-lib/directory/directory-query-rules.ts';
import { directoryHref } from '../directory/directory-href.ts';
import { UnmarkedPathLink } from '../directory/unmarked-path-link.tsx';
import { DIRECTORY_HREF } from '../layout/site-links.ts';
import {
  BREADCRUMBS_DIRECTORY_LABEL,
  BREADCRUMBS_LABEL,
} from './product-breadcrumbs-messages.ts';

export interface ProductBreadcrumbsProps {
  readonly category: { readonly name: string; readonly handle: string };
  readonly name: string;
}

const LINK_CLASS_NAME =
  'rounded-sm text-muted-foreground no-underline hover:text-foreground hover:underline';

function Separator() {
  return <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0" />;
}

export function ProductBreadcrumbs({
  category,
  name,
}: ProductBreadcrumbsProps) {
  return (
    <nav aria-label={BREADCRUMBS_LABEL} className="text-sm">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground">
        <li className="flex items-center gap-1">
          <UnmarkedPathLink href={DIRECTORY_HREF} className={LINK_CLASS_NAME}>
            {BREADCRUMBS_DIRECTORY_LABEL}
          </UnmarkedPathLink>
          <Separator />
        </li>
        <li className="flex min-w-0 items-center gap-1">
          <UnmarkedPathLink
            href={directoryHref(
              withConditions({}, { category: category.handle }),
            )}
            className={`${LINK_CLASS_NAME} wrap-anywhere`}
          >
            {category.name}
          </UnmarkedPathLink>
          <Separator />
        </li>
        <li className="min-w-0">
          <span
            aria-current="page"
            className="font-medium wrap-anywhere text-foreground"
          >
            {name}
          </span>
        </li>
      </ol>
    </nav>
  );
}
