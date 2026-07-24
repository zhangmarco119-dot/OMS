import { Building2, Download, Edit3, Plus, ReceiptText, RefreshCw, Save, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ActionFeedbackDialog, type ActionFeedbackTone } from '../components/feedback/ActionFeedbackDialog';
import { MonthPicker } from '../components/forms/MonthPicker';
import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { FormField, SegmentedControl } from '../components/ui/FormField';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { downloadTaxCardImage } from '../features/tax-accounting/taxCardImage';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import {
  loadTaxAccountingData,
  saveTaxMonthlySalary,
  saveTaxPerson,
  saveTaxStoreCompanyName,
  type SaveTaxPersonInput,
  type TaxAccountingData,
  type TaxPerson,
} from '../services/tax-accounting.service';

type Tab = 'reports' | 'people' | 'accounting';
type Feedback = { message: string; title: string; tone: ActionFeedbackTone };
type SalaryMode = 'system' | 'manual';
type PersonEditor = SaveTaxPersonInput & {
  manualSalary: string;
  salaryMode: SalaryMode;
};

const currentMonth = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
}).format(new Date());
const money = (value: number | null | undefined) => value == null ? '待填写' : `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const roleLabel = (role: string, employmentType: string) => employmentType === 'part_time' ? '兼职' : role === 'manager' ? '店长' : '员工';
const realTimeSalaryAmount = (data: TaxAccountingData | null, profileId: string | null) => {
  const estimate = profileId
    ? data?.estimates.find((item) => item.profileId === profileId)
    : null;
  return estimate?.estimatedPayable ?? estimate?.knownEstimatedPayable ?? null;
};
const emptyEditor = (): PersonEditor => ({
  fullName: '',
  idNumber: '',
  isActive: true,
  manualSalary: '',
  phone: '',
  profileId: null,
  reportingStoreId: null,
  salaryMode: 'manual',
});

export function AdminTaxAccountingPage() {
  const auth = useAuth();
  const [tab, setTab] = useRememberedPageState<Tab>('tab', 'reports');
  const [month, setMonth] = useRememberedPageState('month', currentMonth());
  const [data, setData] = useState<TaxAccountingData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [editor, setEditor] = useState<PersonEditor | null>(null);
  const [busy, setBusy] = useState('');
  const [companyInputs, setCompanyInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!supabase) return;
    setStatus('loading');
    try {
      const next = await loadTaxAccountingData(supabase, month);
      const settings = new Map(next.storeSettings.map((item) => [item.store_id, item.company_name]));
      setData(next);
      setCompanyInputs(Object.fromEntries(next.stores.map((store) => [store.id, settings.get(store.id) ?? store.name])));
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setFeedback({ title: '暂时无法加载', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const profileById = useMemo(() => new Map(data?.profiles.map((item) => [item.id, item]) ?? []), [data]);
  const storeById = useMemo(() => new Map(data?.stores.map((item) => [item.id, item]) ?? []), [data]);
  const estimateByProfile = useMemo(() => new Map(data?.estimates.map((item) => [item.profileId, item]) ?? []), [data]);
  const manualByPerson = useMemo(() => new Map(data?.monthlySalaries.map((item) => [item.person_id, item]) ?? []), [data]);

  const editPerson = (person: TaxPerson) => {
    const manual = manualByPerson.get(person.id)?.manual_amount;
    const systemAmount = realTimeSalaryAmount(data, person.profile_id);
    setEditor({
      fullName: person.full_name,
      id: person.id,
      idNumber: person.id_number,
      isActive: person.is_active,
      manualSalary: manual == null ? '' : String(manual),
      phone: person.phone,
      profileId: person.profile_id,
      reportingStoreId: person.reporting_store_id,
      salaryMode: manual == null && systemAmount != null ? 'system' : 'manual',
    });
  };

  const submitPerson = async () => {
    if (!supabase || !auth.profile || !editor) return;
    if (!editor.fullName.trim()) {
      setFeedback({ title: '请填写姓名', message: '报税人员姓名不能为空。', tone: 'warning' });
      return;
    }
    if (!/^\d{17}[\dXx]$/.test(editor.idNumber.trim())) {
      setFeedback({ title: '身份证号格式不正确', message: '请输入18位身份证号，末位可以是数字或 X。', tone: 'warning' });
      return;
    }
    if (!/^1\d{10}$/.test(editor.phone.trim())) {
      setFeedback({ title: '手机号格式不正确', message: '请输入11位中国大陆手机号。', tone: 'warning' });
      return;
    }
    const manualAmount = Number(editor.manualSalary);
    if (editor.salaryMode === 'manual' && (!editor.manualSalary.trim() || !Number.isFinite(manualAmount) || manualAmount < 0)) {
      setFeedback({ title: '请填写有效薪资', message: '手动薪资应为大于或等于0的数字。', tone: 'warning' });
      return;
    }
    setBusy('person');
    try {
      const savedPerson = await saveTaxPerson(supabase, auth.profile.id, editor);
      await saveTaxMonthlySalary(
        supabase,
        auth.profile.id,
        savedPerson.id,
        month,
        editor.salaryMode === 'manual' ? manualAmount : null,
      );
      setEditor(null);
      await load();
      setFeedback({ title: '人员资料已保存', message: '报税归属、身份资料和本月薪资来源已更新。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '保存失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally {
      setBusy('');
    }
  };

  const saveCompanyName = async (storeId: string) => {
    if (!supabase || !auth.profile) return;
    setBusy(`company:${storeId}`);
    try {
      await saveTaxStoreCompanyName(supabase, auth.profile.id, storeId, companyInputs[storeId] ?? '');
      await load();
      setFeedback({ title: '公司名称已保存', message: '下载的员工个税申报卡片会使用新的公司名称。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '保存失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally {
      setBusy('');
    }
  };

  const download = async (reportIndex: number) => {
    const report = data?.taxReports[reportIndex];
    if (!report) return;
    setBusy(`download:${report.store.id}`);
    try {
      await downloadTaxCardImage(report, month);
      setFeedback({ title: '个税申报卡片已下载', message: '图片已保存，可直接发送给会计。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '无法下载', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' });
    } finally {
      setBusy('');
    }
  };

  return (
    <PageShell backTo="/app/workbench" contentGapClassName="gap-3" eyebrow="门店运营系统 · 管理员" title="税务与记账">
      <SegmentedControl className="grid-cols-3" items={[
        { active: tab === 'reports', label: '报税信息', onClick: () => setTab('reports') },
        { active: tab === 'people', label: '人员登记', onClick: () => setTab('people') },
        { active: tab === 'accounting', label: '记账信息', onClick: () => setTab('accounting') },
      ]} />
      <SectionCard className="p-3">
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <MonthPicker label="统计月份" onChange={setMonth} value={month} />
          <button aria-label="刷新统计" className="ui-icon-button mb-0.5" disabled={status === 'loading'} onClick={() => void load()} type="button">
            <RefreshCw className={`h-5 w-5 ${status === 'loading' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </SectionCard>

      {status === 'loading' ? <LoadingState label="正在汇总税务和工资成本" /> : null}
      {status === 'error' ? <ErrorState message="税务与记账信息暂时无法加载。" onRetry={() => void load()} /> : null}

      {status === 'ready' && data && tab === 'reports' ? (
        <section className="space-y-3">
          {!data.taxReports.length ? <EmptyState title="暂无报税人员" description="请先到“人员登记”中添加人员并选择报税门店。" /> : null}
          {data.taxReports.map((report, reportIndex) => (
            <SectionCard className="overflow-hidden p-0" key={report.store.id}>
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
                <SectionHeader icon={ReceiptText} title={report.companyName} description={`${report.store.name} · ${month.replace('-', '年')}月 · ${report.rows.length}人 · 合计 ${money(report.total)}`} />
                <button className="ui-button-secondary min-h-9 shrink-0 px-3 py-2 text-xs" disabled={busy === `download:${report.store.id}`} onClick={() => void download(reportIndex)} type="button">
                  <Download className="h-4 w-4" />下载图片
                </button>
              </div>
              <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-[1fr_auto]">
                <FormField label="公司名称"><input className="ui-input" maxLength={100} onChange={(event) => setCompanyInputs((current) => ({ ...current, [report.store.id]: event.target.value }))} value={companyInputs[report.store.id] ?? report.companyName} /></FormField>
                <button className="ui-button-primary self-end" disabled={busy === `company:${report.store.id}`} onClick={() => void saveCompanyName(report.store.id)} type="button"><Save className="h-4 w-4" />保存名称</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">姓名</th><th className="px-4 py-3">薪资</th><th className="px-4 py-3">身份证号</th><th className="px-4 py-3">手机号</th><th className="px-4 py-3">来源</th></tr></thead>
                  <tbody>{report.rows.map((row) => <tr className="border-t border-slate-100" key={row.personId}><td className="px-4 py-3 font-semibold">{row.fullName}</td><td className={`px-4 py-3 font-bold ${row.amount == null ? 'text-red-600' : ''}`}>{money(row.amount)}</td><td className="px-4 py-3 tabular-nums">{row.idNumber}</td><td className="px-4 py-3 tabular-nums">{row.phone}</td><td className="px-4 py-3"><StatusBadge tone={row.salarySource === 'missing' ? 'danger' : row.salarySource === 'manual' ? 'warning' : 'success'}>{row.salarySource === 'manual' ? '手动填写' : row.salarySource === 'system' ? '系统实时工资' : '待填写'}</StatusBadge></td></tr>)}</tbody>
                </table>
              </div>
            </SectionCard>
          ))}
        </section>
      ) : null}

      {status === 'ready' && data && tab === 'people' ? (
        <section className="space-y-3">
          <button className="ui-button-primary w-full" onClick={() => setEditor(emptyEditor())} type="button"><Plus className="h-4 w-4" />新增报税人员</button>
          {data.people.map((person) => {
            const profile = person.profile_id ? profileById.get(person.profile_id) : null;
            const estimate = person.profile_id ? estimateByProfile.get(person.profile_id) : null;
            const monthly = manualByPerson.get(person.id);
            return <SectionCard className={!person.is_active ? 'opacity-60' : ''} key={person.id}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><b>{person.full_name}</b><p className="mt-1 text-xs text-slate-500">{profile ? `已关联：${profile.display_name} · ${roleLabel(profile.role, profile.employment_type)}` : '未关联系统账号'} · {person.reporting_store_id ? storeById.get(person.reporting_store_id)?.name ?? '未知门店' : '不计入报税'}</p><p className="mt-1 text-xs text-slate-500">{month.replace('-', '年')}月薪资：{monthly?.manual_amount != null ? `手动 ${money(monthly.manual_amount)}` : person.profile_id ? `系统实时工资 ${money(estimate?.estimatedPayable ?? estimate?.knownEstimatedPayable)}` : '待填写'}</p></div><button className="ui-button-secondary min-h-8 px-2 py-1 text-xs" onClick={() => editPerson(person)} type="button"><Edit3 className="h-3.5 w-3.5" />编辑</button></div>
            </SectionCard>;
          })}
        </section>
      ) : null}

      {status === 'ready' && data && tab === 'accounting' ? (
        <section className="space-y-3">
          <SectionCard className="bg-brand-50/50">
            <SectionHeader icon={Building2} title="门店实际工资成本" description="全职人员按有效出勤天数分摊基本薪资，已审批加班按实际门店计入；兼职薪资按各门店已审批工时分摊。" />
          </SectionCard>
          {data.allocations.map((allocation) => (
            <SectionCard key={allocation.storeId}>
              <SectionHeader icon={Users} title={storeById.get(allocation.storeId)?.name ?? '未知门店'} description={`${allocation.employees.length}人 · 工资成本 ${money(allocation.amount)}`} />
              {allocation.employees.length ? <div className="mt-3 divide-y divide-slate-100">{allocation.employees.map((employee) => {
                const profile = profileById.get(employee.profileId);
                return <div className="grid grid-cols-[1fr_auto] gap-3 py-3 first:pt-0 last:pb-0" key={employee.profileId}><div><b className="text-sm">{profile?.display_name ?? data.payslips.find((item) => item.profile_id === employee.profileId)?.estimate.displayName ?? '未命名员工'}</b><p className="mt-1 text-xs text-slate-500">出勤 {employee.attendanceDays} 天 · 已审批{profile?.employment_type === 'part_time' ? '兼职' : '加班'} {employee.overtimeHours} 小时</p></div><b className="self-center tabular-nums text-brand-800">{money(employee.amount)}</b></div>;
              })}</div> : <p className="mt-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">本月该门店暂无可分摊工资记录。</p>}
            </SectionCard>
          ))}
          <SectionCard className="flex items-center justify-between gap-3"><span className="font-bold">全部门店工资成本合计</span><b className="text-xl tabular-nums text-brand-800">{money(data.allocations.reduce((sum, item) => sum + item.amount, 0))}</b></SectionCard>
        </section>
      ) : null}

      {editor && data ? (
        <div aria-labelledby="tax-person-editor-title" aria-modal="true" className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog">
          <div className="mx-auto max-w-2xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
            <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
              <div><p className="text-xs font-bold text-brand-700">人员登记</p><h2 className="text-xl font-bold" id="tax-person-editor-title">{editor.id ? '编辑人员资料' : '新增人员资料'}</h2></div>
              <button aria-label="关闭人员编辑" className="ui-icon-button" onClick={() => setEditor(null)} type="button"><X className="h-5 w-5" /></button>
            </header>
            <SectionCard>
              <SectionHeader icon={editor.id ? Edit3 : Plus} title="身份与报税归属" description="报税门店独立于账号所属门店；选择“不计入报税”即可暂时排除。" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <FormField label="关联账号（选填）"><select className="ui-input" onChange={(event) => {
                  const profileId = event.target.value || null;
                  const profile = profileId ? profileById.get(profileId) : null;
                  setEditor((current) => current ? {
                    ...current,
                    fullName: profile?.display_name || current.fullName,
                    profileId,
                    salaryMode: current.salaryMode === 'system' && !profileId ? 'manual' : current.salaryMode,
                  } : current);
                }} value={editor.profileId ?? ''}><option value="">无关联账号</option>{data.profiles.map((profile) => <option disabled={data.people.some((person) => person.profile_id === profile.id && person.id !== editor.id)} key={profile.id} value={profile.id}>{profile.display_name} · {roleLabel(profile.role, profile.employment_type)}</option>)}</select></FormField>
                <FormField label="报税归属门店"><select className="ui-input" onChange={(event) => setEditor((current) => current ? { ...current, reportingStoreId: event.target.value || null } : current)} value={editor.reportingStoreId ?? ''}><option value="">不计入报税</option>{data.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></FormField>
                <FormField label="姓名" required><input className="ui-input" onChange={(event) => setEditor((current) => current ? { ...current, fullName: event.target.value } : current)} value={editor.fullName} /></FormField>
                <FormField label="手机号" required><input className="ui-input" inputMode="tel" maxLength={11} onChange={(event) => setEditor((current) => current ? { ...current, phone: event.target.value.replace(/\D/g, '') } : current)} value={editor.phone} /></FormField>
                <FormField label="身份证号" required><input className="ui-input uppercase" maxLength={18} onChange={(event) => setEditor((current) => current ? { ...current, idNumber: event.target.value.replace(/[^0-9xX]/g, '') } : current)} value={editor.idNumber} /></FormField>
                <FormField label="人员状态"><select className="ui-input" onChange={(event) => setEditor((current) => current ? { ...current, isActive: event.target.value === 'active' } : current)} value={editor.isActive ? 'active' : 'inactive'}><option value="active">正常使用</option><option value="inactive">停用并保留历史</option></select></FormField>
              </div>
            </SectionCard>
            <SectionCard>
              <SectionHeader icon={ReceiptText} title={`${month.replace('-', '年')}月薪资来源`} description="选择系统工资后，金额会按当前所选月份的实时工资自动计算；没有关联账号时只能手动填写。" />
              <SegmentedControl className="mt-4 grid-cols-2" items={[
                { active: editor.salaryMode === 'system', disabled: !editor.profileId, label: `系统工资${editor.profileId ? '' : '（不可用）'}`, onClick: () => setEditor((current) => current ? { ...current, salaryMode: 'system' } : current) },
                { active: editor.salaryMode === 'manual', label: '手动填写', onClick: () => setEditor((current) => current ? { ...current, salaryMode: 'manual' } : current) },
              ]} />
              {editor.salaryMode === 'system' ? <div className="mt-3 rounded-xl bg-brand-50 p-4"><p className="text-xs font-bold text-brand-700">所选月份实时工资</p><p className="mt-1 text-xl font-bold text-brand-900">{money(realTimeSalaryAmount(data, editor.profileId))}</p></div> : <FormField label="本月申报薪资" required><input className="ui-input" inputMode="decimal" min="0" onChange={(event) => setEditor((current) => current ? { ...current, manualSalary: event.target.value } : current)} placeholder="请输入本月薪资" type="number" value={editor.manualSalary} /></FormField>}
            </SectionCard>
            <div className="grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => setEditor(null)} type="button">取消</button><button className="ui-button-primary" disabled={busy === 'person'} onClick={() => void submitPerson()} type="button"><Save className="h-4 w-4" />{busy === 'person' ? '正在保存' : '保存资料'}</button></div>
          </div>
        </div>
      ) : null}

      <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} />
    </PageShell>
  );
}
