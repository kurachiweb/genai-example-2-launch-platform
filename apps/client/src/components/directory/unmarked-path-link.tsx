import { createLink } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

// ルーターは表示中のURLと一致するリンクに現在のページの印を必ず付け、判定の指定では止められないため、要素へ渡す時に消す
function UnmarkedAnchor({ children, ...props }: ComponentProps<'a'>) {
  return (
    <a {...props} aria-current={undefined} data-status={undefined}>
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
}

// 一覧の項目に並ぶ絞り込みのリンクは表示中の一覧と同じURLを指し得るが、項目ごとに現在のページと読ませないよう、印を付けずにパスへルーターで遷移させる
export function UnmarkedPathLink({ href, ...props }: UnmarkedPathLinkProps) {
  return <UnmarkedLink {...props} to="." href={href} />;
}
