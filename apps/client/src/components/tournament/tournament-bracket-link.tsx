import { ChevronRightIcon } from 'lucide-react';

import { BRACKET_LINK_LABEL } from './tournament-copy.ts';

// トップページのトーナメントの区画の見出しから、そのトーナメントのブラケットのページへ導くリンク
export function TournamentBracketLink({ href }: { readonly href: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-0.5 font-semibold text-primary underline underline-offset-4"
    >
      {BRACKET_LINK_LABEL}
      <ChevronRightIcon className="size-4" aria-hidden="true" />
    </a>
  );
}
