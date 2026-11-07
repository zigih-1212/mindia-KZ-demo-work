import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** Показывает спиннер, пока проверяется сессия по токену. */
function BootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-sm text-slate-500">Загрузка…</div>
    </div>
  );
}

/** Пропускает только аутентифицированных пользователей. */
export function RequireAuth() {
  const { user, initializing } = useAuth();
  const location = useLocation();
  if (initializing) return <BootScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

/** Редирект уже вошедших с /login на дашборд. */
export function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth();
  if (initializing) return <BootScreen />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}
