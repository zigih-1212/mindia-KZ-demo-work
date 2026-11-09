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
import { SectionTabs, type TabDef, useTab } from "../components/Tabs";
import {
  PROJECT_STATUS_LABELS,
  formatMoneyShort,
  formatRelative,
  projectStatusTone,
  utilizationPercent,
} from "../lib/format";

type Tab = "overview" | "budgets" | "approvals" | "activity";
const TABS: TabDef<Tab>[] = [
  { id: "overview", label: "Обзор" },
  { id: "budgets", label: "Бюджеты" },
  { id: "approvals", label: "Согласования" },
  { id: "activity", label: "Активность" },
];

export function DashboardPage() {
  const { data, loading, error, reload } = useAsync(() => api.dashboard(), []);
  const tab = useTab<Tab>("overview");

  return (
    <div>
      <PageHeader
        title="Дашборд"
        subtitle="Сводка по портфелю — переключайте под-разделы внутри страницы"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/projects?tab=active" className="btn-secondary text-sm">Активные объекты</Link>
            <Link to="/estimates?tab=pending" className="btn-secondary text-sm">Сметы на проверке</Link>
            <Link to="/documents?tab=submitted" className="btn-secondary text-sm">Документы на проверке</Link>
          </div>
        }
      />

      <SectionTabs tabs={TABS} defaultTab="overview" />

      {loading && !data ? (
        <LoadingRows rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Нет данных" description="Сводка появится после загрузки." />
      ) : (
        <div className="space-y-6">
          {tab === "overview" ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Link to="/projects"><StatCard label="Объектов всего" value={String(data.projectsTotal)} hint={`${data.projectsActive} в работе`} tone="brand" /></Link>
                <Link to="/projects?tab=active"><StatCard label="Бюджет портфеля" value={formatMoneyShort(data.budgetMinor)} hint={`Освоено ${formatMoneyShort(data.spentMinor)}`} /></Link>
                <Link to="/estimates?tab=pending"><StatCard label="Смет на согласовании" value={String(data.estimatesPending)} hint={`Всего смет: ${data.estimatesTotal}`} tone={data.estimatesPending > 0 ? "warn" : "good"} /></Link>
                <Link to="/documents?tab=submitted"><StatCard label="Документов в работе" value={String(data.documentsPending)} hint={data.overdueProjects > 0 ? `Просрочено объектов: ${data.overdueProjects}` : "Просрочек нет"} tone={data.overdueProjects > 0 ? "warn" : "default"} /></Link>
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="card p-5 lg:col-span-2">
                  <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-900">Бюджеты по объектам</h2><Link to="/?tab=budgets" className="text-xs text-brand-600 hover:underline">подробнее →</Link></div>
                  {data.budgetsByProject.length === 0 ? <EmptyState title="Объектов пока нет" /> : (
                    <ul className="space-y-4">
                      {data.budgetsByProject.slice(0, 6).map((b) => {
                        const used = utilizationPercent(b.spentMinor, b.budgetMinor);
                        return (
                          <li key={b.projectId}>
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <Link to={`/projects/${b.projectId}`} className="truncate text-sm font-medium text-slate-800 hover:text-brand-600">{b.name}</Link>
                              <span className="shrink-0 text-xs text-slate-500">{formatMoneyShort(b.spentMinor)} / {formatMoneyShort(b.budgetMinor)}</span>
                            </div>
                            <ProgressBar value={used} tone={used > 90 ? "warn" : "brand"} />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="card p-5">
                  <h2 className="mb-4 text-sm font-semibold text-slate-900">Объекты по статусам</h2>
                  {data.projectsByStatus.length === 0 ? <EmptyState title="Нет данных" /> : (
                    <ul className="space-y-2">
                      {data.projectsByStatus.map((s) => (
                        <li key={s.status} className="flex items-center justify-between text-sm">
                          <Link to={`/projects?tab=${s.status}`} className={`badge ${projectStatusTone(s.status)} hover:opacity-80`}>{PROJECT_STATUS_LABELS[s.status] ?? s.status}</Link>
                          <span className="font-medium text-slate-700">{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          ) : null}

          {tab === "budgets" ? (
            <div className="card p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Бюджеты по объектам (полный список)</h2>
              {data.budgetsByProject.length === 0 ? <EmptyState title="Объектов пока нет" /> : (
                <ul className="space-y-4">
                  {data.budgetsByProject.map((b) => {
                    const used = utilizationPercent(b.spentMinor, b.budgetMinor);
                    return (
                      <li key={b.projectId}>
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <Link to={`/projects/${b.projectId}`} className="truncate text-sm font-medium text-slate-800 hover:text-brand-600">{b.name}</Link>
                          <span className="shrink-0 text-xs text-slate-500">{formatMoneyShort(b.spentMinor)} / {formatMoneyShort(b.budgetMinor)}</span>
                        </div>
                        <ProgressBar value={used} tone={used > 90 ? "warn" : "brand"} />
                        <div className="mt-1 text-xs text-slate-400">Освоение {used}% · <Link className="text-brand-600 hover:underline" to={`/projects/${b.projectId}`}>открыть объект</Link></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}

          {tab === "approvals" ? (
            <div className="card p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Что ждёт согласования</h2>
              <p className="mb-4 text-sm text-slate-500">Открывайте нужный список внутри раздела — без лишних переходов.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Link to="/estimates?tab=pending" className="rounded-xl border border-slate-200 p-4 hover:border-brand-300 hover:bg-brand-50/40">
                  <div className="text-sm font-medium text-slate-900">Сметы на проверке</div>
                  <div className="mt-1 text-2xl font-semibold text-brand-700">{data.estimatesPending}</div>
                  <div className="text-xs text-slate-500">Перейти к сметам (вкладка «На проверке») →</div>
                </Link>
                <Link to="/documents?tab=submitted" className="rounded-xl border border-slate-200 p-4 hover:border-brand-300 hover:bg-brand-50/40">
                  <div className="text-sm font-medium text-slate-900">Документы в работе</div>
                  <div className="mt-1 text-2xl font-semibold text-brand-700">{data.documentsPending}</div>
                  <div className="text-xs text-slate-500">Перейти к документам (вкладка «На проверке») →</div>
                </Link>
              </div>
              {data.overdueProjects > 0 ? <p className="mt-4 text-sm text-amber-700">Просрочено объектов: {data.overdueProjects}. <Link className="underline" to="/projects?tab=active">Открыть активные</Link>.</p> : null}
            </div>
          ) : null}

          {tab === "activity" ? (
            <div className="card p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Последние действия</h2>
              {data.recentActivity.length === 0 ? <EmptyState title="Пока нет активности" /> : (
                <ul className="divide-y divide-slate-100">
                  {data.recentActivity.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                      <div>
                        <p className="text-sm text-slate-800">{a.summary || a.action}</p>
                        <p className="text-xs text-slate-500">{a.actorName}</p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{formatRelative(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
