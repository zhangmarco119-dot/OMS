# 上线前安全检查

## 密钥和配置

- [ ] 前端只配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
- [ ] 没有把 service role key 放进前端、Git、Cloudflare Pages 前端变量或文档。
- [ ] 没有提交数据库连接串、数据库密码、员工明文密码 Excel。
- [ ] 已运行 `pnpm audit:security`。

## Supabase

- [ ] 所有业务表启用 RLS。
- [ ] V2 到货四张表已启用 RLS，并用员工、店长、跨门店账号和管理员 JWT 完成集成测试。
- [ ] `arrival-report-images` 为私有 bucket，只允许 JPEG/PNG/WEBP 且单图不超过 10 MiB。
- [ ] Storage 读取同时校验授权门店、父到货单和 `arrival_report_images` 元数据。
- [ ] 管理员账号只授权必要门店。
- [ ] `admin-users` Edge Function 的 `SUPABASE_SERVICE_ROLE_KEY` 只存在于 Supabase Function 环境。
- [ ] 已重置开发过程中在聊天或截图里出现过的数据库密码。

## 业务数据

- [ ] 盘点、订货、商品、反馈、历史记录都包含 `store_id`。
- [ ] 已提交单据保留商品快照，不依赖后续商品主数据。
- [ ] 导出的 Excel 不包含 token、密钥或用户密码。

## 浏览器验收

- [ ] 桌面浏览器打开 `/`、`/login`、`/app`。
- [ ] 手机浏览器完成登录、盘点录入、订货录入、历史记录查看。
- [ ] 管理员在手机上可以打开 `/admin` 并查看商品、导入、反馈、账号标签。

## 发布后

- [ ] 只把生产域名加入 Supabase Auth 允许跳转地址。
- [ ] 验证 Cloudflare Pages 的环境变量没有多余 secret。
- [ ] 验证 RLS 不能跨门店读取数据。
