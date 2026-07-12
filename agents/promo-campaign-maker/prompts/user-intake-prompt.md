# Promo Campaign Maker — User Intake Prompt

Copy this prompt when you want the agent to turn a software website into screenshots and
platform-specific promotional drafts.

```markdown
请使用 `promo-campaign-maker` 帮我做一份宣传素材包。

产品网址：
<填入要打开和截图的网站 URL>

产品大概内容：
<用 3-8 句话说明这是个什么产品、最想宣传什么、用户打开后应该感受到什么>

参考资料：
<填设计案/商业计划/产品说明路径；如果没有，就写“暂无，先根据网页和上面的描述判断”>

目标用户：
<例如：老用户、年轻用户、家长、学生、创作者、B 端品牌/IP 方、投资人等>

目标平台：
<例如：抖音、视频号、小红书、B站、公众号、微信群、微博、B端合作；不确定就写“你来建议”>

希望重点截图的页面/功能：
<例如：首页、登录、核心功能、AI 生成结果、分享页、作品列表、付费页、活动页；不确定可留空>

登录情况：
<例如：无需登录 / 可以用离线体验 / 需要我在浏览器里手动登录 / 需要测试账号但不要在聊天里索要密码>

输出要求：
- 打开网页并进入不同界面截图。
- 根据参考资料和截图判断每张图适合宣传什么卖点。
- 为不同平台分别生成文案，不要所有平台复制同一版。
- 整理成 Markdown 文档，方便人工发帖。
- 不要自动发布到任何平台。
- 不确定的数据、授权、功能状态请标注“需确认”，不要编造。

每日自动化：
<需要 / 不需要>。如果需要，请保存这次设定，之后每天根据同一网址和资料重新截图并生成当天发帖包。
```

## Minimal Version

If the user wants the fastest possible start, this is enough:

```markdown
请用 `promo-campaign-maker` 测试这个网站并生成宣传素材包：<URL>

产品大概是：<一句话说明产品>

目标平台先覆盖：抖音/视频号、小红书、B站、微信社群、微博。

请截图、识别卖点、生成文案，并整理成 Markdown 文档。不要自动发布。
```

## Notes For The Agent

- If the user gives no design plan, generate a first-pass pack from observed UI only and mark
  strategic claims as `需确认`.
- If the user asks for daily automation, save the URL and rough description into
  `agents/promo-campaign-maker/context/campaign-state.md`.
- Never ask the user to paste passwords, cookies, tokens, or API keys into chat.