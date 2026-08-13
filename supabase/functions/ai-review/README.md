# StoreHub AI Review Edge Function

`ai-review` 是五道口店和西直门店管理员端结构化数据 AI 质检的服务端执行器。它只生成辅助提醒，不批准、提交、合并、删除或直接修改任何业务记录。

## 安全边界

- 普通入口必须携带有效的 Supabase 用户 JWT；函数内再次确认账户仍启用且角色为 `admin`。
- `ensure`、`rerun` 和 `check-draft` 的门店访问、两家试点门店白名单及实体归属由对应数据库 RPC 再次校验。
- 后台队列只允许 Service Role 通过 `claim_ai_review_jobs` 领取数据库已经构造并复验过的任务。
- 送模前还有第二层递归字段白名单。图片、图片路径/URL、运单号、承运信息、姓名、电话、邮箱、自由备注和任何未知字段都会使该检查安全失败，不会发送给模型。
- `v2_task` 在本轮结构化试点中关闭，避免文本答案混入模型输入。
- 模型结果只能通过 `complete_ai_review_run` 写入 AI runs/suggestions；失败通过 `fail_ai_review_run` 记录。函数本身不写 `products`、`arrival_reports`、`task_items` 等业务表。
- 一键采纳只由前端填充管理员草稿，仍需管理员使用原业务保存/审核按钮确认。
- API Key 只通过 Secret 读取，禁止写入 Git、`VITE_*`、浏览器请求、日志或错误响应。

## Secrets

必须配置：

```text
DEEPSEEK_API_KEY
```

后台 worker 二选一：

```text
AI_REVIEW_WORKER_SECRET
```

或使用数据库私有配置中保存的随机 Token，并通过 `verify_ai_review_cron_token` 验证 `x-storehub-cron-secret`。该 Token 只用于数据库定时任务到 Edge Function 的服务端调用，不得写入前端、日志或业务表。

可选配置：

```text
DEEPSEEK_API_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_MS=25000
```

端点仅接受官方 `https://api.deepseek.com`（也兼容显式 `/v1`）；模型固定为 `deepseek-v4-pro`，并显式发送 `thinking: {"type":"disabled"}`。结构化质检不使用 V4 Pro 默认的长推理模式，以保持管理员草稿检查和队列处理的有界延迟；采样温度固定为 `0`。JSON Output 响应可容忍 BOM、说明前后缀和 Markdown 围栏，但只提取首个完整平衡 JSON 对象，随后仍执行根对象、建议字段和动作 payload 的严格 schema/白名单校验；不会跳过首个恶意对象寻找后续结果。自定义非官方主机会被拒绝。

函数还依赖 Supabase 自动注入或已有的服务端 Secrets：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

## HTTP API

函数只接受 `POST`。管理员入口使用 `Authorization: Bearer <JWT>`。

### Ensure

为已有正式记录确保有一条当前版本检查；重复请求由数据库去重。

```json
{
  "action": "ensure",
  "storeId": "uuid",
  "workflow": "arrival_report",
  "entityId": "uuid"
}
```

支持的首轮 workflow：`product`、`product_creation_request`、`arrival_report`、`inventory`、`order`。

### Rerun

```json
{
  "action": "rerun",
  "runId": "uuid"
}
```

### Check draft

货品新增/编辑保存前的即时检查。只允许以下精确字段，其他字段会被拒绝：

```json
{
  "action": "check-draft",
  "storeId": "uuid",
  "workflow": "product",
  "structured": {
    "name": "安佳淡奶油",
    "spec": "1L/盒×12盒/箱",
    "countUnit": "盒",
    "categoryCode": "other_food",
    "productId": "编辑时可选 uuid"
  }
}
```

该请求先调用 `admin_ai_check_product_draft` 创建可审计 run，再用 `claim_ai_review_run` 定向领取，完成确定性规则和 DeepSeek JSON 检查，最后落库并直接返回严格建议 JSON。模型异常时仍返回已落库的失败状态，不会代替管理员保存货品。

### Worker / Cron

处理一个有界批次：

```json
{ "action": "process-queue", "limit": 5 }
```

有界排空，最多 20 条；同批任务并行执行以控制 Edge Function 总耗时：

```json
{ "action": "drain", "limit": 20 }
```

请求必须携带 `x-storehub-ai-worker-secret`，或携带由数据库 RPC 验证的 `x-storehub-cron-secret`。单次模型请求 25 秒超时；空内容、无效 JSON、HTTP 429、HTTP 5xx、网络错误和超时最多总共尝试 3 次。`finish_reason=length` 会明确记录为输出截断，并在重试时把输出上限从 2500 逐步提高到 4000、6000；资源不足会重试，内容过滤和意外工具调用不会盲目重试。仍失败时写入安全错误码并由数据库队列稍后重试，原业务流程不受阻断。

## RPC contract

函数使用以下数据库 RPC：

- `admin_ensure_ai_review(p_store_id,p_workflow,p_entity_id)`
- `admin_rerun_ai_review(p_run_id)`
- `admin_ai_check_product_draft(p_store_id,p_product_id,p_draft)`
- `claim_ai_review_run(p_run_id,p_worker_id)`
- `claim_ai_review_jobs(p_limit,p_worker_id)`
- `complete_ai_review_run(p_run_id,p_suggestions,p_model,p_system_fingerprint,p_usage,p_latency_ms)`
- `fail_ai_review_run(p_run_id,p_error_code,p_error_message,p_retryable,p_next_retry_at)`
- `verify_ai_review_cron_token(p_token)`

## Deploy and test

函数有 JWT 和 worker 两种入口，因此网关 JWT 预校验必须关闭；鉴权全部在函数内完成：

```bash
supabase functions deploy ai-review --no-verify-jwt
deno test supabase/functions/ai-review/*_test.ts
```

单元测试覆盖数据库实际输出的 product、product creation request、arrival、inventory 和 order 上下文，camelCase 字段标准化、敏感字段拒绝、草稿严格字段、DeepSeek 固定模型/官方端点、JSON schema 及有限重试。
