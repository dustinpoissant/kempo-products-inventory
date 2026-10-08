import db from 'kempo/server/db/index.js';
import { eq, desc } from 'drizzle-orm';
import crypto from 'crypto';
import { kempoProductInventoryProblem } from '../db/schema.js';

const newId = () => crypto.randomBytes(8).toString('hex');

/* Remembers something that needs a person's attention. Never throws: the thing that went wrong is the point. */
export const addProblem = async ({ ref = '', message }) => {
  console.error(`[kempo-products-inventory] ${ref ? `${ref}: ` : ''}${message}`);
  try {
    await db.insert(kempoProductInventoryProblem).values({ id: newId(), ref, message, created: new Date() });
  } catch(error) {
    console.error('[kempo-products-inventory] could not record a problem:', error);
  }
};

export const getProblems = async () => {
  try {
    return [null, await db.select().from(kempoProductInventoryProblem).orderBy(desc(kempoProductInventoryProblem.created))];
  } catch {
    return [{ code: 500, msg: 'Failed to retrieve problems' }, null];
  }
};

export const dismissProblem = async id => {
  try {
    const rows = await db.delete(kempoProductInventoryProblem).where(eq(kempoProductInventoryProblem.id, id)).returning({ id: kempoProductInventoryProblem.id });
    return rows.length ? [null, { success: true }] : [{ code: 404, msg: 'Problem not found' }, null];
  } catch {
    return [{ code: 500, msg: 'Failed to dismiss the problem' }, null];
  }
};
