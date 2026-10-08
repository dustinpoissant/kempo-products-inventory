import db from 'kempo/server/db/index.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { adjustStockMany } from 'kempo-inventory/sdk';
import { kempoProductInventoryDeduction } from '../db/schema.js';
import { materialsFor } from './materials.js';
import { getLinksByProduct } from './links.js';
import { recalculateProducts, NAME } from './recalculate.js';
import { addProblem } from './problems.js';

const newId = () => crypto.randomBytes(8).toString('hex');

/*
  Takes the materials a purchase uses out of inventory, all together or not at all, and remembers
  exactly what it took. The purchase itself already stands, so when the materials cannot be taken
  (stock moved since products last looked) it is recorded as a problem for a person and the
  affected products are recalculated so they show what is really left.
*/
export const takeMaterials = async purchase => {
  const productIds = [...new Set(purchase.lines.map(line => line.productId))];
  const used = materialsFor(purchase.lines, await getLinksByProduct(productIds));
  if(!used.size) return [null, { taken: 0 }];

  const [error] = await adjustStockMany(
    [...used].map(([id, amount]) => ({ id, delta: -amount })),
    { reason: 'sale', ref: purchase.ref, owner: NAME },
  );
  if(error){
    await addProblem({ ref: purchase.ref, message: `The materials for "${purchase.ref}" could not be taken from inventory: ${error.msg}. The purchase stands; correct the stock by hand.` });
    await recalculateProducts(productIds);
    return [error, null];
  }
  await db.insert(kempoProductInventoryDeduction).values([...used].map(([inventoryItemId, amount]) => ({
    id: newId(), ref: purchase.ref, inventoryItemId, amount, created: new Date(),
  })));
  return [null, { taken: used.size }];
};

/* Puts back what a reversed purchase took, exactly, whatever the links say now. */
export const returnMaterials = async purchase => {
  const rows = await db.select().from(kempoProductInventoryDeduction)
    .where(and(eq(kempoProductInventoryDeduction.ref, purchase.ref), eq(kempoProductInventoryDeduction.reversed, false)));
  if(!rows.length) return [null, { returned: 0 }];

  const [error] = await adjustStockMany(
    rows.map(row => ({ id: row.inventoryItemId, delta: row.amount })),
    { reason: 'return', ref: purchase.ref, owner: NAME },
  );
  if(error){
    await addProblem({ ref: purchase.ref, message: `The materials for the reversed purchase "${purchase.ref}" could not be put back: ${error.msg}.` });
    return [error, null];
  }
  await db.update(kempoProductInventoryDeduction).set({ reversed: true })
    .where(and(eq(kempoProductInventoryDeduction.ref, purchase.ref), eq(kempoProductInventoryDeduction.reversed, false)));
  await recalculateProducts([...new Set(purchase.lines.map(line => line.productId))]);
  return [null, { returned: rows.length }];
};
