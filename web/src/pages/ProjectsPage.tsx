import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../context/AuthContext";
import { Badge, EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import {
  PROJECT_STATUS_LABELS,
  formatDate,
  formatMoneyShort,
  projectStatusTone,
  utilizationPercent,
} from "../lib/format";
import type { ProjectStatus } from "../types";
import { ProjectFormModal } from "../components/ProjectFormModal";

const FILTERS: { value: ProjectStatus | "all"; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "planning", label: "Планирование" },
  { value: "active", label: "В работе" },
  { value: "suspended", label: "Приостановлен" },
  { value: "completed", label: "Завершён" },
];

export function ProjectsPage() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const { data, loading, error, reload } = useAsync(
    () =>
      api.listProjects({
        status: status === "all" ? undefined : status,
        search: search.trim() || undefined,
        limit: 50,
      }),
    [status, search],
  );

  return (
    <div>
      <PageHeader
        title="Объекты"
        subtitle="Портфель строительных проектов организации"
        actions={
          canManage ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + Новый объект
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                status === f.value
                  ? "bg-brand-600 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="input sm:max-w-xs"
          placeholder="Поиск по названию, коду, заказчику…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Объекты не найдены"
          description="Измените фильтры или создайте новый объект."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Код</th>
                  <th className="th">Название</th>
                  <th className="th">Заказчик</th>
                  <th className="th">Статус</th>
                  <th className="th">Бюджет</th>
                  <th className="th">Освоено</th>
                  <th className="th">Готовность</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((p) => {
                  const used = utilizationPercent(p.spentMinor, p.budgetMinor);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="td font-mono text-xs text-slate-500">{p.code}</td>
                      <td className="td">
                        <Link
                          to={`/projects/${p.id}`}
                          className="font-medium text-slate-900 hover:text-brand-600"
                        >
                          {p.name}
                        </Link>
                        <div className="text-xs text-slate-500">{p.address}</div>
                      </td>
                      <td className="td text-slate-600">{p.customer}</td>
                      <td className="td">
                        <Badge tone={projectStatusTone(p.status)}>
                          {PROJECT_STATUS_LABELS[p.status]}
                        </Badge>
                      </td>
                      <td className="td whitespace-nowrap">
                        {formatMoneyShort(p.budgetMinor)}
                      </td>
                      <td className="td whitespace-nowrap">
                        {formatMoneyShort(p.spentMinor)}
                        <span className="ml-1 text-xs text-slate-400">({used}%)</span>
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{ width: `${p.progressPercent}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">
                            {p.progressPercent}%
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          до {formatDate(p.plannedEndDate)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating ? (
        <ProjectFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
