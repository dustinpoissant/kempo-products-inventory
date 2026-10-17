import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql, eq } from 'drizzle-orm';
import { join } from 'path';
import db from 'kempo/server/db/index.js';
import { hook, extension } from 'kempo/server/db/schema.js';
import createHook from 'kempo/server/utils/hooks/createHook.js';
import { clearHandlerCache } from 'kempo/server/utils/hooks/triggerHook.js';
import { createProduct, getProduct, deleteProduct, addLedgerEntry, getLedgerEntry, setQuantity } from 'kempo-products/sdk';
import { createItem, getItem, adjustQuantity, deleteItem } from 'kempo-inventory/sdk';
import { kempoProductInventoryLink, kempoProductInventoryDeduction, kempoProductInventoryProblem } from '../server/db/schema.js';
import { saveLinks, getLinks } from '../server/utils/links.js';
import { recalculateProduct, recalculateAll, NAME } from '../server/utils/recalculate.js';
import { getProblems } from '../server/utils/problems.js';
import install from '../install.js';

/*
  The whole connector against a real database, with the real hooks registered: a sale added to the ledger
  in kempo-products takes materials out of kempo-inventory, and every product made from them shows
  what can still be made. It skips itself when no throwaway database is reachable (its name must end
  in _test): it empties the product, inventory and connector tables first.

  Requires Postgres carrying kempo's schema, kempo-products', kempo-inventory's and this
  extension's (`npx drizzle-kit push --force`), with DATABASE_URL set.
*/
const url = process.env.DATABASE_URL ?? '';
/*
  The unit tier (KEMPO_DB=pglite) is an in-memory database that is always a throwaway. Otherwise the
  database must be one whose name ends in _test, since these suites empty its tables.
*/
const unitTier = process.env.KEMPO_DB === 'pglite';
const reachable = (unitTier || /_test$/.test(url.split('?')[0])) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

if(!reachable && process.env.KEMPO_TEST_TIER === 'integration'){
  throw new Error('The integration tier needs DATABASE_URL pointing at a throwaway Postgres named *_test with the schema applied (npx drizzle-kit push --force).');
}

const root = join(import.meta.dirname, '..');

const HOOKS = {
  'kempo-products:ledger:before_add': 'hooks/ledger-before-add.js',
  'kempo-products:ledger:add_failed': 'hooks/ledger-add-failed.js',
  'kempo-products:product:deleted': 'hooks/product-deleted.js',
  'kempo-inventory:quantity:adjusted': 'hooks/quantity-adjusted.js',
  'kempo-inventory:item:before_delete': 'hooks/item-before-delete.js',
};

/* The other extensions' tables are emptied by name: they are reached through their SDKs everywhere else. */
const FOREIGN_TABLES = ['kempoProductLedger', 'kempoProductOption', 'kempoProduct', 'kempoProductField', 'kempoProductType', 'kempoInventoryMovement', 'kempoInventoryItem'];

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

/* What a shop does: a sale takes quantity from the ledger, and putting it back is the entry that undoes it. */
const SHOP = 'test-shop';
const sell = (ref, productId, quantity = 1, options = {}) => addLedgerEntry({ ref, reason: 'sale', lines: [{ productId, change: -quantity, options }], actor: SHOP });
const putBack = (ref, productId, quantity = 1) => addLedgerEntry({ ref: `${ref}:return`, undoes: ref, reason: 'return', lines: [{ productId, change: quantity }], actor: SHOP });

const quantityOf = async id => ok(await getItem(id)).quantity;
const productQuantity = async id => ok(await getProduct(id)).quantity;
const choiceOf = async (id, optionKey, choiceKey) => ok(await getProduct(id)).options.find(option => option.key === optionKey).choices.find(choice => choice.key === choiceKey);

after(() => unitTier ? db.$client.close() : db.$client.end());

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
    await db.delete(extension).where(eq(extension.name, NAME));
    await db.insert(extension).values({ name: NAME, version: '0.0.0', enabled: true, kempo: {}, installedAt: new Date(), updatedAt: new Date() }).onConflictDoUpdate({ target: extension.name, set: { enabled: true } });
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
      await db.delete(extension).where(eq(extension.name, NAME));
    }
  });

  describe('linking', () => {
    test('a linked product takes its quantity and choice availability from the materials', async () => {
      const product = ok(await getProduct(car.id));
      assert.equal(product.managedBy, NAME);
      assert.equal(product.quantity, 2, 'the TPU only makes two');
      assert.equal((await choiceOf(car.id, 'color', 'red')).available, true);
      assert.equal((await choiceOf(car.id, 'color', 'blue')).available, false, 'not enough blue paint');
    });

    test('a person cannot override managed quantity', async () => {
      const { updateProduct } = await import('kempo-products/sdk');
      refused(await updateProduct(car.id, { quantity: 99 }), 403);
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
    test('a sale takes the fixed materials and the chosen colour, and every figure follows', async () => {
      ok(await sell('order-1', car.id, 1, { color: 'red' }));
      assert.equal(await quantityOf(resin.id), 825);
      assert.equal(await quantityOf(tpu.id), 18);
      assert.equal(await quantityOf(red.id), 20);
      assert.equal(await quantityOf(blue.id), 15, 'the colour not chosen is untouched');
      assert.equal(await productQuantity(car.id), 1, 'the TPU now makes one');
      assert.equal((await choiceOf(car.id, 'color', 'red')).available, true);
    });

    test('what was taken is remembered per entry', async () => {
      const rows = await db.select().from(kempoProductInventoryDeduction).where(eq(kempoProductInventoryDeduction.ref, 'order-1'));
      assert.deepEqual(rows.map(row => row.amount).sort((a, b) => a - b), [12, 20, 175]);
    });

    test('the last unit sells and the product goes out of stock', async () => {
      ok(await sell('order-2', car.id, 1, { color: 'red' }));
      assert.equal(await productQuantity(car.id), 0);
      assert.equal((await choiceOf(car.id, 'color', 'red')).available, false, 'the red paint is used up too');
      refused(await sell('order-3', car.id, 1, { color: 'red' }), 409);
      assert.equal(await quantityOf(tpu.id), 6);
    });

    test('an entry that puts a sale back returns exactly what it took', async () => {
      ok(await putBack('order-2', car.id));
      assert.equal(await quantityOf(resin.id), 825);
      assert.equal(await quantityOf(tpu.id), 18);
      assert.equal(await quantityOf(red.id), 20);
      assert.equal(await productQuantity(car.id), 1);
      const taken = await db.select().from(kempoProductInventoryDeduction).where(eq(kempoProductInventoryDeduction.ref, 'order-2'));
      assert.ok(taken.every(row => row.reversed));
    });

    test('a sale of a product with no links leaves inventory alone', async () => {
      const plain = ok(await createProduct({ name: 'Plain', price: 100, status: 'published', quantity: 3 }));
      const before = await quantityOf(resin.id);
      ok(await sell('plain-1', plain.id));
      assert.equal(await quantityOf(resin.id), before);
      assert.equal(await productQuantity(plain.id), 2);
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
      assert.equal(await productQuantity(first.id), 1);
      assert.equal(await productQuantity(second.id), 1);

      ok(await sell('pla-1', first.id));
      assert.equal(await quantityOf(pla.id), 100);
      assert.equal(await productQuantity(first.id), 0);
      assert.equal(await productQuantity(second.id), 0, 'the other product can no longer be made either');
      refused(await sell('pla-2', second.id), 409);
    });

    test('a colour is linked to its own filament: one car running out of blue does not touch its red, and the other car follows only through the shared blue', async () => {
      const blueFilament = ok(await createItem({ sku: 'FIL-BLUE', name: 'Blue filament (g)', quantity: 60 }));
      const redFilament = ok(await createItem({ sku: 'FIL-RED', name: 'Red filament (g)', quantity: 500 }));
      const options = [{ label: 'Colour', choices: [{ label: 'Blue' }, { label: 'Red' }] }];
      const sedan = ok(await createProduct({ name: 'Sedan', price: 1500, status: 'published', options }));
      const truck = ok(await createProduct({ name: 'Truck', price: 1800, status: 'published', options }));
      ok(await saveLinks(sedan.id, [
        { inventoryItemId: blueFilament.id, quantity: 50, optionKey: 'colour', choiceKey: 'blue' },
        { inventoryItemId: redFilament.id, quantity: 50, optionKey: 'colour', choiceKey: 'red' },
      ]));
      ok(await saveLinks(truck.id, [
        { inventoryItemId: blueFilament.id, quantity: 30, optionKey: 'colour', choiceKey: 'blue' },
        { inventoryItemId: redFilament.id, quantity: 90, optionKey: 'colour', choiceKey: 'red' },
      ]));
      await recalculateAll();
      for(const car of [sedan, truck]) assert.equal((await choiceOf(car.id, 'colour', 'blue')).available, true);

      ok(await sell('sedan-blue', sedan.id, 1, { colour: 'blue' }));
      assert.equal(await quantityOf(blueFilament.id), 10);
      assert.equal(await quantityOf(redFilament.id), 500, 'red was never touched');
      assert.equal((await choiceOf(sedan.id, 'colour', 'blue')).available, false);
      assert.equal((await choiceOf(truck.id, 'colour', 'blue')).available, false, 'the truck needs 30 g of the same blue');
      assert.equal((await choiceOf(sedan.id, 'colour', 'red')).available, true);
      assert.equal((await choiceOf(truck.id, 'colour', 'red')).available, true);
      refused(await sell('truck-blue', truck.id, 1, { colour: 'blue' }), 409);
      ok(await sell('truck-red', truck.id, 1, { colour: 'red' }));
      assert.equal(await quantityOf(redFilament.id), 410);
    });

    test('restocking in the inventory brings products back', async () => {
      const pla = ok((await import('kempo-inventory/sdk').then(sdk => sdk.getItemBySku('PLA'))));
      ok(await adjustQuantity(pla.id, { delta: 400, reason: 'received' }));
      const chassis = ok((await import('kempo-products/sdk').then(sdk => sdk.getProducts({ q: 'Chassis' })))).items[0];
      assert.equal(chassis.quantity, 2);
      const wheels = ok((await import('kempo-products/sdk').then(sdk => sdk.getProducts({ q: 'Wheel' })))).items[0];
      assert.equal(wheels.quantity, 2);
    });
  });

  describe('when things go wrong', () => {
    test('materials that are not there refuse the sale, and the product shows what is really left', async () => {
      const glue = ok(await createItem({ sku: 'GLUE', name: 'Glue (ml)', quantity: 10 }));
      const widget = ok(await createProduct({ name: 'Glued widget', price: 500, status: 'published' }));
      ok(await saveLinks(widget.id, [{ inventoryItemId: glue.id, quantity: 5 }]));
      await recalculateProduct(widget.id);
      assert.equal(await productQuantity(widget.id), 2);

      /* The shelf is emptied without telling anyone (a count done outside the system). */
      await db.execute(sql`update "kempoInventoryItem" set "quantity" = 0 where "id" = ${glue.id}`);
      const error = refused(await sell('stale-1', widget.id), 409);
      assert.match(error.msg, /Insufficient quantity of Glue/);
      refused(await getLedgerEntry('stale-1'), 404);
      assert.equal(await productQuantity(widget.id), 0);
      assert.equal(await quantityOf(glue.id), 0, 'nothing went negative');
    });

    test('an entry that then fails gives the materials back', async () => {
      const cord = ok(await createItem({ sku: 'CORD', name: 'Cord (m)', quantity: 10 }));
      const fan = ok(await createProduct({ name: 'Corded fan', price: 900, status: 'published' }));
      ok(await saveLinks(fan.id, [{ inventoryItemId: cord.id, quantity: 2 }]));
      await recalculateProduct(fan.id);
      const plain = ok(await createProduct({ name: 'Short plain', price: 100, status: 'published', quantity: 1 }));
      refused(await addLedgerEntry({ ref: 'mixed-fail', actor: SHOP, lines: [{ productId: fan.id, change: -1 }, { productId: plain.id, change: -2 }] }), 409);
      assert.equal(await quantityOf(cord.id), 10);
      assert.equal(await productQuantity(fan.id), 5);
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

    test('disabling the connector hands its products back to people, and enabling it takes them back', async () => {
      const lent = ok(await createProduct({ name: 'Lent', price: 1, status: 'published' }));
      ok(await saveLinks(lent.id, [{ inventoryItemId: tpu.id, quantity: 1 }]));
      await recalculateProduct(lent.id);
      refused(await setQuantity(lent.id, 99), 403);
      await db.update(extension).set({ enabled: false }).where(eq(extension.name, NAME));
      assert.equal(ok(await getProduct(lent.id)).managedBy, '');
      assert.equal(ok(await setQuantity(lent.id, 99)).quantity, 99);
      await db.update(extension).set({ enabled: true }).where(eq(extension.name, NAME));
      assert.equal(ok(await getProduct(lent.id)).managedBy, NAME);
      await recalculateProduct(lent.id);
      assert.equal(await productQuantity(lent.id), await quantityOf(tpu.id), 'the connector puts it back in step with the materials');
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

  describe('putting back', () => {
    let beads;
    let kit;

    const setup = async name => {
      beads = ok(await createItem({ sku: `BEADS-${name}`, name: `Beads ${name}`, quantity: 10 }));
      kit = ok(await createProduct({ name: `Kit ${name}`, price: 500, status: 'published' }));
      ok(await saveLinks(kit.id, [{ inventoryItemId: beads.id, quantity: 2 }]));
      await recalculateProduct(kit.id);
    };

    test('a sale takes the materials at once, and the product follows', async () => {
      await setup('A');
      assert.equal(await productQuantity(kit.id), 5);
      ok(await sell('kit-a', kit.id, 2));
      assert.equal(await quantityOf(beads.id), 6);
      assert.equal(await productQuantity(kit.id), 3);
      await recalculateProduct(kit.id);
      assert.equal(await productQuantity(kit.id), 3, 'a recalculation agrees');
    });

    test('putting it back returns the materials, once, however many times it is added', async () => {
      ok(await putBack('kit-a', kit.id, 2));
      assert.equal(await quantityOf(beads.id), 10);
      assert.equal(await productQuantity(kit.id), 5);
      ok(await putBack('kit-a', kit.id, 2));
      assert.equal(await quantityOf(beads.id), 10);
    });

    test('adding to a linked product without saying what it puts back is refused: the quantity follows the materials', async () => {
      await setup('B');
      const error = refused(await addLedgerEntry({ lines: [{ productId: kit.id, change: 3 }], actor: SHOP }), 403);
      assert.match(error.msg, /made from inventory/);
      assert.equal(await productQuantity(kit.id), 5);
    });

    test('the last units cannot be sold twice, in products or in materials', async () => {
      await setup('D');
      ok(await sell('kit-d1', kit.id, 5));
      refused(await sell('kit-d2', kit.id), 409);
      assert.equal(await quantityOf(beads.id), 0);
    });

    test('a sale of one product takes the shared materials from the other, and putting it back gives them to both', async () => {
      const clay = ok(await createItem({ sku: 'CLAY-SHARED', name: 'Clay (g)', quantity: 300 }));
      const bowl = ok(await createProduct({ name: 'Clay bowl', price: 800, status: 'published' }));
      const vase = ok(await createProduct({ name: 'Clay vase', price: 900, status: 'published' }));
      ok(await saveLinks(bowl.id, [{ inventoryItemId: clay.id, quantity: 200 }]));
      ok(await saveLinks(vase.id, [{ inventoryItemId: clay.id, quantity: 200 }]));
      await recalculateAll();
      assert.equal(await productQuantity(vase.id), 1);

      ok(await sell('clay-1', bowl.id));
      assert.equal(await productQuantity(bowl.id), 0);
      assert.equal(await productQuantity(vase.id), 0, 'the clay is gone');
      refused(await sell('clay-2', vase.id), 409);
      assert.equal(await quantityOf(clay.id), 100);

      ok(await putBack('clay-1', bowl.id));
      assert.equal(await productQuantity(vase.id), 1, 'a cancelled order gives the clay back to both');
    });

    test('a product with no links sells and puts back without touching inventory', async () => {
      const plain = ok(await createProduct({ name: 'Plain sold', price: 100, status: 'published', quantity: 3 }));
      const before = await quantityOf(beads.id);
      ok(await sell('plain-sold', plain.id));
      assert.equal(await productQuantity(plain.id), 2);
      ok(await putBack('plain-sold', plain.id));
      assert.equal(await productQuantity(plain.id), 3);
      assert.equal(await quantityOf(beads.id), before);
    });
  });
});
