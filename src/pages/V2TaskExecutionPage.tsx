import { Camera, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import type { Json } from '../types/database';
import { asTaskItemSnapshot, loadV2TaskDetail, saveV2TaskProgress, submitV2Task, uploadV2TaskImage, type V2TaskAnswerRow, type V2TaskDetail } from '../services/v2-tasks.service';

export function V2TaskExecutionPage() {
  const { taskId = '' } = useParams(); const auth = useAuth(); const navigate = useNavigate();
  const [detail, setDetail] = useState<V2TaskDetail | null>(null); const [answers, setAnswers] = useState<V2TaskAnswerRow[]>([]);
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false); const dirty = useRef(false);
  const load = useCallback(async () => { if (!supabase) return; try { const next=await loadV2TaskDetail(supabase,taskId); setDetail(next); setAnswers(next.answers); setMessage(null); } catch(e){setMessage(e instanceof Error?e.message:'加载任务失败');}},[taskId]);
  useEffect(()=>{void load();},[load]);
  const editable = detail ? ['pending','in_progress','rejected','overdue'].includes(detail.task.status) : false;
  const progress = useMemo(()=>answers.length ? Math.round(answers.filter(a=>a.answer!==null).length/answers.length*100):0,[answers]);
  const update=(id:string,answer:Json)=>{dirty.current=true;setAnswers(current=>current.map(a=>a.item_id===id?{...a,answer}:a));};
  const save=async()=>{if(!supabase||!detail||!dirty.current)return detail?.task;setBusy(true);try{const task=await saveV2TaskProgress(supabase,detail.task.id,detail.task.version,answers);dirty.current=false;setDetail({...detail,task});setMessage('已保存');return task;}catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}};
  // The timer is intentionally restarted only when answer data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!editable||!dirty.current)return;const timer=setTimeout(()=>void save(),800);return()=>clearTimeout(timer);},[answers,editable]);
  const submit=async()=>{if(!supabase||!detail)return;setBusy(true);try{const saved=await save();await submitV2Task(supabase,detail.task.id,saved?.version??detail.task.version);navigate('/app/tasks');}catch(e){setMessage(e instanceof Error?e.message:'提交失败');}finally{setBusy(false);}};
  const upload=async(itemId:string,file:File|undefined)=>{if(!file||!supabase||!detail||!auth.profile)return;setBusy(true);try{await uploadV2TaskImage(supabase,detail.task,itemId,auth.profile.id,file);await load();}catch(e){setMessage(e instanceof Error?e.message:'图片上传失败');}finally{setBusy(false);}};
  return <PageShell eyebrow="StoreHub V2 · 任务执行" title={detail?.task.name??'任务'} backTo="/app/tasks">
    {detail?<><section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex justify-between text-sm"><span>截止：{new Date(detail.task.due_at).toLocaleString('zh-CN')}</span><b>{progress}%</b></div><div className="mt-2 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-600" style={{width:`${progress}%`}}/></div>{detail.task.status==='rejected'?<p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">退回原因：{detail.task.review_note}</p>:null}</section>
    {message?<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</p>:null}
    <div className="space-y-3">{answers.map(a=><AnswerCard answer={a} editable={editable} imageCount={detail.images.filter(i=>i.item_id===a.item_id).length} key={a.id} onChange={v=>update(a.item_id,v)} onUpload={f=>void upload(a.item_id,f)}/>)}</div>
    {editable?<div className="grid grid-cols-2 gap-3 rounded-lg bg-white p-4 shadow-sm"><button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border font-bold" disabled={busy} onClick={()=>void save()}><Save className="h-5 w-5"/>保存</button><button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 font-bold text-white" disabled={busy} onClick={()=>void submit()}><Send className="h-5 w-5"/>提交检查</button></div>:null}</>:<p className="rounded-lg bg-white p-5">正在加载任务</p>}
  </PageShell>;
}

function AnswerCard({answer,editable,imageCount,onChange,onUpload}:{answer:V2TaskAnswerRow;editable:boolean;imageCount:number;onChange:(v:Json)=>void;onUpload:(f:File|undefined)=>void}){
 const item=asTaskItemSnapshot(answer.item_snapshot);const options=Array.isArray(item.options)?item.options.filter((v):v is string=>typeof v==='string'):[];const value=answer.answer;
 return <article className="rounded-lg bg-white p-4 shadow-sm"><h2 className="font-bold">{item.label}{item.is_required?' *':''}</h2>{item.guidance?<p className="mt-1 text-sm text-slate-500">{item.guidance}</p>:null}<div className="mt-3">
 {item.field_type==='instruction'?<p className="rounded bg-slate-50 p-3 text-sm">请按说明完成本项。</p>:null}
 {['short_text','long_text'].includes(item.field_type)?<textarea className="min-h-12 w-full rounded-lg border p-3" disabled={!editable} onChange={e=>onChange(e.target.value)} value={typeof value==='string'?value:''}/>:null}
 {['integer','decimal','rating'].includes(item.field_type)?<input className="min-h-12 w-full rounded-lg border p-3" disabled={!editable} onChange={e=>onChange(e.target.value===''?null:Number(e.target.value))} type="number" value={typeof value==='number'?value:''}/>:null}
 {['boolean','confirmation'].includes(item.field_type)?<label className="flex min-h-12 items-center gap-3"><input checked={value===true} disabled={!editable} onChange={e=>onChange(e.target.checked)} type="checkbox"/>确认完成</label>:null}
 {item.field_type==='single_choice'?<select className="min-h-12 w-full rounded-lg border px-3" disabled={!editable} onChange={e=>onChange(e.target.value)} value={typeof value==='string'?value:''}><option value="">请选择</option>{options.map(o=><option key={o}>{o}</option>)}</select>:null}
 {item.field_type==='multi_choice'?<div>{options.map(o=><label className="mr-4 inline-flex gap-2" key={o}><input checked={Array.isArray(value)&&value.includes(o)} disabled={!editable} onChange={e=>{const list=Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'):[];onChange(e.target.checked?[...list,o]:list.filter(v=>v!==o));}} type="checkbox"/>{o}</label>)}</div>:null}
 {['image','multi_image'].includes(item.field_type)||item.image_requirement!=='none'?<label className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-bold"><Camera className="h-4 w-4"/>{imageCount} 张<input accept="image/*" capture="environment" className="hidden" disabled={!editable} onChange={e=>onUpload(e.target.files?.[0])} type="file"/></label>:null}
 </div></article>;
}
