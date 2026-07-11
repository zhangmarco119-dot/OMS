# StoreHub V2 阶段 2：到货数据库与 Storage

> 阶段 3 已实施门店端到货流程，当前状态以 `docs/V2_PHASE_3_STORE_ARRIVALS.md` 为准。

实施分支：`v2-development`

实施日期：2026-07-12

## 1. 阶段范围

阶段 2 只交付数据库与私有 Storage 基础：

- 到货单、商品明细、图片元数据和通知表；
- 约束、索引、触发器、RLS helper；
- 幂等提交、管理员查看和作废 RPC；
- 每日明细与商品汇总 View；
- 私有图片 bucket 与 Storage Policy；
- TypeScript 数据库类型；
- 静态 schema 校验、SQL catalog smoke test 和安全回滚脚本。

本阶段不实现前端草稿编辑、图片压缩/上传、商品搜索、提交页面、管理员列表或 Excel。

## 2. Migration

正向 migration：

```text
supabase/migrations/0010_arrival_reports.sql
```

安全回滚：

```text
supabase/rollbacks/0010_arrival_reports.sql
```

旧的 `0001` 至 `0009` migration 未修改。

## 3. 数据表

### `arrival_reports`

- 每条记录绑定 `store_id` 和 `reported_by`；
- 门店名称和提交人名称由数据库触发器生成快照；
- 状态限定为 `draft | submitted | viewed | voided`；
- `version` 在每次更新时自动递增；
- `submission_key` 唯一，用于提交幂等；
- 查看、作废状态必须包含对应管理员、时间和原因。

### `arrival_report_items`

- 保存商品名称、数量、单位和正式商品 ID；
- 数量必须大于 0；
- 正式商品必须属于到货单门店；
- 删除正式商品后使用 `ON DELETE SET NULL` 保留历史快照。

### `arrival_report_images`

- 区分 `waybill` 和 `goods`；
- bucket 固定为 `arrival-report-images`；
- MIME 只允许 JPEG、PNG、WEBP；
- 单图最大 10 MiB；
- 对象路径必须匹配门店、到货单、图片类型和 UUID 文件名。

### `notifications`

- 支持指定用户或角色；
- 到货提交为管理员角色创建门店范围通知；
- `dedupe_key` 防止同一到货单重复通知；
- 阶段 4 再实现完整消息列表和独立已读操作。

## 4. 索引与聚合

索引覆盖：

- 门店 + 到货日期；
- 门店 + 状态 + 提交时间；
- 提交人 + 状态 + 更新时间；
- 到货单商品排序；
- 正式商品引用；
- 到货单图片类型；
- 用户/角色未读通知。

View：

- `arrival_daily_detail_view`；
- `arrival_daily_product_summary_view`。

两个 View 均使用 `security_invoker = true`，查询继续受基础表 RLS 限制；作废记录不进入聚合，不同单位不会合并。

## 5. RPC

### `submit_arrival_report`

数据库内原子完成：

1. 锁定到货单；
2. 检查提交人、门店、员工/店长角色；
3. 检查 draft 和预期 `version`；
4. 检查至少一条商品、一个面单图片和一个货品图片；
5. 从结构化商品明细重新生成规范描述；
6. 使用 `submission_key` 保证重复请求返回同一结果；
7. 更新 submitted 状态；
8. 创建一次管理员通知；
9. 写入审计日志。

### 管理员 RPC

- `mark_arrival_viewed`：仅管理员且必须拥有门店授权；
- `void_arrival_report`：仅管理员，原因必填，保留原始记录和审计日志。

普通用户不能通过直接 UPDATE 把 draft 改为正式状态。

## 6. RLS 权限矩阵

| 对象 | 员工/店长 | 管理员 |
|---|---|---|
| 到货草稿 | 创建本门店本人草稿；仅修改/删除本人 draft | 不直接修改 |
| 正式到货记录 | 查看当前门店正式记录 | 查看授权门店记录 |
| 商品明细 | 跟随父到货单权限 | 跟随父到货单权限 |
| 图片元数据 | 草稿创建人写入/删除；正式记录只读 | 授权门店只读 |
| 通知 | 只读本人或本人角色范围 | 只读授权门店管理员通知 |
| 状态转换 | 只能调用提交 RPC | 只能调用查看/作废 RPC |

所有子表都通过父到货单检查真实门店和状态，不信任客户端单独传入的 `store_id`。

## 7. Storage

Bucket：

```text
arrival-report-images
```

- `public = false`；
- 大小上限 10 MiB；
- MIME allowlist：JPEG、PNG、WEBP。

对象路径：

```text
{store_id}/{report_id}/waybill/{uuid}.jpg
{store_id}/{report_id}/goods/{uuid}.jpg
```

策略：

- 上传和删除必须关联本人、本门店、draft 到货单；
- 读取必须存在对应 `arrival_report_images` 元数据；
- 员工/店长不能读取其他门店；
- 管理员只能读取授权门店；
- 不提供覆盖 UPDATE，重试必须使用新的唯一对象名。

## 8. 验证

静态验证：

```powershell
pnpm validate:supabase
```

SQL catalog smoke test：

```text
supabase/tests/0010_arrival_schema.sql
```

该 SQL 应在 migration 应用后的 Supabase SQL Editor、CI 数据库或本地 Supabase 中执行。

本机当前没有 Supabase CLI、PostgreSQL `psql` 或 Docker，因此本轮不能本地实际执行 migration。静态验证不等同于真实数据库 RLS 集成测试；应用到测试项目后仍必须用员工、店长、跨门店账号和管理员 JWT 运行权限矩阵测试。

## 9. 回滚

回滚脚本默认拒绝删除非空 bucket。正确顺序：

1. 关闭 `VITE_ENABLE_V2_ARRIVAL_ENTRY`；
2. 停止所有 V2 写入；
3. 导出需要保留的到货数据和图片；
4. 清理 bucket 对象；
5. 执行 `supabase/rollbacks/0010_arrival_reports.sql`；
6. 验证 V1 点货、订货、历史和管理员后台。

不得修改或回退 V1 的 `0001` 至 `0009` migration。

## 10. 下一阶段边界

上述门店端能力已由阶段 3 实现；后续阶段 4 才进入管理员到货中心。
