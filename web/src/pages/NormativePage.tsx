import { useState } from "react";
import { api } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";

export function NormativePage() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data, loading, error, reload } = useAsync(() => api.listNormative(), []);

  const q = submitted.trim().toLowerCase();
  const items = (data?.items ?? []).filter(
    (d) =>
      !q ||
      d.code.toLowerCase().includes(q) ||
      d.title.toLowerCase().includes(q) ||
      d.section.toLowerCase().includes(q) ||
      d.content.toLowerCase().includes(q),
  );

  return (
    <div>
      <PageHeader
        title="Нормативная база"
        subtitle="СНиП, СП, ГОСТ и стандарты, используемые AI-ассистентом и сметчиками"
      />

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query);
        }}
      >
        <input
          className="input"
          placeholder="Поиск по коду, названию, содержанию (например: фундамент, КС-2, ГОСТ)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn-primary shrink-0">
          Найти
        </button>
      </form>

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          description="Попробуйте изменить поисковый запрос."
        />
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <article key={d.id} className="card p-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="rounded bg-brand-50 px-2 py-0.5 font-mono text-xs font-medium text-brand-700">
                  {d.code}
                </span>
                <h2 className="text-sm font-semibold text-slate-900">{d.title}</h2>
              </div>
              {d.section ? (
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                  {d.section}
                </p>
              ) : null}
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {d.content}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
