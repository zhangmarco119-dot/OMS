import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadManagerStoreStaff, managerCreatePayrollPenalty, uploadPayrollEvidence } from '../services/payroll.service';

type PenaltyLevel = 'reminder' | 'warning' | 'formal_warning' | 'serious';

const penaltyLevels: Array<{ label: string; value: PenaltyLevel; defaultDeduction: number }> = [
  { label: '提醒', value: 'reminder', defaultDeduction: 0 },
  { label: '警告', value: 'warning', defaultDeduction: 3 },
  { label: '正式警告', value: 'formal_warning', defaultDeduction: 5 },
  { label: '严重违规', value: 'serious', defaultDeduction: 10 },
];

export function ManagerEmployeeManagementPage() {
  const auth = useAuth();
  const [employees, setEmployees] = useState<Array<{ id: string; display_name: string; store_id: string; is_active: boolean }>>([]);
  const [profileId, setProfileId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [level, setLevel] = useState<PenaltyLevel>('warning');
  const [deduction, setDeduction] = useState('3');
  const [amount, setAmount] = useState('0');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    try {
      setEmployees(await loadManagerStoreStaff(supabase, auth.availableStores.map((store) => store.id)));
    } catch {
      setMessage('无法加载本店员工。');
    }
  }, [auth.profile, auth.availableStores]);

  useEffect(() => { void load(); }, [load]);

  const changeLevel = (next: PenaltyLevel) => {
    setLevel(next);
    setDeduction(String(penaltyLevels.find((item) => item.value === next)?.defaultDeduction ?? 0));
  };

  const submit = async () => {
    if (!supabase || !auth.profile || !profileId || !reason.trim()) {
      setMessage('请选择员工并填写处罚原因。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const penalty = await managerCreatePayrollPenalty(supabase, {
        profileId,
        eventDate: date,
        reason: reason.trim(),
        amount: Number(amount) || 0,
        eventLevel: level,
        performanceDeduction: Number(deduction) || 0,
      });
      const failed: string[] = [];
      for (const file of files) {
        try {
          await uploadPayrollEvidence(supabase, { file, ownerId: auth.profile.id, entityId: penalty.id });
        } catch {
          failed.push(file.name);
        }
      }
      setReason('');
      setFiles([]);
      setMessage(failed.length ? `罚单已发布，但 ${failed.length} 张说明图片上传失败。` : '罚单已发布，已通知员工和管理员。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发布失败。');
    } finally {
      setBusy(false);
    }
  };

  if (auth.profile?.role !== 'manager') {
    return <PageShell eyebrow="账号权限" title="员工管理" backTo="/app/workbench"><div className="rounded-lg bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">员工管理仅向店长开放。</p></div></PageShell>;
  }

  return <PageShell eyebrow="门店运营系统 · 店长" title="员工管理" backTo="/app/workbench" contentGapClassName="gap-3">
    <SectionCard>
      <SectionHeader title="给员工开罚单" description="罚单会同步到员工薪资与管理员后台。" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">员工
          <select className="ui-input mt-1" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">请选择员工</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">事件日期<input className="ui-input mt-1" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-sm font-semibold text-slate-700">事件等级
          <select className="ui-input mt-1" value={level} onChange={(event) => changeLevel(event.target.value as PenaltyLevel)}>
            {penaltyLevels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">绩效扣分<input className="ui-input mt-1" inputMode="decimal" type="number" value={deduction} onChange={(event) => setDeduction(event.target.value)} /></label>
        <label className="text-sm font-semibold text-slate-700">罚款金额<input className="ui-input mt-1" inputMode="decimal" min="0" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      </div>
      <label className="mt-2 block text-sm font-semibold text-slate-700">处罚原因<textarea className="ui-input mt-1 min-h-20 py-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请填写具体原因" /></label>
      <label className="mt-2 block text-sm font-semibold text-slate-700">说明图片<input className="mt-1" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
      <button className="mt-3 min-h-11 rounded-lg bg-brand-600 px-4 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void submit()} type="button">{busy ? '正在发布' : '发布罚单'}</button>
      {message ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{message}</p> : null}
    </SectionCard>
  </PageShell>;
}
