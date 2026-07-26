#!/bin/sh
# Claude Codeのワークスペース信頼設定を行う。

# `~/.claude.json`はコンテナのファイルシステム上にありホストとバインドマウントされないため、
# コンテナを再作成するたびにワークスペース信頼(trust)状態が失われ、
# `.claude/skills/`配下のプラグイン(ecc・cc-sddなど)が手動で信頼ダイアログを承認するまで読み込まれない。
# そのため起動のたびに、信頼済みフラグだけを既存設定へ冪等にマージしておく(oauthAccount等の既存キーは保持する)。
bun -e '
import fs from "fs";
const configPath = process.env.HOME + "/.claude.json";
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
config.projects ??= {};
config.projects["/workspace"] ??= {};
config.projects["/workspace"].hasTrustDialogAccepted = true;
config.projects["/workspace"].hasCompletedProjectOnboarding = true;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
'
