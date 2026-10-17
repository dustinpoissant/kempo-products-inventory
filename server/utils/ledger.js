import db from 'kempo/server/db/index.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { adjustQuantityMany } from 'kempo-inventory/sdk';
import { kempoProductInventoryDeduction } from '../db/schema.js';
import { materialsFor } from './materials.js';
import { getLinksByProduct } from './links.js';
import { recalculateForItems, recalculateProducts, NAME } from './recalculate.js';
import { addProblem } from './problems.js';

const newId = () => crypto.randomBytes(8).toString('hex');

/*
  An entry in kempo-products' ledger that changes a linked product is answered here, before the ledger
  writes it, because a linked product's quantity is only ever written by this extension. Taking from the
  product (a sale) takes its materials from inventory, all together or not at all; when they cannot be
  taken the guard throws, the entry is refused with inventory's own message, and a linked product can never
  be oversold. Adding to it is only for an entry that puts back an earlier one (`undoes`), which returns
  exactly what that one took. Anything else would make a quantity the materials do not back.

  `lines` are the entry's lines ({ productId, change, options }); only the products this extension
  manages count, and `options` says which choice was sold, which decides which materials it uses.
*/
const ourLines = (lines, products) => {
  const ours = new Set(products.filter(product => product.managedBy === NAME).map(product => product.id));
  return lines.filter(line => ours.has(line.productId));
};

/* The materials were not there, so what the products showed was out of date: bring them up to date, then refuse with inventory's own message. */
const refuse = async (error, lines) => {
  await recalculateProducts(lines.map(line => line.productId));
  throw { code: error.code, msg: error.msg };
};

/* Takes the materials a sale uses out of inventory, remembering exactly what it took so an undo can put it back. Idempotent on the ref. */
export const takeMaterials = async ({ ref, lines, products }) => {
  const sold = ourLines(lines, products).filter(line => line.change < 0).map(line => ({ productId: line.productId, quantity: -line.change, selections: line.options }));
  const used = materialsFor(sold, await getLinksByProduct([...new Set(sold.map(line => line.productId))]));
  if(!used.size) return [null, { taken: 0 }];
  if((await db.select({ id: kempoProductInventoryDeduction.id }).from(kempoProductInventoryDeduction).where(and(eq(kempoProductInventoryDeduction.ref, ref), eq(kempoProductInventoryDeduction.reversed, false))).limit(1)).length) return [null, { taken: 0 }];

  const [error] = await adjustQuantityMany(
    [...used].map(([id, amount]) => ({ id, delta: -amount })),
    { reason: 'sale', ref, owner: NAME },
  );
  if(error) return [error, null];
  await db.insert(kempoProductInventoryDeduction).values([...used].map(([inventoryItemId, amount]) => ({
    id: newId(), ref, inventoryItemId, amount, created: new Date(),
  })));
  return [null, { taken: used.size }];
};

/* Puts back what the entry `ref` took, exactly, whatever the links say now. Idempotent: it is only put back once. */
export const returnDeductions = async ref => {
  const rows = await db.select().from(kempoProductInventoryDeduction)
    .where(and(eq(kempoProductInventoryDeduction.ref, ref), eq(kempoProductInventoryDeduction.reversed, false)));
  if(!rows.length) return [null, { returned: 0 }];

  const [error] = await adjustQuantityMany(
    rows.map(row => ({ id: row.inventoryItemId, delta: row.amount })),
    { reason: 'return', ref, owner: NAME },
  );
  if(error){
    await addProblem({ ref, message: `The materials taken by "${ref}" could not be put back: ${error.msg}.` });
    return [error, null];
  }
  await db.update(kempoProductInventoryDeduction).set({ reversed: true })
    .where(and(eq(kempoProductInventoryDeduction.ref, ref), eq(kempoProductInventoryDeduction.reversed, false)));
  await recalculateForItems(rows.map(row => row.inventoryItemId));
  return [null, { returned: rows.length }];
};

/* The guard the ledger asks before adding an entry that touches a product this extension manages. */
export const guardLedger = async data => {
  const ours = ourLines(data.lines, data.products);
  if(!ours.length) return;

  const adding = ours.filter(line => line.change > 0);
  if(adding.length){
    if(!data.undoes){
      const name = data.products.find(product => product.id === adding[0].productId)?.name ?? 'This product';
      throw { code: 403, msg: `${name} is made from inventory, so its quantity follows the materials. Add materials in inventory instead` };
    }
    const [error] = await returnDeductions(data.undoes);
    if(error) await refuse(error, ours);
  }

  const [error] = await takeMaterials(data);
  if(error) await refuse(error, ours);
};

/* An entry this extension agreed to did not happen, so whatever was taken for the ref goes back. */
export const giveBack = ref => returnDeductions(ref);
