import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, HttpError } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Badge, ErrorState, LoadingRows, PageHeader, ProgressBar } from "../components/ui";
import { ProjectFormModal } from "../components/ProjectFormModal";
import { SectionTabs, type TabDef, useTab } from "../components/Tabs";
import { canEditDocuments, canEditEstimates, canManageProjects } from "../lib/rbac";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  ESTIMATE_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  documentStatusTone,
  estimateStatusTone,
  formatDate,
  formatMoney,
  formatMoneyShort,
  projectStatusTone,
  utilizationPercent,
} from "../lib/format";

type Tab = "stages" | "estimates" | "documents";

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const role = user?.role;
  const canManage = canManageProjects(role);
  const canNewEstimate = canEditEstimates(role);
  const canNewDocument = canEditDocuments(role);
  const [editing, setEditing] = useState(false);
  const tab = useTab<Tab>("stages");

  const project = useAsync(() => api.getProject(id), [id]);
  const stages = useAsync(() => api.projectStages(id), [id]);
  const estimates = useAsync(() => api.listEstimates({ projectId: id, limit: 50 }), [id]);
  const documents = useAsync(() => api.listDocuments({ projectId: id, limit: 50 }), [id]);

  const tabs: TabDef<Tab>[] = [
    { id: "stages", label: "Этапы", count: stages.data?.items.length ?? 0 },
    { id: "estimates", label: "Сметы", count: estimates.data?.total ?? 0 },
    { id: "documents", label: "Документы", count: documents.data?.total ?? 0 },
  ];

  const onDelete = async () => {
    if (!confirm("Удалить объект? Действие необратимо.")) return;
    try {
      await api.deleteProject(id);
      notify("Объект удалён", "success");
      navigate("/projects");
    } catch (err) {
      notify(err instanceof HttpError ? err.message : "Не удалось удалить", "error");
    }
  };

  if (project.loading && !project.data) return <LoadingRows rows={6} />;
  if (project.error) return <ErrorState message={project.error} onRetry={project.reload} />;
  if (!project.data) return null;

  const p = project.data;
  const used = utilizationPercent(p.spentMinor, p.budgetMinor);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <Link to="/projects" className="text-slate-500 hover:text-brand-600">← К списку объектов</Link>
        <span className="text-slate-300">·</span>
        <Link to={`/estimates?projectId=${id}`} className="text-slate-500 hover:text-brand-600">Сметы объекта</Link>
        <span className="text-slate-300">·</span>
        <Link to={`/documents?projectId=${id}`} className="text-slate-500 hover:text-brand-600">Документы объекта</Link>
      </div>

      <PageHeader
        title={p.name}
        subtitle={`${p.code} · ${p.address || "адрес не указан"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canNewEstimate ? (
              <Link className="btn-secondary" to={`/estimates?projectId=${id}`}>К сметам</Link>
            ) : null}
            {canNewDocument ? (
              <Link className="btn-secondary" to={`/documents?projectId=${id}`}>К документам</Link>
            ) : null}
            {canManage ? (
              <>
                <button className="btn-secondary" onClick={() => setEditing(true)}>Редактировать</button>
                <button className="btn-danger" onClick={onDelete}>Удалить</button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500">Статус</div>
          <div className="mt-1"><Badge tone={projectStatusTone(p.status)}>{PROJECT_STATUS_LABELS[p.status]}</Badge></div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">Бюджет / Освоено</div>
          <div className="mt-1 text-sm font-medium text-slate-800">{formatMoneyShort(p.spentMinor)} / {formatMoneyShort(p.budgetMinor)}</div>
          <div className="mt-2"><ProgressBar value={used} tone={used > 90 ? "warn" : "brand"} /></div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">Заказчик</div>
          <div className="mt-1 text-sm font-medium text-slate-800">{p.customer || "—"}</div>
          <div className="mt-1 text-xs text-slate-500">Руководитель: {p.managerName || "не назначен"}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500">Сроки</div>
          <div className="mt-1 text-sm font-medium text-slate-800">{formatDate(p.startDate)} — {formatDate(p.plannedEndDate)}</div>
          <div className="mt-1 text-xs text-slate-500">Готовность {p.progressPercent}%</div>
        </div>
      </div>

      <div className="mt-6">
        <SectionTabs tabs={tabs} defaultTab="stages" />
      </div>

      <div className="mt-2">
        {tab === "stages" ? (
          stages.loading ? (
            <LoadingRows rows={4} />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="th">№</th>
                      <th className="th">Этап</th>
                      <th className="th">Статус</th>
                      <th className="th">План</th>
                      <th className="th">Плановая сумма</th>
                      <th className="th">Факт</th>
                      <th className="th">Готовность</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {(stages.data?.items ?? []).map((s) => (
                      <tr key={s.id}>
                        <td className="td text-slate-400">{s.sequence}</td>
                        <td className="td font-medium text-slate-800">{s.name}</td>
                        <td className="td"><Badge tone="slate">{STAGE_STATUS_LABELS[s.status]}</Badge></td>
                        <td className="td whitespace-nowrap text-slate-600">{formatDate(s.plannedStart)} — {formatDate(s.plannedEnd)}</td>
                        <td className="td whitespace-nowrap">{formatMoneyShort(s.plannedMinor)}</td>
                        <td className="td whitespace-nowrap">{formatMoneyShort(s.actualMinor)}</td>
                        <td className="td">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                              <div className="h-full rounded-full bg-brand-500" style={{ width: `${s.progressPercent}%` }} />
                            </div>
                            <span className="text-xs text-slate-500">{s.progressPercent}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(stages.data?.items.length ?? 0) === 0 ? (
                      <tr><td className="td text-slate-500" colSpan={7}>Этапов пока нет</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : null}

        {tab === "estimates" ? (
          estimates.loading ? (
            <LoadingRows rows={4} />
          ) : (
            <div className="card divide-y divide-slate-100">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-slate-600">Сметы по объекту</span>
                <div className="flex gap-2">
                  <Link className="text-sm text-brand-600 hover:underline" to={`/estimates?projectId=${id}`}>Открыть в разделе «Сметы» →</Link>
                </div>
              </div>
              {(estimates.data?.items ?? []).map((e) => (
                <Link key={e.id} to={`/estimates/${e.id}?from=project&projectId=${id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50">
                  <div>
                    <div className="font-mono text-xs text-slate-500">{e.number}</div>
                    <div className="text-sm font-medium text-slate-800">{e.name}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-700">{formatMoney(e.totalMinor)}</span>
                    <Badge tone={estimateStatusTone(e.status)}>{ESTIMATE_STATUS_LABELS[e.status]}</Badge>
                  </div>
                </Link>
              ))}
              {(estimates.data?.items.length ?? 0) === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">Смет по объекту нет</div>
              ) : null}
            </div>
          )
        ) : null}

        {tab === "documents" ? (
          documents.loading ? (
            <LoadingRows rows={4} />
          ) : (
            <div className="card divide-y divide-slate-100">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-slate-600">Документы по объекту</span>
                <Link className="text-sm text-brand-600 hover:underline" to={`/documents?projectId=${id}`}>Открыть в разделе «Документы» →</Link>
              </div>
              {(documents.data?.items ?? []).map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <div className="font-mono text-xs text-slate-500">{DOCUMENT_TYPE_LABELS[d.type]} {d.number}</div>
                    <div className="text-sm font-medium text-slate-800">{d.title}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-700">{formatMoney(d.amountMinor)}</span>
                    <Badge tone={documentStatusTone(d.status)}>{DOCUMENT_STATUS_LABELS[d.status]}</Badge>
                  </div>
                </div>
              ))}
              {(documents.data?.items.length ?? 0) === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">Документов по объекту нет</div>
              ) : null}
            </div>
          )
        ) : null}
      </div>

      {editing ? (
        <ProjectFormModal
          project={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            project.reload();
          }}
        />
      ) : null}
    </div>
  );
}
