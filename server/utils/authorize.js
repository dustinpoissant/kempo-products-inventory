import { currentUserHasPermission, getSession } from 'kempo/server/sdk.js';

/*
  The connector adds no permissions of its own: it works with products and inventory, so it asks for
  theirs. Resolves to [null, { userId }] when the request's user holds every permission listed, or
  [{ code, msg }, null].
*/
export default async (request, permissions) => {
  const token = request.cookies.session_token;
  const [sessionError, session] = await getSession({ token });
  if(sessionError || !session?.user) return [{ code: 401, msg: 'Authentication required' }, null];
  for(const permission of permissions){
    const [, allowed] = await currentUserHasPermission(token, permission);
    if(!allowed) return [{ code: 403, msg: 'Insufficient permissions' }, null];
  }
  return [null, { userId: session.user.id }];
};
