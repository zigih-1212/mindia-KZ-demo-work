import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="text-6xl font-bold text-brand-600">404</div>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">Страница не найдена</h1>
      <p className="mt-1 text-sm text-slate-500">
        Возможно, ссылка устарела или страница была перемещена.
      </p>
      <Link to="/" className="btn-primary mt-5">
        На дашборд
      </Link>
    </div>
  );
}
