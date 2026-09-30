import { Camera, ImagePlus, PackagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ImageViewer } from '../components/ui/ImageViewer';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { ProgressiveImage } from '../components/ui/ProgressiveImage';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  PRODUCT_REGISTRATION_TYPES,
  createProductRegistrationEntry,
  deleteProductRegistrationEntry,
  deleteProductRegistrationImage,
  isProductRegistrationType,
  loadProductRegistrationEntries,
  loadProductRegistrationImageUrls,
  loadRegistrationProducts,
  updateProductRegistrationEntry,
  uploadProductRegistrationImage,
  type ProductRegistrationEntry,
  type ProductRegistrationImage,
  type ProductRegistrationType,
  type RegistrationProduct,
} from '../services/product-registration.service';

type EntryPatch = Pick<ProductRegistrationEntry, 'product_id' | 'product_name' | 'quantity' | 'unit'>;

const isXizhimen = (name?: string) => Boolean(name?.includes('西直门'));
const complete = (entry: ProductRegistrationEntry) => Boolean(entry.product_name.trim() && entry.quantity !== null && entry.unit.trim() && entry.images.length > 0);

export function ProductRegistrationPage({ adminView = false }: { adminView?: boolean }) {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const type = isProductRegistrationType(params.get('type')) ? params.get('type') as ProductRegistrationType : 'packaging';
  const store = useMemo(() => adminView
    ? auth.availableStores.find((item) => isXizhimen(item.name)) ?? null
    : isXizhimen(auth.store?.name) ? auth.store : null, [adminView, auth.availableStores, auth.store]);
  const [entries, setEntries] = useState<ProductRegistrationEntry[]>([]);
  const [products, setProducts] = useState<RegistrationProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const saveQueues = useRef<Record<string, Promise<void>>>({});

  const resolveImageUrls = useCallback((nextEntries: ProductRegistrationEntry[]) => {
    const client = supabase;
    if (!client) return;
    const images = nextEntries.flatMap((entry) => entry.images);
    setImagesLoading(images.length > 0);
    if (!images.length) return;
    void loadProductRegistrationImageUrls(client, images).then((urls) => {
      setEntries((current) => current.map((entry) => ({
        ...entry,
        images: entry.images.map((image) => ({ ...image, signedUrl: urls[image.id] ?? image.signedUrl })),
      })));
    }).catch(() => undefined).finally(() => setImagesLoading(false));
  }, []);

  const reload = useCallback(async () => {
    const client = supabase;
    if (!client || !store || !auth.profile) { setLoading(false); return; }
    setLoading(true); setMessage('');
    try {
      const [nextEntries, nextProducts] = await Promise.all([
        loadProductRegistrationEntries(client, store.id, adminView ? undefined : auth.profile.id),
        loadRegistrationProducts(client, store.id),
      ]);
      setEntries(nextEntries); setProducts(nextProducts); resolveImageUrls(nextEntries);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '货品登记加载失败。');
    } finally { setLoading(false); }
  }, [adminView, auth.profile, resolveImageUrls, store]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const client = supabase;
    if (!client || !store) return undefined;
    const channel = client.channel(`product-registration:${store.id}:${adminView ? 'admin' : auth.profile?.id ?? 'staff'}`)
      .on('postgres_changes', { event: '*', filter: `store_id=eq.${store.id}`, schema: 'public', table: 'product_registration_entries' }, () => void reload())
      .on('postgres_changes', { event: '*', filter: `store_id=eq.${store.id}`, schema: 'public', table: 'product_registration_images' }, () => void reload())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [adminView, auth.profile?.id, reload, store]);

  const updateEntry = (entryId: string, patch: Partial<EntryPatch>) => {
    const client = supabase;
    if (!client || adminView) return;
    setEntries((current) => current.map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry));
    setSavingIds((current) => current.includes(entryId) ? current : [...current, entryId]);
    const previous = saveQueues.current[entryId] ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => { await updateProductRegistrationEntry(client, entryId, patch); });
    saveQueues.current[entryId] = queued;
    void queued.catch((error) => setMessage(error instanceof Error ? error.message : '自动保存失败，请检查网络后重试。')).finally(() => {
      if (saveQueues.current[entryId] !== queued) return;
      setSavingIds((current) => current.filter((id) => id !== entryId));
    });
  };

  const addEntry = async () => {
    if (!supabase || !store || !auth.profile || adminView) return;
    setMessage('');
    try {
      const created = await createProductRegistrationEntry(supabase, { creatorId: auth.profile.id, storeId: store.id, type });
      setEntries((current) => [{ ...created, creatorName: auth.profile?.display_name ?? '我' }, ...current]);
    } catch (error) { setMessage(error instanceof Error ? error.message : '新增登记条目失败。'); }
  };

  const removeEntry = async (entry: ProductRegistrationEntry) => {
    if (!supabase || adminView || !window.confirm(`确认删除“${entry.product_name || '未命名货品'}”这条登记吗？`)) return;
    setSavingIds((current) => current.includes(entry.id) ? current : [...current, entry.id]);
    try {
      await deleteProductRegistrationEntry(supabase, entry);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
    } catch (error) { setMessage(error instanceof Error ? error.message : '删除登记条目失败。'); }
    finally { setSavingIds((current) => current.filter((id) => id !== entry.id)); }
  };

  const uploadImage = async (entry: ProductRegistrationEntry, file: File, onProgress: (value: number) => void) => {
    if (!supabase || !store || !auth.profile) return;
    const image = await uploadProductRegistrationImage(supabase, { entryId: entry.id, file, profileId: auth.profile.id, storeId: store.id }, onProgress);
    setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, images: [...item.images, image] } : item));
  };

  const removeImage = async (entryId: string, image: ProductRegistrationImage) => {
    if (!supabase || adminView || !window.confirm('确认删除这张图片吗？')) return;
    try {
      await deleteProductRegistrationImage(supabase, image);
      setEntries((current) => current.map((entry) => entry.id === entryId ? { ...entry, images: entry.images.filter((item) => item.id !== image.id) } : entry));
    } catch (error) { setMessage(error instanceof Error ? error.message : '删除图片失败，请重试。'); }
  };

  const visibleEntries = entries.filter((entry) => entry.registration_type === type);
  const tabTitle = PRODUCT_REGISTRATION_TYPES.find((item) => item.key === type)?.label ?? '货品登记';
  if (!store) return <PageShell backTo="/app/workbench" eyebrow="门店运营系统" title="货品登记"><EmptyState title="当前账号未关联西直门店" description={adminView ? '管理员需要具备西直门店访问权限后才可以查看员工登记。' : '货品登记目前只开放给西直门员工和店长。'} /></PageShell>;
  return <PageShell backTo="/app/workbench" eyebrow={`门店运营系统 · ${store.name}`} title={adminView ? '货品登记查看' : '货品登记'} contentGapClassName="gap-3">
    <nav aria-label="货品登记分类" className="flex gap-1 overflow-x-auto pb-1">{PRODUCT_REGISTRATION_TYPES.map((item) => <button className={`min-h-9 shrink-0 rounded-md px-2.5 text-xs font-bold whitespace-nowrap ${item.key === type ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700'}`} key={item.key} onClick={() => setParams({ type: item.key })} type="button">{item.label}</button>)}</nav>
    <section className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">{tabTitle}</h2><p className="mt-1 text-xs text-slate-500">{adminView ? `共 ${visibleEntries.length} 条登记` : `我的登记 ${visibleEntries.length} 条`}</p></div>{adminView ? <button aria-label="刷新货品登记" className="ui-icon-button" onClick={() => void reload()} type="button"><RefreshCw className="h-4 w-4" /></button> : null}</section>
    {loading ? <LoadingState label="正在加载货品登记" /> : message ? <ErrorState message={message} onRetry={() => void reload()} /> : <div className="space-y-3">{visibleEntries.length === 0 ? <EmptyState title={`暂无${tabTitle}登记`} description={adminView ? '员工或店长新增登记后会实时显示在这里。' : '请在下方新增一条货品登记。'} /> : visibleEntries.map((entry) => <RegistrationCard adminView={adminView} entry={entry} imagesLoading={imagesLoading} key={entry.id} products={products} saving={savingIds.includes(entry.id)} onDelete={() => void removeEntry(entry)} onDeleteImage={(image) => void removeImage(entry.id, image)} onUpdate={(patch) => updateEntry(entry.id, patch)} onUpload={(file, onProgress) => uploadImage(entry, file, onProgress)} />)}{!adminView ? <button className="ui-button-primary w-full" onClick={() => void addEntry()} type="button"><PackagePlus className="h-4 w-4" />增加货品登记条目</button> : null}</div>}
  </PageShell>;
}

function RegistrationCard({ adminView, entry, imagesLoading, onDelete, onDeleteImage, onUpdate, onUpload, products, saving }: { adminView: boolean; entry: ProductRegistrationEntry; imagesLoading: boolean; onDelete: () => void; onDeleteImage: (image: ProductRegistrationImage) => void; onUpdate: (patch: Partial<EntryPatch>) => void; onUpload: (file: File, onProgress: (value: number) => void) => Promise<void>; products: RegistrationProduct[]; saving: boolean }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [uploadError, setUploadError] = useState('');
  const [activeImage, setActiveImage] = useState<number | null>(null);
  const readonly = adminView;
  const chooseProduct = (product: RegistrationProduct) => onUpdate({ product_id: product.id, product_name: product.name, unit: product.count_unit });
  const uploadFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploading((current) => ({ ...current, [id]: 5 }));
      void onUpload(file, (progress) => setUploading((current) => ({ ...current, [id]: progress }))).catch((error) => {
        setUploadError(error instanceof Error ? error.message : '图片上传失败，请重试。');
      }).finally(() => setUploading((current) => { const next = { ...current }; delete next[id]; return next; }));
    });
  };
  const images = entry.images.flatMap((image) => image.signedUrl ? [{ alt: image.file_name, url: image.signedUrl }] : []);
  return <article className="ui-card p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{entry.product_name || '待填写货品名称'}</p><p className="mt-1 text-xs text-slate-500">{adminView ? `登记人：${entry.creatorName} · ` : ''}更新于 {new Date(entry.updated_at).toLocaleString('zh-CN')}</p></div><StatusBadge tone={complete(entry) ? 'success' : 'warning'}>{complete(entry) ? '已完成' : '待完善'}</StatusBadge></div>
    {readonly ? <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm"><span className="text-slate-500">数量</span><b>{entry.quantity ?? '未填写'}</b><span className="text-slate-500">单位</span><b>{entry.unit || '未填写'}</b><span className="text-slate-500">货品来源</span><b>{entry.product_id ? '西直门货品库' : '手动新建'}</b></div> : <div className="mt-3 space-y-3">
      <div><label className="block text-sm font-semibold text-slate-700" htmlFor={`product-name-${entry.id}`}>货品名称</label><input className="ui-input mt-1" id={`product-name-${entry.id}`} list={`registration-product-options-${entry.id}`} onBlur={() => { const exact = products.find((product) => product.name.trim() === entry.product_name.trim()); if (exact) chooseProduct(exact); }} onChange={(event) => onUpdate({ product_id: null, product_name: event.target.value })} placeholder="检索西直门货品库，或直接输入新名称" value={entry.product_name} /><datalist id={`registration-product-options-${entry.id}`}>{products.map((product) => <option key={product.id} value={product.name}>{product.spec ? `${product.spec} · ${product.count_unit}` : product.count_unit}</option>)}</datalist></div>
      <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold text-slate-700" htmlFor={`quantity-${entry.id}`}>数量<input className="ui-input mt-1" id={`quantity-${entry.id}`} inputMode="decimal" min="0" onChange={(event) => { const value = event.target.value; onUpdate({ quantity: value === '' ? null : Number(value) }); }} placeholder="填写数量" step="any" type="number" value={entry.quantity ?? ''} /></label><label className="block text-sm font-semibold text-slate-700" htmlFor={`unit-${entry.id}`}>单位<input className="ui-input mt-1" id={`unit-${entry.id}`} onChange={(event) => onUpdate({ unit: event.target.value })} placeholder="如：个、箱、台" value={entry.unit} /></label></div>
      <p className="text-xs font-semibold text-slate-500">{saving ? '正在自动保存…' : '已自动保存'}</p>
    </div>}
    <section className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">现场照片 <span className="text-red-600">*</span></p><p className="mt-1 text-xs text-slate-500">至少上传 1 张，已上传 {entry.images.length} 张。</p></div>{!readonly ? <div className="grid shrink-0 grid-cols-2 gap-2"><button className="ui-button-primary min-h-10 px-3" onClick={() => cameraRef.current?.click()} type="button"><Camera className="h-4 w-4" />拍照</button><button className="ui-button-secondary min-h-10 px-3" onClick={() => albumRef.current?.click()} type="button"><ImagePlus className="h-4 w-4" />相册</button></div> : null}</div>
      {!readonly ? <><input accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => { uploadFiles(event.target.files); event.currentTarget.value = ''; }} ref={cameraRef} type="file" /><input accept="image/jpeg,image/png,image/webp" className="hidden" multiple onChange={(event) => { uploadFiles(event.target.files); event.currentTarget.value = ''; }} ref={albumRef} type="file" /></> : null}
      {Object.keys(uploading).length ? <p className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">正在上传图片 {Math.max(...Object.values(uploading))}%</p> : null}
      {uploadError ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{uploadError}</p> : null}
      {entry.images.length ? <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">{entry.images.map((image) => <div className="relative overflow-hidden rounded-lg border bg-white" key={image.id}><button aria-label={`查看图片 ${image.file_name}`} className="block aspect-square w-full" disabled={!image.signedUrl} onClick={() => { const index = images.findIndex((item) => item.url === image.signedUrl); if (index >= 0) setActiveImage(index); }} type="button"><ProgressiveImage alt={image.file_name} className="h-full w-full object-cover" containerClassName="h-full w-full" resourceLoading={imagesLoading && !image.signedUrl} src={image.signedUrl} /></button>{!readonly ? <button aria-label={`删除图片 ${image.file_name}`} className="absolute right-1 top-1 rounded-md bg-white/95 p-1.5 text-red-700 shadow" onClick={() => onDeleteImage(image)} type="button"><Trash2 className="h-4 w-4" /></button> : null}</div>)}</div> : <p className="mt-3 rounded-md border border-dashed border-slate-300 p-3 text-center text-sm text-slate-500">尚未上传照片</p>}
    </section>
    {!readonly ? <button className="mt-4 text-sm font-bold text-red-700" disabled={saving} onClick={onDelete} type="button">删除此登记条目</button> : null}
    {activeImage != null ? <ImageViewer activeIndex={activeImage} images={images} label="货品登记图片预览" onClose={() => setActiveImage(null)} onIndexChange={setActiveImage} /> : null}
  </article>;
}
