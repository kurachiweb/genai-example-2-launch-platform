import { describe, expect, it } from 'bun:test';
import { accessSync, constants } from 'node:fs';
import { BELL_SCRIPT_PATH, mergeBellHooks } from './claude-bell-hooks';

const bellHooks = {
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

const rtkHook = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: 'rtk hook claude' }],
};

describe('BELL_SCRIPT_PATH', () => {
  it('フックのコマンドとして直接起動できるよう実行権限がある', () => {
    expect(() => {
      accessSync(BELL_SCRIPT_PATH, constants.X_OK);
    }).not.toThrow();
  });
});

describe('mergeBellHooks', () => {
  it('フックの無い設定に質問・プラン承認・権限確認・応答完了のフックを追加する', () => {
    expect(mergeBellHooks({})).toEqual({ hooks: bellHooks });
  });

  it('他の設定と既存のフックを保持したまま追加する', () => {
    expect(
      mergeBellHooks({ model: 'opus', hooks: { PreToolUse: [rtkHook] } }),
    ).toEqual({
      model: 'opus',
      hooks: { ...bellHooks, PreToolUse: [rtkHook, ...bellHooks.PreToolUse] },
    });
  });

  it('繰り返し適用してもフックが重複しない', () => {
    const merged = mergeBellHooks({ hooks: { PreToolUse: [rtkHook] } });
    expect(mergeBellHooks(merged)).toEqual(merged);
  });

  it('異なるmatcherや引数で登録済みのベルのフックは現在の定義に置き換え、同じグループの他のフックは残す', () => {
    const otherHook = { type: 'command', command: 'echo stop' };
    expect(
      mergeBellHooks({
        hooks: {
          Notification: [
            {
              matcher: 'permission_prompt|idle_prompt',
              hooks: [{ type: 'command', command: BELL_SCRIPT_PATH }],
            },
          ],
          Stop: [
            {
              hooks: [
                otherHook,
                { type: 'command', command: `${BELL_SCRIPT_PATH} --old` },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      hooks: {
        ...bellHooks,
        Stop: [{ hooks: [otherHook] }, ...bellHooks.Stop],
      },
    });
  });

  it('パスの前方が一致するだけの別スクリプトのフックは残す', () => {
    const similarHook = {
      hooks: [{ type: 'command', command: `${BELL_SCRIPT_PATH}.bak` }],
    };
    expect(mergeBellHooks({ hooks: { Stop: [similarHook] } })).toEqual({
      hooks: { ...bellHooks, Stop: [similarHook, ...bellHooks.Stop] },
    });
  });
});
