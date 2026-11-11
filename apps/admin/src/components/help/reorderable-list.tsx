import { ArrowDownIcon, ArrowUpIcon, type LucideIcon } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import {
  type HelpMoveDirection,
  moveItem,
} from '../../../common-lib/help/help-ordering.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  helpItemMovedAnnouncement,
  MOVE_DOWN_LABEL,
  MOVE_UP_LABEL,
  moveDownName,
  moveUpName,
} from './help-messages.ts';

export interface ReorderableListProps<T> {
  // 一覧の名前(例: 「ピン留めの記事」)
  readonly label: string;
  readonly items: readonly T[];
  readonly itemKey: (item: T) => string;
  // ボタンの名前と移動の読み上げに使う
  readonly itemLabel: (item: T) => string;
  readonly renderItem: (item: T) => ReactNode;
  readonly onChange: (items: readonly T[]) => void;
  // 閲覧のみの管理者には並びだけを見せ、移動のボタンを描かない
  readonly disabled: boolean;
}

interface MoveControl {
  readonly direction: HelpMoveDirection;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly nameOf: (name: string) => string;
}

const MOVE_CONTROLS: readonly MoveControl[] = [
  {
    direction: 'up',
    label: MOVE_UP_LABEL,
    icon: ArrowUpIcon,
    nameOf: moveUpName,
  },
  {
    direction: 'down',
    label: MOVE_DOWN_LABEL,
    icon: ArrowDownIcon,
    nameOf: moveDownName,
  },
];

const buttonIdOf = (key: string, direction: HelpMoveDirection): string =>
  `${direction}:${key}`;

const isAtEdge = (
  index: number,
  length: number,
  direction: HelpMoveDirection,
): boolean => (direction === 'up' ? index === 0 : index === length - 1);

export function ReorderableList<T>({
  label,
  items,
  itemKey,
  itemLabel,
  renderItem,
  onChange,
  disabled,
}: ReorderableListProps<T>) {
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<string | null>(null);
  const [focusedButton, setFocusedButton] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // 押下でボタンにフォーカスを移さないブラウザやプログラムからの押下でも、移動した項目の同じボタンにフォーカスを置き、端のボタンのaria-disabledがフォーカスの状態と食い違わないようにする
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) {
      return;
    }
    pendingFocusRef.current = null;
    buttonsRef.current.get(pending)?.focus();
  }, [items]);

  const move = (index: number, direction: HelpMoveDirection) => {
    const item = items[index];
    if (item === undefined || isAtEdge(index, items.length, direction)) {
      return;
    }
    const buttonId = buttonIdOf(itemKey(item), direction);
    const position = direction === 'up' ? index : index + 2;
    pendingFocusRef.current = buttonId;
    setFocusedButton(buttonId);
    setAnnouncement(helpItemMovedAnnouncement(itemLabel(item), position));
    onChange(moveItem(items, index, direction));
  };

  return (
    <>
      <ol aria-label={label} className="flex flex-col gap-2">
        {items.map((item, index) => {
          const key = itemKey(item);
          const name = itemLabel(item);
          return (
            <li
              key={key}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card px-4 py-3 text-card-foreground"
            >
              <div className="min-w-0 flex-1">{renderItem(item)}</div>
              {disabled ? null : (
                <div className="flex shrink-0 gap-2">
                  {MOVE_CONTROLS.map((control) => {
                    const buttonId = buttonIdOf(key, control.direction);
                    const atEdge = isAtEdge(
                      index,
                      items.length,
                      control.direction,
                    );
                    // 端へ移した直後のボタンはフォーカスを失わないよう、フォーカスが離れるまでaria-disabledで押せないことを伝える
                    const focused = focusedButton === buttonId;
                    const Icon = control.icon;
                    return (
                      <Button
                        key={control.direction}
                        ref={(element) => {
                          if (element === null) {
                            return undefined;
                          }
                          buttonsRef.current.set(buttonId, element);
                          return () => {
                            buttonsRef.current.delete(buttonId);
                          };
                        }}
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={control.nameOf(name)}
                        disabled={atEdge && !focused}
                        aria-disabled={atEdge && focused ? true : undefined}
                        onFocus={() => {
                          setFocusedButton(buttonId);
                        }}
                        onBlur={() => {
                          setFocusedButton((current) =>
                            current === buttonId ? null : current,
                          );
                        }}
                        onClick={() => {
                          move(index, control.direction);
                        }}
                      >
                        <Icon aria-hidden="true" />
                        {control.label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
