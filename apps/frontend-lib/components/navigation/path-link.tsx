import { type ActiveOptions, Link } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

export interface PathLinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  readonly href: string;
  // 現在のページの判定。既定は同じパスとその下のパスで現在のページとしてaria-current="page"を付ける
  readonly activeOptions?: ActiveOptions;
}

// 行き先の経路を型で指定できない遷移(他の機能が作る経路や、組み立て済みのクエリを持つURL)も、ページを読み込み直さずにルーターで遷移させる。Linkはhrefを指定するとtoより優先して行き先にする
export function PathLink({ href, ...props }: PathLinkProps) {
  return <Link {...props} to="." href={href} />;
}
