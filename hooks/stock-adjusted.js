import { recalculateForItems } from '../server/utils/recalculate.js';

/*
  Stock of an inventory item changed, whoever changed it: a sale, a delivery, a count corrected in
  the inventory admin. Every product made from it shows what it can now be made from.
*/
export default async ({ item }) => {
  await recalculateForItems([item.id]);
};
