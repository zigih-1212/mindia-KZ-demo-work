import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, HttpError } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Badge, EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import { Modal } from "../components/Modal";
import { SectionTabs, type TabDef } from "../components/Tabs";
import { canEditEstimates } from "../lib/rbac";
import {
  ESTIMATE_STATUS_LABELS,
  estimateStatusTone,
  formatDate,
  formatMoney,
  majorToMinor,
} from "../lib/format";
import type { EstimateStatus, Project } from "../types";

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
  const { user } = useAuth();
  // Кнопка создания скрывается у ролей без права редактировать сметы (API — источник истины).
  const mayEdit = canEditEstimates(user?.role);
  const [creating, setCreating] = useState(false);

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
            {mayEdit ? (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                Создать смету
              </button>
            ) : null}
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

      {creating ? (
        <EstimateFormModal
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

type DraftItem = { code: string; name: string; unit: string; quantity: string; price: string };

/** Форма создания сметы: доступна ролям с правом редактирования смет. */
function EstimateFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const projects = useAsync(() => api.listProjects({ limit: 100 }), []);
  const [form, setForm] = useState({ projectId: "", number: "", name: "" });
  const [items, setItems] = useState<DraftItem[]>([{ code: "", name: "", unit: "м3", quantity: "1", price: "0" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const setItem = (i: number, k: keyof DraftItem) => (e: { target: { value: string } }) =>
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, [k]: e.target.value } : it)));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    const payloadItems = items
      .filter((it) => it.name.trim())
      .map((it) => ({
        code: it.code.trim(),
        name: it.name.trim(),
        unit: it.unit.trim(),
        quantity: Number(it.quantity) || 0,
        unitPriceMinor: majorToMinor(it.price),
      }));
    if (payloadItems.length === 0) {
      setError("Добавьте хотя бы одну позицию с наименованием.");
      return;
    }
    setBusy(true);
    try {
      await api.createEstimate({
        projectId: form.projectId,
        number: form.number.trim(),
        name: form.name.trim(),
        items: payloadItems,
      });
      notify("Смета создана", "success");
      onSaved();
    } catch (err) {
      setError(err instanceof HttpError ? err.message : "Не удалось создать смету.");
    } finally {
      setBusy(false);
    }
  };

  const projectList: Project[] = projects.data?.items ?? [];

  return (
    <Modal
      title="Новая смета"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Отмена</button>
          <button type="submit" form="estimate-form" className="btn-primary" disabled={busy}>
            {busy ? "Сохранение…" : "Создать"}
          </button>
        </>
      }
    >
      {error ? <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <form id="estimate-form" onSubmit={submit} className="space-y-4" noValidate>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Объект</span>
          <select id="projectId" className="input" value={form.projectId} onChange={set("projectId")} required>
            <option value="">— выберите объект —</option>
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Номер</span>
            <input id="number" className="input" value={form.number} onChange={set("number")} placeholder="СМ-005" required />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Название</span>
            <input id="name" className="input" value={form.name} onChange={set("name")} placeholder="Фасадные работы" required />
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-slate-600">Позиции</span>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-xs"
              onClick={() => setItems((l) => [...l, { code: "", name: "", unit: "м3", quantity: "1", price: "0" }])}
            >
              + Добавить позицию
            </button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_1fr_5rem_6rem_8rem_2rem]">
                <input className="input" placeholder="Код" value={it.code} onChange={setItem(i, "code")} />
                <input className="input" placeholder="Наименование" value={it.name} onChange={setItem(i, "name")} />
                <input className="input" placeholder="Ед." value={it.unit} onChange={setItem(i, "unit")} />
                <input className="input" type="number" min="0" step="0.001" placeholder="Кол-во" value={it.quantity} onChange={setItem(i, "quantity")} />
                <input className="input" type="number" min="0" step="0.01" placeholder="Цена, ₸" value={it.price} onChange={setItem(i, "price")} />
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-xs text-red-600"
                  onClick={() => setItems((l) => (l.length > 1 ? l.filter((_, idx) => idx !== i) : l))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
