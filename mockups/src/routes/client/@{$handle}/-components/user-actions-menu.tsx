import { EllipsisIcon, FlagIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';

type Props = { onReport: () => void };

// ログイン状態を問わず通報できる(FR-REPOT-001)。本人には表示しない(FR-REPOT-005)
export function UserActionsMenu({ onReport }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="outline" aria-label="その他の操作">
          <EllipsisIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onReport}>
          <FlagIcon aria-hidden="true" />
          このユーザーを通報
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
