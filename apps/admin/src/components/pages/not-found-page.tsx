import { NotFoundView } from '../../../lib/components/error/not-found-view.tsx';
import { ADMIN_HOME_HREF } from '../layout/admin-site.ts';

const NOT_FOUND_LINKS = Object.freeze([
  { href: ADMIN_HOME_HREF, label: 'トップページへ' },
]);

export function NotFoundPage() {
  return <NotFoundView links={NOT_FOUND_LINKS} />;
}
