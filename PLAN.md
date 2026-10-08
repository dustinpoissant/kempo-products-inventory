# kempo-products-inventory: plan

Status: **design, nothing built.** Decisions are marked **Agreed**, **Proposed** or **Unverified**, as in the kempo-products plan. Read `../kempo-products/PLAN.md` first; this connector depends on the interface it defines (sections 7 and 8).

## 1. Purpose

kempo-products (a catalog) and kempo-inventory (raw materials) do not know about each other. **Agreed.** This extension requires both and owns the mapping between them: when a product is purchased, the materials it is made from are used up, and every product that can no longer be made goes out of stock.

Worked example. A model car uses 175 g of resin, a set of tyres in TPU and some paint; a keychain uses 35 g of resin. Two products each need 200 g of black PLA and 300 g is in stock. One is bought: 200 g comes off, 100 g is left, which is less than the 200 g either product needs, so **both** go out of stock. The connector does that; neither base extension does.

## 2. Dependencies

- `kempo-config.json` declares `"dependencies": ["kempo-products", "kempo-inventory"]`, so kempo refuses to install it until both are installed and enabled.
- `package.json` lists both as `peerDependencies`, so a modern `npm install kempo-products-inventory` brings both packages in. **Unverified** for consumers who disable peer installs.
- Installing the missing extensions for the user (rather than refusing) is a separate kempo platform task.

## 3. Data model (Proposed)

### `kempoProductInventoryLink`

`id`, `productId`, `inventoryItemId`, `quantity`, `optionKey`, `choiceKey`, `created`.

`quantity` is the amount of the item used **per unit sold**, in the item's own whole units. Inventory quantities are integers with no unit concept, so keep stock in grams and millilitres (175, not 0.175 kg).

A link with `optionKey` and `choiceKey` empty is used by every unit of the product. A link with both set is only used when that choice is selected, which is how a paint colour consumes its paint. Many-to-many: one item feeds many products, one product uses many items. Unique on `(productId, inventoryItemId, optionKey, choiceKey)`.

## 4. Behaviour (Proposed)

### On `kempo-products:purchase:recorded`

For each line, collect the links that apply (the fixed ones, plus those matching the chosen options), multiply by the line quantity, sum per item, and take the materials out of inventory **in one atomic call with the purchase `ref`** so a reversal can find them. Then recalculate every product that uses any of those items.

### On `kempo-products:purchase:reversed`

Put the materials back, then recalculate.

### On `kempo-inventory:stock:adjusted`

Recalculate every product using that item. This matters as much as purchases do: restocking resin, or correcting a count in the inventory admin, must bring products back into stock.

### Recalculating a product

For a product with any link:

- `stock` = the smallest of `floor(item quantity / link quantity)` over its fixed links. Set through kempo-products' `setStock`.
- For each option choice with links, available = its own links can supply one unit **and** the product's fixed links can still supply one unit. Set through `setChoiceAvailability`.
- Declare the product managed with `setManagedBy('kempo-products-inventory')`, so the products admin shows stock read-only with this extension's name. Clear it when the last link is removed, and leave stock as it was.

A product with no links is left alone. A required option with no available choice makes the product unbuyable through kempo-products' own `getPrice` check.

### When it goes wrong

The base extensions' own stock checks stop most oversells, but counts can drift (an edit between recalculations, a failed handler). If the atomic deduction is refused for lack of stock, the purchase already stands in kempo-products. The connector records the problem, recalculates the affected products so they show as out of stock, and shows it to an admin. A "recalculate everything" admin action is the repair tool. **Proposed**; how the problem is recorded and surfaced is an open question.

## 5. Admin (Proposed)

- **On the product form:** an "Inventory" panel to add and remove links (item, quantity per unit, and optionally an option choice). Needs a named location on the kempo-products admin product page.
- **On the inventory item page:** a **Make product from this item** button, which opens the products create form prefilled from the item (name, SKU, stock), with one link of quantity 1. If a product already uses the item, a link to it and the list of products that use it. **Agreed** as the flow for pre-made items. Needs a named location on the inventory item page.
- **A settings page or action** to recalculate all products, and to show unresolved problems.

**Unverified:** how the prefill travels to the products create form (a query parameter such as `?fromInventoryItem=` read by the panel), and that a named location inside a product or item page can be pushed into by another extension.

## 6. What the other extensions must provide

kempo-products (in its plan): `purchase:recorded`, `purchase:reversed`, `setStock`, `setManagedBy`, `setChoiceAvailability`, the admin product-page location.

kempo-inventory (to build, as small generic primitives, not product features):

1. **`adjustStockMany`**: apply several stock changes in one transaction, all or nothing, with a shared reference. Today `adjustStock` runs one transaction per item, so a recipe can't be deducted atomically.
2. **A named `<location>` on the item page** for extension actions. Today `admin/edit/index.page.html` has none.

Reservations (holding stock between order and build) are deliberately not needed.

## 7. Build phases

0. **Scaffold.** Done.
1. Inventory primitives (in the kempo-inventory repo).
2. Link table, admin panel, recalculation.
3. Purchase and reversal handlers; inventory-adjusted handler.
4. "Make product from this item"; recalculate-all and problem list.

## 8. Tests

Recalculation and the material-collecting logic are pure functions of links, quantities and stock, tested without a server. The worked example in section 1 is a test case. A DB suite exercises the handlers against a real Postgres, and the repo needs real kempo-products and kempo-inventory installed to run, so CI follows the sibling extensions' "published" and "siblings" jobs.

## 9. Open questions

1. How are unresolved problems recorded and shown: a small table with an admin list, or only a log line and the recalculated stock? Recommendation: a table, since silent drift in stock is the failure mode this extension exists to prevent.
2. Should a person be able to override a managed product's stock in the products admin? Recommendation: no; to change it, unlink the product or adjust the inventory.
3. Choice availability uses "its own links and the fixed links can supply one unit". Two choices sharing one scarce item (two reds from one tin) are each shown available, though only one more could be sold. Acceptable, since recalculation after the purchase corrects it?
