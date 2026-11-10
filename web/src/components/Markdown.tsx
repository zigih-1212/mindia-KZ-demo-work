import type { ReactNode } from "react";

/**
 * Минимальный markdown-рендерер для ответов AI-ассистента.
 *
 * Зачем свой, а не библиотека: ответы модели приходят в markdown (заголовки,
 * жирный текст, списки, таблицы), а в чате они показывались как plain text с
 * видимыми символами «**» и «|». Библиотека не нужна: поддерживаем ровно тот
 * синтаксис, который использует модель, и разбираем текст в React-узлы
 * (без dangerouslySetInnerHTML — вставка HTML из ответа модели невозможна).
 */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-slate-200 px-1 py-0.5 text-[12px] text-slate-800">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // noUncheckedIndexedAccess: обращаемся к строкам через безопасный геттер.
  const at = (idx: number): string => lines[idx] ?? "";
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = at(i);

    if (!line.trim()) {
      i++;
      continue;
    }

    // Таблица: строка с «|», за ней — строка-разделитель колонок.
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(at(i + 1)) && at(i + 1).includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && at(i).includes("|") && at(i).trim()) {
        rows.push(splitRow(at(i)));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {header.map((h, ci) => (
                  <th key={ci} className="px-3 py-2 font-semibold">{renderInline(h, `h${ci}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 align-top text-slate-700">{renderInline(cell, `c${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min((heading[1] ?? "#").length + 1, 5);
      const headingText = heading[2] ?? "";
      const Tag = (level === 3 ? "h4" : level === 4 ? "h5" : "h3") as "h3" | "h4" | "h5";
      blocks.push(
        <Tag key={key++} className="mt-3 text-[13px] font-semibold text-slate-900">
          {renderInline(headingText, `hd${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const numbered = NUMBERED_RE.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? NUMBERED_RE.exec(at(i)) : BULLET_RE.exec(at(i));
        if (!m) break;
        items.push(m[1] ?? "");
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++} className="my-1 list-disc space-y-0.5 pl-5 text-slate-700 marker:text-slate-400">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `li${ii}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    // Обычный абзац: собираем подряд идущие строки.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      at(i).trim() &&
      !at(i).includes("|") &&
      !HEADING_RE.test(at(i)) &&
      !BULLET_RE.test(at(i)) &&
      !NUMBERED_RE.test(at(i))
    ) {
      paragraph.push(at(i).trim());
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1 leading-relaxed">
        {renderInline(paragraph.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <div className="space-y-1">{blocks}</div>;
}
