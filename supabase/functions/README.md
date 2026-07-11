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
