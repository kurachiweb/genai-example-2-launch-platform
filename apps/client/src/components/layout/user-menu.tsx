import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { LogOutIcon, PackageIcon, SettingsIcon, UserIcon } from 'lucide-react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { DropdownMenu } from '../../../lib/components/ui/dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-item.tsx';
import { DropdownMenuLabel } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-label.tsx';
import { DropdownMenuSeparator } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-separator.tsx';
import { DropdownMenuTrigger } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-trigger.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientLogoutDocument } from '../../graphql/generated/graphql.ts';
import { type ClientViewer, viewerQueryOptions } from '../../graphql/viewer.ts';
import { LOGGED_OUT_MESSAGE } from '../auth/account-messages.ts';
import { PathLink } from '../navigation/path-link.tsx';
import {
  LOGOUT_LABEL,
  MY_PRODUCTS_LINK,
  PROFILE_LABEL,
  profileHref,
  SETTINGS_LINK,
  userMenuLabel,
} from './site-links.ts';

export interface UserMenuProps {
  readonly viewer: ClientViewer;
}

const graphemeSegmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

// 絵文字や結合文字を分けないよう、書記素の単位で先頭の1文字を取り出す
const initialOf = (nickname: string): string => {
  const [first] = graphemeSegmenter.segment(nickname);
  return first === undefined ? '' : first.segment.toUpperCase();
};

export function UserMenu({ viewer }: UserMenuProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const logout = useMutation({
    ...graphqlMutationOptions(ClientLogoutDocument),
    onSuccess: async () => {
      notify.success(LOGGED_OUT_MESSAGE);
      await queryClient.invalidateQueries({
        queryKey: viewerQueryOptions().queryKey,
      });
      await router.invalidate();
    },
    onError: (error) => {
      notify.error(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
    },
  });

  const handleLogout = (): void => {
    if (!logout.isPending) {
      logout.mutate({ variables: {} });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={userMenuLabel(viewer.nickname)}
          className="flex max-w-full min-w-0 items-center gap-2 self-start rounded-full border border-border bg-card p-0.5 text-sm font-medium hover:bg-accent sm:pr-3"
        >
          {/* 頭文字を文字として置くと、見えている文字が名前の一部であることの検査がニックネームの前に頭文字が重なった文字列で照合して違反とするため、疑似要素で描く */}
          <span
            aria-hidden="true"
            data-initial={initialOf(viewer.nickname)}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground before:content-[attr(data-initial)]"
          />
          <span className="hidden max-w-32 min-w-0 wrap-anywhere sm:inline">
            {viewer.nickname}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="wrap-anywhere">
          {viewer.nickname}
          <span className="block text-xs font-normal text-muted-foreground">
            @{viewer.handle}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <PathLink href={profileHref(viewer.handle)}>
            <UserIcon aria-hidden="true" />
            {PROFILE_LABEL}
          </PathLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <PathLink href={MY_PRODUCTS_LINK.href}>
            <PackageIcon aria-hidden="true" />
            {MY_PRODUCTS_LINK.label}
          </PathLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <SettingsIcon aria-hidden="true" />
            {SETTINGS_LINK.label}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout}>
          <LogOutIcon aria-hidden="true" />
          {LOGOUT_LABEL}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
