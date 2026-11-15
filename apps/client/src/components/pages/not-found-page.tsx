import { NotFoundView } from '../../../lib/components/error/not-found-view.tsx';
import { DIRECTORY_HREF, HOME_HREF } from '../layout/site-links.ts';

const NOT_FOUND_LINKS = Object.freeze([
  { href: HOME_HREF, label: 'トップページへ' },
  { href: DIRECTORY_HREF, label: 'ディレクトリを見る' },
]);

export function NotFoundPage() {
  return <NotFoundView links={NOT_FOUND_LINKS} />;
}
