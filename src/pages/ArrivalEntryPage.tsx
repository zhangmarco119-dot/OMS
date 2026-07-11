import { PackageCheck, ShieldCheck } from 'lucide-react';

import { PageShell } from '../components/layout/PageShell';
import { featureFlags } from '../config/featureFlags';
import { canOperateV2Modules } from '../features/access/roleCapabilities';
import { useAuth } from '../features/auth/AuthContext';

export function ArrivalEntryPage() {
  const auth = useAuth();

  if (!featureFlags.arrivalEntry) {
    return (
      <PageShell eyebrow="V2 功能开关" title="到货上报入口未启用" backTo="/app">
        <div className="rounded-lg bg-white p-5 text-sm leading-6 text-slate-600 shadow-sm">
          当前环境已关闭 V2 到货入口。原有点货、订货和历史记录不受影响。
        </div>
      </PageShell>
    );
  }

  if (!canOperateV2Modules(auth.profile?.role)) {
    return (
      <PageShell eyebrow="V2 角色边界" title="当前账号不能执行到货上报" backTo="/app">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm leading-6 text-slate-600">
            到货上报的门店执行端仅向员工和店长开放。管理员将在独立的到货中心查看消息、记录和每日汇总。
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell eyebrow="StoreHub V2" title="到货上报" backTo="/app">
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <PackageCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">入口和角色边界已启用</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              当前门店：{auth.store?.name ?? '未识别门店'}。员工和店长共用此 V2 执行入口，原有点货、订货页面与权限保持不变。
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <h2 className="font-bold text-amber-950">数据库基础已准备，提交界面尚未开放</h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              到货表、私有图片策略和受控提交 RPC 已完成代码设计；草稿服务、图片处理和提交表单将在下一阶段接入并完成真实 RLS 验证。本页没有假数据、上传按钮或空提交操作。
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
