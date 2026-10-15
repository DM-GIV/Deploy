import test from 'node:test';
import assert from 'node:assert/strict';
import { redactPersonalData } from '../lib/torgatlas-public-web-research.mjs';

test('VIN and registration plates are masked; the vehicle description stays', () => {
  const cases = [
    ['Автомобиль легковой, марка: Ford , модель: Focus, VIN: X9FKXXEEBKEB78986, гос. рег. номер: Т479РЕ73, год изготовления: 2018', /Ford , модель: Focus/, /X9FKXXEEBKEB78986|Т479РЕ73/],
    ['Легковой автомобиль, марка: Мазда, модель: Фамилиа, год изготовления: 2001, VIN: отсутствует, г/н: У582ЕА04, кузов', /Мазда/, /У582ЕА04/],
    ['Транспортное средство: ГАЗ-3102; Идентификационный номер (VIN) - X9631020051283939; Марка', /ГАЗ-3102/, /X9631020051283939/],
    ['Идентификационный номер (VIN): ХТН31105041230309; Марка', /Марка/, /ХТН31105041230309/],
    ['Полуприцеп бортовой СЗАП 9327, ГРЗ НА351426, 2014 года', /Полуприцеп бортовой СЗАП 9327/, /НА351426/],
    ['Мотоцикл Indian, гос. номер 5499ВО77, цвет черный', /Мотоцикл Indian/, /5499ВО77/],
    ['седан А123ВС77 серый', /седан/, /А123ВС77/]
  ];
  for (const [input, kept, gone] of cases) {
    const out = redactPersonalData(input);
    assert.match(out, kept, out);
    assert.doesNotMatch(out, gone, out);
  }
});

test('ordinary property text is not damaged by the vehicle rules', () => {
  for (const keep of [
    'Лот №4. Полуприцеп бортовой СЗАП 9327', 'Квартира площадью 141,4 кв.м, 2 этаж; кадастровый номер 63:09:0301161:1367',
    'Земельный участок 15 соток, категория земель: земли населённых пунктов', 'Нежилое помещение 105,8 кв. м по адресу: г. Москва, ул. Тверская, д. 7, этаж 2',
    'Станок токарный 16К20, год выпуска 1987', 'Автомобиль, год изготовления 2018, цвет белый, пробег 120000 км'
  ]) assert.equal(redactPersonalData(keep), keep, keep);
});
