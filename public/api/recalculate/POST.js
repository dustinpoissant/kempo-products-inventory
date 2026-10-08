import authorize from '../../../server/utils/authorize.js';
import { recalculateAll } from '../../../server/utils/recalculate.js';

/* The repair tool: every linked product is brought in line with the materials on hand. */
export default async (request, response) => {
  const [authError] = await authorize(request, ['products:update']);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  response.json({ recalculated: await recalculateAll() });
};
