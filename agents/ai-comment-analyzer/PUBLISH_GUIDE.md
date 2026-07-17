# AI Comment Analyzer — 发布能力使用教程

> 本文档覆盖小红书、抖音、公众号、贴吧四个平台的 **内容发布** 全流程教程。

---

## 📋 总览：平台能力矩阵

| 平台 | 评论采集 | 评论回复 | 发布内容 | 引擎 | 认证方式 |
|------|:---:|:---:|:---:|------|------|
| **小红书** | ✅ | ✅ | ✅ 图文/视频笔记 | redbook-cli (CDP) | 扫码登录 |
| **微信公众号** | ✅ | ✅ | ✅ Markdown→草稿箱 | wechatpy 官方 API | AppID + Secret |
| **百度贴吧** | ✅ | ✅ | ✅ 回复 + 发新帖 | aiotieba 官方 API | BDUSS Cookie |
| B站 | ✅ | ✅ | ❌ | API + Cookie | SESSDATA |
| 微博 | ✅ | ❌ | ❌ | API + Cookie | Cookie |
| **抖音** | ✅ | ⚠️ 顶级评论 | ✅ 视频/图文 | dy-cli (CDP) | 扫码登录 |
| Twitter/X | ✅ | ❌ | ❌ | Tweepy API v2 | Bearer Token |

---

## 🔴 一、小红书发布

### 1.1 前置准备

```bash
# 安装 redbook-cli
pip install redbook-cli

# 需要 Chrome 浏览器（CDP 模式需要）
```

### 1.2 首次登录（只需一次）

```bash
# 扫码登录，会弹出 Chrome 浏览器窗口
xhs login --cdp

# 验证登录状态
xhs status
# 应显示: CDP: 已登录
```

> ⚠️ 如果报 `WinError 267 目录名称无效`，说明 PyPI 包缺少 scripts 文件。已通过手动补全修复。如果重装后仍报错，确保 `Python314/Lib/scripts/` 下有 7 个 `.py` 文件。

### 1.3 发布笔记

```python
from platforms.xiaohongshu_publisher import XiaohongshuPublisher

pub = XiaohongshuPublisher()

# 检查状态
state = pub.get_agent_state()
print(state)  # {"logged_in": True, "ready_to_publish": True}

# 发布图文笔记
result = pub.publish_note(
    title="我的第一条AI笔记",     # 标题 (≤20字)
    content="这是通过AI agent自动发布的小红书内容",
    images=["photo1.jpg", "photo2.jpg"],  # 至少1张图片
    tags=["AI", "自动化"],       # 话题标签
    visibility="公开",           # 公开 / 仅自己可见
)
print(result.success, result.message)

# 发布视频笔记
result = pub.publish_video(
    title="视频标题",
    content="视频描述",
    video_path="video.mp4",
    tags=["教程"],
)

# 预览模式（不实际发布）
result = pub.publish_note(
    title="测试", content="测试内容",
    images=["test.jpg"], dry_run=True,
)
```

### 1.4 命令行直接使用

```bash
# 发图文
xhs publish -t "标题" -c "正文" -i image.jpg --tags AI --tags 工具

# 发视频
xhs publish -t "标题" -c "正文" -v video.mp4

# 搜索笔记
xhs search "关键词"

# 预览不发布
xhs pub -t "标题" -c "内容" -i img.jpg --dry-run
```

---

## 🎬 二、抖音发布

### 2.1 前置准备

```bash
pip install dy-cli

# 需要 Chrome 浏览器（Playwright CDP）
```

### 2.2 首次登录（只需一次）

```bash
dy login            # 扫码登录（Playwright CDP）
dy status           # 验证: 应显示已登录
```

### 2.3 发布内容

```python
from platforms.douyin_publisher import DouyinPublisher

pub = DouyinPublisher()

# 发布视频
result = pub.publish_video(
    title="产品演示视频",
    description="新版本功能展示，欢迎观看",
    video_path="demo.mp4",
    tags=["科技", "效率工具"],
)
print(result.success, result.message)

# 发布图文
result = pub.publish_image_post(
    title="产品更新日志",
    description="v2.0 更新内容",
    images=["screenshot1.jpg", "screenshot2.jpg"],
    tags=["产品更新"],
)

# 定时发布
result = pub.publish_video(
    title="定时发布测试",
    video_path="video.mp4",
    schedule="2026-07-14T08:00:00+08:00",
)

# 预览模式
result = pub.publish_video(
    title="测试", video_path="test.mp4", dry_run=True,
)
```

### 2.4 搜索 & 下载

```python
# 搜索视频
results = pub.search("美食教程")

# 热搜榜
hot = pub.trending(count=10)
for h in hot:
    print(h["raw"])

# 无水印下载
result = pub.download("https://v.douyin.com/xxx")

# 评论互动（Playwright 浏览器）
pub.comment("视频ID", "好看！")
```

### 2.5 命令行直接使用

```bash
dy publish -t "标题" -v video.mp4 --tags AI --tags 教程
dy publish -t "标题" -i img1.jpg -i img2.jpg
dy trending --count 10
dy search "关键词"
dy dl https://v.douyin.com/xxx          # 无水印下载
dy pub -t "标题" -v video.mp4 --dry-run  # 预览
```

---

### 2.1 前置准备

```bash
# 安装依赖
pip install wechatpy cryptography mistune pyyaml Pillow requests
```

### 2.2 配置

在 `.env` 文件中添加：

```bash
WECHAT_APPID=wx_your_app_id_here
WECHAT_SECRET=your_app_secret_here
```

> 📌 在微信公众号后台获取：`mp.weixin.qq.com` → 设置与开发 → 基本配置
>
> ⚠️ 还必须将你的服务器出口 IP 加入 **IP 白名单**（同一页面）

### 2.3 发布文章到草稿箱

```python
from platforms.wechat_mp import WechatMPPublisher

pub = WechatMPPublisher()  # 自动读取 .env

# 检查状态
state = pub.get_agent_state()
print(state)
# {"configured": True, "deps_installed": True, "ready": True,
#  "available_themes": ["news-minimal", "tech-digest"],
#  "cover_styles": ["gradient", "accent-bar", "split", "minimal", "geometric"]}

# 一键发布（Markdown → 排版 → 封面 → 草稿箱）
result = pub.one_click_publish(
    title="产品更新 v2.0",
    content_md="""
# 本次更新

## 新功能
- 功能一：支持多平台发布
- 功能二：AI 自动生成封面

## 修复
- 修复了登录超时的问题

> 感谢大家的反馈！
""",
    author="产品团队",
    digest="这是一条摘要",        # 不填则自动取正文前100字
    theme="tech-digest",         # 排版主题
    cover_style="gradient",      # 封面风格
    # cover_image="custom.jpg",  # 自定义封面（不填自动生成）
)
print(result.success, result.message)  # → "草稿创建成功"
print(result.draft_id)                  # 草稿 media_id

# 发布草稿（群发，需审核）
if result.draft_id:
    pub_result = pub.publish_draft(result.draft_id)
    print(pub_result.publish_id)  # 发布任务 ID
```

### 2.4 分步操作

```python
pub = WechatMPPublisher()

# 步骤1：Markdown 转公众号 HTML
html, err = pub.markdown_to_html("# 标题\n正文...", theme="tech-digest")

# 步骤2：生成封面
cover_path = pub.generate_cover("文章标题", style="accent-bar")

# 步骤3：上传封面到微信 CDN
thumb_id = pub.upload_cover(cover_path)  # 返回 thumb_media_id

# 步骤4：创建草稿
result = pub.create_draft(
    title="文章标题",
    html_content=html,
    author="作者",
    thumb_media_id=thumb_id,
    need_open_comment=1,  # 开启评论
)

# 步骤5：查询发布状态
status = pub.get_publish_status(publish_id="xxx")
print(status.status)  # success / publishing / failed
```

### 2.5 评论采集与回复

```python
from platforms.wechat_mp import WechatMPCollector

col = WechatMPCollector()  # 自动读 .env

# 拉取文章评论（需提供文章的 msg_data_id 和 index）
comments = col.fetch_comments("1234567,1", max_comments=50)
for c in comments:
    print(f"[{c['author_name']}] {c['text']}  👍{c['like_count']}")

# 回复评论（≤140字）
success, msg = col.reply_comment(
    post_id="1234567,1",
    comment_id="789",
    content="感谢你的反馈！我们会在下个版本修复这个问题。",
)

# 批量回复（自动限流，每条间隔5秒）
results = col.reply_batch("1234567,1", [
    {"comment_id": "123", "content": "谢谢支持！💪"},
    {"comment_id": "456", "content": "已记录，会尽快处理"},
])

# 精选评论（设为可见）
col.mark_elected("1234567,1", comment_id="789")

# 删除评论
col.delete_comment("1234567,1", comment_id="789")
```

---

## 🟡 三、百度贴吧发布

### 3.1 前置准备

```bash
pip install aiotieba
```

### 3.2 获取 BDUSS

1. 浏览器打开 [tieba.baidu.com](https://tieba.baidu.com) 并登录
2. 按 `F12` → `Application`（应用程序）→ `Cookies` → `tieba.baidu.com`
3. 找到 `BDUSS`，复制值
4. 在 `.env` 中添加：

```bash
TIEBA_BDUSS=你的BDUSS值
```

### 3.3 采集评论

```python
from platforms.tieba import TiebaCollector

tb = TiebaCollector()  # 自动读取 TIEBA_BDUSS

# 检查状态
state = tb.get_agent_state()
# {"can_read": True, "can_reply": True, "can_post": True}

# 拉取帖子回复（=评论/楼层）
comments = tb.fetch_comments(
    "https://tieba.baidu.com/p/8537603600",  # 支持 URL 或纯数字 tid
    max_comments=50,
)
for c in comments:
    print(f"[{c['floor']}楼] {c['author_name']}: {c['text'][:60]}")

# 获取帖子基本信息
info = tb.get_post_info("8537603600")
print(info["title"], info["url"])

# 搜索吧内帖子
posts = tb.search_posts("天堂鸡汤", max_posts=10)
for p in posts:
    print(f"{p['title']} — {p['comment_count']}回复")
```

### 3.4 回复与发帖

```python
tb = TiebaCollector(bduss="你的BDUSS")

# 回复帖子（=在帖子里发一条回复）
result = tb.reply_comment(
    comment_id="",              # 贴吧回复是针对帖子，不需指定楼层
    reply_text="好帖！已收藏👍",
    post_id="8537603600",
)
print(result["success"], result["message"])

# 在指定贴吧发新帖
result = tb.post_thread(
    forum_name="天堂鸡汤",
    title="分享一个有趣的故事",
    content="今天在上班路上看到一只猫...",
)
if result["success"]:
    print(f"发帖成功: {result['url']}")

# 批量回复（自动限流，每条间隔3秒）
results = tb.reply_batch("8537603600", [
    {"content": "感谢分享！"},
    {"content": "说得很对"},
    {"content": "期待更多内容"},
])

# 测试连接（验证 BDUSS 是否有效）
conn = tb.test_connection()
print(conn)  # {"success": True, "message": "已认证: 你的贴吧昵称"}
```

> ⚠️ 未设置 BDUSS 时只能**读取**公开帖子，回复和发帖需要 BDUSS 认证。

---

## 📦 环境变量总览

在 `agents/ai-comment-analyzer/software/.env` 中配置：

```bash
# === 通用 ===
OPENAI_API_KEY=sk-...           # AI 分析必需
API_KEY=your-secret-key         # Agent API 认证

# === 小红书 ===
# 无需环境变量，使用 xhs login --cdp 扫码登录

# === 微信公众号 ===
WECHAT_APPID=wx_your_app_id
WECHAT_SECRET=your_app_secret

# === 百度贴吧 ===
TIEBA_BDUSS=你的BDUSS值

# === 其他平台（可选）===
TWITTER_BEARER_TOKEN=
BILIBILI_SESSDATA=
BILIBILI_BILI_JCT=
XHS_COOKIE=
WEIBO_COOKIE=
DOUYIN_COOKIE=
```

---

## 🧪 快速验证脚本

```python
"""一键检查所有平台状态"""
import sys
sys.path.insert(0, "agents/ai-comment-analyzer/software")

# 小红书
from platforms.xiaohongshu_publisher import XiaohongshuPublisher
xhs = XiaohongshuPublisher()
print("小红书:", "✅ 已登录" if xhs.check_login() else "❌ 未登录 (xhs login --cdp)")

# 公众号
from platforms.wechat_mp import WechatMPPublisher, WechatMPCollector
wx = WechatMPPublisher()
print("公众号发布:", "✅" if wx.get_agent_state()["ready"] else "❌ 需配置 WECHAT_APPID/SECRET")

wx_col = WechatMPCollector()
print("公众号评论:", "✅" if wx_col.validate_config() else "❌ 需配置")

# 贴吧
from platforms.tieba import TiebaCollector
tb = TiebaCollector()
print("贴吧:", "✅ 全功能" if tb.bduss else "⚠️ 只读模式 (配置 TIEBA_BDUSS 获取发帖权限)")
```

---

## 🔧 常见问题

### 小红书

| 问题 | 解决 |
|------|------|
| `WinError 267 目录名称无效` | 已修复。如重装后仍出现，确保 `Python314/Lib/scripts/` 有 7 个 `.py` 文件 |
| `xhs login --cdp` 没反应 | 关掉所有 Chrome，重试。检查端口 9222 是否被占用 |
| 发图文笔记失败 | 小红书图文必须至少一张图片，且格式为 jpg/png |

### 公众号

| 问题 | 解决 |
|------|------|
| 认证失败 `invalid ip` | 在公众号后台 IP 白名单中加入当前服务器出口 IP |
| `wechatpy` 安装失败 | `pip install cryptography` 可能需要编译工具，Windows 用预编译版本 |
| 文章内容显示乱码 | 确保 `json.dumps(ensure_ascii=False)` |

### 贴吧

| 问题 | 解决 |
|------|------|
| `Connection timeout to tiebac.baidu.com` | 网络问题，可能需要代理或 VPN |
| BDUSS 过期 | 重新从浏览器 Cookie 获取，BDUSS 一般有效期较长 |
| `get_fid` 找不到吧名 | 检查吧名是否正确（如"天堂鸡汤"而非"天堂鸡汤吧"） |
