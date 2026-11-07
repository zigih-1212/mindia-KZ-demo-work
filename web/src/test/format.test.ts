import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatMoney,
  formatMoneyShort,
  majorToMinor,
  minorToMajor,
  utilizationPercent,
} from "../lib/format";

describe("денежные преобразования", () => {
  it("конвертирует минорные единицы в мажорные и обратно", () => {
    expect(minorToMajor(123456)).toBe(1234.56);
    expect(majorToMinor(1234.56)).toBe(123456);
    expect(majorToMinor(0)).toBe(0);
  });

  it("форматирует суммы с символом тенге", () => {
    const s = formatMoney(123456789);
    expect(s).toContain("₸");
    // Разделитель дробной части — запятая (локаль ru-RU).
    expect(s).toMatch(/1\s?234\s?567,89/);
  });

  it("сокращает крупные суммы до млрд/млн/тыс", () => {
    expect(formatMoneyShort(4_850_000_000_00)).toContain("млрд");
    expect(formatMoneyShort(3_200_000_00)).toContain("млн");
    expect(formatMoneyShort(45_000_00)).toContain("тыс");
  });
});

describe("даты", () => {
  it("форматирует ISO в дд.мм.гггг", () => {
    expect(formatDate("2026-03-12T12:00:00Z")).toMatch(/^\d{2}\.\d{2}\.2026$/);
  });
  it("возвращает прочерк для пустой и некорректной даты", () => {
    expect(formatDate("")).toBe("—");
    expect(formatDate("не дата")).toBe("—");
  });
});

describe("утилизация бюджета", () => {
  it("считает процент освоения", () => {
    expect(utilizationPercent(50, 100)).toBe(50);
    expect(utilizationPercent(0, 0)).toBe(0);
  });
});
