import { useSearchParams } from "react-router-dom";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
}

// Вкладки внутри раздела: состояние в ?tab= (без перехода на другой раздел).
export function SectionTabs<T extends string>({
  tabs,
  param = "tab",
  defaultTab,
}: {
  tabs: TabDef<T>[];
  param?: string;
  defaultTab: T;
}) {
  const [sp, setSp] = useSearchParams();
  const active = (sp.get(param) as T) || defaultTab;
  const current = tabs.some((t) => t.id === active) ? active : defaultTab;
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const on = t.id === current;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              const next = new URLSearchParams(sp);
              if (t.id === defaultTab) next.delete(param);
              else next.set(param, t.id);
              setSp(next, { replace: true });
            }}
            className={`-mb-px rounded-t-lg border px-3 py-2 text-sm font-medium transition-colors ${
              on
                ? "border-slate-200 border-b-white bg-white text-brand-700"
                : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${on ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function useTab<T extends string>(defaultTab: T, param = "tab"): T {
  const [sp] = useSearchParams();
  return ((sp.get(param) as T) || defaultTab) as T;
}
