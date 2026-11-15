import type { ComponentProps } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import type { InquiryCategoryOption } from '../../graphql/inquiry-contact.ts';
import { CATEGORY_PLACEHOLDER } from './inquiry-contact-messages.ts';

export interface InquiryCategorySelectProps extends Omit<
  ComponentProps<'select'>,
  'children'
> {
  readonly categories: readonly InquiryCategoryOption[];
}

// 選択肢の一覧を開く間にフォーカスが外れず、開いただけで未選択のエラーを出さないよう、端末の標準の選択の部品を使う
export function InquiryCategorySelect({
  categories,
  className,
  ...props
}: InquiryCategorySelectProps) {
  return (
    <select
      data-slot="inquiry-category-select"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    >
      <option value="">{CATEGORY_PLACEHOLDER}</option>
      {categories.map(({ id, name }) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  );
}
