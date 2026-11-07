import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { Badge, EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import {
  ESTIMATE_STATUS_LABELS,
  estimateStatusTone,
  formatDate,
  formatMoney,
} from "../lib/format";
import type { EstimateStatus } from "../types";

const FILTERS: { value: EstimateStatus | "all"; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновик" },
  { value: "on_review", label: "На проверке" },
  { value: "approved", label: "Утверждена" },
  { value: "rejected", label: "Отклонена" },
  { value: "archived", label: "Архив" },
];

export function EstimatesPage() {
  const [status, setStatus] = useState<EstimateStatus | "all">("all");
  const [search, setSearch] = useState("");

  const { data, loading, error, reload } = useAsync(
    () =>
      api.listEstimates({
        status: status === "all" ? undefined : status,
        search: search.trim() || undefined,
        limit: 50,
      }),
    [status, search],
  );

  return (
    <div>
      <PageHeader
        title="Сметы"
        subtitle="Сметные расчёты по объектам с контролем версий и проверкой на аномалии"
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
        <EmptyState title="Сметы не найдены" description="Измените фильтры поиска." />
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
                      <Link
                        to={`/estimates/${e.id}`}
                        className="font-medium text-slate-900 hover:text-brand-600"
                      >
                        {e.name}
                      </Link>
                    </td>
                    <td className="td text-slate-600">{e.projectName || "—"}</td>
                    <td className="td text-slate-600">{e.itemCount}</td>
                    <td className="td whitespace-nowrap font-medium">
                      {formatMoney(e.totalMinor)}
                    </td>
                    <td className="td">
                      <Badge tone={estimateStatusTone(e.status)}>
                        {ESTIMATE_STATUS_LABELS[e.status]}
                      </Badge>
                    </td>
                    <td className="td whitespace-nowrap text-slate-500">
                      {formatDate(e.createdAt)}
                    </td>
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
