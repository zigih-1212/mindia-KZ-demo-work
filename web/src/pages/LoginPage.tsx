import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { HttpError } from "../services/api";

const DEMO_ACCOUNTS = [
  { email: "admin@mindia.kz", role: "Администратор" },
  { email: "manager@mindia.kz", role: "Руководитель проекта" },
  { email: "estimator@mindia.kz", role: "Сметчик" },
  { email: "foreman@mindia.kz", role: "Прораб" },
  { email: "customer@mindia.kz", role: "Заказчик" },
];

export function LoginPage() {
  const { login } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@mindia.kz");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      const msg =
        err instanceof HttpError ? err.message : "Не удалось войти. Проверьте данные.";
      setError(msg);
      notify(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-2xl font-bold text-white">
            С
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">СтройКонтроль</h1>
            <p className="text-xs text-slate-300">
              Платформа управления строительными проектами
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Вход в систему</h2>
            <p className="mt-1 text-sm text-slate-500">
              Управление объектами, сметами, документацией и AI-ассистент.
            </p>
          </div>

          {error ? (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Вход…" : "Войти"}
          </button>

          <p className="text-center text-sm text-slate-500">
            Нет аккаунта?{" "}
            <Link to="/register" className="font-medium text-brand-600 hover:underline">
              Зарегистрироваться
            </Link>
          </p>
        </form>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-slate-300">
          <div className="mb-2 font-medium text-white">Демо-доступы (пароль demo1234)</div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  setEmail(a.email);
                  setPassword("demo1234");
                }}
                className="rounded px-2 py-1 text-left hover:bg-white/10"
              >
                <span className="block font-mono text-[11px]">{a.email}</span>
                <span className="text-slate-400">{a.role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
