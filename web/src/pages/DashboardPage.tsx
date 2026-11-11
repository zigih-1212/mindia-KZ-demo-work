import { Link } from "react-router-dom";
import { api } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../context/AuthContext";
import { canApprove, canEditDocuments, canEditEstimates, canManageProjects } from "../lib/rbac";
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

type Tab = "overview" | "budgets" | "approvals" | "activity" | "resume";
const TABS: TabDef<Tab>[] = [
  { id: "overview", label: "Обзор" },
  { id: "budgets", label: "Бюджеты" },
  { id: "approvals", label: "Согласования" },
  { id: "activity", label: "Активность" },
  { id: "resume", label: "Резюме" },
];

// Названия ролей — для блока «Резюме» (что доступно текущему пользователю).
const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  manager: "Руководитель проектов",
  estimator: "Сметчик",
  foreman: "Прораб",
  customer: "Заказчик",
};

export function DashboardPage() {
  const { data, loading, error, reload } = useAsync(() => api.dashboard(), []);
  const usage = useAsync(() => api.aiUsage(), []);
  const { user } = useAuth();
  const role = user?.role;
  const tab = useTab<Tab>("overview");

  // Бюджет AI: показываем, сколько демо-лимита израсходовано (общий на сайт).
  const usedTokens = usage.data ? usage.data.tokensIn + usage.data.tokensOut : 0;
  const limitTokens = usage.data?.limitTotal ?? 0;
  const usedPercent = limitTokens > 0 ? Math.min(100, Math.round((usedTokens / limitTokens) * 100)) : 0;
  const remainingTokens = Math.max(0, limitTokens - usedTokens);

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

          {tab === "resume" ? (
            <div className="space-y-4">
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-slate-900">Резюме платформы</h2>
                <p className="mt-2 text-sm text-slate-600">
                  «СтройКонтроль» — демо-система управления строительными объектами: портфель объектов с
                  бюджетами и этапами, сметы с позициями и AI-проверкой, исполнительная документация
                  (КС-2/КС-3, акты, счета) и нормативная база. Внутри каждого раздела работают под-вкладки —
                  переключайте их, не покидая раздел.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs text-slate-500">Объекты</div>
                    <div className="text-lg font-semibold text-slate-900">{data.projectsTotal}</div>
                    <div className="text-xs text-slate-500">{data.projectsActive} в работе</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs text-slate-500">Сметы</div>
                    <div className="text-lg font-semibold text-slate-900">{data.estimatesTotal}</div>
                    <div className="text-xs text-slate-500">{data.estimatesPending} на согласовании</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs text-slate-500">Документы</div>
                    <div className="text-lg font-semibold text-slate-900">{data.documentsPending}</div>
                    <div className="text-xs text-slate-500">в работе</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs text-slate-500">Бюджет портфеля</div>
                    <div className="text-lg font-semibold text-slate-900">{formatMoneyShort(data.budgetMinor)}</div>
                    <div className="text-xs text-slate-500">освоено {formatMoneyShort(data.spentMinor)}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="card p-5">
                  <h2 className="text-sm font-semibold text-slate-900">Что доступно вашей роли</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Роль: <strong>{role ? ROLE_LABELS[role] ?? role : "—"}</strong>. Права проверяет сервер —
                    интерфейс только скрывает недоступные действия.
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    <li>• Просмотр объектов, смет, документов и нормативов — доступно всем ролям.</li>
                    <li>• Объекты: {canManageProjects(role) ? "создание, редактирование, удаление" : "только просмотр"}.</li>
                    <li>• Сметы: {canEditEstimates(role) ? "создание, позиции, отправка на проверку, AI-анализ" : "только просмотр"}.</li>
                    <li>• Документы: {canEditDocuments(role) ? "создание и отправка на согласование" : "только просмотр"}.</li>
                    <li>• Согласование и архиварование: {canApprove(role) ? "доступно" : "недоступно"}.</li>
                    <li>• AI-ассистент со сводкой по платформе — доступен всем ролям.</li>
                  </ul>
                </div>

                <div className="card p-5">
                  <h2 className="text-sm font-semibold text-slate-900">AI-ассистент</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Ассистент отвечает по данным платформы (объекты, сметы, документы, нормативы) и по
                    строительным вопросам; цифры берёт из служебных инструментов, а не выдумывает.
                  </p>
                  {usage.data ? (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-sm text-slate-700">
                        <span>Израсходовано токенов</span>
                        <span>{formatNum(usedTokens)} / {formatNum(limitTokens)}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${usedPercent}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Лимит общий на весь сайт (демо-режим). Осталось примерно {formatNum(remainingTokens)} токенов.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">Загрузка бюджета…</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link className="btn-secondary text-sm" to="/assistant?tab=chat">Открыть чат</Link>
                    <Link className="btn-secondary text-sm" to="/assistant?tab=about">О бюджете и возможностях</Link>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function formatNum(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}
