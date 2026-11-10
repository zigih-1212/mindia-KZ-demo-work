import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../components/Markdown";

describe("markdown-рендерер ответов ассистента", () => {
  it("рендерит жирный текст и заголовки без служебных символов", () => {
    render(<Markdown text={"## Итоги\n**Всего объектов:** 5"} />);
    expect(screen.getByText("Итоги")).toBeTruthy();
    expect(screen.getByText("Всего объектов:").tagName).toBe("STRONG");
    // Символы разметки не показываются как текст.
    expect(screen.queryByText(/^\*\*/)).toBeNull();
  });

  it("рендерит маркированный список", () => {
    render(<Markdown text={"- Проверка сметы\n- Проверка документов"} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe("Проверка сметы");
  });

  it("рендерит markdown-таблицу в настоящую таблицу", () => {
    render(
      <Markdown
        text={"| Код | Сумма |\n| --- | --- |\n| СМ-001 | 100 000 ₸ |\n| СМ-002 | 200 000 ₸ |"}
      />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("СМ-001")).toBeTruthy();
  });

  it("не выполняет HTML из ответа модели", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector("img")).toBeNull();
  });
});
