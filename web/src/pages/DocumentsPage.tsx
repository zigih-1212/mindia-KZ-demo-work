import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, HttpError } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Modal } from "../components/Modal";
import { Badge, EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import { SectionTabs, type TabDef } from "../components/Tabs";
import { canApprove, canEditDocuments } from "../lib/rbac";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  documentStatusTone,
  formatDate,
  formatMoney,
  majorToMinor,
  todayInput,
} from "../lib/format";
import type { DocumentStatus, DocumentType, Project } from "../types";

type ViewTab = "all" | DocumentStatus;
const TABS: TabDef<ViewTab>[] = [
  { id: "all", label: "Все" },
  { id: "submitted", label: "На проверке" },
  { id: "draft", label: "Черновики" },
  { id: "approved", label: "Утверждённые" },
  { id: "rejected", label: "Отклонённые" },
];

export function DocumentsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [sp] = useSearchParams();
  const tab = ((sp.get("tab") as ViewTab) || "all");
  const status: DocumentStatus | "all" = (TABS.some((t) => t.id === tab) ? tab : "all") as ViewTab;
  const [type, setType] = useState<DocumentType | "all">("all");
  const [creating, setCreating] = useState(false);
  const mayApprove = canApprove(user?.role);
  const mayEdit = canEditDocuments(user?.role);

  const { data, loading, error, reload } = useAsync(
    () =>
      api.listDocuments({
        status: status === "all" ? undefined : status,
        type: type === "all" ? undefined : type,
        limit: 100,
      }),
    [status, type],
  );

  const transition = async (id: string, to: DocumentStatus, version: number) => {
    try {
      await api.transitionDocument(id, to, version);
      notify(`Документ: ${DOCUMENT_STATUS_LABELS[to]}`, "success");
      reload();
    } catch (err) {
      notify(err instanceof HttpError ? err.message : "Не удалось изменить статус", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Исполнительная документация"
        subtitle="Акты КС-2, КС-3, счета и акты — вкладки переключаются внутри раздела"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/projects" className="btn-secondary text-sm">К объектам</Link>
            <Link to="/estimates?tab=pending" className="btn-secondary text-sm">Сметы на проверке</Link>
            {mayEdit ? (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                + Новый документ
              </button>
            ) : null}
          </div>
        }
      />

      <SectionTabs tabs={TABS} defaultTab="all" />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-slate-500">
          {status === "all" ? "Все статусы." : `Вкладка: ${DOCUMENT_STATUS_LABELS[status]}.`} Действия зависят от вашей роли.
        </p>
        <select
          className="input lg:max-w-[16rem]"
          value={type}
          onChange={(e) => setType(e.target.value as DocumentType | "all")}
        >
          <option value="all">Все типы</option>
          {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((t) => (
            <option key={t} value={t}>
              {DOCUMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <LoadingRows rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="Документы не найдены" description="Измените вкладку/тип или создайте документ (прораб/менеджер/админ)." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Тип</th>
                  <th className="th">Номер</th>
                  <th className="th">Название</th>
                  <th className="th">Объект</th>
                  <th className="th">Период</th>
                  <th className="th">Сумма</th>
                  <th className="th">Статус</th>
                  <th className="th">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="td"><Badge tone="brand">{DOCUMENT_TYPE_LABELS[d.type]}</Badge></td>
                    <td className="td font-mono text-xs text-slate-500">{d.number}</td>
                    <td className="td font-medium text-slate-800">{d.title}</td>
                    <td className="td text-slate-600">
                      {d.projectId ? <Link className="hover:text-brand-600" to={`/projects/${d.projectId}`}>{d.projectName || "Объект"}</Link> : (d.projectName || "—")}
                    </td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">
                      {formatDate(d.periodFrom)} — {formatDate(d.periodTo)}
                    </td>
                    <td className="td whitespace-nowrap">{formatMoney(d.amountMinor)}</td>
                    <td className="td">
                      <Badge tone={documentStatusTone(d.status)}>{DOCUMENT_STATUS_LABELS[d.status]}</Badge>
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {d.status === "draft" && mayEdit ? (
                          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => transition(d.id, "submitted", d.version)}>На проверку</button>
                        ) : null}
                        {d.status === "submitted" && mayApprove ? (
                          <>
                            <button className="btn-ghost !px-2 !py-1 text-xs text-emerald-700" onClick={() => transition(d.id, "approved", d.version)}>Утвердить</button>
                            <button className="btn-ghost !px-2 !py-1 text-xs text-red-700" onClick={() => transition(d.id, "rejected", d.version)}>Отклонить</button>
                          </>
                        ) : null}
                        {d.status === "rejected" && mayEdit ? (
                          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => transition(d.id, "draft", d.version)}>В черновик</button>
                        ) : null}
                        {!mayEdit && !mayApprove ? <span className="text-xs text-slate-400">только просмотр</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating ? (
        <DocumentFormModal
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

function DocumentFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const projects = useAsync(() => api.listProjects({ limit: 100 }), []);
  const [form, setForm] = useState({
    projectId: "",
    type: "ks2" as DocumentType,
    number: "",
    title: "",
    periodFrom: todayInput(),
    periodTo: todayInput(),
    amount: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createDocument({
        projectId: form.projectId,
        type: form.type,
        number: form.number.trim(),
        title: form.title.trim(),
        periodFrom: form.periodFrom,
        periodTo: form.periodTo,
        amountMinor: majorToMinor(form.amount),
      });
      notify("Документ создан", "success");
      onSaved();
    } catch (err) {
      const msg = err instanceof HttpError ? err.message : "Не удалось создать документ.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const projectList: Project[] = projects.data?.items ?? [];

  return (
    <Modal
      title="Новый документ"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Отмена</button>
          <button type="submit" form="doc-form" className="btn-primary" disabled={busy}>
            {busy ? "Сохранение…" : "Создать"}
          </button>
        </>
      }
    >
      <form id="doc-form" onSubmit={submit} className="space-y-4" noValidate>
        {error ? <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        <div>
          <label className="label" htmlFor="projectId">Объект *</label>
          <select id="projectId" className="input" value={form.projectId} onChange={set("projectId")} required>
            <option value="">— выберите объект —</option>
            {projectList.map((p) => (<option key={p.id} value={p.id}>{p.code} · {p.name}</option>))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="type">Тип</label>
            <select id="type" className="input" value={form.type} onChange={set("type")}>
              {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((t) => (<option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="number">Номер *</label>
            <input id="number" className="input" value={form.number} onChange={set("number")} required />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="title">Название *</label>
          <input id="title" className="input" value={form.title} onChange={set("title")} required />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="periodFrom">Период с</label>
            <input id="periodFrom" type="date" className="input" value={form.periodFrom} onChange={set("periodFrom")} />
          </div>
          <div>
            <label className="label" htmlFor="periodTo">Период по</label>
            <input id="periodTo" type="date" className="input" value={form.periodTo} onChange={set("periodTo")} />
          </div>
          <div>
            <label className="label" htmlFor="amount">Сумма, ₸</label>
            <input id="amount" type="number" min="0" step="0.01" className="input" value={form.amount} onChange={set("amount")} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
