import authorize from '../../../server/utils/authorize.js';
import { saveLinks } from '../../../server/utils/links.js';
import { recalculateProduct } from '../../../server/utils/recalculate.js';

/* Replaces everything a product is made from: { productId, links: [{ inventoryItemId, quantity, optionKey?, choiceKey? }] }. */
export default async (request, response) => {
  const [authError] = await authorize(request, ['products:update', 'kempo-inventory:items:read']);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { productId, links } = request.body || {};
  const [error, saved] = await saveLinks(productId, links);
  if(error) return response.status(error.code).json({ error: error.msg });
  await recalculateProduct(saved[0]?.productId ?? productId);
  response.json({ links: saved });
};
