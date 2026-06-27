# 麦思星球 微信小程序

把网页游戏 `麦思星球` 用微信小程序的 `web-view` 组件封装。

游戏地址：
`https://keepwork.com/api/raw/maisi/maisi/webgames/MagicHaqi/release/MagicHaqi_maisi.html`

## 目录结构

```
.
├── app.js            # 全局逻辑，存放游戏 URL
├── app.json          # 全局配置（页面、窗口样式）
├── app.wxss          # 全局样式
├── project.config.json
├── sitemap.json
└── pages
    ├── index         # 启动页：标题 + 开始按钮
    │   ├── index.js
    │   ├── index.json
    │   ├── index.wxml
    │   └── index.wxss
    └── game          # 游戏页：web-view 加载网址
        ├── game.js
        ├── game.json
        └── game.wxml
```

## 运行步骤

1. 用「微信开发者工具」导入本目录。
2. AppID：当前为占位值 `touristappid`（游客模式，仅供本地预览）。正式发布前请在
   `project.config.json` 把 `appid` 改为本小程序自己的 AppID。
3. 在开发者工具右上角「详情 → 本地设置」里勾选
   **「不校验合法域名、web-view（业务域名）...」**，即可在开发阶段预览。

## ⚠️ 正式发布前必读：业务域名

`web-view` 只能打开在小程序后台配置过的 **业务域名**。要上线必须：

1. 登录 https://mp.weixin.qq.com → 「开发 → 开发管理 → 开发设置 → 业务域名」。
2. 添加 `keepwork.com`（必须是 HTTPS、已 ICP 备案）。
3. 下载微信提供的校验文件，放到该域名根目录可访问的位置。

由于 `keepwork.com` 不是你自己的域名，通常无法完成校验文件上传。可选方案：
- 把游戏 HTML 资源迁移到你自己已备案的域名 / 服务器，再改 `app.js` 里的 `gameUrl`。
- 或将游戏改造为原生小程序（用 canvas 重写），不再依赖 `web-view`。

此外：个人主体的小程序**不支持** `web-view`，需要企业 / 个体工商户等非个人主体。
