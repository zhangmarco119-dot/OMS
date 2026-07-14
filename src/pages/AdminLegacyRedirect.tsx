import { Navigate, useSearchParams } from 'react-router-dom';

export function AdminLegacyRedirect() {
  const [searchParams] = useSearchParams();
  return <Navigate to={searchParams.get('tab') === 'users' ? '/app/admin/users' : '/app/admin/products'} replace />;
}
