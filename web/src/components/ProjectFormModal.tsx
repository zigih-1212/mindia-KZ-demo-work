import { useState, type FormEvent } from "react";
import { api, HttpError } from "../services/api";
import { useToast } from "../context/ToastContext";
import { Modal } from "./Modal";
import { majorToMinor, minorToMajor, todayInput } from "../lib/format";
import { PROJECT_STATUS_LABELS } from "../lib/format";
import type { Project, ProjectStatus } from "../types";

interface Props {
  project?: Project;
  onClose: () => void;
  onSaved: () => void;
}

/** Форма создания и редактирования объекта. Для редактирования передаётся project. */
export function ProjectFormModal({ project, onClose, onSaved }: Props) {
  const { notify } = useToast();
  const isEdit = Boolean(project);
  const [form, setForm] = useState({
    code: project?.code ?? "",
    name: project?.name ?? "",
    customer: project?.customer ?? "",
    address: project?.address ?? "",
    status: (project?.status ?? "planning") as ProjectStatus,
    budget: project ? minorToMajor(project.budgetMinor) : "",
    contractAmount: project ? minorToMajor(project.contractAmountMinor) : "",
    startDate: project?.startDate ?? todayInput(),
    plannedEndDate: project?.plannedEndDate ?? "",
    progressPercent: String(project?.progressPercent ?? 0),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const body = {
      code: form.code.trim(),
      name: form.name.trim(),
      customer: form.customer.trim(),
      address: form.address.trim(),
      status: form.status,
      budgetMinor: majorToMinor(form.budget),
      contractAmountMinor: majorToMinor(form.contractAmount),
      startDate: form.startDate,
      plannedEndDate: form.plannedEndDate,
      progressPercent: Math.max(0, Math.min(100, Number(form.progressPercent) || 0)),
    };
    try {
      if (project) {
        await api.updateProject(project.id, { ...body, version: project.version });
        notify("Объект обновлён", "success");
      } else {
        await api.createProject(body);
        notify("Объект создан", "success");
      }
      onSaved();
    } catch (err) {
      const msg =
        err instanceof HttpError ? err.message : "Не удалось сохранить объект.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "Редактирование объекта" : "Новый объект"}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" form="project-form" className="btn-primary" disabled={busy}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </>
      }
    >
      <form id="project-form" onSubmit={submit} className="space-y-4" noValidate>
        {error ? (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="code">
              Код объекта *
            </label>
            <input id="code" className="input" value={form.code} onChange={set("code")} required />
          </div>
          <div>
            <label className="label" htmlFor="status">
              Статус
            </label>
            <select id="status" className="input" value={form.status} onChange={set("status")}>
              {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="name">
            Название *
          </label>
          <input id="name" className="input" value={form.name} onChange={set("name")} required />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="customer">
              Заказчик
            </label>
            <input
              id="customer"
              className="input"
              value={form.customer}
              onChange={set("customer")}
            />
          </div>
          <div>
            <label className="label" htmlFor="address">
              Адрес
            </label>
            <input id="address" className="input" value={form.address} onChange={set("address")} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="budget">
              Бюджет, ₸
            </label>
            <input
              id="budget"
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.budget}
              onChange={set("budget")}
            />
          </div>
          <div>
            <label className="label" htmlFor="contractAmount">
              Сумма договора, ₸
            </label>
            <input
              id="contractAmount"
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.contractAmount}
              onChange={set("contractAmount")}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="startDate">
              Дата начала
            </label>
            <input
              id="startDate"
              type="date"
              className="input"
              value={form.startDate}
              onChange={set("startDate")}
            />
          </div>
          <div>
            <label className="label" htmlFor="plannedEndDate">
              План. завершение
            </label>
            <input
              id="plannedEndDate"
              type="date"
              className="input"
              value={form.plannedEndDate}
              onChange={set("plannedEndDate")}
            />
          </div>
          <div>
            <label className="label" htmlFor="progressPercent">
              Готовность, %
            </label>
            <input
              id="progressPercent"
              type="number"
              min="0"
              max="100"
              className="input"
              value={form.progressPercent}
              onChange={set("progressPercent")}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
