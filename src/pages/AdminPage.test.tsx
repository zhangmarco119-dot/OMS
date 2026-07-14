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
import { loadAdminProductsData } from '../features/admin/adminProductsService';
import { useAuth } from '../features/auth/AuthContext';
import { AdminPage } from './AdminPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../features/admin/adminProductsService', () => ({
  createAllProductsExportFile: vi.fn(),
  createProduct: vi.fn(),
  deleteProduct: vi.fn(),
  downloadProductExportFile: vi.fn(),
  importProducts: vi.fn(),
  loadAdminProductsData: vi.fn(),
  parseProductImportFile: vi.fn(),
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

const makeUser = (overrides: Partial<AdminUserRow>): AdminUserRow => ({
  created_at: '2026-02-01T00:00:00Z',
  deleted_at: null,
  display_name: '测试员工',
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
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ profile: { id: initialAdmin.id, role: 'admin' } } as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminProductsData).mockResolvedValue({ products: [], selectedStoreId: store.id, stores: [store] });
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
    expect(screen.queryByRole('heading', { name: '创建账号' })).not.toBeInTheDocument();
  });

  it('hides email from new and ordinary accounts, then confirms a successful save in a dialog', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/users']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminPage section="users" /></MemoryRouter>);

    await screen.findByRole('heading', { name: '创建账号' });
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
