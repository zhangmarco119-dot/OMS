# 独立自托管后端恢复

测试站 `https://oms-store-development.pages.dev` 与正式站 `https://oms-store-management.pages.dev` 可以分别使用各自登记的自托管后端。数据库、容器网络、存储数据卷、JWT 密钥和隧道必须独立，严禁连接到另一环境。

前端地址保持不变，API 地址为 `/backend`。Cloudflare Pages 分别使用 `STOREHUB_DEV_BACKEND_ORIGIN` 和 `STOREHUB_PROD_BACKEND_ORIGIN` 绑定连接到本机对应 API 网关的 HTTPS 隧道。缺少正式绑定时不能回退到测试绑定。网关使用重新生成的 JWT 密钥，只提供 Auth、REST、Storage、Functions 和 Realtime WebSocket/广播；不得直接公开 Supabase CLI 的网关、Studio、pg-meta、Realtime 租户管理或数据库端口。

仓库的环境策略按发布分支同时校验固定站点 URL 和各自 anon key 的 SHA-256 指纹。前端不得包含 service role、内部密钥或数据库密码。更换 anon key 时必须同步更新对应环境指纹和构建变量。

临时隧道依赖本机 Docker、隧道进程和网络持续运行，不提供生产高可用承诺。隧道重启后需更新对应站点绑定并重新部署 Worker，前端 API URL 不需要变化。历史图片按可用原图备份单独恢复，缺失文件必须如实记录，不用相似图片代替。迁移时暂停原云端 StoreHub cron，保留回退配置；本机自动任务和 AI 先暂停，核验后分别恢复。

恢复验证必须包含实际在线登录、考勤、薪资、任务读取以及 Android WebView 检查，不能仅以网页返回 200 判断服务已恢复。
