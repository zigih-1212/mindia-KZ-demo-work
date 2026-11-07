import { Link } from "react-router-dom";
import { api } from "../services/api";
import { useAsync } from "../lib/useAsync";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  ProgressBar,
  StatCard,
} from "../components/ui";
import {
  PROJECT_STATUS_LABELS,
  formatMoneyShort,
  formatRelative,
  projectStatusTone,
  utilizationPercent,
} from "../lib/format";

export function DashboardPage() {
  const { data, loading, error, reload } = useAsync(() => api.dashboard(), []);

  return (
    <div>
      <PageHeader
        title="Дашборд"
        subtitle="Сводка по портфелю объектов, сметам и документам"
      />

      {loading && !data ? (
        <LoadingRows rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Нет данных" description="Сводка появится после загрузки." />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Объектов всего"
              value={String(data.projectsTotal)}
              hint={`${data.projectsActive} в работе`}
              tone="brand"
            />
            <StatCard
              label="Бюджет портфеля"
              value={formatMoneyShort(data.budgetMinor)}
              hint={`Освоено ${formatMoneyShort(data.spentMinor)}`}
            />
            <StatCard
              label="Смет на согласовании"
              value={String(data.estimatesPending)}
              hint={`Всего смет: ${data.estimatesTotal}`}
              tone={data.estimatesPending > 0 ? "warn" : "good"}
            />
            <StatCard
              label="Документов в работе"
              value={String(data.documentsPending)}
              hint={
                data.overdueProjects > 0
                  ? `Просрочено объектов: ${data.overdueProjects}`
                  : "Просрочек нет"
              }
              tone={data.overdueProjects > 0 ? "warn" : "default"}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">
                Бюджеты по объектам
              </h2>
              {data.budgetsByProject.length === 0 ? (
                <EmptyState title="Объектов пока нет" />
              ) : (
                <ul className="space-y-4">
                  {data.budgetsByProject.map((b) => {
                    const used = utilizationPercent(b.spentMinor, b.budgetMinor);
                    return (
                      <li key={b.projectId}>
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <Link
                            to={`/projects/${b.projectId}`}
                            className="truncate text-sm font-medium text-slate-800 hover:text-brand-600"
                          >
                            {b.name}
                          </Link>
                          <span className="shrink-0 text-xs text-slate-500">
                            {formatMoneyShort(b.spentMinor)} / {formatMoneyShort(b.budgetMinor)}
                          </span>
                        </div>
                        <ProgressBar value={used} tone={used > 90 ? "warn" : "brand"} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">
                Объекты по статусам
              </h2>
              {data.projectsByStatus.length === 0 ? (
                <EmptyState title="Нет данных" />
              ) : (
                <ul className="space-y-2">
                  {data.projectsByStatus.map((s) => (
                    <li
                      key={s.status}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className={`badge ${projectStatusTone(s.status)}`}>
                        {PROJECT_STATUS_LABELS[s.status] ?? s.status}
                      </span>
                      <span className="font-medium text-slate-700">{s.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">
              Последние действия
            </h2>
            {data.recentActivity.length === 0 ? (
              <EmptyState title="Пока нет активности" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recentActivity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                    <div>
                      <p className="text-sm text-slate-800">{a.summary || a.action}</p>
                      <p className="text-xs text-slate-500">{a.actorName}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">
                      {formatRelative(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
