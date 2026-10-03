import { Link } from '@tanstack/react-router';
import {
  FileSearchIcon,
  RocketIcon,
  SearchXIcon,
  TrophyIcon,
  XIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

import type { DirectoryQuery } from '../-model/query';
import { useDirectoryFormat } from './use-directory-format';

type Props =
  | {
      kind: 'filtered';
      query: DirectoryQuery;
      categoryName: string | undefined;
      periodLabel: string | undefined;
    }
  | { kind: 'none'; loggedIn: boolean }
  | { kind: 'out-of-range'; page: number; pageCount: number };

function Frame({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="empty-heading"
      className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center"
    >
      <Icon className="size-10 text-muted-foreground/60" aria-hidden="true" />
      <h2 id="empty-heading" className="mt-4 text-lg font-extrabold">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
      <div className="mt-6 flex max-w-full flex-wrap justify-center gap-2">
        {children}
      </div>
    </section>
  );
}

type Condition = {
  key: string;
  label: string;
  patch: Partial<DirectoryQuery>;
};

const CLEAR_ALL: Partial<DirectoryQuery> = {
  q: undefined,
  category: undefined,
  from: undefined,
  to: undefined,
};

// 次の行動への導線を添えた空状態。条件の指定中は条件の見直し・解除、条件なしならローンチ予約へ導く
export function EmptyState(props: Props) {
  const format = useDirectoryFormat();

  if (props.kind === 'out-of-range') {
    return (
      <Frame
        icon={FileSearchIcon}
        title="このページにはプロダクトがありません。"
        description={`一覧は全${format.number(props.pageCount)}ページです。1ページ目から探してみましょう。`}
      >
        <Button asChild>
          <Link
            from="/client/p/"
            to="/client/p"
            search={(prev) => ({ ...prev, page: undefined })}
          >
            1ページ目へ
          </Link>
        </Button>
      </Frame>
    );
  }

  if (props.kind === 'none') {
    return (
      <Frame
        icon={TrophyIcon}
        title="ディレクトリに掲載されたプロダクトはまだありません。"
        description="予選マッチに勝利したプロダクトがここに並びます。最初の勝者を目指して、ローンチを予約しましょう。"
      >
        <Button size="lg" asChild>
          <a href="#">
            <RocketIcon aria-hidden="true" />
            {props.loggedIn
              ? 'ローンチを予約🚀'
              : 'ログインしてローンチを予約🚀'}
          </a>
        </Button>
      </Frame>
    );
  }

  const { query, categoryName, periodLabel } = props;
  const conditions = [
    query.q && {
      key: 'q',
      label: `キーワード「${query.q}」`,
      patch: { q: undefined },
    },
    categoryName && {
      key: 'category',
      label: `カテゴリ「${categoryName}」`,
      patch: { category: undefined },
    },
    periodLabel && {
      key: 'period',
      label: `期間「${periodLabel}」`,
      patch: { from: undefined, to: undefined },
    },
  ].filter(Boolean) as Condition[];

  return (
    <Frame
      icon={SearchXIcon}
      title="条件に一致するプロダクトはありません。"
      description="キーワードを変えるか、絞り込みを解除してお試しください。"
    >
      {conditions.length > 1 &&
        conditions.map((condition) => (
          <Button
            key={condition.key}
            variant="outline"
            size="sm"
            asChild
            className="h-auto min-h-8 max-w-full rounded-full py-1 whitespace-normal"
          >
            <Link
              from="/client/p/"
              to="/client/p"
              search={(prev) => ({
                ...prev,
                ...condition.patch,
                page: undefined,
              })}
            >
              <XIcon aria-hidden="true" />
              <span className="wrap-anywhere">{condition.label}を解除</span>
            </Link>
          </Button>
        ))}
      <Button size="sm" asChild className="rounded-full">
        <Link
          from="/client/p/"
          to="/client/p"
          search={(prev) => ({ ...prev, ...CLEAR_ALL, page: undefined })}
        >
          {conditions.length > 1
            ? '条件をすべて解除'
            : `${conditions[0]?.label ?? '条件'}を解除`}
        </Link>
      </Button>
    </Frame>
  );
}
