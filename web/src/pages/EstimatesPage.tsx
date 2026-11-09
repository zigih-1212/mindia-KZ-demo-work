import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { Badge, EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import { SectionTabs, type TabDef } from "../components/Tabs";
import {
  ESTIMATE_STATUS_LABELS,
  estimateStatusTone,
  formatDate,
  formatMoney,
} from "../lib/format";
import type { EstimateStatus } from "../types";

type ViewTab = "all" | "pending" | EstimateStatus;
const TABS: TabDef<ViewTab>[] = [
  { id: "all", label: "Все" },
  { id: "pending", label: "На проверке" },
  { id: "draft", label: "Черновики" },
  { id: "approved", label: "Утверждённые" },
  { id: "rejected", label: "Отклонённые" },
  { id: "archived", label: "Архив" },
];

function toApiStatus(tab: ViewTab): EstimateStatus | undefined {
  if (tab === "all") return undefined;
  if (tab === "pending") return "on_review";
  return tab as EstimateStatus;
}

export function EstimatesPage() {
  const [sp] = useSearchParams();
  const tab = ((sp.get("tab") as ViewTab) || "all");
  const safeTab = TABS.some((t) => t.id === tab) ? tab : "all";
  const status = toApiStatus(safeTab);
  const [search, setSearch] = useState("");

  const { data, loading, error, reload } = useAsync(
    () =>
      api.listEstimates({
        status,
        search: search.trim() || undefined,
        limit: 100,
      }),
    [safeTab, search],
  );

  return (
    <div>
      <PageHeader
        title="Сметы"
        subtitle="Сметные расчёты с контролем версий и проверкой на аномалии — вкладки внутри раздела"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/documents?tab=submitted" className="btn-secondary text-sm">Документы на проверке</Link>
            <Link to="/projects" className="btn-secondary text-sm">К объектам</Link>
          </div>
        }
      />

      <SectionTabs tabs={TABS} defaultTab="all" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          {safeTab === "all" ? "Все сметы." : `Вкладка: ${safeTab === "pending" ? "На проверке" : ESTIMATE_STATUS_LABELS[safeTab as EstimateStatus]}.`} Открывайте смету для проверки/согласования.
        </p>
        <input
          className="input sm:max-w-xs"
          placeholder="Поиск по номеру, названию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="Сметы не найдены" description="Измените вкладку/поиск." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Номер</th>
                  <th className="th">Название</th>
                  <th className="th">Объект</th>
                  <th className="th">Позиций</th>
                  <th className="th">Сумма</th>
                  <th className="th">Статус</th>
                  <th className="th">Создана</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="td font-mono text-xs text-slate-500">{e.number}</td>
                    <td className="td">
                      <Link to={`/estimates/${e.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                        {e.name}
                      </Link>
                    </td>
                    <td className="td text-slate-600">
                      {e.projectId ? <Link className="hover:text-brand-600" to={`/projects/${e.projectId}`}>{e.projectName || "Объект"}</Link> : (e.projectName || "—")}
                    </td>
                    <td className="td text-slate-600">{e.itemCount}</td>
                    <td className="td whitespace-nowrap font-medium">{formatMoney(e.totalMinor)}</td>
                    <td className="td">
                      <Badge tone={estimateStatusTone(e.status)}>{ESTIMATE_STATUS_LABELS[e.status]}</Badge>
                    </td>
                    <td className="td whitespace-nowrap text-slate-500">{formatDate(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
