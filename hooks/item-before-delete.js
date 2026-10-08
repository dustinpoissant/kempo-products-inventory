import { getLinks } from '../server/utils/links.js';
import { getProducts } from 'kempo-products/sdk';

/*
  A guard: an inventory item that products are made from cannot be deleted, because those products
  would be left with a material that is not there. The message names them.
*/
export default async ({ item }) => {
  const [, links] = await getLinks({ inventoryItemId: item.id });
  if(!links?.length) return;
  const ids = [...new Set(links.map(link => link.productId))];
  const [, found] = await getProducts({ ids, limit: ids.length });
  const names = (found?.items ?? []).map(product => product.name).join(', ');
  throw { code: 409, msg: `${item.name} is used by ${ids.length === 1 ? 'a product' : `${ids.length} products`}${names ? ` (${names})` : ''}. Remove it from ${ids.length === 1 ? 'it' : 'them'} first` };
};
