# StoreHub V2 阶段 3：门店端到货上报

实施分支：`v2-development`

实施日期：2026-07-12

## 1. 阶段范围

本阶段完成员工和店长共用的门店端到货流程：

- 创建或恢复本人、本门店到货草稿；
- 到货日期、时间、配送方、快递单号和备注；
- 面单照片和拆包货品照片；
- 本店商品防抖搜索和手工未匹配商品；
- 多产品、数量、单位和产品备注；
- 自动生成规范中文描述；
- 本机未完成输入恢复和数据库自动保存；
- 乐观并发、幂等提交和二次确认；
- 提交成功页和门店到货历史。

管理员消息、列表、详情、作废 UI、每日汇总和 Excel 属于阶段 4，本轮不实现。

## 2. 角色边界

- 员工与店长使用同一套 `/app/arrivals` 执行组件；
- V2 共享能力不用于 V1 点货、订货和商品维护；
- 管理员不能创建或编辑门店到货草稿；
- 历史记录继续由阶段 2 RLS 限制在当前门店或管理员授权门店。

## 3. 草稿和自动保存

草稿恢复分为两层：

1. 数据库保存完整、可验证的商品明细和基础信息；
2. 浏览器 localStorage 保存尚未填完的输入，刷新后恢复。

自动保存延迟 800ms，并显示等待、保存中、已保存和失败状态。提交前会强制执行一次保存。

### 原子并发保护

新增 migration：

```text
supabase/migrations/0011_save_arrival_draft.sql
```

`save_arrival_draft` 在单个数据库事务中：

- 锁定父到货单；
- 校验创建人、门店、draft 状态和预期版本；
- 替换完整商品明细；
- 重新生成数据库描述；
- 更新基础字段并递增版本。

同一提交人、同一门店同时只允许一条 draft；并发打开两个页面时，唯一索引会让后发请求复用已经创建的草稿。

同时撤销前端对 `arrival_reports` UPDATE/DELETE 和 `arrival_report_items` INSERT/UPDATE/DELETE 的直写权限，避免绕过版本号。

## 4. 商品录入

- 只加载当前门店启用商品；
- 输入 250ms 防抖；
- 结果显示名称、规格和单位；
- 选择正式商品后记录 `product_id` 并带出单位；
- 手工填写时 `product_id = null` 且标记未匹配；
- 未匹配商品不会写入 V1 正式商品表；
- 数量必须大于 0、最多三位小数且不超过数据库范围。

## 5. 图片流程

- 支持相机和相册；
- 选择后立即创建本地预览；
- 浏览器端最长边压缩到 2000px；
- 压缩后必须小于 10 MiB；
- 仅支持 JPEG、PNG、WEBP；
- 显示上传阶段进度、成功和具体失败原因；
- 失败保留原文件，可直接重试；
- 上传对象成功但元数据或签名 URL 失败时执行补偿清理；
- 删除先移除元数据，再清理 Storage，使残留孤儿对象无法被读取；
- 提交时仍有上传任务会被阻止。

## 6. 提交

前端提交前检查：

- 至少一张面单照片；
- 至少一张拆包货品照片；
- 没有图片上传中；
- 至少一个完整产品；
- 产品名称、数量和单位有效。

确认弹层显示门店、产品种类、自动描述和两类图片数量。前端阻止重复点击，数据库 `submit_arrival_report` 继续使用版本和幂等键保证只生成一条正式记录和通知。

## 7. 页面和服务

路由：

- `/app/arrivals`：草稿和提交；
- `/app/arrivals/history`：门店到货历史；
- `/app/arrivals/:reportId/success`：提交成功页。

核心文件：

```text
src/features/arrivals/arrivalForm.ts
src/features/arrivals/useArrivalDraft.ts
src/features/arrivals/ArrivalItemCard.tsx
src/features/arrivals/ArrivalImageSection.tsx
src/services/arrivals.service.ts
src/services/arrival-images.service.ts
```

页面组件不直接散落 Supabase 写查询。

## 8. 验证边界

自动测试覆盖：

- 单产品、多产品和空描述；
- 未匹配商品；
- 数量校验；
- 两类必需图片和上传中阻止；
- 图片 MIME 校验；
- 员工/店长共享页面与管理员隔离；
- V1 既有测试。

数据库 catalog/权限 smoke test：

```text
supabase/tests/0010_arrival_schema.sql
supabase/tests/0011_arrival_draft_rpc.sql
```

本机没有 Supabase CLI、psql 或 Docker，且按要求只推送代码，因此 migration 和真实 JWT 流程没有应用到远端项目。部署到测试 Supabase 后必须使用员工、店长、跨门店账号和管理员完成真实图片与 RLS E2E。

## 9. 回滚

先关闭 `VITE_ENABLE_V2_ARRIVAL_ENTRY`，再按逆序执行：

1. `supabase/rollbacks/0012_arrival_report_returning_rls.sql`；
2. `supabase/rollbacks/0011_save_arrival_draft.sql`；
3. 清理到货图片对象；
4. `supabase/rollbacks/0010_arrival_reports.sql`。

回滚不会修改 V1 `0001–0009`。

## 10. 下一阶段

阶段 4 才实现管理员到货消息、列表、详情、标记查看、作废、每日汇总和 Excel。本轮到此停止。
