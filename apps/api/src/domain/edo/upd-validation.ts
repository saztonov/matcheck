import type { UpdCheck, UpdValidation } from '@matcheck/contracts';

// Duck-typed вход: подходит и для UpdPdfParsed (LLM/локальный PDF-парсер),
// и для UpdParsed (XML). Поля с одинаковыми именами — qty, price, sum,
// vatRate, vatSum, totalSum, vatSum (на документе) — везде хранятся как
// number | null. itemsCount пока есть только в UpdPdfParsed.
export type UpdLikeForValidation = {
  totalSum?: number | null;
  vatSum?: number | null;
  itemsCount?: number | null;
  items: ReadonlyArray<{
    qty?: number | null;
    price?: number | null;
    sum?: number | null;
    vatRate?: number | null;
    vatSum?: number | null;
  }>;
};

const ROW_TOLERANCE = 0.01;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function sumNullable(values: ReadonlyArray<number | null | undefined>): number {
  let acc = 0;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) acc += v;
  }
  return round2(acc);
}

export function validateUpdTotals(parsed: UpdLikeForValidation): UpdValidation {
  const checks: UpdCheck[] = [];
  const items = parsed.items;
  const rowCount = items.length;
  const totalsTolerance = Math.max(ROW_TOLERANCE, rowCount * ROW_TOLERANCE);

  // 1) Σ items.sum vs totalSum.
  //
  // ВАЖНО про базу сравнения. В стандартной форме УПД (ПР № 1137):
  //   - «Всего к оплате (9)» = сумма С НДС → попадает в parsed.totalSum.
  //   - Колонка «Стоимость без налога – всего» по строкам → item.sum.
  //   - parsed.vatSum — общий НДС из шапки.
  // То есть items.sum это база БЕЗ НДС, а totalSum — С НДС. Сравнивать
  // их напрямую нельзя — на любом УПД с НДС > 0 будет false-positive
  // (см. УПД 201/21125720: 162660.80 vs 133328.52 = разница ровно vatSum).
  // Если шапочный vatSum известен — приводим totalSum к базе «без НДС».
  // Если vatSum null/0 (документ без НДС или XML-парсер не извлёк) —
  // сравниваем напрямую.
  {
    const totalSum = parsed.totalSum ?? null;
    const vatSum = parsed.vatSum ?? null;
    if (totalSum == null) {
      checks.push({
        name: 'sum_total',
        scope: 'document',
        expected: null,
        actual: null,
        diff: null,
        tolerance: totalsTolerance,
        ok: true,
        skipReason: 'no_expected',
      });
    } else {
      const expected = round2(vatSum != null && vatSum > 0 ? totalSum - vatSum : totalSum);
      const actual = sumNullable(items.map((i) => i.sum ?? null));
      const diff = round2(Math.abs(expected - actual));
      checks.push({
        name: 'sum_total',
        scope: 'document',
        expected,
        actual,
        diff,
        tolerance: totalsTolerance,
        ok: diff <= totalsTolerance,
      });
    }
  }

  // 2) Σ items.vatSum vs vatSum (документа).
  //
  // PDF-флоу больше не извлекает vatSum по позициям (см. UpdPdfItemSchema:
  // поля убраны намеренно, чтобы LLM сосредоточилась на qty/price/sum).
  // В этом случае все items.vatSum пусты, sumNullable даёт 0, и сравнение
  // с шапочным vatSum > 0 всегда давало false-positive. Скипаем check,
  // когда нечего сравнивать. Для XML-флоу items.vatSum по-прежнему
  // заполняется парсером, и check работает как раньше.
  {
    const expected = parsed.vatSum ?? null;
    const hasAnyItemVat = items.some((i) => i.vatSum != null);
    if (expected == null) {
      checks.push({
        name: 'vat_total',
        scope: 'document',
        expected: null,
        actual: null,
        diff: null,
        tolerance: totalsTolerance,
        ok: true,
        skipReason: 'no_expected',
      });
    } else if (!hasAnyItemVat) {
      checks.push({
        name: 'vat_total',
        scope: 'document',
        expected: round2(expected),
        actual: null,
        diff: null,
        tolerance: totalsTolerance,
        ok: true,
        skipReason: 'no_actual',
      });
    } else {
      const actual = sumNullable(items.map((i) => i.vatSum ?? null));
      const diff = round2(Math.abs(expected - actual));
      checks.push({
        name: 'vat_total',
        scope: 'document',
        expected: round2(expected),
        actual,
        diff,
        tolerance: totalsTolerance,
        ok: diff <= totalsTolerance,
      });
    }
  }

  // 3) Кол-во позиций («Всего наименований» в шапке) vs items.length.
  {
    const expected = parsed.itemsCount ?? null;
    if (expected == null) {
      checks.push({
        name: 'items_count',
        scope: 'document',
        expected: null,
        actual: rowCount,
        diff: null,
        tolerance: 0,
        ok: true,
        skipReason: 'no_expected',
      });
    } else {
      const diff = Math.abs(expected - rowCount);
      checks.push({
        name: 'items_count',
        scope: 'document',
        expected,
        actual: rowCount,
        diff,
        tolerance: 0,
        ok: diff === 0,
      });
    }
  }

  // 4) Построчно: qty × price ≈ sum.
  //
  // Tolerance расширен до max(1₽, 0.1% от sum). Причина: поставщики
  // обычно печатают цену округлённой до 2 знаков, а сумму строки считают
  // по неокруглённой. Пример (УПД 201/21125720, строка 1):
  //   qty=600, price=65.49, sum=39295.08
  //   qty × price = 39294.00, расхождение 1.08₽
  //   реальная цена поставщика ≈ 65.4918, округлена до 65.49.
  // Жёсткий tolerance в копейку давал false-positive почти на каждом
  // реальном УПД. Расхождения «реальной» ошибки (перепутаны колонки,
  // qty распознано как код товара) — в десятки раз больше суммы, так
  // что чувствительность к настоящим багам сохраняется.
  items.forEach((it, idx) => {
    const row = idx + 1;
    const qty = it.qty ?? null;
    const price = it.price ?? null;
    const sum = it.sum ?? null;
    if (qty == null || price == null || sum == null) {
      checks.push({
        name: 'row_qty_price',
        scope: { row },
        expected: sum,
        actual: qty != null && price != null ? round2(qty * price) : null,
        diff: null,
        tolerance: ROW_TOLERANCE,
        ok: true,
        skipReason: sum == null ? 'no_expected' : 'no_actual',
      });
      return;
    }
    const actual = round2(qty * price);
    const diff = round2(Math.abs(sum - actual));
    const tolerance = round2(Math.max(1, Math.abs(sum) * 0.001));
    checks.push({
      name: 'row_qty_price',
      scope: { row },
      expected: round2(sum),
      actual,
      diff,
      tolerance,
      ok: diff <= tolerance,
    });
  });

  // 5) Построчно: sum × vatRate / 100 ≈ vatSum.
  items.forEach((it, idx) => {
    const row = idx + 1;
    const sum = it.sum ?? null;
    const vatRate = it.vatRate ?? null;
    const vatSum = it.vatSum ?? null;
    if (sum == null || vatRate == null || vatSum == null) {
      checks.push({
        name: 'row_vat_rate',
        scope: { row },
        expected: vatSum,
        actual: sum != null && vatRate != null ? round2((sum * vatRate) / 100) : null,
        diff: null,
        tolerance: ROW_TOLERANCE,
        ok: true,
        skipReason: vatSum == null ? 'no_expected' : 'no_actual',
      });
      return;
    }
    const actual = round2((sum * vatRate) / 100);
    const diff = round2(Math.abs(vatSum - actual));
    checks.push({
      name: 'row_vat_rate',
      scope: { row },
      expected: round2(vatSum),
      actual,
      diff,
      tolerance: ROW_TOLERANCE,
      ok: diff <= ROW_TOLERANCE,
    });
  });

  const hasMismatch = checks.some((c) => !c.ok);
  return {
    hasMismatch,
    checkedAt: new Date().toISOString(),
    checks,
  };
}
