import authorize from '../../../server/utils/authorize.js';
import { getProblems } from '../../../server/utils/problems.js';

export default async (request, response) => {
  const [authError] = await authorize(request, ['products:read']);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const [error, problems] = await getProblems();
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ problems });
};
