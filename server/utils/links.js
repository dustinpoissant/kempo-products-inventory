import db from 'kempo/server/db/index.js';
import { eq, inArray, asc } from 'drizzle-orm';
import crypto from 'crypto';
import { getProduct } from 'kempo-products/sdk';
import { getItems } from 'kempo-inventory/sdk';
import { kempoProductInventoryLink } from '../db/schema.js';

const newId = () => crypto.randomBytes(8).toString('hex');

const MAX_LINKS = 100;
const MAX_QUANTITY = 1000000;

const bad = msg => [{ code: 400, msg }, null];

export const getLinks = async ({ productId, inventoryItemId } = {}) => {
  try {
    const rows = await db.select().from(kempoProductInventoryLink)
      .where(productId ? eq(kempoProductInventoryLink.productId, productId) : inventoryItemId ? eq(kempoProductInventoryLink.inventoryItemId, inventoryItemId) : undefined)
      .orderBy(asc(kempoProductInventoryLink.created), asc(kempoProductInventoryLink.id));
    return [null, rows];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve links' }, null];
  }
};

/* The links of several products at once: Map of product id -> its links. */
export const getLinksByProduct = async productIds => {
  if(!productIds.length) return new Map();
  const rows = await db.select().from(kempoProductInventoryLink).where(inArray(kempoProductInventoryLink.productId, productIds));
  const byProduct = new Map();
  for(const row of rows) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row]);
  return byProduct;
};

/*
  Replaces everything a product is made from. Each link names an inventory item and how much of it
  one unit uses, optionally only when one choice of one of the product's options is selected. The
  whole list is checked before anything is written.
*/
export const saveLinks = async (productId, input) => {
  if(!Array.isArray(input)) return bad('links must be a list');
  if(input.length > MAX_LINKS) return bad(`A product can have at most ${MAX_LINKS} links`);

  const [productError, product] = await getProduct(productId);
  if(productError) return [productError, null];

  const links = [];
  const seen = new Set();
  for(const raw of input){
    const inventoryItemId = String(raw?.inventoryItemId ?? '').trim();
    const quantity = Number(raw?.quantity);
    const optionKey = String(raw?.optionKey ?? '').trim();
    const choiceKey = String(raw?.choiceKey ?? '').trim();
    if(!inventoryItemId) return bad('Every link needs an inventory item');
    if(!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY){
      return bad(`The amount used must be a whole number from 1 to ${MAX_QUANTITY}. Inventory counts whole units, so use grams or millilitres`);
    }
    if(Boolean(optionKey) !== Boolean(choiceKey)) return bad('A link to a choice needs both the option and the choice');
    if(optionKey){
      const option = product.options.find(candidate => candidate.key === optionKey);
      if(!option?.choices.some(choice => choice.key === choiceKey)) return bad(`"${optionKey}: ${choiceKey}" is not an option choice on this product`);
    }
    const id = `${inventoryItemId}/${optionKey}/${choiceKey}`;
    if(seen.has(id)) return bad('The same material is listed twice for the same choice. Add the amounts together');
    seen.add(id);
    links.push({ inventoryItemId, quantity, optionKey, choiceKey });
  }

  if(links.length){
    const ids = [...new Set(links.map(link => link.inventoryItemId))];
    const [itemsError, found] = await getItems({ ids, limit: ids.length });
    if(itemsError) return [itemsError, null];
    if(found.items.length !== ids.length) return bad('One of the inventory items no longer exists');
  }

  try {
    const rows = await db.transaction(async tx => {
      await tx.delete(kempoProductInventoryLink).where(eq(kempoProductInventoryLink.productId, product.id));
      if(!links.length) return [];
      const now = new Date();
      return tx.insert(kempoProductInventoryLink).values(links.map(link => ({ id: newId(), productId: product.id, ...link, created: now }))).returning();
    });
    return [null, rows];
  } catch {
    return [{ code: 500, msg: 'Failed to save links' }, null];
  }
};

export const deleteLinksForProduct = async productId => {
  await db.delete(kempoProductInventoryLink).where(eq(kempoProductInventoryLink.productId, productId));
};
