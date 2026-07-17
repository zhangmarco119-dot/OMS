# Edge Functions

## `account-login`

账号名或姓名登录函数。它在服务端查找 `public.profiles`，再使用对应的 Supabase Auth 用户校验密码。前端只提交账号名/姓名和密码，不读取或显示底层认证邮箱。

- 账号名必须唯一。
- 姓名可重复；如果同名账号超过一个，用户必须改用账号名登录。
- 停用的 profile 不允许登录。
- 部署时必须关闭网关 JWT 预校验，因为调用发生在用户登录之前；函数内部仍会通过 Supabase Auth 校验密码。

```bash
supabase functions deploy account-login --no-verify-jwt
```

该函数只在服务端读取 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY`，不会把内部邮箱或 Service Role Key 返回给前端。

## `admin-users`

管理员账号管理函数。用于：

- 创建 Supabase Auth 用户并插入 `public.profiles`；邮箱为空时自动生成内部认证邮箱
- 给已有用户设置临时新密码

该函数必须部署在 Supabase Edge Functions，且只在服务端读取：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

不要把 `SUPABASE_SERVICE_ROLE_KEY` 写入前端 `.env.local`。

部署后，前端会调用：

```text
POST /functions/v1/admin-users
```

调用者必须已经登录，并且 `public.profiles.role = 'admin'`。

## `dingtalk-attendance`

钉钉员工目录与考勤同步函数。支持管理员更新通讯录、同步月份/门店/单个员工、重试任务，以及带独立密钥的 Cron 自动同步。

- 网关 JWT 预校验关闭，函数内部会完整校验用户 JWT、管理员角色和门店范围。
- 自动同步必须携带 `x-storehub-cron-secret`，普通匿名请求会被拒绝。
- 钉钉 `AppSecret` 和 Access Token 只存在于服务端。
- 函数按员工隔离失败并记录标准化错误，不记录 Token、完整手机号或完整响应。

```bash
supabase functions deploy dingtalk-attendance --no-verify-jwt
```

完整 Secrets、权限、首次绑定和 Cron 配置见 `docs/DINGTALK_ATTENDANCE_SETUP.md`。

## `pospal-sales`

银豹营业收入同步函数。管理员可以更新指定日期，也可以由数据库 Cron 在到达门店计划时间时自动触发。函数会分页读取银豹单据，排除作废单据、扣减有效退货，随后通过事务函数更新当日营业收入和同步日志。

- 网关 JWT 预校验关闭；手动更新仍会在函数内部验证用户 JWT、管理员角色和门店权限。
- 自动更新请求必须携带数据库私有 Cron Token，普通匿名请求无法触发。
- `POSPAL_INTEGRATIONS_BASE64` 只存在于 Supabase Edge Function Secret，内容是按门店配置的 Base64 JSON 数组；严禁写入前端或 Git。
- 同步表只保留核算所需的单号、时间、类型、有效状态和金额，不保存顾客资料或完整银豹响应。

```bash
supabase functions deploy pospal-sales --no-verify-jwt
```

完整配置、联调和发布顺序见 `docs/POS_SALES_SYNC.md`。
