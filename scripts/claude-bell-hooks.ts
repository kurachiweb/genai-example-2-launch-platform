type HookHandler = { type: string; command?: string };

type HookMatcherGroup = { matcher?: string; hooks: HookHandler[] };

export type ClaudeSettings = {
  hooks?: Record<string, HookMatcherGroup[]>;
  [key: string]: unknown;
};

export const BELL_SCRIPT_PATH = '/workspace/scripts/claude-terminal-bell.sh';

const bellHooks: Record<string, HookMatcherGroup[]> = {
  PreToolUse: [
    {
      matcher: 'AskUserQuestion|ExitPlanMode',
      hooks: [{ type: 'command', command: BELL_SCRIPT_PATH }],
    },
  ],
  Notification: [
    {
      matcher: 'permission_prompt',
      hooks: [
        { type: 'command', command: `${BELL_SCRIPT_PATH} --skip-if-recent` },
      ],
    },
  ],
  Stop: [{ hooks: [{ type: 'command', command: BELL_SCRIPT_PATH }] }],
};

const isBellHandler = ({ command }: HookHandler): boolean =>
  command === BELL_SCRIPT_PATH ||
  (command?.startsWith(`${BELL_SCRIPT_PATH} `) ?? false);

// matcherや引数を変更しても起動時の再適用で現在の定義へ揃うよう、登録済みのベルのフックを除いてから追加し直す
export const mergeBellHooks = (settings: ClaudeSettings): ClaudeSettings => {
  const hooks: Record<string, HookMatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups.flatMap((group) => {
      const handlers = group.hooks.filter((handler) => !isBellHandler(handler));
      return handlers.length > 0 ? [{ ...group, hooks: handlers }] : [];
    });
    if (kept.length > 0) {
      hooks[event] = kept;
    }
  }
  for (const [event, groups] of Object.entries(bellHooks)) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  return { ...settings, hooks };
};
