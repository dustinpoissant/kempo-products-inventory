import { deleteLinksForProduct } from '../server/utils/links.js';

/* A product was deleted in kempo-products: what it was made from no longer matters. */
export default async ({ product }) => {
  await deleteLinksForProduct(product.id);
};
