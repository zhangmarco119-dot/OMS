import { CreditCard, Edit3, FileText, MapPin, Save, ShieldCheck, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ActionFeedbackDialog, type ActionFeedbackTone } from '../../components/feedback/ActionFeedbackDialog';
import { ProgressiveImage } from '../../components/ui/ProgressiveImage';
import { FormField } from '../../components/ui/FormField';
import { SectionCard, SectionHeader } from '../../components/ui/Surface';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  getEmployeeIdCardUrl,
  saveTaxPerson,
  uploadEmployeeIdCard,
  type TaxPerson,
} from '../../services/tax-accounting.service';
import type { AdminUserRow, StoreRow } from './adminUsersService';

type Feedback = { message: string; title: string; tone: ActionFeedbackTone };
type EmployeeEditor = {
  bankCardNumber: string;
  bankName: string;
  contactAddress: string;
  fullName: string;
  id: string;
  idCardImagePath: string | null;
  idNumber: string;
  isActive: boolean;
  phone: string;
  profileId: string;
  reportingStoreId: string | null;
};

const mask = (value: string | null, visible = 4) => {
  if (!value) return '未登记';
  if (value.length <= visible * 2) return value;
  return `${value.slice(0, visible)}${'*'.repeat(Math.max(value.length - visible * 2, 4))}${value.slice(-visible)}`;
};

const employeeRoleLabel = (user: AdminUserRow) => user.employment_type === 'part_time' ? '兼职' : user.role === 'manager' ? '店长' : '员工';

const toEditor = (user: AdminUserRow, person: TaxPerson | undefined): EmployeeEditor => ({
  bankCardNumber: person?.bank_card_number ?? '',
  bankName: person?.bank_name ?? '',
  contactAddress: person?.contact_address ?? '',
  fullName: user.display_name,
  id: person?.id ?? '',
  idCardImagePath: person?.id_card_image_path ?? null,
  idNumber: person?.id_number ?? '',
  isActive: person?.is_active ?? user.is_active,
  phone: person?.phone ?? '',
  profileId: user.id,
  reportingStoreId: person?.reporting_store_id ?? user.store_id,
});

export function EmployeeInformationManager({ stores, users }: { stores: StoreRow[]; users: AdminUserRow[] }) {
  const auth = useAuth();
  const [people, setPeople] = useState<TaxPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EmployeeEditor | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [imageState, setImageState] = useState<{ loading: boolean; src: string | null }>({ loading: false, src: null });

  const loadPeople = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from('tax_reporting_people').select('*').order('full_name');
    if (error) {
      setFeedback({ title: '员工档案加载失败', message: error.message || '请稍后重试。', tone: 'danger' });
    } else {
      setPeople(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadPeople(); }, [loadPeople]);

  useEffect(() => {
    let cancelled = false;
    if (!editor?.idCardImagePath || !supabase) {
      setImageState({ loading: false, src: null });
      return undefined;
    }
    setImageState({ loading: true, src: null });
    void getEmployeeIdCardUrl(supabase, editor.idCardImagePath)
      .then((src) => { if (!cancelled) setImageState({ loading: false, src }); })
      .catch(() => { if (!cancelled) setImageState({ loading: false, src: null }); });
    return () => { cancelled = true; };
  }, [editor?.idCardImagePath]);

  const personByProfile = useMemo(() => new Map(people.filter((person) => person.profile_id).map((person) => [person.profile_id!, person])), [people]);
  const employees = useMemo(() => users.filter((user) => user.role === 'staff' || user.role === 'manager'), [users]);

  const openEditor = (user: AdminUserRow) => {
    setSelectedFile(null);
    setEditor(toEditor(user, personByProfile.get(user.id)));
  };

  const save = async () => {
    if (!supabase || !auth.profile || !editor) return;
    const idNumber = editor.idNumber.trim();
    const phone = editor.phone.trim();
    const bankCard = editor.bankCardNumber.trim();
    if (idNumber && !/^\d{17}[\dXx]$/.test(idNumber)) {
      setFeedback({ title: '身份证号格式不正确', message: '请输入18位身份证号，末位可以是数字或 X。', tone: 'warning' });
      return;
    }
    if (phone && !/^1\d{10}$/.test(phone)) {
      setFeedback({ title: '手机号格式不正确', message: '请输入11位中国大陆手机号。', tone: 'warning' });
      return;
    }
    if (bankCard && !/^\d{12,30}$/.test(bankCard)) {
      setFeedback({ title: '银行卡号格式不正确', message: '请输入12至30位数字，不要包含空格。', tone: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveTaxPerson(supabase, auth.profile.id, {
        bankCardNumber: bankCard,
        bankName: editor.bankName,
        contactAddress: editor.contactAddress,
        fullName: editor.fullName,
        id: editor.id || undefined,
        idCardImagePath: editor.idCardImagePath,
        idNumber,
        isActive: editor.isActive,
        phone,
        profileId: editor.profileId,
        reportingStoreId: editor.reportingStoreId,
      });
      if (selectedFile) {
        const idCardImagePath = await uploadEmployeeIdCard(supabase, saved.id, selectedFile);
        await saveTaxPerson(supabase, auth.profile.id, {
          ...editor,
          id: saved.id,
          idCardImagePath,
          profileId: editor.profileId,
          reportingStoreId: editor.reportingStoreId,
        });
      }
      setEditor(null);
      setSelectedFile(null);
      await loadPeople();
      setFeedback({ title: '员工信息已保存', message: '员工管理与税务记账中的人员登记已同步更新。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '保存失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return <section className="space-y-3">
    <SectionCard className="border-brand-100 bg-brand-50/60">
      <SectionHeader icon={ShieldCheck} title="员工信息管理" description="这里与“税务与记账 · 人员登记”共用同一份员工档案；身份证、联系方式、住址、银行卡和身份证照片只对管理员开放。" />
    </SectionCard>
    {loading ? <p className="rounded-lg bg-white p-5 text-center text-sm text-slate-500 shadow-sm">正在加载员工档案…</p> : null}
    {!loading && !employees.length ? <p className="rounded-lg bg-white p-5 text-center text-sm text-slate-500 shadow-sm">暂无员工账号，请先在“账号管理”创建员工或店长账号。</p> : null}
    {!loading ? employees.map((user) => {
      const person = personByProfile.get(user.id);
      const complete = Boolean(person?.id_number && person.phone && person.contact_address && person.bank_card_number && person.bank_name && person.id_card_image_path);
      return <SectionCard key={user.id}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b>{user.display_name}</b><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${complete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{complete ? '信息完整' : '待补充'}</span></div><p className="mt-1 text-xs text-slate-500">{employeeRoleLabel(user)} · {user.username} · {user.storeName}</p><p className="mt-2 text-xs text-slate-600">身份证 {mask(person?.id_number ?? null)} · 手机 {mask(person?.phone ?? null, 3)} · 银行卡 {mask(person?.bank_card_number ?? null)}</p></div>
          <button className="ui-button-secondary min-h-9 shrink-0 px-3 text-xs" onClick={() => openEditor(user)} type="button"><Edit3 className="h-3.5 w-3.5" />{person ? '编辑' : '登记'}</button>
        </div>
      </SectionCard>;
    }) : null}

    {editor ? <div aria-labelledby="employee-information-editor-title" aria-modal="true" className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog">
      <div className="mx-auto max-w-2xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
        <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5"><div><p className="text-xs font-bold text-brand-700">员工管理</p><h2 className="text-xl font-bold" id="employee-information-editor-title">{editor.fullName}的员工信息</h2></div><button aria-label="关闭员工信息编辑" className="ui-icon-button" onClick={() => setEditor(null)} type="button"><X className="h-5 w-5" /></button></header>
        <SectionCard><SectionHeader icon={FileText} title="身份与联系方式" description="证件资料仅限管理员查看，并会同步显示在税务与记账的人员登记中。" /><div className="mt-4 grid gap-3 sm:grid-cols-2">
          <FormField label="姓名"><input className="ui-input" disabled value={editor.fullName} /></FormField>
          <FormField label="手机号"><input className="ui-input" inputMode="tel" maxLength={11} onChange={(event) => setEditor((current) => current ? { ...current, phone: event.target.value.replace(/\D/g, '') } : current)} value={editor.phone} /></FormField>
          <FormField label="身份证号"><input className="ui-input uppercase" maxLength={18} onChange={(event) => setEditor((current) => current ? { ...current, idNumber: event.target.value.replace(/[^0-9xX]/g, '') } : current)} value={editor.idNumber} /></FormField>
          <FormField label="报税归属门店"><select className="ui-input" onChange={(event) => setEditor((current) => current ? { ...current, reportingStoreId: event.target.value || null } : current)} value={editor.reportingStoreId ?? ''}><option value="">暂不计入报税</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></FormField>
          <div className="sm:col-span-2"><FormField label="联系地址"><textarea className="ui-input min-h-20" maxLength={300} onChange={(event) => setEditor((current) => current ? { ...current, contactAddress: event.target.value } : current)} value={editor.contactAddress} /></FormField></div>
        </div></SectionCard>
        <SectionCard><SectionHeader icon={CreditCard} title="收款银行卡" description="用于管理员核对工资发放资料。" /><div className="mt-4 grid gap-3 sm:grid-cols-2"><FormField label="银行卡号"><input className="ui-input" inputMode="numeric" maxLength={30} onChange={(event) => setEditor((current) => current ? { ...current, bankCardNumber: event.target.value.replace(/\D/g, '') } : current)} value={editor.bankCardNumber} /></FormField><FormField label="开户行"><input className="ui-input" maxLength={200} onChange={(event) => setEditor((current) => current ? { ...current, bankName: event.target.value } : current)} value={editor.bankName} /></FormField></div></SectionCard>
        <SectionCard><SectionHeader icon={MapPin} title="身份证照片" description="支持 JPG、PNG、WEBP，最大 10MB。" /><div className="mt-4 space-y-3">{editor.idCardImagePath ? <ProgressiveImage alt={`${editor.fullName}的身份证照片`} className="h-auto w-full object-contain" containerClassName="min-h-40 rounded-xl border border-slate-200" resourceLoading={imageState.loading} src={imageState.src} /> : <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">尚未上传身份证照片</p>}<label className="ui-button-secondary w-full cursor-pointer"><Upload className="h-4 w-4" />{selectedFile ? `已选择：${selectedFile.name}` : '选择身份证照片'}<input accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} type="file" /></label></div></SectionCard>
        <div className="grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => setEditor(null)} type="button">取消</button><button className="ui-button-primary" disabled={saving} onClick={() => void save()} type="button"><Save className="h-4 w-4" />{saving ? '正在保存' : '保存员工信息'}</button></div>
      </div>
    </div> : null}
    <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} />
  </section>;
}
