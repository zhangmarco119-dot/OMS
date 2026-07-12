import { Download, Eye, EyeOff, FileUp, PackagePlus, RefreshCw, Save, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import {
  createProduct,
  createAllProductsExportFile,
  deleteProduct,
  downloadProductExportFile,
  importProducts,
  loadAdminProductsData,
  parseProductImportFile,
  updateProduct,
  type ProductDraft,
  type ProductRow,
} from '../features/admin/adminProductsService';
import {
  createAuthUserWithProfile,
  deleteManagedUser,
  loadAdminUsers,
  setUserTemporaryPassword,
  updateProfileAdminFields,
  type AdminUserRow,
  type CreateUserInput,
  type StoreRow,
} from '../features/admin/adminUsersService';
import { useAuth } from '../features/auth/AuthContext';

type AdminTab = 'products' | 'users';
type ProductTab = 'catalog' | 'import' | 'export';

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

export function AdminPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<AdminTab>('products');
  const [productTab, setProductTab] = useState<ProductTab>('catalog');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [newProduct, setNewProduct] = useState<ProductDraft>(emptyProductDraft());
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const [newUser, setNewUser] = useState<CreateUserInput>({
    email: '',
    password: '',
    username: '',
    displayName: '',
    role: 'staff',
    storeIds: [],
  });
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});

  const refresh = async (storeId = selectedStoreId) => {
    setLoading(true);
    setMessage(null);
    try {
      const [catalogData, userData] = await Promise.all([
        loadAdminProductsData(storeId),
        loadAdminUsers(),
      ]);
      setStores(catalogData.stores);
      setSelectedStoreId(catalogData.selectedStoreId);
      setProducts(catalogData.products);
      setUsers(userData.users);
      setProductDrafts(Object.fromEntries(catalogData.products.map((product) => [product.id, productToDraft(product)])));
      setNewProduct(emptyProductDraft(catalogData.selectedStoreId));
      setNewUser((current) => ({
        ...current,
        storeIds: current.storeIds.length > 0
          ? current.storeIds
          : [userData.stores[0]?.id || catalogData.selectedStoreId].filter(Boolean),
      }));
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
      setMessage('商品已创建。');
      await refresh(selectedStoreId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建商品失败');
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
      setMessage('商品已保存。');
      await refresh(selectedStoreId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存商品失败');
    }
  };

  const removeProduct = async (product: ProductRow) => {
    const confirmed = window.confirm(`确认删除商品“${product.name}”？已提交的历史单据仍保留当时的商品快照。`);
    if (!confirmed) {
      return;
    }

    setMessage(null);
    try {
      await deleteProduct(product.id);
      setMessage('商品已删除。');
      await refresh(selectedStoreId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除商品失败');
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
      setMessage(`导入完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}。`);
      setImportFile(null);
      await refresh(selectedStoreId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    }
  };

  const exportAllProducts = async () => {
    setMessage(null);
    try {
      const file = await createAllProductsExportFile();
      downloadProductExportFile(file);
      setMessage(`已导出全部 ${file.count} 个商品。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出商品失败');
    }
  };

  const createUser = async () => {
    setMessage(null);
    if (!newUser.username.trim() || !newUser.displayName.trim() || !newUser.password || newUser.storeIds.length === 0) {
      setMessage('请填写账号名、姓名、初始密码并至少选择一个门店。');
      return;
    }
    if (newUser.email && !/^\S+@\S+\.\S+$/.test(newUser.email.trim())) {
      setMessage('选填邮箱格式不正确。');
      return;
    }
    if (users.some((user) => user.username.trim().toLocaleLowerCase() === newUser.username.trim().toLocaleLowerCase())) {
      setMessage('账号名已存在，请使用其他账号名。');
      return;
    }
    try {
      await createAuthUserWithProfile(newUser);
      setMessage('账号已创建。');
      setNewUser({ email: '', password: '', username: '', displayName: '', role: 'staff', storeIds: stores[0]?.id ? [stores[0].id] : [] });
      await refresh(selectedStoreId);
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
    try {
      await updateProfileAdminFields(user.id, {
        role: user.role,
        is_active: user.is_active,
        storeIds: user.storeIds,
      });
      setMessage('账号资料已更新。');
      await refresh(selectedStoreId);
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
      setMessage('账号已删除，历史提交记录已保留。');
      await refresh(selectedStoreId);
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

  const setTemporaryPassword = async (userId: string) => {
    const password = passwordDrafts[userId];
    if (!password) {
      setMessage('请输入新的临时密码。');
      return;
    }

    setMessage(null);
    try {
      await setUserTemporaryPassword(userId, password);
      setPasswordDrafts((current) => ({ ...current, [userId]: '' }));
      setMessage('临时密码已设置，请通知该账号登录后自行修改。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '设置密码失败');
    }
  };

  return (
    <PageShell eyebrow="管理员" title="后台管理" backTo="/app">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 text-sm">
          {[
            ['products', '商品'],
            ['users', '账号'],
          ].map(([value, label]) => (
            <button
              className={[
                'min-h-10 rounded-lg font-bold transition',
                tab === value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600',
              ].join(' ')}
              key={value}
              onClick={() => setTab(value as AdminTab)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'products' ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select className="min-h-11 rounded-xl border border-slate-200 px-3" onChange={(event) => changeStore(event.target.value)} value={selectedStoreId}>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold" onClick={() => void refresh(selectedStoreId)} type="button">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              刷新
            </button>
          </div>
        ) : null}
      </div>

      {message ? <p className="rounded-xl bg-accent-50 p-3 text-sm leading-6 text-accent-700">{message}</p> : null}
      {loading ? <p className="rounded-xl bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm">正在加载后台数据</p> : null}

      {tab === 'products' ? (
        <section className="space-y-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {([
              ['catalog', '商品列表'],
              ['import', '导入商品'],
              ['export', '导出商品'],
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
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-bold text-slate-900">新增商品</h2>
            <ProductDraftForm draft={newProduct} onChange={setNewProduct} />
            <button className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white" onClick={() => void saveNewProduct()} type="button">
              <PackagePlus className="h-4 w-4" aria-hidden="true" />
              创建商品
            </button>
          </div>

          <div className="space-y-2">
            {products.map((product) => (
              <article className="rounded-lg bg-white p-3 shadow-sm" key={product.id}>
                <ProductDraftForm
                  draft={productDrafts[product.id] ?? productToDraft(product)}
                  onChange={(draft) => setProductDrafts((current) => ({ ...current, [product.id]: draft }))}
                />
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-800" onClick={() => void saveProduct(product.id)} type="button">
                    <Save className="h-4 w-4" aria-hidden="true" />
                    保存商品
                  </button>
                  <button aria-label={`删除${product.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 text-red-700" onClick={() => void removeProduct(product)} title="删除商品" type="button">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
            </>
          ) : null}

          {productTab === 'import' ? (
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900">Excel 导入商品</h2>
                <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700" download href="/templates/商品导入模板.xlsx">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  下载模板
                </a>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                默认读取第一个 Sheet。支持列名：商品名称、规格、单位、商品编码、排序、启用。导入时按商品编码优先匹配，其次按名称+规格+单位匹配。
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
          ) : null}

          {productTab === 'export' ? (
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">导出全部商品</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">导出您有权限查看的全部门店商品，包括商品编号、门店、规格、单位、编码、状态和创建/更新时间。</p>
              <button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white" onClick={() => void exportAllProducts()} type="button">
                <Download className="h-4 w-4" aria-hidden="true" />
                导出全部商品 Excel
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'users' ? (
        <section className="space-y-3">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">创建账号</h2>
                <p className="mt-1 text-xs text-slate-500">账号名或姓名登录，邮箱选填。</p>
              </div>
              <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold" onClick={() => setShowPassword((current) => !current)} type="button">
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} placeholder="账号名" value={newUser.username} />
              <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} placeholder="姓名" value={newUser.displayName} />
              <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} placeholder="初始密码" type={showPassword ? 'text' : 'password'} value={newUser.password} />
              <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" inputMode="email" onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} placeholder="联系邮箱（选填）" type="email" value={newUser.email ?? ''} />
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
                <div className="grid gap-2 sm:grid-cols-4">
                  <select className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, role: event.target.value as AdminUserRow['role'] } : entry))} value={user.role}>
                    <option value="staff">员工</option>
                    <option value="manager">店长</option>
                    <option value="admin">管理员</option>
                  </select>
                  <select className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, is_active: event.target.value === 'true' } : entry))} value={String(user.is_active)}>
                    <option value="true">启用</option>
                    <option value="false">禁用</option>
                  </select>
                  <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold" onClick={() => void saveProfile(user)} type="button">
                    <Save className="h-4 w-4" aria-hidden="true" />
                    保存
                  </button>
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
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setPasswordDrafts((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="设置新的临时密码" type={showPassword ? 'text' : 'password'} value={passwordDrafts[user.id] ?? ''} />
                  <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white" onClick={() => void setTemporaryPassword(user.id)} type="button">
                    设置临时密码
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}

function ProductDraftForm({ draft, onChange }: { draft: ProductDraft; onChange: (draft: ProductDraft) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="商品名称" value={draft.name} />
      <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => onChange({ ...draft, spec: event.target.value })} placeholder="规格" value={draft.spec} />
      <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => onChange({ ...draft, count_unit: event.target.value })} placeholder="单位" value={draft.count_unit} />
      <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => onChange({ ...draft, product_code: event.target.value })} placeholder="商品编码" value={draft.product_code} />
      <input className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => onChange({ ...draft, sort_order: Number(event.target.value) || 0 })} placeholder="排序" type="number" value={draft.sort_order} />
      <select className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => onChange({ ...draft, is_active: event.target.value === 'true' })} value={String(draft.is_active)}>
        <option value="true">启用</option>
        <option value="false">停用</option>
      </select>
    </div>
  );
}
