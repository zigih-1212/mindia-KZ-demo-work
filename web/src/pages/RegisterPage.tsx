import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { HttpError } from "../services/api";
import { ROLE_LABELS } from "../lib/format";
import type { Role } from "../types";

export function RegisterPage() {
  const { register } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
    fullName: "",
    position: "",
    role: "foreman" as Role,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim(),
        position: form.position.trim(),
        role: form.role,
      });
      notify("Аккаунт создан", "success");
      navigate("/", { replace: true });
    } catch (err) {
      const msg =
        err instanceof HttpError ? err.message : "Не удалось зарегистрироваться.";
      setError(msg);
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
            <p className="text-xs text-slate-300">Регистрация в системе</p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
          {error ? (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="fullName">
              ФИО
            </label>
            <input
              id="fullName"
              className="input"
              value={form.fullName}
              onChange={set("fullName")}
              placeholder="Иван Иванов"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              autoComplete="username"
              value={form.email}
              onChange={set("email")}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="position">
                Должность
              </label>
              <input
                id="position"
                className="input"
                value={form.position}
                onChange={set("position")}
                placeholder="Прораб"
              />
            </div>
            <div>
              <label className="label" htmlFor="role">
                Роль
              </label>
              <select id="role" className="input" value={form.role} onChange={set("role")}>
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="new-password"
              value={form.password}
              onChange={set("password")}
              minLength={8}
              required
            />
            <p className="mt-1 text-xs text-slate-500">Минимум 8 символов.</p>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Создание…" : "Создать аккаунт"}
          </button>

          <p className="text-center text-sm text-slate-500">
            Уже есть аккаунт?{" "}
            <Link to="/login" className="font-medium text-brand-600 hover:underline">
              Войти
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
