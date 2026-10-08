import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';

/*
  kempo's installer builds CREATE TABLE from the Drizzle columns only; indexes and unique
  constraints declared in server/db/schema.js are not carried across. The unique link index is a
  correctness guarantee, so it is created here, matching the schema.
*/
const INDEXES = [
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoProductInventoryLinkUniqueIdx" ON "kempoProductInventoryLink" ("productId", "inventoryItemId", "optionKey", "choiceKey")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoProductInventoryLinkItemIdx" ON "kempoProductInventoryLink" ("inventoryItemId")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoProductInventoryDeductionRefIdx" ON "kempoProductInventoryDeduction" ("ref")`,
];

export default async () => {
  for(const statement of INDEXES) await db.execute(statement);
};
