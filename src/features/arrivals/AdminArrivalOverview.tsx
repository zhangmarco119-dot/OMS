import { Bell, ChevronRight, PackageCheck, RefreshCw, Store, Tags } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { formatTimestamp } from './adminArrivalFormat';
import { supabase } from '../../lib/supabase';
import {
  loadAdminArrivalDashboard,
  markAdminArrivalViewed,
  type AdminArrivalDashboardData,
  type AdminArrivalMessage,
} from '../../services/admin-arrivals.service';

export function AdminArrivalOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminArrivalDashboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) { setMessage('需要配置 Supabase 才能加载到货数据。'); setLoading(false); return; }
    setLoading(true);
    try { setData(await loadAdminArrivalDashboard(supabase)); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : '加载到货概览失败。'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openMessage = async (entry: AdminArrivalMessage) => {
    if (!supabase) return;
    try {
      await markAdminArrivalViewed(supabase, entry.report.id);
      navigate(`/app/admin/arrivals/${entry.report.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '打开到货消息失败。');
    }
  };

  return <section className="space-y-4" aria-labelledby="admin-arrival-title">
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-brand-700">StoreHub V2</p><h2 className="mt-1 text-lg font-bold text-slate-900" id="admin-arrival-title">今日到货</h2></div><button aria-label="刷新到货概览" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></div>
    {message ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p> : null}
    {loading ? <p className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-600 shadow-sm">正在加载今日到货</p> : null}
    {data ? <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric icon={PackageCheck} label="今日上报" value={data.metrics.reportCount} />
        <Metric attention icon={Bell} label="未读消息" value={data.metrics.unreadCount} />
        <Metric icon={Store} label="到货门店" value={data.metrics.storeCount} />
        <Metric icon={Tags} label="产品种类" value={data.metrics.productCount} />
      </div>
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">最新未读到货</h3><p className="text-sm text-slate-500">点击后标记查看并进入详情</p></div><Link className="font-bold text-brand-700" to="/app/admin/arrivals">全部</Link></div>
        {data.messages.length ? <div className="mt-3 space-y-2">{data.messages.slice(0, 3).map((entry) => <button className="flex w-full items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-left" key={entry.notification.id} onClick={() => void openMessage(entry)} type="button">{entry.thumbnailUrl ? <img alt="面单缩略图" className="h-12 w-12 shrink-0 rounded-md object-cover" src={entry.thumbnailUrl} /> : <div className="h-12 w-12 shrink-0 rounded-md bg-white" />}<span className="min-w-0 flex-1"><span className="block text-xs font-bold text-amber-800">{entry.report.store_name_snapshot}</span><span className="block truncate font-semibold text-slate-900">{entry.report.generated_summary}</span><span className="block text-xs text-slate-500">{formatTimestamp(entry.report.submitted_at)}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-slate-400" /></button>)}</div> : <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无未读到货消息。</p>}
      </div>
    </> : null}
  </section>;
}

function Metric({ attention = false, icon: Icon, label, value }: { attention?: boolean; icon: typeof Bell; label: string; value: number }) {
  return <div className={`rounded-lg p-4 shadow-sm ${attention && value > 0 ? 'bg-amber-500 text-white' : 'bg-white text-slate-900'}`}><Icon className={`h-5 w-5 ${attention && value > 0 ? 'text-white' : 'text-brand-700'}`} /><p className={`mt-3 text-xs font-semibold ${attention && value > 0 ? 'text-white/85' : 'text-slate-500'}`}>{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>;
}
