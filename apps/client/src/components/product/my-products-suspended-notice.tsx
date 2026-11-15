import { BanIcon } from 'lucide-react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { SUSPENDED_NOTICE_LABEL } from '../settings/settings-messages.ts';
import {
  MY_PRODUCTS_SUSPENDED_CONTACT_LABEL,
  MY_PRODUCTS_SUSPENDED_NOTICE,
} from './my-product-messages.ts';

// 停止中の利用者がプロダクトを登録・変更できない旨と、問い合わせへの導線
export function MyProductsSuspendedNotice() {
  return (
    <div
      role="note"
      aria-label={SUSPENDED_NOTICE_LABEL}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3.5 sm:px-5"
    >
      <BanIcon
        aria-hidden="true"
        className="size-6 shrink-0 text-destructive"
      />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">
        {MY_PRODUCTS_SUSPENDED_NOTICE}
      </p>
      <Button size="sm" variant="outline" className="bg-card" asChild>
        <PathLink href={CONTACT_HREF}>
          {MY_PRODUCTS_SUSPENDED_CONTACT_LABEL}
        </PathLink>
      </Button>
    </div>
  );
}
