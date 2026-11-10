import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, HttpError } from "../services/api";
import { useAsync } from "../lib/useAsync";
import { EmptyState, PageHeader } from "../components/ui";
import { SectionTabs, type TabDef, useTab } from "../components/Tabs";
import { Markdown } from "../components/Markdown";
import type { AIMessage, AIChatResult } from "../types";

const SUGGESTIONS = [
  "Какие объекты сейчас в работе и есть ли перерасход бюджета?",
  "Проверь смету СМ-002 на дубли и ошибки.",
  "Что нужно для приёмки работ по КС-2? Найди в нормативах.",
  "Какие сметы и документы ждут согласования?",
  "Что такое исполнительная документация в строительстве?",
  "Привет, подскажи с чего начать работу в системе.",
];

type Tab = "chat" | "prompts" | "about";
const TABS: TabDef<Tab>[] = [
  { id: "chat", label: "Чат" },
  { id: "prompts", label: "Подсказки" },
  { id: "about", label: "О бюджете и возможностях" },
];

export function AssistantPage() {
  const conversations = useAsync(() => api.aiConversations(), []);
  const usage = useAsync(() => api.aiUsage(), []);
  const tab = useTab<Tab>("chat");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<AIChatResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    const conversationId = activeId;
    let cancelled = false;
    api
      .aiMessages(conversationId)
      .then((res) => {
        if (!cancelled) setMessages(res.items);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    setBusy(true);
    setInput("");
    const optimistic: AIMessage = {
      id: `local-${Date.now()}`,
      conversationId: activeId ?? "",
      role: "user",
      content,
      tokensIn: 0,
      tokensOut: 0,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    try {
      const result = await api.aiChat(activeId ?? "", content);
      setLastResult(result);
      setActiveId(result.conversationId);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), optimistic, result.message]);
      usage.reload();
      conversations.reload();
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setError(err instanceof HttpError ? err.message : "Ассистент недоступен. Попробуйте позже.");
    } finally {
      setBusy(false);
    }
  };

  const remaining =
    usage.data && usage.data.limitTotal > 0
      ? Math.max(0, Math.round((1 - (usage.data.tokensIn + usage.data.tokensOut) / usage.data.limitTotal) * 100))
      : null;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader
        title="AI-ассистент"
        subtitle="Строительная тематика и данные платформы — под-разделы внутри страницы"
        actions={
          usage.data ? (
            <div className="text-right">
              <div className="text-xs text-slate-500">Демо-лимит: {remaining ?? "—"}%</div>
              <div className="text-xs text-slate-400">{formatNum(usage.data.tokensIn + usage.data.tokensOut)} / {formatNum(usage.data.limitTotal)} токенов</div>
            </div>
          ) : null
        }
      />

      <SectionTabs tabs={TABS} defaultTab="chat" />

      {tab === "about" ? (
        <div className="card max-w-3xl space-y-4 p-5 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Возможности и ограничения</h2>
          <p>Ассистент отвечает по строительной тематике и по данным платформы «СтройКонтроль»: объекты, сметы, КС-2/КС-3, акты, счета, нормативы, материалы, безопасность и организация работ. Может поддержать простой диалог (приветствие, уточнения).</p>
          <p>Цифры по объектам/сметам/документам берутся из инструментов платформы — ассистент не должен их выдумывать. На темы вне строительства он мягко откажется.</p>
          <p><strong>Бюджет демо-режима:</strong> {usage.data ? `${formatNum(usage.data.tokensIn + usage.data.tokensOut)} / ${formatNum(usage.data.limitTotal)}` : "…"} токенов (общий на весь сайт). При исчерпании — ассистент отключается, остальные функции работают.</p>
          <Link className="btn-secondary inline-block" to="/assistant?tab=chat">Открыть чат</Link>
        </div>
      ) : null}

      {tab === "prompts" ? (
        <div className="card max-w-3xl p-5">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Примеры вопросов (нажмите, чтобы отправить в чат)</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => { send(s); window.history.replaceState(null, "", `${window.location.pathname}?tab=chat`); window.dispatchEvent(new PopStateEvent("popstate")); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-600 hover:border-brand-300 hover:bg-brand-50">
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "chat" ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[18rem_1fr]">
          <aside className="hidden flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:flex">
            <div className="border-b border-slate-200 p-3">
              <button className="btn-secondary w-full" onClick={() => setActiveId(null)}>+ Новый диалог</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {conversations.loading && !conversations.data ? (
                <div className="p-2 text-xs text-slate-400">Загрузка…</div>
              ) : conversations.data?.items.length === 0 ? (
                <div className="p-2 text-xs text-slate-400">Диалогов пока нет</div>
              ) : (
                <ul className="space-y-1">
                  {conversations.data?.items.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => setActiveId(c.id)} className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm ${activeId === c.id ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}>
                        {c.title || "Без названия"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="mx-auto max-w-2xl py-8">
                  <EmptyState title="Чем помочь по стройке и платформе?" description="Спрашивайте про объекты, сметы, документы, нормативы или общие строительные вопросы. Цифры по данным платформы берутся из системы." />
                  <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.slice(0, 4).map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-600 hover:border-brand-300 hover:bg-brand-50">{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <ul className="mx-auto max-w-3xl space-y-4">
                  {messages.map((m) => (<MessageBubble key={m.id} message={m} />))}
                  {busy ? (
                    <li className="flex gap-3">
                      <div className="h-8 w-8 shrink-0 rounded-full bg-brand-100 text-center text-sm leading-8 text-brand-700">AI</div>
                      <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2 text-sm text-slate-500">Думаю…</div>
                    </li>
                  ) : null}
                </ul>
              )}
            </div>

            {lastResult && lastResult.toolCalls && lastResult.toolCalls.length > 0 ? (
              <div className="border-t border-slate-100 px-4 py-2">
                <div className="text-xs text-slate-400">Использованы инструменты: {lastResult.toolCalls.map((t) => (<span key={t.name} className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">{t.name}</span>))}</div>
              </div>
            ) : null}

            {error ? <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div> : null}

            <form className="flex items-end gap-2 border-t border-slate-200 p-3" onSubmit={(e: FormEvent) => { e.preventDefault(); send(input); }}>
              <textarea className="input max-h-32 min-h-[44px] resize-y" rows={1} placeholder="Спросите про стройку или про данные платформы…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} disabled={busy} />
              <button type="submit" className="btn-primary shrink-0" disabled={busy || !input.trim()}>Отправить</button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MessageBubble({ message }: { message: AIMessage }) {
  const isUser = message.role === "user";
  return (
    <li className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`h-8 w-8 shrink-0 rounded-full text-center text-sm leading-8 ${isUser ? "bg-slate-200 text-slate-600" : "bg-brand-100 text-brand-700"}`}>{isUser ? "Вы" : "AI"}</div>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${isUser ? "whitespace-pre-line rounded-tr-sm bg-brand-600 text-white" : "rounded-tl-sm bg-slate-100 text-slate-800"}`}>
        {isUser ? message.content : <Markdown text={message.content} />}
        {!isUser && message.tokensOut > 0 ? <div className="mt-1 text-[11px] text-slate-400">{message.tokensIn + message.tokensOut} токенов</div> : null}
      </div>
    </li>
  );
}

function formatNum(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}
