import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  createCodeBlockCommand,
  emphasisSchema,
  headingSchema,
  inlineCodeSchema,
  linkSchema,
  orderedListSchema,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { insertTableCommand, tableSchema } from '@milkdown/kit/preset/gfm';
import type {
  Mark,
  Node as ProseNode,
  MarkType,
  NodeType,
  ResolvedPos,
} from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';

import type { EditorAction, EditorLink } from '../editor-controller.ts';

type RunnableAction = Exclude<EditorAction, 'link'>;

const TOOLBAR_HEADING_LEVEL = 2;

interface MarkRange {
  readonly from: number;
  readonly to: number;
  readonly mark: Mark;
}

// 全体の選択では選択の起点が文書の直下になるため、選択範囲に含まれる段落・見出しなどの文字のブロックの種類で判定する
const selectedTextblocksOf = (state: EditorState): readonly ProseNode[] => {
  const { from, to } = state.selection;
  const textblocks: ProseNode[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isTextblock) {
      textblocks.push(node);
      return false;
    }
    return undefined;
  });
  return textblocks;
};

const isEveryTextblockOf = (state: EditorState, type: NodeType): boolean => {
  const textblocks = selectedTextblocksOf(state);
  return (
    textblocks.length > 0 && textblocks.every((node) => node.type === type)
  );
};

const isHeadingBlock = (state: EditorState, ctx: Ctx): boolean =>
  isEveryTextblockOf(state, headingSchema.type(ctx));

const ACTION_RUNNERS: Readonly<
  Record<RunnableAction, (ctx: Ctx, state: EditorState) => void>
> = {
  heading: (ctx, state) => {
    const commands = ctx.get(commandsCtx);
    if (isHeadingBlock(state, ctx)) {
      commands.call(turnIntoTextCommand.key);
      return;
    }
    commands.call(wrapInHeadingCommand.key, TOOLBAR_HEADING_LEVEL);
  },
  bold: (ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key),
  italic: (ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key),
  inlineCode: (ctx) => ctx.get(commandsCtx).call(toggleInlineCodeCommand.key),
  bulletList: (ctx) => ctx.get(commandsCtx).call(wrapInBulletListCommand.key),
  orderedList: (ctx) => ctx.get(commandsCtx).call(wrapInOrderedListCommand.key),
  blockquote: (ctx) => ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key),
  codeBlock: (ctx) => ctx.get(commandsCtx).call(createCodeBlockCommand.key),
  table: (ctx) => ctx.get(commandsCtx).call(insertTableCommand.key),
};

export function runEditorAction(ctx: Ctx, action: RunnableAction): void {
  ACTION_RUNNERS[action](ctx, ctx.get(editorViewCtx).state);
}

const hasMark = (state: EditorState, type: MarkType): boolean => {
  const { empty, from, to, $from } = state.selection;
  if (empty) {
    return type.isInSet(state.storedMarks ?? $from.marks()) !== undefined;
  }
  return state.doc.rangeHasMark(from, to, type);
};

const isInside = ($pos: ResolvedPos, type: NodeType): boolean =>
  Array.from({ length: $pos.depth + 1 }, (_, depth) => $pos.node(depth)).some(
    (node) => node.type === type,
  );

export function activeEditorActions(
  ctx: Ctx,
  state: EditorState,
): ReadonlySet<EditorAction> {
  const { $from } = state.selection;
  const checks: readonly (readonly [EditorAction, boolean])[] = [
    ['heading', isHeadingBlock(state, ctx)],
    ['bold', hasMark(state, strongSchema.type(ctx))],
    ['italic', hasMark(state, emphasisSchema.type(ctx))],
    ['link', hasMark(state, linkSchema.type(ctx))],
    ['inlineCode', hasMark(state, inlineCodeSchema.type(ctx))],
    ['bulletList', isInside($from, bulletListSchema.type(ctx))],
    ['orderedList', isInside($from, orderedListSchema.type(ctx))],
    ['blockquote', isInside($from, blockquoteSchema.type(ctx))],
    ['codeBlock', isEveryTextblockOf(state, codeBlockSchema.type(ctx))],
    ['table', isInside($from, tableSchema.type(ctx))],
  ];
  return new Set(
    checks.filter(([, active]) => active).map(([action]) => action),
  );
}

export const isSameActionSet = (
  left: ReadonlySet<EditorAction>,
  right: ReadonlySet<EditorAction>,
): boolean =>
  left.size === right.size && [...left].every((action) => right.has(action));

const childOffsetsOf = ($pos: ResolvedPos): readonly number[] => {
  const offsets = [0];
  for (let index = 0; index < $pos.parent.childCount; index += 1) {
    offsets.push((offsets[index] ?? 0) + $pos.parent.child(index).nodeSize);
  }
  return offsets;
};

type ChildContains = (from: number, to: number, position: number) => boolean;

const touches: ChildContains = (from, to, position) =>
  from <= position && position <= to;

const startsWithin: ChildContains = (from, to, position) =>
  from <= position && position < to;

const endsWithin: ChildContains = (from, to, position) =>
  from < position && position <= to;

// 位置を含む文字列の節点から、同じリンクの印が続く兄弟の節点までを1つのリンクの範囲として広げる
const markRangeAround = (
  $pos: ResolvedPos,
  type: MarkType,
  contains: ChildContains = touches,
): MarkRange | undefined => {
  const { parent } = $pos;
  const start = $pos.start();
  const offsets = childOffsetsOf($pos);
  const position = $pos.pos - start;
  const marksAt = (index: number): readonly Mark[] =>
    index >= 0 && index < parent.childCount ? parent.child(index).marks : [];
  const hitIndex = Array.from(
    { length: parent.childCount },
    (_, index) => index,
  ).find(
    (index) =>
      type.isInSet(marksAt(index)) !== undefined &&
      contains(offsets[index] ?? 0, offsets[index + 1] ?? 0, position),
  );
  const mark =
    hitIndex === undefined ? undefined : type.isInSet(marksAt(hitIndex));
  if (hitIndex === undefined || mark === undefined) {
    return undefined;
  }
  const continues = (index: number): boolean => mark.isInSet(marksAt(index));
  let first = hitIndex;
  while (continues(first - 1)) {
    first -= 1;
  }
  let last = hitIndex;
  while (continues(last + 1)) {
    last += 1;
  }
  return {
    from: start + (offsets[first] ?? 0),
    to: start + (offsets[last + 1] ?? 0),
    mark,
  };
};

const linkRangeOf = (
  state: EditorState,
  type: MarkType,
): MarkRange | undefined => {
  const { empty, from, to, $from } = state.selection;
  if (empty) {
    return type.isInSet($from.marks()) === undefined
      ? undefined
      : markRangeAround($from, type);
  }
  let found: MarkRange | undefined;
  state.doc.nodesBetween(from, to, (node, position) => {
    if (found !== undefined) {
      return false;
    }
    if (node.isText && type.isInSet(node.marks) !== undefined) {
      found = markRangeAround(
        state.doc.resolve(Math.max(position, from)),
        type,
      );
    }
    return undefined;
  });
  return found;
};

export function currentEditorLink(ctx: Ctx): EditorLink | undefined {
  const { state } = ctx.get(editorViewCtx);
  const range = linkRangeOf(state, linkSchema.type(ctx));
  const href: unknown = range?.mark.attrs.href;
  return typeof href === 'string' ? { href } : undefined;
}

export function applyEditorLink(ctx: Ctx, href: string | undefined): void {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const type = linkSchema.type(ctx);
  const { empty, from, to } = state.selection;
  const range = linkRangeOf(state, type);
  if (href === undefined) {
    if (!empty) {
      // 選択の両端がリンクの途中にあれば、リンクを割らないようにリンクの端まで広げて解除する
      const first = markRangeAround(
        state.doc.resolve(from),
        type,
        startsWithin,
      );
      const last = markRangeAround(state.doc.resolve(to), type, endsWithin);
      view.dispatch(
        state.tr.removeMark(first?.from ?? from, last?.to ?? to, type),
      );
      return;
    }
    if (range !== undefined) {
      view.dispatch(state.tr.removeMark(range.from, range.to, type));
    }
    return;
  }
  if (range !== undefined) {
    view.dispatch(
      state.tr
        .removeMark(range.from, range.to, type)
        .addMark(
          range.from,
          range.to,
          type.create({ ...range.mark.attrs, href }),
        ),
    );
    return;
  }
  if (!empty) {
    ctx.get(commandsCtx).call(toggleLinkCommand.key, { href });
    return;
  }
  const marks = type.create({ href }).addToSet(state.selection.$from.marks());
  view.dispatch(
    state.tr.replaceSelectionWith(state.schema.text(href, marks), false),
  );
}
