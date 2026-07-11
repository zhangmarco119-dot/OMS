import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7f3] px-4">
      <div className="rounded-lg border border-line bg-white p-6 text-center shadow-panel">
        <h1 className="text-2xl font-bold">页面不存在</h1>
        <Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-brand-600 px-5 font-semibold text-white" to="/phase-1">
          返回阶段状态
        </Link>
      </div>
    </main>
  );
}
