import { CheckCircle2, Database, FileText, Route, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';

import { hasSupabaseConfig } from '../lib/env';
import { currentPhase, routePlan } from '../lib/routePlan';

const completedItems = [
  '已完成 PRD 核对、架构设计、数据库与 RLS 方案、页面路由设计。',
  '已建立移动优先的 React/Vite/TypeScript/Tailwind 项目骨架。',
  '已接入 Supabase Auth、门店首页、盘点、订货、导出、历史和后台管理。',
  '已增加单元测试、导出测试、Excel 导入解析测试和阶段状态测试。',
  '已增加 Playwright smoke 脚本，覆盖桌面和手机视口的公开页与保护路由。',
  '已增加安全扫描脚本、Cloudflare Pages 部署说明和上线前检查清单。',
];

export function PhaseStatusPage() {
  return (
    <main className="min-h-screen bg-[#f4f7f3] px-4 py-6 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section className="rounded-lg border border-line bg-white p-5 shadow-panel sm:p-7">
          <div className="flex items-start gap-3">
            <Smartphone className="mt-1 h-7 w-7 shrink-0 text-brand-600" aria-hidden="true" />
            <div className="space-y-3">
              <p className="text-sm font-semibold text-brand-700">阶段 {currentPhase} 测试和部署</p>
              <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
                移动端门店盘点订货系统
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-700">
                当前版本已完成 PRD 建议阶段中的核心实现、测试脚本、部署文档和上线前安全检查。
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-line bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-brand-600" aria-hidden="true" />
              <h2 className="text-lg font-semibold">本阶段已完成</h2>
            </div>
            <ul className="space-y-3 text-sm leading-6 text-slate-700">
              {completedItems.map((item) => (
                <li key={item} className="border-l-4 border-brand-100 pl-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-line bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-5 w-5 text-brand-600" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Supabase 配置</h2>
            </div>
            <p className="text-sm leading-6 text-slate-700">
              {hasSupabaseConfig
                ? '已检测到公开 anon key 配置，当前页面会连接真实 Supabase。'
                : '尚未配置 .env，本阶段不会连接真实 Supabase。'}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              前端只读取 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，不会使用 service role key。
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Route className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold">页面路由计划</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {routePlan.map((item) => (
              <Link
                className="rounded-md border border-line p-4 transition hover:border-brand-500 hover:bg-brand-50"
                key={item.path}
                to={item.path}
              >
                <div className="font-mono text-sm font-semibold text-brand-700">{item.path}</div>
                <div className="mt-2 text-sm text-slate-700">阶段 {item.phase}：{item.purpose}</div>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold">文档入口</h2>
          </div>
          <p className="text-sm leading-6 text-slate-700">
            部署、使用说明、安全检查和阶段清单都维护在仓库 `docs/` 和 README 中。
          </p>
        </section>
      </div>
    </main>
  );
}
