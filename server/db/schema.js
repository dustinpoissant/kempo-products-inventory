import { pgTable, text, timestamp, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

/*
  What a product is made from. `quantity` is how much of the inventory item one unit sold uses, in
  the item's own whole units (grams, millilitres). A link with an empty optionKey and choiceKey is
  used by every unit; one with both set is only used when that choice is selected, which is how a
  paint colour uses its paint.
*/
export const kempoProductInventoryLink = pgTable('kempoProductInventoryLink', {
  id: text('id').primaryKey(),
  productId: text('productId').notNull(),
  inventoryItemId: text('inventoryItemId').notNull(),
  quantity: integer('quantity').notNull(),
  optionKey: text('optionKey').notNull().default(''),
  choiceKey: text('choiceKey').notNull().default(''),
  created: timestamp('created').notNull(),
}, table => [
  uniqueIndex('kempoProductInventoryLinkUniqueIdx').on(table.productId, table.inventoryItemId, table.optionKey, table.choiceKey),
  index('kempoProductInventoryLinkItemIdx').on(table.inventoryItemId),
]);

/*
  What was actually taken from inventory for a purchase, so a reversal puts back exactly that, even
  if the links have been edited since.
*/
export const kempoProductInventoryDeduction = pgTable('kempoProductInventoryDeduction', {
  id: text('id').primaryKey(),
  ref: text('ref').notNull(),
  inventoryItemId: text('inventoryItemId').notNull(),
  amount: integer('amount').notNull(),
  reversed: boolean('reversed').notNull().default(false),
  created: timestamp('created').notNull(),
}, table => [index('kempoProductInventoryDeductionRefIdx').on(table.ref)]);

/*
  Something that did not go to plan and needs a person: materials that could not be taken for a
  purchase that already stands. Shown in the admin until dismissed.
*/
export const kempoProductInventoryProblem = pgTable('kempoProductInventoryProblem', {
  id: text('id').primaryKey(),
  ref: text('ref').notNull().default(''),
  message: text('message').notNull(),
  created: timestamp('created').notNull(),
});
