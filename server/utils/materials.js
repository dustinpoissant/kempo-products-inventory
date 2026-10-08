/*
  Pure rules about what a product uses up and what can still be made. No database access, so the
  arithmetic can be tested without a server.

  A link is { inventoryItemId, quantity, optionKey, choiceKey }. `quantity` is per unit sold.
*/

/* The links one unit of a product with these selections ({ optionKey: choiceKey }) uses: the fixed ones, plus the chosen choices'. */
export const linksFor = (links, selections = {}) => links.filter(link => !link.optionKey || selections[link.optionKey] === link.choiceKey);

/* Links used by every unit, whatever is chosen. */
export const fixedLinks = links => links.filter(link => !link.optionKey);

/* The links that belong to one choice of one option. */
export const choiceLinks = (links, optionKey, choiceKey) => links.filter(link => link.optionKey === optionKey && link.choiceKey === choiceKey);

/* Several links to one item draw on one pile of it, so they are added together: Map of item id -> quantity per unit. */
export const perUnit = links => {
  const totals = new Map();
  for(const link of links) totals.set(link.inventoryItemId, (totals.get(link.inventoryItemId) ?? 0) + link.quantity);
  return totals;
};

/*
  What a purchase uses up: Map of item id -> amount. `lines` are the purchase's lines
  ({ productId, quantity, selections }) and `linksByProduct` a Map of product id -> its links. A
  product with no links uses nothing.
*/
export const materialsFor = (lines, linksByProduct) => {
  const totals = new Map();
  for(const line of lines){
    const links = linksFor(linksByProduct.get(line.productId) ?? [], line.selections ?? {});
    for(const [itemId, quantity] of perUnit(links)) totals.set(itemId, (totals.get(itemId) ?? 0) + quantity * line.quantity);
  }
  return totals;
};

/*
  How many units the stock can make: the smallest whole number across the items used. `stock` is a
  Map of item id -> quantity on hand; an item missing from it counts as none. With no links
  there is no limit (Infinity).
*/
export const unitsAvailable = (links, stock) => {
  let units = Infinity;
  for(const [itemId, quantity] of perUnit(links)){
    if(quantity <= 0) continue;
    units = Math.min(units, Math.floor((stock.get(itemId) ?? 0) / quantity));
  }
  return units;
};

/*
  The stock a product should show, from its fixed links: how many can be made, or null when no
  fixed link limits it (leave its stock alone).
*/
export const productStock = (links, stock) => {
  const fixed = fixedLinks(links);
  return fixed.length ? unitsAvailable(fixed, stock) : null;
};

/*
  Whether one more unit can be made with a given choice: the fixed links and the choice's own, taken
  together, because they may share an item (resin for the body and for a coloured part).
*/
export const choiceInStock = (links, optionKey, choiceKey, stock) =>
  unitsAvailable([...fixedLinks(links), ...choiceLinks(links, optionKey, choiceKey)], stock) >= 1;

/* The (optionKey, choiceKey) pairs that have links, with no repeats. */
export const linkedChoices = links => {
  const seen = new Set();
  const choices = [];
  for(const link of links){
    if(!link.optionKey) continue;
    const id = `${link.optionKey}/${link.choiceKey}`;
    if(seen.has(id)) continue;
    seen.add(id);
    choices.push({ optionKey: link.optionKey, choiceKey: link.choiceKey });
  }
  return choices;
};
