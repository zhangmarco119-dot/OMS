# 架构设计

## 项目目标理解

本系统是一套移动端优先的门店盘点与订货 Web 应用。首期支持两家门店：

- 宝珠奶酪（五道口店）
- OMEGA酸奶（西直门店）

两家门店共用同一套前端、数据库结构和业务逻辑。用户登录后，系统根据账号绑定的 `store_id` 自动加载门店标题、商品清单、草稿和历史数据。门店之间的数据隔离不能只依赖前端路由，必须由数据库 RLS 执行。

## 当前仓库状态

开始前仓库不是 Git 仓库，只有一份 PRD Markdown 文件，没有现有代码、配置、依赖或测试。当前阶段已在不覆盖既有业务代码的前提下创建第一阶段骨架。

## 技术实现方案

- 前端：React + TypeScript strict + Vite。
- 样式：Tailwind CSS，移动端优先，兼容手机安全区。
- 路由：React Router，统一路由承载两家门店和两类任务。
- 表单：后续阶段使用 React Hook Form + Zod。
- 数据：Supabase Auth + PostgreSQL + RLS。
- 导入/导出：后续阶段使用 SheetJS/xlsx。
- 测试：Vitest + React Testing Library，后续增加 Playwright。
- 部署：Cloudflare Pages，后端由 Supabase 承担。

## 关键架构规则

- 所有业务表必须包含 `store_id`。
- 前端只能使用 Supabase anon key。
- Service role key 只能用于受控的导入脚本、CI secret 或 Supabase 后台，不进入浏览器包。
- 盘点和订货复用 `tasks` / `task_items` 通用任务模型，通过 `task_type` 区分。
- `task_items.product_snapshot` 保存商品快照，避免商品主数据后续变化影响历史单据。
- 异常反馈用独立表 `product_feedback`，避免单字段无法表达多个问题。
- 店长商品更正与管理员审批由数据库事务函数执行，修改、通知、撤回、删除和审计保持一致；商品删除不会删除历史任务快照。
- 本地存储只作为离线兜底，最终提交以数据库数据和服务端校验为准。

## 本轮完成任务

- 复制 PRD 到 `docs/PRD.md`。
- 补充架构、数据库、部署、用户说明和阶段任务文档。
- 建立前端项目骨架、路由和移动端基础布局。
- 提供 Supabase 初始迁移与 RLS 方案。
- 跑通类型检查、lint、测试、构建。

## 假设和风险

- PRD 原始文件是 UTF-8，但当前 PowerShell 输出编码会显示乱码；文件字节内容已原样复制。
- 本机 PATH 缺少 npm/pnpm，需要使用 Codex runtime 内置 pnpm。
- 阶段 1 不接入真实 Supabase，因此 RLS 只能做 SQL 静态方案，阶段 2 需要在 Supabase 项目中执行并验证。
- 手机预览依赖同一局域网和 Windows 防火墙策略。
