import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, HttpError } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Badge, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import { SectionTabs, type TabDef, useTab } from "../components/Tabs";
import { canApprove, canEditEstimates } from "../lib/rbac";
import {
  ESTIMATE_STATUS_LABELS,
  estimateStatusTone,
  formatDate,
  formatMoney,
  formatMoneyShort,
  severityTone,
} from "../lib/format";
import type { EstimateAnalysis, EstimateStatus } from "../types";

/** Матрица переходов (совпадает с backend/edge). */
const TRANSITIONS: Record<EstimateStatus, { to: EstimateStatus; label: string }[]> = {
  draft: [
    { to: "on_review", label: "Отправить на проверку" },
    { to: "archived", label: "В архив" },
  ],
  on_review: [
    { to: "approved", label: "Утвердить" },
    { to: "rejected", label: "Отклонить" },
    { to: "draft", label: "Вернуть в черновик" },
  ],
  rejected: [
    { to: "draft", label: "В черновик" },
    { to: "archived", label: "В архив" },
  ],
  approved: [{ to: "archived", label: "В архив" }],
  archived: [],
};

function canDoTransition(role: ReturnType<typeof useAuth>["user"] extends infer U ? (U extends { role: infer R } ? R : never) : never, from: EstimateStatus, to: EstimateStatus): boolean {
  if (to === "approved" || to === "rejected" || to === "archived") return canApprove(role);
  if (to === "on_review" || (from === "on_review" && to === "draft") || (from === "rejected" && to === "draft")) {
    return canEditEstimates(role);
  }
  return canEditEstimates(role);
}

type Tab = "items" | "analysis" | "info";

export function EstimateDetailPage() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const { user } = useAuth();
  const { notify } = useToast();
  const role = user?.role;
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<EstimateAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const tab = useTab<Tab>("items");

  const estimate = useAsync(() => api.getEstimate(id), [id]);
  const items = useAsync(() => api.estimateItems(id), [id]);

  const fromProject = sp.get("from") === "project" ? sp.get("projectId") : null;

  const runTransition = async (to: EstimateStatus) => {
    if (!estimate.data) return;
    setBusy(true);
    try {
      await api.transitionEstimate(id, to, estimate.data.version);
      notify(`Статус изменён: ${ESTIMATE_STATUS_LABELS[to]}`, "success");
      estimate.reload();
    } catch (err) {
      notify(err instanceof HttpError ? err.message : "Не удалось изменить статус", "error");
    } finally {
      setBusy(false);
    }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const result = await api.analyzeEstimate(id);
      setAnalysis(result);
      const next = new URLSearchParams(window.location.search);
      next.set("tab", "analysis");
      window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      notify(err instanceof HttpError ? err.message : "Ошибка анализа", "error");
    } finally {
      setAnalyzing(false);
    }
  };

  if (estimate.loading && !estimate.data) return <LoadingRows rows={6} />;
  if (estimate.error) return <ErrorState message={estimate.error} onRetry={estimate.reload} />;
  if (!estimate.data) return null;

  const e = estimate.data;
  const transitions = TRANSITIONS[e.status].filter((t) => canDoTransition(role, e.status, t.to));
  const canAnalyze = canEditEstimates(role);

  const tabs: TabDef<Tab>[] = [
    { id: "items", label: "Позиции", count: e.itemCount },
    { id: "analysis", label: "AI-проверка", count: analysis?.anomalies.length },
    { id: "info", label: "Сводка" },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <Link to="/estimates" className="text-slate-500 hover:text-brand-600">← К списку смет</Link>
        {e.projectId ? (
          <>
            <span className="text-slate-300">·</span>
            <Link to={`/projects/${e.projectId}${fromProject ? "?tab=estimates" : ""}`} className="text-slate-500 hover:text-brand-600">Объект</Link>
          </>
        ) : null}
      </div>

      <PageHeader
        title={e.name}
        subtitle={`${e.number} · ${e.currency} · версия ${e.version}`}
        actions={
          canAnalyze ? (
            <button className="btn-primary" onClick={runAnalysis} disabled={analyzing}>
              {analyzing ? "Анализ…" : "AI-проверка сметы"}
            </button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500">Статус</div>
          <div className="mt-1"><Badge tone={estimateStatusTone(e.status)}>{ESTIMATE_STATUS_LABELS[e.status]}</Badge></div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">Сумма сметы</div>
          <div className="mt-1 text-sm font-medium text-slate-800">{formatMoney(e.totalMinor)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">Позиций</div>
          <div className="mt-1 text-sm font-medium text-slate-800">{e.itemCount}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">Автор</div>
          <div className="mt-1 text-sm font-medium text-slate-800">{e.createdByName || "—"}</div>
          <div className="mt-1 text-xs text-slate-500">от {formatDate(e.createdAt)}</div>
        </div>
      </div>

      {transitions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {transitions.map((t) => (
            <button
              key={t.to}
              className={t.to === "approved" ? "btn-primary" : "btn-secondary"}
              onClick={() => runTransition(t.to)}
              disabled={busy}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        <SectionTabs tabs={tabs} defaultTab="items" />
      </div>

      {tab === "info" ? (
        <div className="card space-y-2 p-5 text-sm text-slate-700">
          <div><span className="text-slate-500">Номер:</span> {e.number}</div>
          <div><span className="text-slate-500">Валюта:</span> {e.currency}</div>
          <div><span className="text-slate-500">Версия:</span> {e.version}</div>
          <div><span className="text-slate-500">Создана:</span> {formatDate(e.createdAt)}</div>
          {e.projectId ? <div><span className="text-slate-500">Объект:</span> <Link className="text-brand-600 hover:underline" to={`/projects/${e.projectId}?tab=estimates`}>открыть</Link></div> : null}
        </div>
      ) : null}

      {tab === "analysis" ? (
        analysis ? (
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Результат AI-проверки сметы</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Индекс риска</span>
                <span className={`text-lg font-bold ${analysis.riskScore >= 40 ? "text-red-600" : analysis.riskScore > 0 ? "text-amber-600" : "text-emerald-600"}`}>{analysis.riskScore}</span>
              </div>
            </div>
            {analysis.anomalies.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Аномалий не обнаружено. Смета прошла проверку.</p>
            ) : (
              <ul className="space-y-2">
                {analysis.anomalies.map((a, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800">{a.message}</p>
                      {a.itemName ? <p className="text-xs text-slate-500">Позиция: {a.itemName}</p> : null}
                    </div>
                    {a.impactMinor ? <span className="ml-auto shrink-0 text-xs text-slate-500">{formatMoneyShort(a.impactMinor)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {analysis.byCategory.length > 0 ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Структура по категориям</h3>
                <div className="flex flex-wrap gap-2">
                  {analysis.byCategory.map((c) => (
                    <span key={c.category || "—"} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-700">{c.category || "Без категории"}: {formatMoneyShort(c.totalMinor)}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="card p-5 text-sm text-slate-600">
            Результатов проверки ещё нет. {canAnalyze ? <button className="text-brand-600 hover:underline" onClick={runAnalysis} disabled={analyzing}>{analyzing ? "Анализ…" : "Запустить AI-проверку"}</button> : "Недостаточно прав для анализа."}
          </div>
        )
      ) : null}

      {tab === "items" ? (
        items.loading && !items.data ? (
          <LoadingRows rows={6} />
        ) : (items.data?.items.length ?? 0) === 0 ? (
          <div className="card px-4 py-6 text-center text-sm text-slate-500">В смете нет позиций</div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">№</th>
                    <th className="th">Код</th>
                    <th className="th">Наименование</th>
                    <th className="th">Ед.</th>
                    <th className="th text-right">Кол-во</th>
                    <th className="th text-right">Цена</th>
                    <th className="th text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {items.data?.items.map((it) => (
                    <tr key={it.id}>
                      <td className="td text-slate-400">{it.position}</td>
                      <td className="td font-mono text-xs text-slate-500">{it.code}</td>
                      <td className="td text-slate-800">
                        {it.name}
                        {it.category ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{it.category}</span> : null}
                      </td>
                      <td className="td text-slate-500">{it.unit}</td>
                      <td className="td text-right">{it.quantity}</td>
                      <td className="td whitespace-nowrap text-right">{formatMoney(it.unitPriceMinor)}</td>
                      <td className="td whitespace-nowrap text-right font-medium">{formatMoney(it.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td className="td font-semibold text-slate-700" colSpan={6}>Итого</td>
                    <td className="td whitespace-nowrap text-right font-semibold text-slate-900">{formatMoney(e.totalMinor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
