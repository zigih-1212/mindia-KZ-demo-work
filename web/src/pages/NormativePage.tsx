import { useMemo, useState } from "react";
import { api } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import { SectionTabs, type TabDef, useTab } from "../components/Tabs";

type Tab = "all" | "gost" | "snip" | "fer" | "rules";
const TABS: TabDef<Tab>[] = [
  { id: "all", label: "Все" },
  { id: "gost", label: "ГОСТ" },
  { id: "snip", label: "СНиП / СП" },
  { id: "fer", label: "ФЕР / сметные" },
  { id: "rules", label: "Правила/документооборот" },
];

function matchesTab(code: string, title: string, section: string, tab: Tab): boolean {
  if (tab === "all") return true;
  const s = `${code} ${title} ${section}`.toLowerCase();
  if (tab === "gost") return s.includes("гост");
  if (tab === "snip") return s.includes("снип") || s.includes("сп ") || s.includes("сп\u00a0");
  if (tab === "fer") return s.includes("фер") || s.includes("гэсн") || s.includes("смет");
  if (tab === "rules") return s.includes("правил") || s.includes("документооборот") || s.includes("кс-") || s.includes("акт");
  return true;
}

export function NormativePage() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const tab = useTab<Tab>("all");

  const { data, loading, error, reload } = useAsync(() => api.listNormative(), []);

  const items = useMemo(() => {
    const q = submitted.trim().toLowerCase();
    return (data?.items ?? []).filter((d) => {
      if (!matchesTab(d.code, d.title, d.section, tab)) return false;
      if (!q) return true;
      return (
        d.code.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.section.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q)
      );
    });
  }, [data, submitted, tab]);

  return (
    <div>
      <PageHeader
        title="Нормативная база"
        subtitle="ГОСТ, СНиП/СП, ФЕР и правила — под-разделы фильтруются внутри страницы"
      />

      <SectionTabs tabs={TABS} defaultTab="all" />

      <form
        className="mb-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query);
        }}
      >
        <input
          className="input"
          placeholder="Поиск по коду, названию, содержанию (фундамент, КС-2, ГОСТ)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-2">
          <button type="submit" className="btn-primary shrink-0">Найти</button>
          {submitted ? (
            <button type="button" className="btn-secondary shrink-0" onClick={() => { setQuery(""); setSubmitted(""); }}>Сбросить</button>
          ) : null}
        </div>
      </form>

      <p className="mb-3 text-sm text-slate-500">Найдено: {items.length}. Вкладка ограничивает тип документов; поиск уточняет внутри вкладки.</p>

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState title="Ничего не найдено" description="Попробуйте другую вкладку или поисковый запрос." />
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <article key={d.id} className="card p-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="rounded bg-brand-50 px-2 py-0.5 font-mono text-xs font-medium text-brand-700">{d.code}</span>
                <h2 className="text-sm font-semibold text-slate-900">{d.title}</h2>
              </div>
              {d.section ? <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">{d.section}</p> : null}
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{d.content}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
