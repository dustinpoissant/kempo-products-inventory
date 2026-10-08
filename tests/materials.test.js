import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linksFor, perUnit, materialsFor, unitsAvailable, productStock, choiceInStock, linkedChoices } from '../server/utils/materials.js';

const link = (inventoryItemId, quantity, optionKey = '', choiceKey = '') => ({ inventoryItemId, quantity, optionKey, choiceKey });

/* A model car: 175 g of resin always, tyres in TPU, and the paint for whichever colour is chosen. */
const car = [link('resin', 175), link('tpu', 12), link('red-paint', 20, 'color', 'red'), link('blue-paint', 20, 'color', 'blue')];

test('a unit uses the fixed links and only the chosen choice\'s', () => {
  assert.deepEqual(linksFor(car, { color: 'red' }).map(l => l.inventoryItemId), ['resin', 'tpu', 'red-paint']);
  assert.deepEqual(linksFor(car, {}).map(l => l.inventoryItemId), ['resin', 'tpu']);
});

test('links to one item are added together', () => {
  assert.deepEqual([...perUnit([link('resin', 100), link('resin', 75), link('tpu', 1)])], [['resin', 175], ['tpu', 1]]);
});

test('a purchase uses its quantity of each material, across products', () => {
  const keychain = [link('resin', 35)];
  const used = materialsFor(
    [{ productId: 'car', quantity: 2, selections: { color: 'red' } }, { productId: 'keychain', quantity: 3, selections: {} }, { productId: 'unlinked', quantity: 9 }],
    new Map([['car', car], ['keychain', keychain]]),
  );
  assert.deepEqual([...used].sort(), [['red-paint', 40], ['resin', 175 * 2 + 35 * 3], ['tpu', 24]].sort());
});

test('the units that can be made are limited by the scarcest material', () => {
  const stock = new Map([['resin', 1000], ['tpu', 30]]);
  assert.equal(unitsAvailable([link('resin', 175), link('tpu', 12)], stock), 2);
  assert.equal(unitsAvailable([link('resin', 175)], stock), 5);
});

test('a material that is missing counts as none, and no links means no limit', () => {
  assert.equal(unitsAvailable([link('gone', 1)], new Map()), 0);
  assert.equal(unitsAvailable([], new Map()), Infinity);
});

test('the example from the design: 300 g of PLA, two products needing 200 g each', () => {
  const pla = [link('pla', 200)];
  assert.equal(productStock(pla, new Map([['pla', 300]])), 1);
  assert.equal(productStock(pla, new Map([['pla', 300 - 200]])), 0, 'after one sale both are out');
});

test('a product with only choice links has no stock limit of its own', () => {
  assert.equal(productStock([link('red-paint', 20, 'color', 'red')], new Map()), null);
});

test('a choice is in stock when its paint and the fixed materials can both make one more', () => {
  const stock = new Map([['resin', 175], ['tpu', 12], ['red-paint', 20], ['blue-paint', 5]]);
  assert.equal(choiceInStock(car, 'color', 'red', stock), true);
  assert.equal(choiceInStock(car, 'color', 'blue', stock), false, 'not enough blue paint');
  assert.equal(choiceInStock(car, 'color', 'red', new Map([...stock, ['resin', 100]])), false, 'not enough resin for any colour');
});

test('a choice sharing an item with the fixed links needs both amounts', () => {
  const links = [link('resin', 100), link('resin', 80, 'part', 'big')];
  assert.equal(choiceInStock(links, 'part', 'big', new Map([['resin', 179]])), false);
  assert.equal(choiceInStock(links, 'part', 'big', new Map([['resin', 180]])), true);
});

test('the choices that have links are listed once each', () => {
  assert.deepEqual(linkedChoices([...car, link('red-paint-2', 5, 'color', 'red')]), [{ optionKey: 'color', choiceKey: 'red' }, { optionKey: 'color', choiceKey: 'blue' }]);
});
