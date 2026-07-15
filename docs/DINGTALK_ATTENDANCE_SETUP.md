# StoreHub 钉钉考勤接入与发布手册

更新时间：2026-07-16

本文用于配置 StoreHub 的钉钉考勤数据源。真实 AppSecret、Access Token 和 Cron 密钥不得写入 Git、前端环境变量、Migration 或日志。

## 1. 已实现的数据链路

1. 管理员在 StoreHub“考勤管理 → 员工绑定”更新钉钉通讯录。
2. Edge Function 使用企业内部应用凭据换取服务端 Access Token。
3. 管理员确认 StoreHub 账号与钉钉员工的绑定；同名只作为建议，不自动绑定。
4. 手动或定时任务从钉钉读取排班、考勤结果和打卡流水。
5. Edge Function 标准化并 Upsert 到本地考勤表；页面始终读取本地数据，不在打开页面时直连钉钉。

当前适配接口：

- `POST https://api.dingtalk.com/v1.0/oauth2/accessToken`
- `POST /topapi/v2/department/listsubid`
- `POST /topapi/v2/user/list`
- `POST /attendance/list`
- `POST /attendance/listRecord`
- `POST /topapi/attendance/listschedule`

打卡结果和打卡详情按最多 50 人、7 天分片；组织排班接口按工作日逐日查询，每页最多 200 条，并在服务端为每条排班补充所属工作日。实现兼容分页、超时、429/5xx 重试、Token 失效刷新和单个员工失败隔离。接口路径和请求字段已经使用当前企业内部应用完成真实只读调用验证。

官方参考：

- [钉钉开放平台](https://open.dingtalk.com/)
- [获取打卡结果](https://open.dingtalk.com/document/development/open-attendance-clock-in-data)
- [获取打卡详情](https://open.dingtalk.com/document/development/attendance-clock-in-record-is-open)
- [全量查询企业考勤排班详情](https://open.dingtalk.com/document/development/interface-for-daily-full-query-of-attendance-scheduling-information)
- [钉钉官方 Workspace CLI 考勤参考](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/mono/references/products/attendance.md)

## 2. 钉钉开放平台一次性配置

1. 使用企业管理员账号进入钉钉开放平台，创建“企业内部应用”。
2. 将应用可见范围覆盖需要同步考勤的员工和部门。
3. 在权限管理中搜索并申请以下只读能力；控制台文案可能随版本微调，以接口详情页显示的权限点为准：
   - 通讯录部门信息读取；
   - 通讯录成员基础信息读取；
   - `qyapi_get_attendance_data`：企业考勤数据读取（考勤结果和打卡流水）；
   - `qyapi_base`：组织排班只读接口的基础调用权限。
4. 确认企业已启用钉钉考勤，并且目标员工已进入考勤组或存在可查询记录。
5. 记录 `CorpId`、应用 `AppKey` 和 `AppSecret`。不要发送到聊天、截图或提交到仓库；直接写入目标 Supabase 项目的 Function Secrets。

若接口返回无权限，打开钉钉开放平台对应接口详情，点击“权限说明/申请权限”，将列出的权限点全部授权给该企业内部应用，再重新发布应用版本。

## 3. Development Supabase Secrets

以下命令必须在 `v2-development` 分支执行，并确认项目 ref 是 `tpbjlzmxpxsydsheeswm`。将尖括号内容替换为真实值，不要把执行记录提交到仓库：

```powershell
pnpm dlx supabase@latest secrets set `
  DINGTALK_CORP_ID="<企业 CorpId>" `
  DINGTALK_APP_KEY="<应用 AppKey>" `
  DINGTALK_APP_SECRET="<应用 AppSecret>" `
  DINGTALK_ROOT_DEPARTMENT_IDS="1" `
  DINGTALK_ENTERPRISE_TIMEZONE="Asia/Shanghai" `
  DINGTALK_CRON_SECRET="<至少 32 位随机字符串>" `
  --project-ref tpbjlzmxpxsydsheeswm
```

变量说明：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DINGTALK_CORP_ID` | 是 | 企业 CorpId，仅用于区分企业数据和 Token 缓存。 |
| `DINGTALK_APP_KEY` | 是 | 企业内部应用 AppKey。 |
| `DINGTALK_APP_SECRET` | 是 | 仅保存在 Supabase Secrets。 |
| `DINGTALK_ROOT_DEPARTMENT_IDS` | 否 | 根部门 ID，多个以逗号分隔；默认 `1`。 |
| `DINGTALK_ENTERPRISE_TIMEZONE` | 否 | 默认 `Asia/Shanghai`。 |
| `DINGTALK_CRON_SECRET` | 自动同步必填 | 仅供 Cron 请求头鉴权，建议 32 字节以上随机值。 |

Supabase 自动提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY`，无需手工复制。

## 4. 部署与首次同步

```powershell
& .\scripts\supabase-environment.ps1 -Environment Development -Action MigrationList
& .\scripts\supabase-environment.ps1 -Environment Development -Action DryRun
& .\scripts\supabase-environment.ps1 -Environment Development -Action Push
pnpm dlx supabase@latest functions deploy dingtalk-attendance --project-ref tpbjlzmxpxsydsheeswm --no-verify-jwt --agent no
```

然后在 StoreHub 管理员端依次执行：

1. 进入“工作台 → 考勤管理 → 员工绑定”。
2. 点击“更新钉钉员工通讯录”。
3. 逐个确认员工绑定；姓名一致的“建议”也必须人工确认。
4. 回到“月度考勤”，选择当前月和门店，点击同步。
5. 在“同步日志”核对成功数、失败数和失败原因。

## 5. 自动同步

Development 已通过 `0052_dingtalk_attendance_cron_transport.sql` 启用 `pg_net`，并配置以下两个启用状态的 `pg_cron` 任务：`storehub-dingtalk-attendance-daily` 与 `storehub-dingtalk-attendance-month-start`。Cron Secret 同时保存在 Development Function Secrets 和 Vault，真实值不进入 Migration。首次 HTTP 试运行已返回 200。

新环境或未来正式发布时，可在 Supabase Dashboard 的 Cron/定时任务功能中创建等价的两个 HTTP 调用；也可以采用同样的 `pg_cron + pg_net + Vault` 方案，但必须使用该环境自己的 URL 和独立 Secret，不得复制 Development 的值。URL 均为：

```text
https://tpbjlzmxpxsydsheeswm.supabase.co/functions/v1/dingtalk-attendance
```

请求头：

```text
Content-Type: application/json
x-storehub-cron-secret: <与 DINGTALK_CRON_SECRET 完全一致>
```

推荐任务：

| 任务 | Cron（UTC） | Body | 企业时区效果 |
|---|---|---|---|
| 每日增量 | `15 18 * * *` | `{"action":"scheduled-sync","mode":"daily"}` | 北京时间每天 02:15，同步最近 7 天。 |
| 月初回补 | `45 18 28-31 * *` | `{"action":"scheduled-sync","mode":"month-start"}` | 北京时间每月 1 日 02:45 回补上月末 5 天；函数会在非 1 日自动跳过。 |

不要将 Cron 密钥放入 URL 查询参数。测试完成后，在 Cron 日志和“考勤管理 → 同步日志”中同时确认执行结果。

## 6. 权限与数据边界

- 员工、店长：只允许读取本人绑定与考勤。
- 管理员：只允许读取现有授权门店内的员工考勤。
- 店长不会因为可以管理门店业务而获得全店考勤权限。
- 浏览器不能写考勤表；所有同步写入只在 Edge Function Service Role 中完成。
- 匿名用户不能读表、调用 RPC 或执行手动同步。
- 同步日志只保存标准化错误，不保存 Token、Secret、完整手机号或完整第三方响应。

## 7. 常见问题

- “钉钉服务尚未完成安全配置”：缺少三个必填钉钉 Secret，或 Secret 写入了错误项目。
- “当前账号没有考勤管理权限”：请使用管理员账号，普通员工和店长不能触发同步。
- 通讯录为空：检查应用可见范围、通讯录读取权限和根部门 ID。
- 某员工没有数据：检查是否已绑定、员工是否在钉钉考勤组、所选月份是否有排班/打卡。
- 部分成功：打开同步日志查看单个员工失败原因；修复权限或绑定后点击重试。
- 补卡未更新：重新同步该月份；Upsert 会更新原日记录，不会重复累计。

## 8. 正式发布顺序

本模块当前只允许验证 Development。未来用户明确要求合并时，必须按顺序执行：Migration/RLS/测试/构建检查 → 同一批 Migration 应用正式 Supabase → 部署正式 Edge Function → 配置正式项目独立钉钉 Secrets 与 Cron → 部署 `manage-system` 前端。禁止把 Development Secret、Cron 或考勤测试数据复制到正式项目。
