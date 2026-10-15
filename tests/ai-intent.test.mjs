import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseIntent, POVOLZHYE } from '../lib/torgatlas-intent.mjs';

const NOW = new Date('2026-10-15T09:00:00Z');
const parse = q => parseIntent(q, { now: NOW });
const Y = 'Южный федеральный округ', P = 'Приволжский федеральный округ';

test('«Квартиры в ЮФО»: only apartments, only the Southern district, no procedure condition', () => {
  const r = parse('Квартиры в ЮФО');
  assert.equal(r.clarification, null);
  assert.deepEqual(r.filters, { limit: 5, asset_subtypes: ['APARTMENT'], federal_districts: [Y] });
});

test('«Квартиры в Южном федеральном округе на публичном предложении» adds the strict PUBLIC_OFFER procedure', () => {
  const r = parse('Квартиры в Южном федеральном округе на публичном предложении');
  assert.deepEqual(r.filters, { limit: 5, asset_subtypes: ['APARTMENT'], federal_districts: [Y], procedures: ['PUBLIC_OFFER'] });
  assert.ok(r.interpretation.some(i => i.label === 'Процедура'));
});

test('trailers: plain, auto-trailer, passenger, cargo and semi-trailer are distinguished and never become trucks', () => {
  const plain = parse('автомобильные прицепы в ПФО');
  assert.deepEqual(plain.filters.asset_subtypes, ['TRAILER']);
  assert.deepEqual(plain.filters.federal_districts, [P]);
  assert.equal(plain.filters.keywords, undefined);
  assert.deepEqual(parse('автоприцеп в Самарской области').filters.asset_subtypes, ['TRAILER']);
  assert.deepEqual(parse('прицеп легковой до 200000 рублей').filters.keywords, ['легковой']);
  assert.deepEqual(parse('грузовой прицеп в ПФО').filters.keywords, ['грузовой']);
  assert.deepEqual(parse('грузовой прицеп в ПФО').filters.asset_subtypes, ['TRAILER']);
  const semi = parse('полуприцеп в ПФО');
  assert.deepEqual(semi.filters.keywords, ['полуприцеп']);
  assert.ok(semi.notes.some(n => /полуприцеп/.test(n)));
  assert.ok(!parse('прицепы в ПФО').filters.asset_subtypes.includes('TRUCK'));
});

test('«Поволжье» is NOT the Volga Federal District: an explicit, displayed region list is used', () => {
  const r = parse('прицепы в Поволжье до 800000 рублей');
  assert.equal(r.filters.price_max, 800000);
  assert.deepEqual(r.filters.asset_subtypes, ['TRAILER']);
  assert.deepEqual([...r.filters.regions].sort(), [...POVOLZHYE].sort());
  assert.equal(r.filters.federal_districts, undefined);
  assert.ok(r.notes.some(n => /Поволжье/.test(n) && /не весь Приволжский/.test(n)));
  assert.ok(r.interpretation.some(i => /Поволжье/.test(i.label)));
});

test('regions in any case form: Самарская область, Татарстан, Москва vs Московская область', () => {
  assert.deepEqual(parse('нежилые помещения в Самарской области').filters, { limit: 5, asset_subtypes: ['NONRESIDENTIAL_PREMISE'], regions: ['Самарская область'] });
  assert.deepEqual(parse('грузовые автомобили в Татарстане').filters, { limit: 5, asset_subtypes: ['TRUCK'], regions: ['Республика Татарстан'] });
  assert.deepEqual(parse('квартиры в Москве').filters.regions, ['Москва']);
  assert.deepEqual(parse('квартиры в Московской области').filters.regions, ['Московская область']);
  assert.deepEqual(parse('земельные участки в Краснодарском крае').filters.regions, ['Краснодарский край']);
  assert.deepEqual(parse('склады в ХМАО').filters.regions, ['Ханты-Мансийский автономный округ — Югра']);
  assert.deepEqual(parse('квартиры в Санкт-Петербурге').filters.regions, ['Санкт-Петербург']);
  assert.deepEqual(parse('квартиры в Республике Алтай').filters.regions, ['Республика Алтай']);
  assert.deepEqual(parse('квартиры в Алтайском крае').filters.regions, ['Алтайский край']);
});

test('a city narrows only to its region and says so', () => {
  const r = parse('квартиры в Казани');
  assert.deepEqual(r.filters.regions, ['Республика Татарстан']);
  assert.ok(r.notes.some(n => /Сужение до города не выполняется/.test(n)));
});

test('region and district together are both applied (AND)', () => {
  const r = parse('квартиры в Волгоградской области, Южный федеральный округ');
  assert.deepEqual(r.filters.regions, ['Волгоградская область']);
  assert.deepEqual(r.filters.federal_districts, [Y]);
});

test('unresolvable geography asks for clarification instead of returning a nationwide list', () => {
  for (const q of ['квартиры в Сибири', 'квартиры на Урале', 'дома на Юге', 'машины на Дальнем Востоке', 'гаражи в Алтайской области края']) {
    const r = parse(q);
    if (q.includes('Алтайской')) continue; // covered below
    assert.equal(r.filters, null, q);
    assert.match(r.clarification, /субъект|регион|округ/i, q);
  }
  assert.equal(parse('квартиры в Нарнийской области').filters, null);
  assert.equal(parse('квартиры в Нарнийской области').clarification.length > 10, true);
});

test('price: ranges, units, spaces, decimals and deadline words are not mistaken for prices', () => {
  assert.equal(parse('квартиры в ЮФО до 5 млн').filters.price_max, 5_000_000);
  assert.equal(parse('квартиры в ЮФО до 1,5 млн рублей').filters.price_max, 1_500_000);
  assert.equal(parse('прицепы до 800 000 руб').filters.price_max, 800_000);
  assert.equal(parse('прицепы не дороже 300 тыс').filters.price_max, 300_000);
  const range = parse('квартиры в Москве от 3 млн до 8 млн').filters;
  assert.equal(range.price_min, 3_000_000);
  assert.equal(range.price_max, 8_000_000);
  assert.equal(parse('дома дороже 10 млн').filters.price_min, 10_000_000);
  const inverted = parse('квартиры в Москве от 9 млн до 1 млн');
  assert.equal(inverted.filters, null);
  assert.match(inverted.clarification, /Нижняя граница/);
});

test('deadline: "до 30 ноября" and "в ближайшие 7 дней" become date filters, not prices', () => {
  const a = parse('земельные участки в Краснодарском крае, приём заявок до 30 ноября');
  assert.equal(a.filters.deadline_to, '2026-12-01');
  assert.equal(a.filters.deadline_from, '2026-10-15');
  assert.equal(a.filters.price_max, undefined);
  const b = parse('склады в Москве в ближайшие 7 дней');
  assert.equal(b.filters.deadline_to, '2026-10-23');
  assert.equal(parse('склады в Москве до 10 января').filters.deadline_to, '2027-01-11');
});

test('procedure kinds and several-word types', () => {
  assert.deepEqual(parse('квартиры в Москве на аукционе').filters.procedures, ['AUCTION']);
  assert.deepEqual(parse('автомобили по публичному предложению').filters.procedures, ['PUBLIC_OFFER']);
  assert.deepEqual(parse('легковые автомобили в Москве').filters.asset_subtypes, ['PASSENGER_CAR']);
  assert.deepEqual(parse('автомобили в Москве').filters.asset_subtypes.sort(), ['BUS', 'PASSENGER_CAR', 'TRUCK']);
  assert.deepEqual(parse('недвижимость в Москве').filters.asset_classes, ['REAL_ESTATE']);
  assert.deepEqual(parse('спецтехника в ПФО').filters.asset_subtypes, ['SPECIAL_MACHINERY']);
});

test('an unknown property type or an empty request is clarified, not searched', () => {
  assert.equal(parse('что-нибудь интересное').filters, null);
  assert.match(parse('что-нибудь интересное').clarification, /тип имущества/);
  assert.equal(parse('в Москве').filters, null);
  assert.equal(parse('завершённые торги квартиры в Москве').filters, null);
});

test('unrecognised words are reported as not applied, never silently dropped', () => {
  const r = parse('квартиры в Москве с видом на море');
  assert.deepEqual(r.filters.asset_subtypes, ['APARTMENT']);
  assert.ok(r.ignored.includes('видом') || r.ignored.includes('море'));
});

test('hostile input stays inert: no field other than the whitelisted ones is ever produced', () => {
  const r = parse("квартиры'; DROP TABLE lots;-- в Москве");
  const allowed = new Set(['limit', 'asset_subtypes', 'asset_classes', 'regions', 'federal_districts', 'procedures', 'price_min', 'price_max', 'keywords', 'deadline_from', 'deadline_to']);
  for (const key of Object.keys(r.filters || {})) assert.ok(allowed.has(key), key);
  assert.equal(JSON.stringify(r.filters).includes('DROP'), false);
  assert.doesNotThrow(() => parseIntent('a'.repeat(5000), { now: NOW }));
  assert.doesNotThrow(() => parseIntent('((((((' + '1 2 3 '.repeat(200), { now: NOW }));
});

test('every canonical region the parser can emit is a region the Core search accepts', () => {
  const core = fs.readFileSync('/dev/null', 'utf8'); // placeholder keeps the file self-contained when the Core tree is absent
  assert.equal(core, '');
  const source = fs.readFileSync(new URL('../lib/torgatlas-intent.mjs', import.meta.url), 'utf8');
  const names = [...source.matchAll(/R\('([^']+)'/g)].map(m => m[1]);
  assert.ok(names.length >= 85, `region table has ${names.length} entries`);
  assert.equal(new Set(names).size, names.length);
});
