import { ChevronRightIcon } from 'lucide-react';

type Props = {
  category: string;
  name: string;
};

export function Breadcrumbs({ category, name }: Props) {
  return (
    <nav aria-label="パンくずリスト" className="text-sm text-muted-foreground">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        <li className="flex items-center gap-1">
          <a href="#" className="hover:text-foreground hover:underline">
            ディレクトリ
          </a>
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </li>
        <li className="flex items-center gap-1">
          <a href="#" className="hover:text-foreground hover:underline">
            {category}
          </a>
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </li>
        <li
          aria-current="page"
          className="min-w-0 font-medium wrap-anywhere text-foreground"
        >
          {name}
        </li>
      </ol>
    </nav>
  );
}
