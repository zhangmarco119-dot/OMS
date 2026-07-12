# 门店运营系统

面向手机浏览器的门店盘点和订货 Web 应用。当前已推进到阶段 9 后的角色化后台体验：登录、角色首页、盘点、订货、数据库提交、管理员消息、历史明细、后台维护、测试脚本和部署文档。

门店运营系统 V2 当前完成阶段 0–9：已支持到货闭环、任务、公告、SOP、统计、历史中心增强以及上线前验证。详见 [V2 阶段 8/9](docs/V2_PHASE_8_9_ANALYTICS_RELEASE.md)。

## 当前能力

- 使用账号名或姓名登录，底层通过 Supabase Auth 校验密码并保持会话。
- 根据账号 profile 自动识别门店。
- 员工和店长首页保留“点货”“订货”，并增加 V2“到货上报”；管理员首页显示独立消息中心，以及真实的今日到货统计和未读到货消息。
- 盘点/订货共用移动端工作台：大数字输入、上下项、下一未处理、已处理/未处理抽屉、自动保存。
- 点货可随时结束并提交，未填写项记录为“未盘点”；支持从本店所有账号的历史盘点单导入进度继续盘点。
- 商品删除申请立即移入已完成列表并标记“申请删除”，等待管理员审批。
- 店长在点货/订货中可直接更正商品资料并通知管理员；商品删除必须由管理员二次确认。
- 店长在任务中新增商品时同步写入本店商品库并通知管理员，管理员可忽略通知或确认知晓。
- 员工盘点支持商品反馈和新增临时商品。
- 订货支持“无需订货”独立状态。
- 汇总页点击提交即完成一次点货/订货，并生成管理员可见的提交提醒。
- 历史记录页支持按角色查看已提交单据和商品明细。
- 后台支持商品新增/编辑/停用/删除、Excel 商品导入、反馈审批和账号管理；管理员可确认删除、忽略、知晓或撤回店长修改。
- 管理员用户管理安全代码路径已接入；不在前端保存或展示明文密码。
- V2 到货入口通过 `VITE_ENABLE_V2_ARRIVAL_ENTRY` 控制；员工和店长共享入口，管理员保持独立工作台。
- 管理员到货中心支持授权门店列表、详情、标记查看、作废、每日汇总和 Excel 导出。
- 管理员可配置适用多门店的 V2 任务模板并发布不可变版本；模板仅管理员可见，员工和店长只会看到已发布到本门店的任务实例。
- V2 任务模板入口通过 `VITE_ENABLE_V2_TASK_TEMPLATES` 独立控制。
- V2 公告与 SOP 入口通过 `VITE_ENABLE_V2_NOTICES_AND_SOPS` 独立控制；公告记录个人已读，SOP 支持门店/角色范围、生效时间、私有附件和关联任务模板。

## 本机运行

```powershell
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' dev
```

打开：

- 本机：[http://localhost:5173/app](http://localhost:5173/app)
- 登录页面：[http://localhost:5173/login](http://localhost:5173/login)

## 手机预览

1. 电脑和手机连接同一个 Wi-Fi。
2. 在电脑运行 `ipconfig`，找到当前网络的 IPv4 地址。
3. 手机浏览器打开 `http://电脑IPv4:5173/app`。
4. 如果打不开，确认 dev server 使用 `--host 0.0.0.0`，并允许 Windows 防火墙访问。

## 质量检查

```powershell
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' validate:supabase
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' audit:security
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' typecheck
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' lint
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' test
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' build
```

E2E smoke 需要先启动 dev server，再运行：

```powershell
& 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\hwson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs' test:e2e
```

## 阶段边界

V1 阶段 9 与 V2 阶段 0–9 已完成。后续仅在确认后进行 AI 能力预留之外的功能迭代。
