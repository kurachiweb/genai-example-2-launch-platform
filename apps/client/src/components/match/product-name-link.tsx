import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { productDetailHref } from '../layout/site-links.ts';

export interface ProductNameLinkProps {
  readonly name: string;
  readonly handle: string;
  // ディレクトリに掲載されているか閲覧者自身のプロダクトのときだけ詳細ページへ導く
  readonly linked: boolean;
}

export function ProductNameLink({
  name,
  handle,
  linked,
}: ProductNameLinkProps) {
  if (!linked) {
    return name;
  }
  return (
    <PathLink
      href={productDetailHref(handle)}
      className="rounded-sm text-inherit no-underline hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {name}
    </PathLink>
  );
}
