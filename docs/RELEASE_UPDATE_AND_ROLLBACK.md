# StoreHub 强制更新与安全回滚

## 工作方式

系统使用两层检查，避免升级和回滚互相冲突：

1. Cloudflare 每次构建生成 `/version.json`，包含版本号、Git 构建编号和数据库兼容级别。
2. 已打开的页面启动时、每 60 秒、重新获得焦点或恢复联网时读取该文件。构建编号不同就显示不可关闭的更新窗口。
3. Supabase `system_release_control` 保存允许写入的前端版本。开启 `block` 后，不在允许列表中或数据库兼容级别过低的客户端无法写入业务表。
4. 升级和回滚都使用“精确版本列表”，禁止使用“版本号必须更大”的判断。

## 第一次启用

Migration `0101_safe_release_control.sql` 默认使用 `off`，这是必要的过渡保护：当前已打开且尚无更新检测能力的旧页面不会突然被锁死。

1. 先部署包含更新检测能力的前端。
2. 等待主要终端至少刷新一次。
3. 在 Supabase SQL Editor 由数据库所有者更新发布控制单例，开启拦截：

```sql
update public.system_release_control
set active_release = '2.4.4',
    allowed_releases = array['2.4.4'],
    minimum_database_contract = 1,
    enforcement_mode = 'block',
    message = '系统已更新，请刷新页面后继续操作。',
    updated_at = now()
where singleton;
```

日常应用代码不能直接更新该表；已登录管理员可通过受保护的 `configure_system_release_policy` RPC 调整策略。SQL Editor 用于首次启用和发布应急处理。

## 正常升级

1. 将新版本加入允许列表，同时暂时保留当前版本。
2. 部署新前端；`version.json` 变化会要求用户刷新。
3. 验证登录、查询和关键写入。
4. 将旧版本从允许列表移除。

例如从 `2.4.4` 升级到 `2.4.5` 时，过渡列表为：

```text
active_release: 2.4.5
allowed_releases: [2.4.4, 2.4.5]
```

稳定后改为 `[2.4.5]`。

## 回滚

1. 先把目标旧版本加入允许列表，例如 `[2.4.4, 2.4.5]`。
2. 在 Cloudflare 回滚到旧部署。
3. 将 `active_release` 设置为 `2.4.4`。
4. 验证关键业务后移除故障版本，允许列表改为 `[2.4.4]`。

Cloudflare 回滚后 `/version.json` 会恢复旧构建编号，因此正在使用故障版本的页面同样会收到“立即更新”，并刷新到回滚版本。

## 数据库原则

- 前端回滚默认不回滚数据库。
- Migration 必须向前兼容：先新增，再迁移数据，最后在后续稳定版本中清理旧结构。
- 删除字段、删除表或不可逆数据转换必须单独准备恢复方案，不能仅依赖前端回滚。
- 正式数据库禁止执行 reset、seed、drop、truncate 或测试清理。
- 每个后续新增的可写业务表都必须安装 `enforce_supported_client_release` 触发器。

## Cloudflare 缓存

`public/_headers` 对 `/version.json` 和 `/index.html` 禁止缓存，对带内容哈希的 `/assets/*` 使用长期不可变缓存。这样可以快速发现新部署，同时继续高效缓存静态资源。
