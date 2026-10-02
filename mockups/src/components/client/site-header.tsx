import { Link } from '@tanstack/react-router';
import {
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  PackageIcon,
  RocketIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
} from 'lucide-react';

import { UserAvatar } from '#/components/client/user-avatar';
import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip';
import type { User } from '#/lib/mock-data';
import { setTheme, useTheme } from '#/lib/preferences';

type Props = {
  user: User | null;
  // ページ本文に別のh1(プロダクト名など)がある場合はdivにする
  logoAs?: 'h1' | 'div';
};

export function SiteHeader({ user, logoAs: Logo = 'h1' }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4">
        <Link
          to="/client/top"
          className="flex items-center gap-2 text-foreground no-underline"
        >
          <Logo className="text-lg font-extrabold tracking-tight before:me-1 before:content-['⚽️']">
            Launch Stadium
          </Logo>
        </Link>

        <nav
          aria-label="メイン"
          className="ml-4 hidden items-center gap-1 md:flex"
        >
          <a
            href="#"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ディレクトリ
          </a>
          <a
            href="#"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ヘルプ
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button size="sm" className="hidden sm:inline-flex">
            <RocketIcon />
            ローンチする
          </Button>
          {user ? (
            <UserMenu user={user} />
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="hidden sm:inline-flex"
              >
                ログイン
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="hidden sm:inline-flex"
              >
                登録
              </Button>
            </>
          )}
          <MobileMenu user={user} />
        </div>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label =
    theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          aria-pressed={theme === 'dark'}
          onClick={() => setTheme(next)}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function UserMenu({ user }: { user: User }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-border bg-card p-0.5 text-sm font-medium hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:pr-3"
          aria-label={`${user.nickname}のユーザーメニュー`}
        >
          <UserAvatar user={user} size={28} />
          <span className="hidden max-w-32 wrap-anywhere sm:inline">
            {user.nickname}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="wrap-anywhere">
          {user.nickname}
          <span className="block text-xs font-normal text-muted-foreground">
            @{user.handle}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <UserIcon />
          プロフィール
        </DropdownMenuItem>
        <DropdownMenuItem>
          <PackageIcon />
          自身のプロダクト
        </DropdownMenuItem>
        <DropdownMenuItem>
          <SettingsIcon />
          設定
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <LogOutIcon />
          ログアウト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileMenu({ user }: { user: User | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="md:hidden"
          aria-label="メニュー"
        >
          <MenuIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem>ディレクトリ</DropdownMenuItem>
        <DropdownMenuItem>ヘルプ</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <RocketIcon />
          ローンチする
        </DropdownMenuItem>
        {!user && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem>ログイン</DropdownMenuItem>
            <DropdownMenuItem>登録</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
