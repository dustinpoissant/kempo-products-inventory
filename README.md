# kempo-products-inventory

Connects [kempo-products](https://github.com/dustinpoissant/kempo-products) to [kempo-inventory](https://github.com/dustinpoissant/kempo-inventory). Sell a model car and the resin, paint and filament it is made from come out of stock automatically, and every product that can no longer be made goes out of stock with it.

> Status: pre-release. See [PLAN.md](PLAN.md) for the design.

Neither of those extensions needs the other. Install this one when you use both. It has to be installed after they are: kempo refuses to enable it until both are.

## What it does

You tell it what a product is made from. Open a product in **Products** and use the **Made from** panel:

| Product | Material | Per unit | Used |
|---|---|---|---|
| Model car | Black resin | 175 | always |
| Model car | TPU filament | 12 | always |
| Model car | Red paint | 20 | only with Color: Red |
| Model car | Blue paint | 20 | only with Color: Blue |
| Keychain | Black resin | 35 | always |

Then, with no further setup:

- **Selling takes the materials.** When a purchase is recorded in kempo-products, 175 g of resin, 12 g of TPU and 20 ml of the colour that was bought are taken from inventory, all together or not at all. Each inventory movement carries the order reference.
- **Stock follows the materials.** Each product's stock is how many can be made from what is on hand, limited by the scarcest material. A colour is marked sold out when there is not enough of its paint for one more.
- **Products that share materials stay honest.** With 300 g of PLA and two products that each need 200 g, selling one leaves 100 g and **both** go out of stock.
- **Restocking brings them back.** Receiving resin in the inventory, or correcting a count there, updates every product made from it straight away.
- **Reversing a purchase puts back exactly what it took**, even if the materials were edited since.

Inventory counts whole numbers with no unit, so keep stock in grams and millilitres (175 g, not 0.175 kg).

### Selling a piece you already made

Open the item in the inventory admin and choose **Make product from this item**. The new product form opens with the name filled in and the item already listed as its material, one for one, so its stock is the item's quantity. Fill in the price and the rest, and save.

### When the stock the system believed was wrong

Normally nothing goes wrong, because products refuse to sell more than they think they can make. But if stock was changed behind the system's back, for instance directly in the database, the materials for a purchase may not be there. The purchase stands (it already happened); the connector records a **problem** on the **Product Stock** admin page, with the order reference, and recalculates the affected products so they show what is really left. **Recalculate everything** on that page is the repair tool.

An inventory item that products are made from cannot be deleted until it is removed from them.

## Stock is managed for you

A product made from inventory is marked as maintained by this extension. Its stock and which colours are in stock show as read-only in the products admin, so an edit there cannot be silently overwritten. To change a product's stock, change the inventory it is made from, or remove its materials to hand it back.

## Install

```bash
npm install kempo-products-inventory
```

Install it from **Admin > Extensions** once kempo-products and kempo-inventory are enabled. There is nothing to configure and it adds no permissions: to link materials you need `products:update` and `kempo-inventory:items:read`.

## How it fits together

| It listens to | And |
|---|---|
| `kempo-products:purchase:recorded` | takes the materials out of inventory in one atomic call |
| `kempo-products:purchase:reversed` | puts back what that purchase took |
| `kempo-inventory:stock:adjusted` | recalculates every product made from that item |
| `kempo-products:product:deleted` | forgets what the product was made from |
| `kempo-inventory:item:before_delete` | refuses while products are made from the item |

It reaches the other extensions only through their SDKs (`setStock`, `setManagedBy` and `setChoiceAvailability` from kempo-products; `adjustStockMany` from kempo-inventory) and adds three pieces of interface through fragments those extensions provide: the **Made from** panel on a product's form, the **Make product from this item** panel on an inventory item's page, and a **Product Stock** page.

## API

JSON routes under `/products-inventory/api/`. They need the products and inventory permissions named above.

| Route | Purpose |
|---|---|
| `GET links` | Everything linked (`?productId=` or `?inventoryItemId=` narrows it), with names and stock |
| `PUT links` | Replace what a product is made from: `{ productId, links: [{ inventoryItemId, quantity, optionKey?, choiceKey? }] }` |
| `POST recalculate` | Recalculate every linked product |
| `GET problems`, `DELETE problems/<id>` | What needs attention, and dismissing it |

## Development

```bash
npm run link:local          # symlinks the sibling kempo checkouts
docker compose up -d        # a throwaway Postgres on port 5444
DATABASE_URL=postgresql://kempo:kempo@localhost:5444/kempo_products_inventory_test npx drizzle-kit push --force
DATABASE_URL=postgresql://kempo:kempo@localhost:5444/kempo_products_inventory_test npm test
```

The database tests run the whole chain with the real hooks registered: a purchase in kempo-products takes materials out of kempo-inventory, and products made from them follow. They skip themselves when no database is reachable and refuse to run unless its name ends in `_test`. **A green run with `SKIPPED` did not test the database.**
