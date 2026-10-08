const BASE = '/products-inventory/api';

const req = async (method, path, data) => {
  const opts = { method, headers: {} };
  if(data !== undefined && method !== 'GET'){
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  try {
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if(!res.ok) return [{ code: res.status, msg: json.error || 'An error occurred' }, null];
    return [null, json];
  } catch {
    return [{ code: 503, msg: 'Network error' }, null];
  }
};

/*
  What a product is made from, or what uses an inventory item. Resolves to
  { links, products, items }: the links, and the names and stock to show them with.
*/
export const getLinksForProduct = productId => req('GET', `${BASE}/links?productId=${encodeURIComponent(productId)}`);
export const getLinksForItem = inventoryItemId => req('GET', `${BASE}/links?inventoryItemId=${encodeURIComponent(inventoryItemId)}`);

/* Replaces everything a product is made from. Each link is { inventoryItemId, quantity, optionKey?, choiceKey? }. */
export const saveLinks = (productId, links) => req('PUT', `${BASE}/links`, { productId, links });

export const recalculateAll = () => req('POST', `${BASE}/recalculate`, {});
export const getProblems = () => req('GET', `${BASE}/problems`);
export const dismissProblem = id => req('DELETE', `${BASE}/problems/${encodeURIComponent(id)}`);
