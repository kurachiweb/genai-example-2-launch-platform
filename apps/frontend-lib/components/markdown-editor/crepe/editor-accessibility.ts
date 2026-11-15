import { editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';

import type { EditorSurfaceProps } from '../editor-controller.ts';

export type EditableAccessibility = Pick<
  EditorSurfaceProps,
  'editableId' | 'labelledBy' | 'describedBy' | 'invalid' | 'disabled'
>;

// ProseMirrorは前の指定に無くなった属性を要素から外すため、該当しない状態の属性はキーごと省く
export function editableAttributesOf({
  editableId,
  labelledBy,
  describedBy,
  invalid,
  disabled,
}: EditableAccessibility): Record<string, string> {
  return {
    id: editableId,
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-labelledby': labelledBy,
    ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
    ...(invalid ? { 'aria-invalid': 'true' } : {}),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
  };
}

export const configureEditableAccessibility =
  (accessibility: EditableAccessibility) =>
  (ctx: Ctx): void => {
    ctx.update(editorViewOptionsCtx, (options) => ({
      ...options,
      attributes: editableAttributesOf(accessibility),
    }));
  };

export const updateEditableAccessibility =
  (accessibility: EditableAccessibility) =>
  (ctx: Ctx): void => {
    ctx
      .get(editorViewCtx)
      .setProps({ attributes: editableAttributesOf(accessibility) });
  };
