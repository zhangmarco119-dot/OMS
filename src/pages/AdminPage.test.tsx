import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findInitialAdminId,
  loadAdminUsers,
  updateManagedUser,
  updateProductPermissions,
  updateProfileAdminFields,
  type AdminUserRow,
  type StoreRow,
} from '../features/admin/adminUsersService';
import { archiveProduct, createProduct, createRecommendedProducts, deleteProduct, importProducts, loadAdminProductsData, loadProductMatchingSettings, loadRecommendedProductAdditions, parseProductImportFile, restoreProduct, type ProductRow } from '../features/admin/adminProductsService';
import { useAuth } from '../features/auth/AuthContext';
import { AdminPage } from './AdminPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../features/admin/adminProductsService', () => ({
  archiveProduct: vi.fn(),
  archiveProducts: vi.fn(),
  createAllProductsExportFile: vi.fn(),
  createProduct: vi.fn(),
  createRecommendedProducts: vi.fn(),
  deleteProduct: vi.fn(),
  downloadProductExportFile: vi.fn(),
  importProducts: vi.fn(),
  loadAdminProductsData: vi.fn(),
  loadProductMatchingSettings: vi.fn(),
  loadRecommendedProductAdditions: vi.fn(),
  parseProductImportFile: vi.fn(),
  restoreProduct: vi.fn(),
  saveProductMatchingSettings: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock('../features/admin/adminUsersService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../features/admin/adminUsersService')>();
  return {
    ...original,
    createAuthUserWithProfile: vi.fn(),
    deleteManagedUser: vi.fn(),
    loadAdminUsers: vi.fn(),
    updateManagedUser: vi.fn(),
    updateProductPermissions: vi.fn(),
    updateProfileAdminFields: vi.fn(),
  };
});

const store: StoreRow = {
  created_at: '2026-01-01T00:00:00Z',
  id: '00000000-0000-4000-8000-000000000001',
  is_active: true,
  name: '测试门店',
  short_name: '测试门店',
};

const makeProduct = (overrides: Partial<ProductRow> = {}): ProductRow => ({
  category_code: 'other_food',
  count_unit: '杯',
  created_at: '2026-07-14T00:00:00Z',
  id: '00000000-0000-4000-8000-000000000010',
  is_active: true,
  name: '原味酸奶',
  product_code: null,
  sort_order: 9,
  spec: '120g',
  store_id: store.id,
  updated_at: '2026-07-14T00:00:00Z',
  ...overrides,
});

const makeUser = (overrides: Partial<AdminUserRow>): AdminUserRow => ({
  created_at: '2026-02-01T00:00:00Z',
  deleted_at: null,
  display_name: '测试员工',
  employment_type: 'full_time',
  email: 'internal-staff@accounts.invalid',
  id: '00000000-0000-4000-8000-000000000003',
  is_active: true,
  productPermissions: { can_request_discontinued: true, can_request_incorrect: true, can_request_new: true },
  role: 'staff',
  store_id: store.id,
  storeIds: [store.id],
  storeName: store.name,
  updated_at: '2026-02-01T00:00:00Z',
  username: 'staff',
  ...overrides,
});

describe('AdminPage account management', () => {
  const initialAdmin = makeUser({
    created_at: '2026-01-01T00:00:00Z',
    display_name: '初始管理员',
    email: 'admin@example.com',
    id: '00000000-0000-4000-8000-000000000002',
    role: 'admin',
    username: 'admin',
  });
  const staff = makeUser({});

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ profile: { id: initialAdmin.id, role: 'admin' } } as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminProductsData).mockResolvedValue({ products: [], selectedStoreId: store.id, stores: [store] });
    vi.mocked(loadProductMatchingSettings).mockResolvedValue({ historyMatchDays: 30, recommendationDays: 30, updatedAt: null });
    vi.mocked(loadRecommendedProductAdditions).mockResolvedValue([]);
    vi.mocked(loadAdminUsers).mockResolvedValue({ stores: [store], users: [staff, initialAdmin] });
    vi.mocked(updateManagedUser).mockResolvedValue(undefined);
    vi.mocked(updateProfileAdminFields).mockResolvedValue(undefined);
    vi.mocked(updateProductPermissions).mockResolvedValue(undefined);
  });

  it('identifies the oldest administrator independent of list order', () => {
    expect(findInitialAdminId([staff, initialAdmin])).toBe(initialAdmin.id);
  });

  it('loads only product data on the independent product page', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/products']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminPage section="products" /></MemoryRouter>);

    await screen.findByRole('heading', { name: '新增货品' });
    expect(loadAdminProductsData).toHaveBeenCalled();
    expect(loadAdminUsers).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('货品编码')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '创建账号' })).not.toBeInTheDocument();
  });

  it('shows a centered success dialog after creating a product', async () => {
    vi.mocked(createProduct).mockResolvedValue(undefined);
    render(<MemoryRouter initialEntries={['/app/admin/products']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminPage section="products" /></MemoryRouter>);

    await screen.findByRole('heading', { name: '新增货品' });
    fireEvent.click(screen.getByRole('button', { name: '创建货品' }));

    await waitFor(() => expect(createProduct).toHaveBeenCalled());
    expect(await screen.findByRole('dialog', { name: '操作成功' })).toHaveTextContent('货品已创建');
  });

  it('shows a detailed modal report after a mixed product import', async () => {
    vi.mocked(parseProductImportFile).mockResolvedValue([
      { category_code: 'other_food', count_unit: '杯', name: '成功货品', product_code: null, row_number: 2, sort_order: 1, spec: '100g' },
      { category_code: 'other_food', count_unit: '', name: '失败货品', product_code: null, row_number: 3, sort_order: 2, spec: '120g' },
    ]);
    vi.mocked(importProducts).mockResolvedValue({
      failed: 1,
      failures: [{ item: 'Excel 第 3 行 · 失败货品', reason: '缺少必填字段：单位。', rowNumber: 3 }],
      inserted: 1,
      succeeded: 1,
      total: 2,
      updated: 0,
    });
    const { container } = render(<MemoryRouter initialEntries={['/app/admin/products']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminPage section="products" /></MemoryRouter>);

    await screen.findByRole('heading', { name: '新增货品' });
    fireEvent.click(screen.getByRole('button', { name: '批量处理' }));
    const file = new File(['excel'], 'products.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(container.querySelector<HTMLInputElement>('input[accept=".xlsx,.xls"]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '导入到当前门店' }));

    await waitFor(() => expect(importProducts).toHaveBeenCalled());
    const dialog = await screen.findByRole('dialog', { name: '货品批量导入完成' });
    expect(dialog).toHaveTextContent('上传成功1上传失败1');
    expect(dialog).toHaveTextContent('Excel 第 3 行 · 失败货品');
    expect(dialog).toHaveTextContent('缺少必填字段：单位');
  });

  it('edits, selects, and creates recommended unmatched products in one batch', async () => {
    vi.mocked(loadRecommendedProductAdditions).mockResolvedValue([{
      categoryCode: 'fruit', countUnit: '个', firstArrivalDate: '2026-07-30', key: '牛油果', lastArrivalDate: '2026-08-02', name: '牛油果', reportCount: 3, reportItemCount: 4, requestCount: 1, spec: '', totalQuantity: 12,
    }]);
    vi.mocked(createRecommendedProducts).mockResolvedValue({ createdCount: 1, matchedArrivalItems: 4, products: [{ id: 'product-new', matchedArrivalItems: 4, name: '牛油果' }] });
    render(<MemoryRouter initialEntries={['/app/admin/products']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminPage section="products" /></MemoryRouter>);

    await screen.findByRole('heading', { name: '新增货品' });
    fireEvent.click(screen.getByRole('button', { name: '批量处理' }));
    await screen.findByRole('heading', { name: '推荐新增货品' });
    fireEvent.change(screen.getByRole('textbox', { name: '推荐货品规格 牛油果' }), { target: { value: '单果' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择推荐货品 牛油果' }));
    fireEvent.click(screen.getByRole('button', { name: '一键新增已勾选货品（1）' }));

    await waitFor(() => expect(createRecommendedProducts).toHaveBeenCalledWith(store.id, [{ category_code: 'fruit', count_unit: '个', name: '牛油果', spec: '单果' }]));
    expect(await screen.findByRole('dialog')).toHaveTextContent('已一次新增 1 个货品');
  });

  it('uses a compact active list and separates archived products', async () => {
    const active = makeProduct();
    const otherActive = makeProduct({ id: '00000000-0000-4000-8000-000000000012', name: '椰子脆片', spec: '500g', count_unit: '袋' });
    const archived = makeProduct({ id: '00000000-0000-4000-8000-000000000011', is_active: false, name: '旧款酸奶' });
    vi.mocked(loadAdminProductsData).mockResolvedValue({ products: [active, otherActive, archived], selectedStoreId: store.id, stores: [store] });
    vi.mocked(archiveProduct).mockResolvedValue(undefined);
    vi.mocked(deleteProduct).mockResolvedValue(undefined);
    vi.mocked(restoreProduct).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<MemoryRouter initialEntries={['/app/admin/products']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminPage section="products" /></MemoryRouter>);

    await screen.findByDisplayValue('原味酸奶');
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('9')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '停用' })).not.toBeInTheDocument();
    expect(screen.queryByText('旧款酸奶')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '检索货品' }), { target: { value: '原味' } });
    expect(screen.getByDisplayValue('原味酸奶')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('椰子脆片')).not.toBeInTheDocument();
    expect(screen.getByText('显示 1 / 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '归档' }));
    await waitFor(() => expect(archiveProduct).toHaveBeenCalledWith(active.id));

    fireEvent.change(screen.getByRole('searchbox', { name: '检索货品' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '已归档 1' }));
    expect(await screen.findByText('旧款酸奶')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(deleteProduct).toHaveBeenCalledWith(archived.id));
    fireEvent.click(screen.getByRole('button', { name: '取消归档' }));
    await waitFor(() => expect(restoreProduct).toHaveBeenCalledWith(archived.id));
  });

  it('hides email from new and ordinary accounts, then confirms a successful save in a dialog', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/users']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminPage section="users" /></MemoryRouter>);

    await screen.findByRole('heading', { name: '创建账号' });
    expect(screen.getByRole('combobox', { name: '账号类型' })).toHaveTextContent('员工店长兼职管理员');
    expect(screen.queryByRole('combobox', { name: '用工类型' })).not.toBeInTheDocument();
    expect(loadAdminProductsData).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('联系邮箱（选填）')).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox').filter((input) => input.getAttribute('type') === 'email')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '初始管理员邮箱' })).toHaveValue('admin@example.com');

    fireEvent.click(screen.getAllByRole('button', { name: '保存账号修改' })[0]);

    await waitFor(() => expect(updateManagedUser).toHaveBeenCalledWith(expect.objectContaining({ email: undefined, userId: staff.id })));
    expect(await screen.findByRole('dialog', { name: '账号修改已保存' })).toHaveTextContent('测试员工');

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    vi.mocked(updateManagedUser).mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: '保存账号修改' })[1]);
    await waitFor(() => expect(updateManagedUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'admin@example.com', userId: initialAdmin.id })));
  });
});
