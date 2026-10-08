import authorize from '../../../server/utils/authorize.js';
import { getLinks } from '../../../server/utils/links.js';
import { getProducts } from 'kempo-products/sdk';
import { getItems } from 'kempo-inventory/sdk';

/*
  ?productId= is what one product is made from; ?inventoryItemId= is what uses one inventory item;
  with neither it is every link. All come back with the names and current stock needed to show them.
*/
export default async (request, response) => {
  const [authError] = await authorize(request, ['products:read', 'kempo-inventory:items:read']);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { productId, inventoryItemId } = request.query;
  const [error, links] = await getLinks({ productId, inventoryItemId });
  if(error) return response.status(error.code).json({ error: error.msg });

  const productIds = [...new Set(links.map(link => link.productId))];
  const itemIds = [...new Set(links.map(link => link.inventoryItemId))];
  const [, products] = await getProducts({ ids: productIds, limit: Math.max(productIds.length, 1) });
  const [, items] = await getItems({ ids: itemIds, limit: Math.max(itemIds.length, 1) });
  response.json({
    links,
    products: Object.fromEntries((products?.items ?? []).map(product => [product.id, { id: product.id, name: product.name, slug: product.slug, stock: product.stock }])),
    items: Object.fromEntries((items?.items ?? []).map(item => [item.id, { id: item.id, sku: item.sku, name: item.name, quantity: item.quantity }])),
  });
};
