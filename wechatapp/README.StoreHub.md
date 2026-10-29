# StoreHub 微信小程序

在微信开发者工具中打开本目录：`D:\codex_develop\manage_system\wechatapp`。

- AppID：`wxa11bc5cac53d2291`。
- `project.config.json` 的 `miniprogramRoot` 指向 `dist/`，当前为正式系统联调包。
- 原有模板源码保留在根目录，不参与生成的小程序包；本机项目配置备份在 `.local/`。
- 已验证正式账号登录、进入业务分包、刷新恢复会话、运营概览、底部导航布局。手机预览已通过开发者工具推送。
- 手机端已确认可以登录并进入首页；针对真机缺少 `Intl` 的问题，已添加独立兼容分包并推送更新，首页统计数据恢复待真机复验。
- 已修复大响应 UTF-8 编解码导致的页面无响应，长列表每页展示 20 项，所有记录可通过上一页／下一页访问；选择框保留完整选项。
- 日期、月份、时间和日期时间使用微信选择器；详情折叠、异步确认、勾选事件、文件图片选择、剪贴板、文档导出和原生画布由适配层处理。
- 相机、文件和导出仍需完整真机验收；不能据此宣称全部角色流程和实时同步已经通过。

业务页面复用仓库中的 React 源码，业务请求保留原系统用户 JWT 与权限；没有复制业务数据库。正式与测试构建分别固定对应的后台地址和公开配置指纹。

可维护源码在 `tooling/`，接口桥接源码在 `cloudfunctions/bridge/`。在仓库根目录执行：

```powershell
pnpm run wechat:setup
pnpm run wechat:check
pnpm run wechat:build             # 测试环境，输出 build/development
pnpm run wechat:build:production  # 正式环境，输出 build/production 并更新 dist
pnpm run wechat:build:cloud       # 生成两套固定目标的云函数，不会自动部署
```

构建前在本机 `.local/development.json.local` 和 `.local/production.json.local` 放置对应环境的 JSON 配置，字段为 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。构建器核对仓库环境策略中的地址和公开密钥指纹，拒绝旧云库或环境混用。本机已配置；新机器需从受控环境配置恢复，不能提交真实公开密钥或 JWT。

云函数使用现有免费环境 `storehub-development-d7a8968dc20`，通过 `wx.cloud.callHTTPFunction` 调用。保留网关小程序身份校验及原系统 JWT/RLS；不要为桥接函数创建无身份保护的公开 HTTP 路由。实时 WebSocket 的真机域名兼容性仍待单独验证。

`pnpm run release:check` 包含小程序回归测试，新机器需先运行 `wechat:setup`。小程序仍需在微信开发者工具中编译、预览、上传并完成真机验收；Web 双分支发布与微信正式发布是独立步骤。请勿把 `dist/` 当作源码，勿把上传私钥、账号密码、AppSecret 或任何服务端密钥放入代码仓库或小程序包。
