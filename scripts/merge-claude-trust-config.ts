import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface ClaudeConfig {
  projects?: Record<string, Record<string, unknown> | undefined>;
}

// `.claude.json`にはセッション履歴やOAuth情報など実行時に蓄積されるデータが含まれるため、ファイル全体を上書きせず、
// ワークスペース信頼設定のキーだけを既存内容を保持したまま冪等にマージする。
const configDir = process.env.CLAUDE_CONFIG_DIR;
if (!configDir) {
  throw new Error("環境変数CLAUDE_CONFIG_DIRが未設定です。");
}
const path = `${configDir}/.claude.json`;
const data: ClaudeConfig = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : {};
data.projects ??= {};
data.projects["/workspace"] = {
  ...data.projects["/workspace"],
  hasTrustDialogAccepted: true,
  hasCompletedProjectOnboarding: true,
};
writeFileSync(path, JSON.stringify(data));
