# 部署说明

## 本地预览

```powershell
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' dev
```

本机打开：

- `http://localhost:5173/app`
- `http://localhost:5173/login`

手机预览：

1. 电脑和手机连接同一个 Wi-Fi。
2. 电脑运行 `ipconfig` 找到 IPv4 地址。
3. 手机打开 `http://电脑IPv4:5173/app`。

## 必要环境变量

Cloudflare Pages 或其他静态托管平台只需要公开 anon 配置：

```text
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_ANON_KEY=你的 publishable/anon key
```

不要把以下内容放到前端环境变量：

- Supabase service role key
- 数据库连接串
- 数据库密码
- 员工密码 Excel

## Cloudflare Pages

推荐配置：

- Framework preset: `Vite`
- Build command: `pnpm build`
- Build output directory: `dist`
- Node version: 22 或 Cloudflare 默认可用 LTS

如果 Cloudflare 没有启用 pnpm，可使用：

```text
corepack enable && pnpm install --frozen-lockfile && pnpm build
```

## 部署前检查

```powershell
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' validate:supabase
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' audit:security
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' typecheck
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' lint
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' test
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' build
```

E2E smoke 需要先启动本地服务：

```powershell
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' dev
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' test:e2e
```

## Supabase 注意事项

- 生产项目必须启用 RLS。
- 前端只使用 anon/publishable key。
- `admin-users` 和 `account-login` Edge Function 上线时，必须只在 Supabase Function 环境中使用 `SUPABASE_SERVICE_ROLE_KEY`。
- `account-login` 必须使用 `supabase functions deploy account-login --no-verify-jwt` 部署；它在用户登录前调用，并在函数内部通过 Supabase Auth 校验密码。
- 管理员账号创建后应重置数据库密码，避免聊天或本机日志中出现过的临时密码继续有效。
