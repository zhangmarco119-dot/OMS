import { Link } from 'react-router-dom';

import { EmptyState } from '../components/ui/Feedback';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md"><EmptyState action={<Link className="ui-button-primary" to="/app">返回管理系统</Link>} description="请检查地址，或返回首页继续使用。" title="页面不存在" /></div>
    </main>
  );
}
