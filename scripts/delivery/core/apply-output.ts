const NAME = String.raw`[A-Za-z_][\w-]*`;
const INDEX = String.raw`(?:\[(?:\d+|"(?:[^"\\]|\\.)*")\])?`;
const SEGMENT = `${NAME}${INDEX}`;

// module.<名前>[キー]の連なりの後に、data.・ephemeral.の付き得る<種類>.<名前>[キー]が続き、区切りの「: 」で終わる行
const RESOURCE_LINE = new RegExp(
  `^(?:module\\.${SEGMENT}\\.)*(?:data\\.|ephemeral\\.)?${NAME}\\.${SEGMENT}: `,
);

const COMPLETE_LINE = /^Apply complete! /;

export function filterApplyOutput(line: string): string | undefined {
  return RESOURCE_LINE.test(line) || COMPLETE_LINE.test(line)
    ? line
    : undefined;
}
