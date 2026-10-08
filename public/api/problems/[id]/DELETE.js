import authorize from '../../../../server/utils/authorize.js';
import { dismissProblem } from '../../../../server/utils/problems.js';

export default async (request, response) => {
  const [authError] = await authorize(request, ['products:update']);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const [error, result] = await dismissProblem(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(result);
};
