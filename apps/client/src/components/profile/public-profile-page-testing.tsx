import { createRoute, useRouter, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import {
  GUEST_VIEWER_QUERY,
  renderPageRouter,
} from '../../../test/page-router.tsx';
import type { ClientViewerQuery } from '../../graphql/generated/graphql.ts';
import { PublicProfilePage } from './public-profile-page.tsx';
import type { PublicProfilePageProps } from './public-profile-page.tsx';
import type {
  PublicProfileSectionComponent,
  PublicProfileTab,
} from './public-profile-section-types.ts';
import type { PublicProfileView } from './public-profile-view.ts';

export interface TabOptions {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly count?: number;
  readonly body?: ReactNode;
  readonly Panel?: PublicProfileSectionComponent;
}

export const tabOf = ({
  id,
  label,
  order,
  count,
  body = `${label}の内容`,
  Panel,
}: TabOptions): PublicProfileTab => ({
  id,
  label,
  order,
  Count: count === undefined ? undefined : () => <>{count.toString()}</>,
  Panel: Panel ?? (() => <p>{body}</p>),
});

export const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

export interface RenderPublicProfilePageOptions extends Pick<
  PublicProfilePageProps,
  'tabs' | 'badges' | 'menuItems'
> {
  readonly path?: string;
  readonly cachedViewer?: ClientViewerQuery;
}

const tabOfSearch = (search: object): string | undefined =>
  'tab' in search && typeof search.tab === 'string' ? search.tab : undefined;

// タブの切り替えは本番のルートと同じく、履歴へ積みスクロールを先頭へ戻さない
export const renderPublicProfilePage = (
  profile: PublicProfileView,
  {
    path = '/',
    cachedViewer = GUEST_VIEWER_QUERY,
    ...pageProps
  }: RenderPublicProfilePageOptions = {},
) =>
  renderPageRouter({
    path,
    cachedViewer,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        validateSearch: (search: Record<string, unknown>) => ({
          tab: typeof search.tab === 'string' ? search.tab : undefined,
        }),
        component: function TestProfileRoute() {
          const router = useRouter();
          const tab = tabOfSearch(useSearch({ strict: false }));
          return (
            <PublicProfilePage
              profile={profile}
              tab={tab}
              onTabChange={(next) => {
                void router.navigate({
                  href:
                    next === undefined
                      ? '/'
                      : `/?tab=${encodeURIComponent(next)}`,
                  resetScroll: false,
                });
              }}
              {...pageProps}
            />
          );
        },
      }),
    ],
  });
