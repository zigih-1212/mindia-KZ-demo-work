import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../context/AuthContext";
import { Badge, EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import { SectionTabs, type TabDef } from "../components/Tabs";
import { canManageProjects } from "../lib/rbac";
import {
  PROJECT_STATUS_LABELS,
  formatDate,
  formatMoneyShort,
  projectStatusTone,
  utilizationPercent,
} from "../lib/format";
import type { ProjectStatus } from "../types";
import { ProjectFormModal } from "../components/ProjectFormModal";

type ViewTab = "all" | ProjectStatus;

const TABS: TabDef<ViewTab>[] = [
  { id: "all", label: "Все объекты" },
  { id: "active", label: "В работе" },
  { id: "planning", label: "Планирование" },
  { id: "suspended", label: "Приостановлены" },
  { id: "completed", label: "Завершённые" },
];

export function ProjectsPage() {
  const { user } = useAuth();
  const canManage = canManageProjects(user?.role);
  const [sp] = useSearchParams();
  const tab = ((sp.get("tab") as ViewTab) || "all");
  const status: ProjectStatus | "all" = (TABS.some((t) => t.id === tab) ? tab : "all") as ViewTab;
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const { data, loading, error, reload } = useAsync(
    () =>
      api.listProjects({
        status: status === "all" ? undefined : status,
        search: search.trim() || undefined,
        limit: 100,
      }),
    [status, search],
  );

  const quick = useMemo(() => {
    const items = data?.items ?? [];
    const by = (s: ProjectStatus) => items.filter((p) => p.status === s).length;
    return { total: items.length, active: by("active"), planning: by("planning"), completed: by("completed") };
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Объекты"
        subtitle="Портфель строительных проектов — под-разделы открываются внутри страницы"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/estimates?tab=pending" className="btn-secondary text-sm">Сметы на проверке</Link>
            <Link to="/documents?tab=submitted" className="btn-secondary text-sm">Документы на проверке</Link>
            {canManage ? (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                + Новый объект
              </button>
            ) : null}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickCard label="Всего (в выборке)" value={quick.total} to="/projects" />
        <QuickCard label="В работе" value={quick.active} to="/projects?tab=active" tone="brand" />
        <QuickCard label="Планирование" value={quick.planning} to="/projects?tab=planning" />
        <QuickCard label="Завершённые" value={quick.completed} to="/projects?tab=completed" tone="green" />
      </div>

      <SectionTabs tabs={TABS} defaultTab="all" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          {status === "all" ? "Показаны все объекты." : `Фильтр: ${PROJECT_STATUS_LABELS[status]}.`} Переключайте вкладки выше — страница не меняется.
        </p>
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
          description="Измените вкладку/поиск или создайте новый объект (если есть права)."
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
                        <Link to={`/projects/${p.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                          {p.name}
                        </Link>
                        <div className="text-xs text-slate-500">{p.address}</div>
                      </td>
                      <td className="td text-slate-600">{p.customer}</td>
                      <td className="td">
                        <Badge tone={projectStatusTone(p.status)}>{PROJECT_STATUS_LABELS[p.status]}</Badge>
                      </td>
                      <td className="td whitespace-nowrap">{formatMoneyShort(p.budgetMinor)}</td>
                      <td className="td whitespace-nowrap">
                        {formatMoneyShort(p.spentMinor)}
                        <span className="ml-1 text-xs text-slate-400">({used}%)</span>
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${p.progressPercent}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">{p.progressPercent}%</span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">до {formatDate(p.plannedEndDate)}</div>
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

function QuickCard({ label, value, to, tone }: { label: string; value: number; to: string; tone?: "brand" | "green" }) {
  const ring = tone === "brand" ? "ring-brand-200 bg-brand-50" : tone === "green" ? "ring-emerald-200 bg-emerald-50" : "ring-slate-200 bg-white";
  return (
    <Link to={to} className={`card block px-4 py-3 ring-1 transition hover:shadow-sm ${ring}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-400">открыть вкладку →</div>
    </Link>
  );
}
