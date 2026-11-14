import { describe, expect, test } from 'bun:test';

import type {
  HastDoctype,
  HastElement,
  HastElementContent,
  HastProperties,
  HastRoot,
} from '../hast-types.ts';
import { labelTaskCheckboxes } from './task-list-label.ts';

const root = (
  ...children: readonly (HastDoctype | HastElementContent)[]
): HastRoot => ({
  type: 'root',
  children,
});

const element = (
  tagName: string,
  properties: HastProperties,
  ...children: readonly HastElementContent[]
): HastElement => ({ type: 'element', tagName, properties, children });

const text = (value: string): HastElementContent => ({ type: 'text', value });

const checkbox = (properties: HastProperties = {}): HastElement =>
  element('input', { type: 'checkbox', disabled: true, ...properties });

const taskItem = (...children: readonly HastElementContent[]): HastElement =>
  element('li', { className: ['task-list-item'] }, ...children);

const taskList = (...items: readonly HastElement[]): HastElement =>
  element('ul', { className: ['contains-task-list'] }, ...items);

describe('labelTaskCheckboxes', () => {
  test('タスクリストのチェックボックスに項目の文字列を名前として付ける', () => {
    const tree = root(
      taskList(
        taskItem(
          checkbox(),
          text(' 未完了の '),
          element('strong', {}, text('項目')),
        ),
        taskItem(checkbox({ checked: true }), text(' 完了した項目')),
      ),
    );

    expect(labelTaskCheckboxes(tree)).toStrictEqual(
      root(
        taskList(
          taskItem(
            checkbox({ ariaLabel: '未完了の 項目' }),
            text(' 未完了の '),
            element('strong', {}, text('項目')),
          ),
          taskItem(
            checkbox({ checked: true, ariaLabel: '完了した項目' }),
            text(' 完了した項目'),
          ),
        ),
      ),
    );
  });

  test('段落の中のチェックボックスにも名前を付け、入れ子のリストの文字列を名前に含めない', () => {
    const tree = root(
      taskList(
        taskItem(
          element('p', {}, checkbox(), text(' 親の\n項目')),
          taskList(taskItem(checkbox(), text(' 子の項目'))),
        ),
      ),
    );

    expect(labelTaskCheckboxes(tree)).toStrictEqual(
      root(
        taskList(
          taskItem(
            element(
              'p',
              {},
              checkbox({ ariaLabel: '親の 項目' }),
              text(' 親の\n項目'),
            ),
            taskList(
              taskItem(checkbox({ ariaLabel: '子の項目' }), text(' 子の項目')),
            ),
          ),
        ),
      ),
    );
  });

  test('改行を空白として名前に含める', () => {
    const tree = root(
      taskList(
        taskItem(checkbox(), text('一行目'), element('br', {}), text('二行目')),
      ),
    );

    expect(labelTaskCheckboxes(tree)).toStrictEqual(
      root(
        taskList(
          taskItem(
            checkbox({ ariaLabel: '一行目 二行目' }),
            text('一行目'),
            element('br', {}),
            text('二行目'),
          ),
        ),
      ),
    );
  });

  test('項目に文字列が無い場合は既定の名前を付ける', () => {
    const tree = root(
      taskList(taskItem(checkbox(), { type: 'comment', value: 'x' })),
    );

    expect(labelTaskCheckboxes(tree)).toStrictEqual(
      root(
        taskList(
          taskItem(checkbox({ ariaLabel: 'タスク' }), {
            type: 'comment',
            value: 'x',
          }),
        ),
      ),
    );
  });

  test('タスクリストの項目でない要素と、チェックボックスでない入力欄は変えない', () => {
    const tree = root(
      { type: 'doctype' },
      element('ul', {}, element('li', {}, checkbox(), text('通常の項目'))),
      taskList(
        taskItem(element('input', { type: 'text' }), text('文字の入力欄')),
      ),
    );

    expect(labelTaskCheckboxes(tree)).toStrictEqual(tree);
  });
});
