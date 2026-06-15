# 怎么让 Claude Code 模仿 OpenClaw（使用备忘）

> 一句话：在**本仓库目录**里，对 Claude Code 说 **“act as OpenClaw”**（或“扮演 OpenClaw / 你现在是 Claw”）即可。
> 技能源文件在 [SKILL.md](SKILL.md)，已装到 `.claude/skills/openclaw/`。

## 三种开启方式（由简到正式）

### 方式 1 · 直接一句话（最快，零配置）
在仓库目录开 Claude Code，直接说：
```
act as OpenClaw
```
或中文：`扮演 OpenClaw` / `你现在是 Claw`。
我会自动读 [SKILL.md](SKILL.md) 并按 5 个子系统运行。
**前提**：当前工作目录是这个仓库（`.claude/skills/openclaw/` 已装好）。

### 方式 2 · Skill 工具 / 斜杠命令
已安装到 [.claude/skills/openclaw/SKILL.md](../../.claude/skills/openclaw/SKILL.md)，Claude Code 会自动发现：
```
/openclaw
```
或让我“调用 openclaw 技能”。

### 方式 3 · 新机器 / 重装后
新克隆仓库、或 `.claude/skills/` 被清掉时，先装一次：
```sh
node agents/openclaw/install.mjs claude    # 只装 Claude Code
node agents/openclaw/install.mjs --check    # 确认状态，不写文件
```
然后回到方式 1 或 2。其它宿主：`copilot` / `codex` / `codebuddy` / `all`。卸载：`--uninstall <host|all>`。

## 激活后我会做什么
1. **先读记忆** — `.openclaw/workspace/memory/MEMORY.md`（不存在则第一次写时创建）。
2. 以 **“Claw”** 人设简短打招呼（暖、短、主动）。
3. **匹配技能**：要养宠物 → [pet-master](../pet-master/SKILL.md)；要做运营/“巡一遍” → [haqi-operator](../haqi-operator/SKILL.md)。
4. **权限分级**：读操作直接做 · 写操作先说再做 · 花币/对外发布/不可逆操作**先问你**。

## 没网时（离线模式）
没有 KeepWork token 或网站打不开时，用自带模拟器，命令形态一致、不联网：
```sh
node .openclaw/workspace/sim/run-pet-master.cjs
```
日志里会标 `(simulated)`，避免和真实状态混淆。

## 常用提示语速查
| 你想做的事 | 对 Claude Code 说 |
|---|---|
| 开启 | `act as OpenClaw` / `/openclaw` |
| 领养宠物 | `领养一只 MagicHaqi 宠物` |
| 日常照料 | `照看一下我的宠物` |
| 跑运营循环（仅 owner） | `做今天的运营` / `巡一遍` |
| 离线演示 | `用模拟器跑一遍 pet-master` |
| 退出 | `不用扮演 OpenClaw 了` |
