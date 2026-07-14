import { Archive, CheckCircle2, Download, Eye, EyeOff, FileUp, PackagePlus, RefreshCw, RotateCcw, Save, Search, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { BatchImportReportDialog } from '../components/feedback/BatchImportReportDialog';
import {
  archiveProduct,
  createProduct,
  createAllProductsExportFile,
  deleteProduct,
  downloadProductExportFile,
  importProducts,
  loadAdminProductsData,
  parseProductImportFile,
  restoreProduct,
  updateProduct,
  type ProductDraft,
  type ProductImportResult,
  type ProductRow,
} from '../features/admin/adminProductsService';
import {
  createAuthUserWithProfile,
  deleteManagedUser,
  findInitialAdminId,
  loadAdminUsers,
  updateManagedUser,
  updateProfileAdminFields,
  updateProductPermissions,
  type AdminUserRow,
  type CreateUserInput,
  type StoreRow,
} from '../features/admin/adminUsersService';
import { useAuth } from '../features/auth/AuthContext';

export type AdminSection = 'products' | 'users';
type ProductTab = 'catalog' | 'batch' | 'archived';

const emptyProductDraft = (storeId = ''): ProductDraft => ({
  count_unit: '',
  is_active: true,
  name: '',
  product_code: '',
  sort_order: 0,
  spec: '',
  store_id: storeId,
});

const productToDraft = (product: ProductRow): ProductDraft => ({
  count_unit: product.count_unit,
  is_active: product.is_active,
  name: product.name,
  product_code: product.product_code ?? '',
  sort_order: product.sort_order,
  spec: product.spec,
  store_id: product.store_id,
});

export function AdminPage({ section }: { section: AdminSection }) {
  const auth = useAuth();
  const [productTab, setProductTab] = useState<ProductTab>('catalog');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [newProduct, setNewProduct] = useState<ProductDraft>(emptyProductDraft());
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const [productImportReport, setProductImportReport] = useState<ProductImportResult | null>(null);
  const [newUser, setNewUser] = useState<CreateUserInput>({
    password: '',
    username: '',
    displayName: '',
    role: 'staff',
    storeIds: [],
  });
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [savedAccountName, setSavedAccountName] = useState<string | null>(null);
  const initialAdminId = findInitialAdminId(users);

  const refresh = async (storeId = selectedStoreId) => {
    setLoading(true);
    setMessage(null);
    try {
      if (section === 'products') {
        const catalogData = await loadAdminProductsData(storeId);
        setStores(catalogData.stores);
        setSelectedStoreId(catalogData.selectedStoreId);
        setProducts(catalogData.products);
        setProductDrafts(Object.fromEntries(catalogData.products.map((product) => [product.id, productToDraft(product)])));
        setNewProduct(emptyProductDraft(catalogData.selectedStoreId));
      } else {
        const userData = await loadAdminUsers();
        setStores(userData.stores);
        setUsers(userData.users);
        setNewUser((current) => ({
          ...current,
          storeIds: current.storeIds.length > 0
            ? current.storeIds
            : [userData.stores[0]?.id].filter(Boolean),
        }));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载后台数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeStore = (storeId: string) => {
    setSelectedStoreId(storeId);
    setNewProduct(emptyProductDraft(storeId));
    void refresh(storeId);
  };

  const saveNewProduct = async () => {
    setMessage(null);
    try {
      await createProduct({ ...newProduct, store_id: selectedStoreId });
      await refresh(selectedStoreId);
      setMessage('货品已创建。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建货品失败');
    }
  };

  const saveProduct = async (productId: string) => {
    const draft = productDrafts[productId];
    if (!draft) {
      return;
    }

    setMessage(null);
    try {
      await updateProduct(productId, draft);
      await refresh(selectedStoreId);
      setMessage('货品已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存货品失败');
    }
  };

  const moveProductToArchive = async (product: ProductRow) => {
    const confirmed = window.confirm(`确认归档货品“${product.name}”？归档后不会出现在日常货品列表中，历史单据仍会完整保留。`);
    if (!confirmed) {
      return;
    }

    setMessage(null);
    try {
      await archiveProduct(product.id);
      await refresh(selectedStoreId);
      setMessage('货品已归档。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '归档货品失败');
    }
  };

  const restoreArchivedProduct = async (product: ProductRow) => {
    setMessage(null);
    try {
      await restoreProduct(product.id);
      await refresh(selectedStoreId);
      setMessage('货品已取消归档，已恢复到货品列表。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '取消归档失败');
    }
  };

  const permanentlyDeleteArchivedProduct = async (product: ProductRow) => {
    if (!window.confirm(`确认永久删除已归档货品“${product.name}”？此操作无法撤销。`)) {
      return;
    }

    setMessage(null);
    try {
      await deleteProduct(product.id);
      await refresh(selectedStoreId);
      setMessage('已归档货品已永久删除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除已归档货品失败');
    }
  };

  const importExcel = async () => {
    if (!importFile) {
      setMessage('请先选择 Excel 文件。');
      return;
    }

    setMessage(null);
    try {
      const rows = await parseProductImportFile(importFile);
      const result = await importProducts(selectedStoreId, rows);
      setImportFile(null);
      await refresh(selectedStoreId);
      setProductImportReport(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    }
  };

  const exportAllProducts = async () => {
    setMessage(null);
    try {
      const file = await createAllProductsExportFile();
      downloadProductExportFile(file);
      setMessage(`已导出全部 ${file.count} 个货品。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出货品失败');
    }
  };

  const createUser = async () => {
    setMessage(null);
    if (!newUser.username.trim() || !newUser.displayName.trim() || !newUser.password || newUser.storeIds.length === 0) {
      setMessage('请填写账号名、姓名、初始密码并至少选择一个门店。');
      return;
    }
    if (users.some((user) => user.username.trim().toLocaleLowerCase() === newUser.username.trim().toLocaleLowerCase())) {
      setMessage('账号名已存在，请使用其他账号名。');
      return;
    }
    try {
      await createAuthUserWithProfile(newUser);
      setNewUser({ password: '', username: '', displayName: '', role: 'staff', storeIds: stores[0]?.id ? [stores[0].id] : [] });
      await refresh(selectedStoreId);
      setMessage('账号已创建。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建账号失败');
    }
  };

  const saveProfile = async (user: AdminUserRow) => {
    setMessage(null);
    if (user.storeIds.length === 0) {
      setMessage('每个账号至少需要选择一个门店。');
      return;
    }
    if (!user.username.trim() || !user.display_name.trim()) {
      setMessage('账号名和姓名不能为空。');
      return;
    }
    if (user.id === initialAdminId && user.email && !/^\S+@\S+\.\S+$/.test(user.email.trim())) {
      setMessage('邮箱格式不正确。');
      return;
    }
    const password = passwordDrafts[user.id]?.trim();
    if (password && password.length < 6) {
      setMessage('新密码至少需要 6 位。');
      return;
    }
    try {
      await updateManagedUser({
        displayName: user.display_name,
        email: user.id === initialAdminId ? user.email : undefined,
        password,
        userId: user.id,
        username: user.username,
      });
      await updateProfileAdminFields(user.id, {
        role: user.role,
        is_active: user.is_active,
        storeIds: user.storeIds,
      });
      if (user.role !== 'admin') await updateProductPermissions(user.id, user.productPermissions);
      setPasswordDrafts((current) => ({ ...current, [user.id]: '' }));
      await refresh(selectedStoreId);
      setSavedAccountName(user.display_name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存账号失败');
    }
  };

  const removeUser = async (user: AdminUserRow) => {
    if (user.id === auth.profile?.id) {
      setMessage('不能删除当前正在登录的管理员账号。');
      return;
    }
    if (!window.confirm(`确认删除账号“${user.display_name}（${user.username}）”？该账号将无法继续登录，历史点货记录仍会保留。`)) {
      return;
    }
    if (!window.confirm('再次确认删除此账号？此操作不能在页面中撤销。')) {
      return;
    }

    setMessage(null);
    try {
      await deleteManagedUser(user.id);
      await refresh(selectedStoreId);
      setMessage('账号已删除，历史提交记录已保留。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除账号失败');
    }
  };

  const toggleNewUserStore = (storeId: string) => {
    setNewUser((current) => ({
      ...current,
      storeIds: current.storeIds.includes(storeId)
        ? current.storeIds.filter((id) => id !== storeId)
        : [...current.storeIds, storeId],
    }));
  };

  const toggleUserStore = (userId: string, storeId: string) => {
    setUsers((current) => current.map((user) => user.id === userId
      ? {
          ...user,
          storeIds: user.storeIds.includes(storeId)
            ? user.storeIds.filter((id) => id !== storeId)
            : [...user.storeIds, storeId],
        }
      : user));
  };

  const activeProducts = products.filter((product) => product.is_active);
  const archivedProducts = products.filter((product) => !product.is_active);
  const normalizedProductSearch = productSearch.trim().toLocaleLowerCase();
  const matchesProductSearch = (product: ProductRow) => {
    if (!normalizedProductSearch) {
      return true;
    }
    const draft = productDrafts[product.id] ?? productToDraft(product);
    return [draft.name, draft.spec, draft.count_unit]
      .some((value) => value.toLocaleLowerCase().includes(normalizedProductSearch));
  };
  const visibleActiveProducts = activeProducts.filter(matchesProductSearch);
  const visibleArchivedProducts = archivedProducts.filter(matchesProductSearch);

  return (
    <PageShell eyebrow="门店运营系统 · 管理员" title={section === 'products' ? '货品管理' : '账号管理'} backTo="/app/workbench">
      {section === 'products' ? (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <select className="min-h-11 rounded-xl border border-slate-200 px-3" onChange={(event) => changeStore(event.target.value)} value={selectedStoreId}>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 text-slate-500">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <input aria-label="检索货品" className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none" onChange={(event) => setProductSearch(event.target.value)} placeholder="检索名称、规格或单位" type="search" value={productSearch} />
            </label>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold" onClick={() => void refresh(selectedStoreId)} type="button">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              刷新
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <p className="rounded-xl bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm">正在加载后台数据</p> : null}

      {section === 'products' ? (
        <section className="space-y-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {([
              ['catalog', '货品列表'],
              ['batch', '批量处理'],
              ['archived', `已归档 ${archivedProducts.length}`],
            ] as const).map(([value, label]) => (
              <button
                className={`min-h-10 rounded-md font-bold ${productTab === value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`}
                key={value}
                onClick={() => setProductTab(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {productTab === 'catalog' ? (
            <>
          <div className="rounded-lg bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-base font-bold text-slate-900">新增货品</h2>
            <ProductDraftForm draft={newProduct} onChange={setNewProduct} />
            <button className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-bold text-white" onClick={() => void saveNewProduct()} type="button">
              <PackagePlus className="h-4 w-4" aria-hidden="true" />
              创建货品
            </button>
          </div>

          <div className="space-y-2">
            {visibleActiveProducts.map((product) => (
              <article className="rounded-lg bg-white p-2.5 shadow-sm" key={product.id}>
                <ProductDraftForm
                  draft={productDrafts[product.id] ?? productToDraft(product)}
                  onChange={(draft) => setProductDrafts((current) => ({ ...current, [product.id]: draft }))}
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800" onClick={() => void saveProduct(product.id)} type="button">
                    <Save className="h-4 w-4" aria-hidden="true" />
                    保存货品
                  </button>
                  <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-amber-200 px-3 text-sm font-bold text-amber-800" onClick={() => void moveProductToArchive(product)} type="button">
                    <Archive className="h-4 w-4" aria-hidden="true" />
                    归档
                  </button>
                </div>
              </article>
            ))}
            {visibleActiveProducts.length === 0 ? <p className="rounded-lg bg-white p-4 text-center text-sm text-slate-500 shadow-sm">{normalizedProductSearch ? '没有符合检索条件的使用中货品。' : '当前门店暂无使用中的货品。'}</p> : null}
          </div>
            </>
          ) : null}

          {productTab === 'batch' ? (
            <div className="space-y-2">
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900">Excel 导入货品</h2>
                <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700" download="货品导入模板.xlsx" href="/templates/货品导入模板.xlsx">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  下载模板
                </a>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                默认读取第一个 Sheet。支持列名：货品名称、规格、单位、排序、启用。导入时按“货品名称 + 规格 + 单位”匹配，已存在则更新，未匹配则新增。单行不合规范或写入失败时会继续处理其余货品，完成后统一报告失败原因。
              </p>
              <input
                accept=".xlsx,.xls"
                className="mt-4 block w-full rounded-xl border border-slate-200 p-3 text-sm"
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                type="file"
              />
              <button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white" onClick={() => void importExcel()} type="button">
                <FileUp className="h-4 w-4" aria-hidden="true" />
                导入到当前门店
              </button>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">导出全部货品</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">导出您有权限查看的全部门店货品，包括门店、名称、规格、单位、排序、状态和更新时间。</p>
              <button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white" onClick={() => void exportAllProducts()} type="button">
                <Download className="h-4 w-4" aria-hidden="true" />
                导出全部货品 Excel
              </button>
            </div>
            </div>
          ) : null}

          {productTab === 'archived' ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <h2 className="text-base font-bold text-slate-900">已归档货品</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">归档货品不会出现在日常业务选择中，历史单据仍会保留。需要继续使用时可取消归档。</p>
              </div>
              {visibleArchivedProducts.map((product) => (
                <article className="rounded-lg bg-white p-3 shadow-sm" key={product.id}>
                  <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-2 text-sm">
                    <strong className="truncate text-slate-900">{product.name}</strong>
                    <span className="truncate text-slate-600">{product.spec}</span>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{product.count_unit}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-brand-200 px-3 text-sm font-bold text-brand-700" onClick={() => void restoreArchivedProduct(product)} type="button">
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      取消归档
                    </button>
                    <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-bold text-red-700" onClick={() => void permanentlyDeleteArchivedProduct(product)} type="button">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      删除
                    </button>
                  </div>
                </article>
              ))}
              {visibleArchivedProducts.length === 0 ? <p className="rounded-lg bg-white p-4 text-center text-sm text-slate-500 shadow-sm">{normalizedProductSearch ? '没有符合检索条件的已归档货品。' : '当前门店暂无已归档货品。'}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {section === 'users' ? (
        <section className="space-y-3">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">创建账号</h2>
                <p className="mt-1 text-xs text-slate-500">账号名或姓名登录，系统会自动配置登录信息。</p>
              </div>
              <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold" onClick={() => setShowPassword((current) => !current)} type="button">
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} placeholder="账号名" value={newUser.username} />
              <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} placeholder="姓名" value={newUser.displayName} />
              <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} placeholder="初始密码" type={showPassword ? 'text' : 'password'} value={newUser.password} />
              <select className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as CreateUserInput['role'] }))} value={newUser.role}>
                <option value="staff">员工</option>
                <option value="manager">店长</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <fieldset className="mt-3">
              <legend className="mb-2 text-xs font-bold text-slate-500">可访问门店（可多选）</legend>
              <div className="flex flex-wrap gap-2">
                {stores.map((store) => (
                  <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700" key={store.id}>
                    <input checked={newUser.storeIds.includes(store.id)} onChange={() => toggleNewUserStore(store.id)} type="checkbox" />
                    {store.short_name}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white" onClick={() => void createUser()} type="button">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              创建账号
            </button>
          </div>

          <div className="space-y-2">
            {users.map((user, index) => (
              <div className="rounded-lg bg-white p-3 shadow-sm" key={user.id}>
                <div className="mb-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-4">
                  <div className="font-semibold text-slate-900">{index + 1}. {user.display_name}</div>
                  <div>{user.username}</div>
                  <div>{user.storeName}</div>
                  <div>{user.is_active ? '启用' : '禁用'}</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, username: event.target.value } : entry))} placeholder="账号名" value={user.username} />
                  <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, display_name: event.target.value } : entry))} placeholder="姓名" value={user.display_name} />
                  {user.id === initialAdminId ? <input aria-label="初始管理员邮箱" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" inputMode="email" onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, email: event.target.value } : entry))} placeholder="初始管理员邮箱" type="email" value={user.email} /> : null}
                  <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setPasswordDrafts((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="新密码（留空不修改）" type={showPassword ? 'text' : 'password'} value={passwordDrafts[user.id] ?? ''} />
                  <select className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, role: event.target.value as AdminUserRow['role'] } : entry))} value={user.role}>
                    <option value="staff">员工</option>
                    <option value="manager">店长</option>
                    <option value="admin">管理员</option>
                  </select>
                  <select className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, is_active: event.target.value === 'true' } : entry))} value={String(user.is_active)}>
                    <option value="true">启用</option>
                    <option value="false">禁用</option>
                  </select>
                  <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-bold text-red-700 disabled:border-slate-200 disabled:text-slate-300" disabled={user.id === auth.profile?.id} onClick={() => void removeUser(user)} type="button">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    删除账号
                  </button>
                </div>
                <fieldset className="mt-2">
                  <legend className="mb-1 text-xs font-bold text-slate-500">可访问门店</legend>
                  <div className="flex flex-wrap gap-2">
                    {stores.map((store) => (
                      <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700" key={store.id}>
                        <input checked={user.storeIds.includes(store.id)} onChange={() => toggleUserStore(user.id, store.id)} type="checkbox" />
                        {store.short_name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {user.role !== 'admin' ? <fieldset className="mt-3 rounded-lg bg-slate-50 p-3"><legend className="px-1 text-xs font-bold text-slate-500">员工货品申请权限</legend><div className="mt-1 flex flex-wrap gap-3 text-sm"><label><input checked={user.productPermissions.can_request_new} onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, productPermissions: { ...entry.productPermissions, can_request_new: event.target.checked } } : entry))} type="checkbox" /> 新增申请</label><label><input checked={user.productPermissions.can_request_incorrect} onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, productPermissions: { ...entry.productPermissions, can_request_incorrect: event.target.checked } } : entry))} type="checkbox" /> 修订申请</label><label><input checked={user.productPermissions.can_request_discontinued} onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, productPermissions: { ...entry.productPermissions, can_request_discontinued: event.target.checked } } : entry))} type="checkbox" /> 删除申请</label></div></fieldset> : null}
                <button className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white" onClick={() => void saveProfile(user)} type="button"><Save className="h-4 w-4" aria-hidden="true" />保存账号修改</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {savedAccountName ? <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="account-save-success-title"><section className="ui-dialog-panel max-w-sm border border-emerald-100 p-5"><div className="flex items-start justify-between gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-7 w-7" aria-hidden="true" /></div><button aria-label="关闭保存成功提示" className="ui-icon-button" onClick={() => setSavedAccountName(null)} type="button"><X className="h-5 w-5" /></button></div><h2 className="mt-4 text-xl font-bold text-slate-900" id="account-save-success-title">账号修改已保存</h2><p className="mt-2 text-sm leading-6 text-slate-600">“{savedAccountName}”的账号资料已更新并生效。</p><button className="ui-button-primary mt-5 w-full" onClick={() => setSavedAccountName(null)} type="button">我知道了</button></section></div> : null}
      <BatchImportReportDialog failureCount={productImportReport?.failed ?? 0} failures={productImportReport?.failures ?? []} onClose={() => setProductImportReport(null)} open={Boolean(productImportReport)} successCount={productImportReport?.succeeded ?? 0} successDescription={`成功处理 ${productImportReport?.succeeded ?? 0} 个货品：新增 ${productImportReport?.inserted ?? 0} 个，更新 ${productImportReport?.updated ?? 0} 个。失败行不会影响其他货品。`} title="货品批量导入完成" />
      <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={Boolean(message)} title={message && /失败|请|不能|不能为空|不正确|至少|已存在|未配置/.test(message) ? '操作未完成' : '操作成功'} tone={message && /失败|请|不能|不能为空|不正确|至少|已存在|未配置/.test(message) ? 'warning' : 'success'} />
    </PageShell>
  );
}

export function AdminProductsPage() {
  return <AdminPage section="products" />;
}

export function AdminUsersPage() {
  return <AdminPage section="users" />;
}

function ProductDraftForm({ draft, onChange }: { draft: ProductDraft; onChange: (draft: ProductDraft) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(4.5rem,0.55fr)] gap-2">
      <input aria-label="货品名称" className="min-h-9 min-w-0 rounded-lg border border-slate-200 px-2.5 text-sm" onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="名称" value={draft.name} />
      <input aria-label="货品规格" className="min-h-9 min-w-0 rounded-lg border border-slate-200 px-2.5 text-sm" onChange={(event) => onChange({ ...draft, spec: event.target.value })} placeholder="规格" value={draft.spec} />
      <input aria-label="货品单位" className="min-h-9 min-w-0 rounded-lg border border-slate-200 px-2.5 text-sm" onChange={(event) => onChange({ ...draft, count_unit: event.target.value })} placeholder="单位" value={draft.count_unit} />
    </div>
  );
}
