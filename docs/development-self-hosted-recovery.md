# 开发测试后端恢复

仅开发测试站 `https://oms-store-development.pages.dev` 可以使用已登记的自托管后端。正式站仍必须连接正式 Supabase，不能使用此代理。

前端地址保持不变，API 地址为 `/backend`。Cloudflare Pages 的 `STOREHUB_DEV_BACKEND_ORIGIN` 绑定连接到本机独立 API 网关的 HTTPS 隧道。网关使用重新生成的 JWT 密钥，只提供 Auth、REST、Storage、Functions 和 Realtime；不得直接公开 Supabase CLI 的网关、Studio、pg-meta 或数据库端口。

仓库的环境策略同时校验固定测试 URL 和 anon key 的 SHA-256 指纹。前端不得包含 service role、内部密钥或数据库密码。更换 anon key 时必须同步更新开发指纹和测试站构建变量。

临时隧道依赖本机 Docker、隧道进程和网络持续运行。隧道重启后需更新测试站绑定并重新部署 Worker，前端 API URL 不需要变化。历史图片文件未完成迁移；原有业务关联和其他数据保留。自动同步和 AI 执行保持关闭，启用前必须单独核验。

恢复验证必须包含实际在线登录、考勤、薪资、任务读取以及 Android WebView 检查，不能仅以网页返回 200 判断服务已恢复。
