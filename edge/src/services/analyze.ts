// Детерминированный анализ смет — зеркало EstimateService.Analyze (Go — эталон).
// Правила и веса: RiskScore = min(100, high*20 + medium*8).

import type { EstimateAnalysis, EstimateAnomaly, EstimateItem, CategoryTotal } from "../types";

export function analyzeItems(estimateId: string, totalMinor: number, items: EstimateItem[]): EstimateAnalysis {
  const anomalies: EstimateAnomaly[] = [];
  let high = 0;
  let medium = 0;

  if (items.length === 0) {
    anomalies.push({
      severity: "high",
      kind: "empty",
      message: "В смете нет ни одной позиции",
      impactMinor: 0,
    });
    high++;
    const byCategory: CategoryTotal[] = [];
    return { estimateId, totalMinor, itemCount: 0, anomalies, riskScore: riskScore(high, medium), byCategory };
  }

  // R1: дубликаты по наименованию (без учёта регистра/пробелов).
  const byName = new Map<string, EstimateItem[]>();
  for (const it of items) {
    const key = it.name.trim().toLowerCase();
    if (!key) continue;
    const group = byName.get(key) ?? [];
    group.push(it);
    byName.set(key, group);
  }
  for (const group of byName.values()) {
    if (group.length > 1) {
      const impact = group.reduce((acc, it) => acc + it.totalMinor, 0);
      anomalies.push({
        severity: "medium",
        kind: "duplicate",
        itemId: group[0]?.id || undefined,
        itemName: group[0]?.name,
        message: `Позиция «${group[0]?.name}» встречается ${group.length} раза`,
        impactMinor: impact,
      });
      medium++;
    }
  }

  // R2: нулевые/отрицательные количество и цена.
  for (const it of items) {
    if (it.quantity <= 0) {
      anomalies.push({
        severity: "high",
        kind: "non_positive_qty",
        itemId: it.id || undefined,
        itemName: it.name,
        message: `Позиция «${it.name}»: нулевое или отрицательное количество`,
        impactMinor: it.totalMinor,
      });
      high++;
    }
    if (it.unitPriceMinor <= 0) {
      anomalies.push({
        severity: "medium",
        kind: "non_positive_price",
        itemId: it.id || undefined,
        itemName: it.name,
        message: `Позиция «${it.name}»: нулевая или отрицательная цена за единицу`,
        impactMinor: it.totalMinor,
      });
      medium++;
    }
  }

  // R3: доминирующая позиция (>40% суммы при более чем 3 позициях).
  if (items.length > 3 && totalMinor > 0) {
    for (const it of items) {
      const share = it.totalMinor / totalMinor;
      if (share > 0.4) {
        const percent = Math.round(share * 100);
        anomalies.push({
          severity: "medium",
          kind: "dominant_item",
          itemId: it.id || undefined,
          itemName: it.name,
          message: `Позиция занимает ${percent}% сметы — проверьте объём и цену`,
          impactMinor: it.totalMinor,
        });
        medium++;
      }
    }
  }

  // R4: расхождение суммы с «количество × цена».
  for (const it of items) {
    if (it.quantity > 0 && it.unitPriceMinor > 0) {
      const expected = Math.round(it.quantity * it.unitPriceMinor);
      const diff = Math.abs(it.totalMinor - expected);
      if (diff > 1) {
        anomalies.push({
          severity: "high",
          kind: "math_mismatch",
          itemId: it.id || undefined,
          itemName: it.name,
          message: `Сумма позиции не совпадает с «количество × цена»`,
          impactMinor: diff,
        });
        high++;
      }
    }
  }

  return {
    estimateId,
    totalMinor,
    itemCount: items.length,
    anomalies,
    riskScore: riskScore(high, medium),
    byCategory: byCategory(items),
  };
}

function riskScore(high: number, medium: number): number {
  return Math.min(100, high * 20 + medium * 8);
}

function byCategory(items: EstimateItem[]): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const it of items) {
    const cat = it.category || "прочее";
    const cur = map.get(cat) ?? { category: cat, totalMinor: 0, itemCount: 0 };
    cur.totalMinor += it.totalMinor;
    cur.itemCount += 1;
    map.set(cat, cur);
  }
  // Порядок как в Go: сортировка по сумме по убыванию.
  return [...map.values()].sort((a, b) => b.totalMinor - a.totalMinor);
}
