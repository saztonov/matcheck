import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseUpdText } from '../src/domain/edo/upd-pdf-local.parser.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'upd');

function load(name: string): string {
  const raw = readFileSync(join(fixturesDir, name), 'utf8');
  return raw.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

describe('parseUpdText — локальный парсер УПД-PDF', () => {
  it('УПД №961 (1С, 51 позиция) — извлекает все поля', () => {
    const r = parseUpdText(load('upd-961-1c.txt'));
    expect(r.docNumber).toBe('961');
    expect(r.docDate).toBe('2025-08-05');
    expect(r.supplier?.inn).toBe('7743429410');
    expect(r.recipient?.inn).toBe('7736255508');
    expect(r.totalSum).toBeCloseTo(339277.8, 1);
    expect(r.vatSum).toBeCloseTo(56546.3, 1);
    expect(r.items).toHaveLength(51);
    expect(r.items[0].nameRaw).toBe('Воздуховод ш20/ш20 700x300 Оцин 1 L=1250');
    expect(r.items[0].qty).toBe(1);
    expect(r.items[0].unit).toBe('шт');
    expect(r.items[0].price).toBeCloseTo(1992.33, 2);
    expect(r.items[0].vatRate).toBe(20);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('УПД №2493 (iText, 1 позиция с длинным именем) — корректные числа', () => {
    const r = parseUpdText(load('upd-2493.txt'));
    expect(r.docNumber).toBe('249/3');
    expect(r.docDate).toBe('2026-05-05');
    expect(r.supplier?.inn).toBe('7743917287');
    expect(r.recipient?.inn).toBe('7736255508');
    expect(r.totalSum).toBeCloseTo(555000, 0);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].nameRaw).toContain('Светильник');
    expect(r.items[0].nameRaw).toContain('Selecta');
    expect(r.items[0].qty).toBe(222);
    expect(r.items[0].price).toBeCloseTo(2049.18, 2);
    expect(r.items[0].sum).toBeCloseTo(454918.03, 2);
    expect(r.items[0].vatRate).toBe(22);
  });

  it('УПД №20121125720 (5 позиций, неоднозначные пробелы в числах) — partition по qty*price≈sum', () => {
    const r = parseUpdText(load('upd-20121125720.txt'));
    expect(r.docNumber).toBe('201/21125720');
    expect(r.docDate).toBe('2026-05-13');
    expect(r.items).toHaveLength(5);
    // последняя позиция была сломана при наивном greedy-разборе:
    // "180 134.02 24 122.95" → qty=180, price=134.02, sum=24122.95
    const last = r.items[4];
    expect(last.qty).toBe(180);
    expect(last.price).toBeCloseTo(134.02, 2);
    expect(last.sum).toBeCloseTo(24122.95, 2);
  });

  it('УПД №26051200033 (iText, 1 позиция, имя на 5 строк) — не съедает «SOLID 500» как новый item', () => {
    const r = parseUpdText(load('upd-26051200033.txt'));
    expect(r.docNumber).toBe('26051200033');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].nameRaw.startsWith('ТЕХНОНИКОЛЬ')).toBe(true);
    expect(r.items[0].nameRaw).toContain('SOLID 500');
    expect(r.items[0].qty).toBeCloseTo(72.576, 3);
    expect(r.items[0].unit).toBe('м3');
  });

  it('пустой текст → items=[], confidence=0', () => {
    const r = parseUpdText('Не УПД, просто текст. '.repeat(20));
    expect(r.items).toHaveLength(0);
    expect(r.confidence).toBe(0);
  });
});
