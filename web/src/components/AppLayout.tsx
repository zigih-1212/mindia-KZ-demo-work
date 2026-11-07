import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../lib/format";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Роли, которым пункт доступен; undefined — всем. */
  roles?: string[];
}

const NAV: NavItem[] = [
  { to: "/", label: "Дашборд", icon: "▦" },
  { to: "/projects", label: "Объекты", icon: "▤" },
  { to: "/estimates", label: "Сметы", icon: "₸" },
  { to: "/documents", label: "Документы", icon: "▦" },
  { to: "/normative", label: "Нормативы", icon: "§" },
  { to: "/assistant", label: "AI-ассистент", icon: "✦" },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const visibleNav = NAV.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">
          С
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">СтройКонтроль</div>
          <div className="text-[11px] text-slate-400">управление стройкой</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Основная навигация">
        {visibleNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-600 text-white"
                  : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
              }`
            }
          >
            <span aria-hidden="true" className="w-4 text-center">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-700/60 px-4 py-4">
        <div className="mb-3 text-sm">
          <div className="font-medium text-white">{user?.fullName}</div>
          <div className="text-xs text-slate-400">
            {user ? ROLE_LABELS[user.role] : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white"
        >
          Выйти
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — десктоп */}
      <aside className="hidden w-60 shrink-0 bg-slate-900 lg:block">{sidebar}</aside>

      {/* Sidebar — мобильный drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute left-0 top-0 h-full w-60 bg-slate-900">{sidebar}</aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setMobileOpen(true)}
            aria-label="Открыть меню"
          >
            ☰
          </button>
          <span className="font-semibold text-slate-900">СтройКонтроль</span>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
