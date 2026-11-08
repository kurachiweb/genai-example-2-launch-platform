import { EllipsisIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { DropdownMenu } from '../../../lib/components/ui/dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuTrigger } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-trigger.tsx';
import { orderPublicProfileSections } from './public-profile-section-order.ts';
import type {
  PublicProfileMenuItem,
  PublicProfileSectionContext,
} from './public-profile-section-types.ts';
import { ACTIONS_MENU_LABEL } from './profile-messages.ts';

export interface ProfileActionsMenuProps {
  readonly context: PublicProfileSectionContext;
  readonly items: readonly PublicProfileMenuItem[];
}

// 項目は他の機能が登録する。本人には項目があっても出さず、項目が無ければボタンごと出さない
export function ProfileActionsMenu({
  context,
  items,
}: ProfileActionsMenuProps) {
  if (context.isOwner || items.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={ACTIONS_MENU_LABEL}
        >
          <EllipsisIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {orderPublicProfileSections(items).map(({ id, Item }) => (
          <Item key={id} {...context} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
