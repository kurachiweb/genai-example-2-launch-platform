import { Toolbar as ToolbarPrimitive } from 'radix-ui';
import { useId } from 'react';

import { cn } from '../../utilities/class-names.ts';
import {
  EDITOR_KEYBOARD_HINT,
  FORMAT_TOOLBAR_LABEL,
} from '../../utilities/messages/markdown-messages.ts';
import { Button } from '../ui/button/button.tsx';
import { EDITOR_TOOLBAR_ITEMS } from './editor-actions.ts';
import type { EditorAction, EditorController } from './editor-controller.ts';

export interface MarkdownToolbarProps {
  readonly controller: EditorController | undefined;
  readonly activeActions: ReadonlySet<EditorAction>;
  readonly controlsId: string;
  readonly disabled?: boolean;
  readonly inactive?: boolean;
  readonly onRequestLink: () => void;
  readonly className?: string;
}

export function MarkdownToolbar({
  controller,
  activeActions,
  controlsId,
  disabled = false,
  inactive = false,
  onRequestLink,
  className,
}: MarkdownToolbarProps) {
  const hintId = useId();
  const isDisabled = disabled || controller === undefined;

  const runAction = (action: EditorAction): void => {
    if (controller === undefined || disabled || inactive) {
      return;
    }
    if (action === 'link') {
      onRequestLink();
      return;
    }
    controller.run(action);
    controller.focus();
  };

  return (
    <ToolbarPrimitive.Root
      data-slot="markdown-toolbar"
      aria-label={FORMAT_TOOLBAR_LABEL}
      aria-controls={controller === undefined ? undefined : controlsId}
      aria-describedby={hintId}
      className={cn('flex flex-wrap items-center gap-0.5', className)}
    >
      {EDITOR_TOOLBAR_ITEMS.map(({ action, kind, label, icon: Icon }) => (
        <ToolbarPrimitive.Button key={action} asChild disabled={isDisabled}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            aria-pressed={
              kind === 'toggle' ? activeActions.has(action) : undefined
            }
            aria-haspopup={kind === 'dialog' ? 'dialog' : undefined}
            aria-disabled={inactive && !isDisabled ? true : undefined}
            className="aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground dark:aria-pressed:hover:bg-primary/90"
            onClick={() => {
              runAction(action);
            }}
          >
            <Icon aria-hidden="true" />
          </Button>
        </ToolbarPrimitive.Button>
      ))}
      <span id={hintId} className="sr-only">
        {EDITOR_KEYBOARD_HINT}
      </span>
    </ToolbarPrimitive.Root>
  );
}
