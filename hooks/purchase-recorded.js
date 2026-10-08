import { takeMaterials } from '../server/utils/purchases.js';

/*
  A purchase was recorded in kempo-products: take what its products are made from out of inventory.
  Inventory then fires its own stock event, which is what brings every product that shares those
  materials up to date.
*/
export default async ({ purchase }) => {
  await takeMaterials(purchase);
};
