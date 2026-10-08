import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql, eq } from 'drizzle-orm';
import { join } from 'path';
import db from 'kempo/server/db/index.js';
import { hook } from 'kempo/server/db/schema.js';
import createHook from 'kempo/server/utils/hooks/createHook.js';
import { clearHandlerCache } from 'kempo/server/utils/hooks/triggerHook.js';
import { createProduct, getProduct, deleteProduct, recordPurchase, reversePurchase } from 'kempo-products/sdk';
import { createItem, getItem, adjustStock, deleteItem } from 'kempo-inventory/sdk';
import { kempoProductInventoryLink, kempoProductInventoryDeduction, kempoProductInventoryProblem } from '../server/db/schema.js';
import { saveLinks, getLinks } from '../server/utils/links.js';
import { recalculateProduct, recalculateAll, NAME } from '../server/utils/recalculate.js';
import { getProblems } from '../server/utils/problems.js';
import install from '../install.js';

/*
  The whole connector against a real database, with the real hooks registered: a purchase recorded
  in kempo-products takes materials out of kempo-inventory, and every product made from them shows
  what can still be made. It skips itself when no throwaway database is reachable (its name must end
  in _test): it empties the product, inventory and connector tables first.

  Requires Postgres carrying kempo's schema, kempo-products', kempo-inventory's and this
  extension's (`npx drizzle-kit push --force`), with DATABASE_URL set.
*/
const url = process.env.DATABASE_URL ?? '';
const reachable = /_test$/.test(url.split('?')[0]) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

const root = join(import.meta.dirname, '..');

const HOOKS = {
  'kempo-products:purchase:recorded': 'hooks/purchase-recorded.js',
  'kempo-products:purchase:reversed': 'hooks/purchase-reversed.js',
  'kempo-products:product:deleted': 'hooks/product-deleted.js',
  'kempo-inventory:stock:adjusted': 'hooks/stock-adjusted.js',
  'kempo-inventory:item:before_delete': 'hooks/item-before-delete.js',
};

/* The other extensions' tables are emptied by name: they are reached through their SDKs everywhere else. */
const FOREIGN_TABLES = ['kempoProductPurchase', 'kempoProductOption', 'kempoProduct', 'kempoProductField', 'kempoProductType', 'kempoInventoryMovement', 'kempoInventoryItem'];

const purge = async () => {
  for(const table of [kempoProductInventoryDeduction, kempoProductInventoryProblem, kempoProductInventoryLink]) await db.delete(table);
  for(const name of FOREIGN_TABLES) await db.execute(sql.raw(`delete from "${name}"`));
};

const ok = ([error, value]) => {
  assert.equal(error, null, error?.msg);
  return value;
};

const refused = ([error, value], code) => {
  assert.ok(error, 'expected an error');
  assert.equal(value, null);
  if(code) assert.equal(error.code, code, error.msg);
  return error;
};

const stockOf = async id => ok(await getItem(id)).quantity;
const productStock = async id => ok(await getProduct(id)).stock;
const choiceOf = async (id, optionKey, choiceKey) => ok(await getProduct(id)).options.find(option => option.key === optionKey).choices.find(choice => choice.key === choiceKey);

after(() => db.$client.end());

describe('connector', { skip: reachable ? false : 'no throwaway database (set DATABASE_URL to one ending in _test)' }, () => {
  let resin;
  let tpu;
  let red;
  let blue;
  let car;

  before(async () => {
    await install();
    await purge();
    await db.delete(hook).where(eq(hook.owner, NAME));
    for(const [event, file] of Object.entries(HOOKS)) ok(await createHook({ owner: NAME, event, callback: join(root, file) }));
    clearHandlerCache();
    resin = ok(await createItem({ sku: 'RESIN', name: 'Resin (g)', quantity: 1000 }));
    tpu = ok(await createItem({ sku: 'TPU', name: 'TPU (g)', quantity: 30 }));
    red = ok(await createItem({ sku: 'RED', name: 'Red paint (ml)', quantity: 40 }));
    blue = ok(await createItem({ sku: 'BLUE', name: 'Blue paint (ml)', quantity: 15 }));
    car = ok(await createProduct({
      name: 'Model car', price: 4999, status: 'published',
      options: [{ label: 'Color', choices: [{ label: 'Red' }, { label: 'Blue' }] }],
    }));
    ok(await saveLinks(car.id, [
      { inventoryItemId: resin.id, quantity: 175 },
      { inventoryItemId: tpu.id, quantity: 12 },
      { inventoryItemId: red.id, quantity: 20, optionKey: 'color', choiceKey: 'red' },
      { inventoryItemId: blue.id, quantity: 20, optionKey: 'color', choiceKey: 'blue' },
    ]));
    await recalculateProduct(car.id);
  });

  after(async () => {
    if(reachable){
      await purge();
      await db.delete(hook).where(eq(hook.owner, NAME));
    }
  });

  describe('linking', () => {
    test('a linked product takes its stock and choice availability from the materials', async () => {
      const product = ok(await getProduct(car.id));
      assert.equal(product.managedBy, NAME);
      assert.equal(product.stock, 2, 'the TPU only makes two');
      assert.equal((await choiceOf(car.id, 'color', 'red')).available, true);
      assert.equal((await choiceOf(car.id, 'color', 'blue')).available, false, 'not enough blue paint');
    });

    test('a person cannot override managed stock', async () => {
      const { updateProduct } = await import('kempo-products/sdk');
      refused(await updateProduct(car.id, { stock: 99 }), 403);
    });

    test('links are validated before anything is written', async () => {
      refused(await saveLinks(car.id, [{ inventoryItemId: resin.id, quantity: 1.5 }]), 400);
      refused(await saveLinks(car.id, [{ inventoryItemId: resin.id, quantity: 0 }]), 400);
      refused(await saveLinks(car.id, [{ inventoryItemId: 'ffffffffffffffff', quantity: 1 }]), 400);
      refused(await saveLinks(car.id, [{ inventoryItemId: resin.id, quantity: 1, optionKey: 'color', choiceKey: 'green' }]), 400);
      refused(await saveLinks(car.id, [{ inventoryItemId: resin.id, quantity: 1, optionKey: 'color' }]), 400);
      refused(await saveLinks(car.id, [{ inventoryItemId: resin.id, quantity: 1 }, { inventoryItemId: resin.id, quantity: 2 }]), 400);
      refused(await saveLinks('ffffffffffffffff', []), 404);
      assert.equal(ok(await getLinks({ productId: car.id })).length, 4, 'the original links are untouched');
    });
  });

  describe('selling', () => {
    test('a purchase takes the fixed materials and the chosen colour, and every figure follows', async () => {
      ok(await recordPurchase({ ref: 'order-1', lines: [{ productId: car.id, quantity: 1, options: { color: 'red' } }] }));
      assert.equal(await stockOf(resin.id), 825);
      assert.equal(await stockOf(tpu.id), 18);
      assert.equal(await stockOf(red.id), 20);
      assert.equal(await stockOf(blue.id), 15, 'the colour not chosen is untouched');
      assert.equal(await productStock(car.id), 1, 'the TPU now makes one');
      assert.equal((await choiceOf(car.id, 'color', 'red')).available, true);
    });

    test('what was taken is remembered per purchase', async () => {
      const rows = await db.select().from(kempoProductInventoryDeduction).where(eq(kempoProductInventoryDeduction.ref, 'order-1'));
      assert.deepEqual(rows.map(row => row.amount).sort((a, b) => a - b), [12, 20, 175]);
    });

    test('the last unit sells and the product goes out of stock', async () => {
      ok(await recordPurchase({ ref: 'order-2', lines: [{ productId: car.id, options: { color: 'red' } }] }));
      assert.equal(await productStock(car.id), 0);
      assert.equal((await choiceOf(car.id, 'color', 'red')).available, false, 'the red paint is used up too');
      refused(await recordPurchase({ ref: 'order-3', lines: [{ productId: car.id, options: { color: 'red' } }] }), 409);
      assert.equal(await stockOf(tpu.id), 6);
    });

    test('reversing a purchase puts back exactly what it took', async () => {
      ok(await reversePurchase('order-2'));
      assert.equal(await stockOf(resin.id), 825);
      assert.equal(await stockOf(tpu.id), 18);
      assert.equal(await stockOf(red.id), 20);
      assert.equal(await productStock(car.id), 1);
      const taken = await db.select().from(kempoProductInventoryDeduction).where(eq(kempoProductInventoryDeduction.ref, 'order-2'));
      assert.ok(taken.every(row => row.reversed));
    });

    test('a purchase of a product with no links leaves inventory alone', async () => {
      const plain = ok(await createProduct({ name: 'Plain', price: 100, status: 'published', stock: 3 }));
      const before = await stockOf(resin.id);
      ok(await recordPurchase({ ref: 'plain-1', lines: [{ productId: plain.id }] }));
      assert.equal(await stockOf(resin.id), before);
      assert.equal(await productStock(plain.id), 2);
    });
  });

  describe('sharing materials', () => {
    test('two products needing the same filament both go out of stock when one is sold', async () => {
      const pla = ok(await createItem({ sku: 'PLA', name: 'Black PLA (g)', quantity: 300 }));
      const first = ok(await createProduct({ name: 'Chassis', price: 1000, status: 'published' }));
      const second = ok(await createProduct({ name: 'Wheel set', price: 1000, status: 'published' }));
      ok(await saveLinks(first.id, [{ inventoryItemId: pla.id, quantity: 200 }]));
      ok(await saveLinks(second.id, [{ inventoryItemId: pla.id, quantity: 200 }]));
      await recalculateAll();
      assert.equal(await productStock(first.id), 1);
      assert.equal(await productStock(second.id), 1);

      ok(await recordPurchase({ ref: 'pla-1', lines: [{ productId: first.id }] }));
      assert.equal(await stockOf(pla.id), 100);
      assert.equal(await productStock(first.id), 0);
      assert.equal(await productStock(second.id), 0, 'the other product can no longer be made either');
      refused(await recordPurchase({ ref: 'pla-2', lines: [{ productId: second.id }] }), 409);
    });

    test('restocking in the inventory brings products back', async () => {
      const pla = ok((await import('kempo-inventory/sdk').then(sdk => sdk.getItemBySku('PLA'))));
      ok(await adjustStock(pla.id, { delta: 400, reason: 'received' }));
      const chassis = ok((await import('kempo-products/sdk').then(sdk => sdk.getProducts({ q: 'Chassis' })))).items[0];
      assert.equal(chassis.stock, 2);
      const wheels = ok((await import('kempo-products/sdk').then(sdk => sdk.getProducts({ q: 'Wheel' })))).items[0];
      assert.equal(wheels.stock, 2);
    });
  });

  describe('when things go wrong', () => {
    test('materials that cannot be taken are recorded for a person, and the product shows what is really left', async () => {
      const glue = ok(await createItem({ sku: 'GLUE', name: 'Glue (ml)', quantity: 10 }));
      const widget = ok(await createProduct({ name: 'Glued widget', price: 500, status: 'published' }));
      ok(await saveLinks(widget.id, [{ inventoryItemId: glue.id, quantity: 5 }]));
      await recalculateProduct(widget.id);
      assert.equal(await productStock(widget.id), 2);

      /* The shelf is emptied without telling anyone (a count done outside the system). */
      await db.execute(sql`update "kempoInventoryItem" set "quantity" = 0 where "id" = ${glue.id}`);
      ok(await recordPurchase({ ref: 'stale-1', lines: [{ productId: widget.id }] }));

      const [, problems] = await getProblems();
      assert.ok(problems.some(problem => problem.ref === 'stale-1' && /Insufficient stock of Glue/.test(problem.message)));
      assert.equal(await productStock(widget.id), 0);
      assert.equal(await stockOf(glue.id), 0, 'nothing went negative');
    });

    test('an inventory item that products are made from cannot be deleted', async () => {
      const error = refused(await deleteItem(resin.id), 409);
      assert.match(error.msg, /Model car/);
      assert.equal(ok(await getItem(resin.id)).id, resin.id);
    });

    test('an unused item can be deleted', async () => {
      const spare = ok(await createItem({ sku: 'SPARE', name: 'Spare', quantity: 1 }));
      ok(await deleteItem(spare.id));
    });

    test('deleting a product removes what it was made from', async () => {
      const temp = ok(await createProduct({ name: 'Temporary', price: 1, status: 'published' }));
      ok(await saveLinks(temp.id, [{ inventoryItemId: tpu.id, quantity: 1 }]));
      ok(await deleteProduct(temp.id));
      assert.equal(ok(await getLinks({ productId: temp.id })).length, 0);
    });

    test('removing every link hands the product back to people', async () => {
      const free = ok(await createProduct({ name: 'Freed', price: 1, status: 'published' }));
      ok(await saveLinks(free.id, [{ inventoryItemId: tpu.id, quantity: 1 }]));
      await recalculateProduct(free.id);
      assert.equal(ok(await getProduct(free.id)).managedBy, NAME);
      ok(await saveLinks(free.id, []));
      await recalculateProduct(free.id);
      assert.equal(ok(await getProduct(free.id)).managedBy, '');
    });
  });
});
