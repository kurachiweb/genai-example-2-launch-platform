import { Link } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

export interface PathLinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  readonly href: string;
}

// 行き先の経路を型で指定できない遷移(他のspecが作る経路や、組み立て済みのクエリを持つURL)も、ページを読み込み直さずにルーターで遷移させる。Linkはhrefを指定するとtoより優先して行き先にする
export function PathLink({ href, ...props }: PathLinkProps) {
  return <Link {...props} to="." href={href} />;
}
