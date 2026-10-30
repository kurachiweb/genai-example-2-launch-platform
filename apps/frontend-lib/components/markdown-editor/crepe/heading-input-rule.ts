import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { headingSchema } from '@milkdown/kit/preset/commonmark';
import { textblockTypeInputRule } from '@milkdown/kit/prose/inputrules';
import { $inputRule } from '@milkdown/kit/utils';

const HEADING_MARKER = /^(?<hashes>#{2,6})\s$/;

export const headingInputRule: MilkdownPlugin = $inputRule((ctx) =>
  textblockTypeInputRule(HEADING_MARKER, headingSchema.type(ctx), (match) => ({
    level: match.groups?.hashes?.length,
  })),
);
