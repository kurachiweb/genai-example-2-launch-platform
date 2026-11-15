import { createLink } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

interface UnmarkedAnchorProps extends ComponentProps<'a'> {
  readonly current?: boolean | undefined;
}

// ルーターは表示中のURLと一致するリンクに現在のページの印を必ず付け、判定の指定では止められないため、要素へ渡す時に消し、呼び出し元が決めた印だけを付ける
function UnmarkedAnchor({
  current = false,
  children,
  ...props
}: UnmarkedAnchorProps) {
  return (
    <a
      {...props}
      aria-current={current ? 'page' : undefined}
      data-status={undefined}
    >
      {children}
    </a>
  );
}

const UnmarkedLink = createLink(UnmarkedAnchor);

export interface UnmarkedPathLinkProps extends Omit<
  ComponentProps<'a'>,
  'href'
> {
  readonly href: string;
  // 表示中のURLとの一致ではなく、呼び出し元の判断で現在のページと読ませる
  readonly current?: boolean | undefined;
}

// 絞り込みやページ送りのリンクは表示中の一覧と同じURLを指し得るが、ルーターの判定で現在のページと読ませないよう、印を呼び出し元の判断に限ってパスへルーターで遷移させる
export function UnmarkedPathLink({ href, ...props }: UnmarkedPathLinkProps) {
  return <UnmarkedLink {...props} to="." href={href} />;
}
