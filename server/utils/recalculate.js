import db from 'kempo/server/db/index.js';
import { inArray } from 'drizzle-orm';
import { getProduct, setStock, setManagedBy, setChoiceAvailability } from 'kempo-products/sdk';
import { getItems } from 'kempo-inventory/sdk';
import { kempoProductInventoryLink } from '../db/schema.js';
import { productStock, choiceInStock, linkedChoices } from './materials.js';
import { getLinksByProduct, deleteLinksForProduct } from './links.js';
import { addProblem } from './problems.js';

export const NAME = 'kempo-products-inventory';

/*
  Brings one product's stock and choice availability in line with the materials it is made from:
  stock is how many can be made from what is on hand, and a choice is in stock when one more can be
  made with it. A product with no links is left alone (and handed back to people if it had been
  ours); a product that no longer exists loses its links.
*/
export const recalculateProduct = async productId => {
  const [error, product] = await getProduct(productId);
  if(error){
    if(error.code === 404) await deleteLinksForProduct(productId);
    return;
  }
  const links = (await getLinksByProduct([product.id])).get(product.id) ?? [];
  if(!links.length){
    if(product.managedBy === NAME) await setManagedBy(product.id, '');
    return;
  }

  const ids = [...new Set(links.map(link => link.inventoryItemId))];
  const [itemsError, found] = await getItems({ ids, limit: ids.length });
  if(itemsError){
    await addProblem({ message: `Could not read inventory to update "${product.name}": ${itemsError.msg}` });
    return;
  }
  const stock = new Map(found.items.map(item => [item.id, item.quantity]));

  const [managedError] = await setManagedBy(product.id, NAME);
  if(managedError){
    await addProblem({ message: `"${product.name}" could not be linked to inventory: ${managedError.msg}` });
    return;
  }

  const target = productStock(links, stock);
  if(target !== null) await setStock(product.id, target, { actor: NAME, reason: 'materials' });

  for(const { optionKey, choiceKey } of linkedChoices(links)){
    /* A choice removed from the product since is not a problem: there is nothing left to mark. */
    await setChoiceAvailability(product.id, optionKey, choiceKey, choiceInStock(links, optionKey, choiceKey, stock), { actor: NAME });
  }
};

export const recalculateProducts = async productIds => {
  for(const id of new Set(productIds)) await recalculateProduct(id);
};

/* Every product that uses any of these inventory items. */
export const recalculateForItems = async itemIds => {
  if(!itemIds.length) return;
  const rows = await db.select({ productId: kempoProductInventoryLink.productId }).from(kempoProductInventoryLink)
    .where(inArray(kempoProductInventoryLink.inventoryItemId, itemIds));
  await recalculateProducts(rows.map(row => row.productId));
};

export const recalculateAll = async () => {
  const rows = await db.select({ productId: kempoProductInventoryLink.productId }).from(kempoProductInventoryLink);
  const ids = [...new Set(rows.map(row => row.productId))];
  await recalculateProducts(ids);
  return ids.length;
};
