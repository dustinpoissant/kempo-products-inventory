import { returnMaterials } from '../server/utils/purchases.js';

/* A purchase was reversed in kempo-products: put back exactly what it took. */
export default async ({ purchase }) => {
  await returnMaterials(purchase);
};
