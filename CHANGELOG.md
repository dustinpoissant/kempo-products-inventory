# Changelog

All notable changes to `kempo-products-inventory` are documented in this file.

## [Unreleased]

### Changed (breaking)

- **It answers the ledger, not purchases and holds.** kempo-products no longer has purchases or holds; every change to a quantity is an entry in its ledger. A sale of a linked product (an entry that takes quantity) is answered through `kempo-products:ledger:before_add`: the materials are taken from inventory all together or not at all, and the entry is refused with inventory's message when they are not there. An entry that puts a sale back (`undoes`) returns exactly what that one took; adding to a linked product any other way is refused, because its quantity follows the materials. `kempo-products:ledger:add_failed` gives back what was taken for an entry that then failed. The hooks for `purchase:before_record`, `purchase:reversed`, `hold:before_create`, `hold:committed`, `hold:released` and `quantity:take_failed` are gone, and so is the `kempoProductInventoryHold` table (existing rows are left unused). Materials are taken when the order is placed, not set aside and consumed later, so what a pending order has taken is gone from inventory until it is put back. Needs the kempo-products that has the ledger.

### Changed

- Its menu entry ("Connect Products to Inventory") is in the **Products** group, last (priority 86), instead of Commerce.
- **Custom elements are renamed to `k-products-inventory-<name>`**, the extension's name after `k-`; the old tag names stop working: `k-pi-item-actions` is `k-products-inventory-item-actions`, `k-pi-widget` is `k-products-inventory-widget`, `k-pi-links` is `k-products-inventory-links`, `k-pi-status` is `k-products-inventory-status`. Its "Made from" tab is pushed as `<k-products-tab>`, so it needs the kempo-products release that renamed `<k-prod-tab>`.
- **Disabling or uninstalling this extension frees its products.** kempo-products treats a product as managed only while its manager is installed and enabled, so linked products become editable again without clean-up, and are managed again once this is enabled and recalculates them.
- **"Stock" is now "quantity"**, following kempo-products and kempo-inventory: it listens for `kempo-inventory:quantity:adjusted`, calls `setQuantity`, `adjustQuantityMany`, `holdQuantity` and `releaseQuantity`, and the product's `quantity` is what it keeps in step with the materials. Needs the matching kempo-products and kempo-inventory.

### Added

- **Holds reserve materials.** When kempo-products holds stock for an order that is waiting on a payment (`holdQuantity`), the materials its products are made from are set aside in kempo-inventory with its held quantity; committing the hold uses them up and releasing or expiring it gives them back, so a recalculation can never hand held quantity to another buyer. The purchase that results from a hold does not take its materials again, and reversing it puts back exactly what was used. New `kempoProductInventoryHold` table and hooks on `kempo-products:hold:created`, `committed` and `released`. Needs kempo-products with holds.

- **Dashboard widget.** A **Product stock sync** widget on the kempo admin dashboard showing whether product availability matches inventory, listing any problems, with a **Recalculate** button, declared in `widgets` in `kempo-config.json`. Needs a kempo with the dashboard; ignored on older versions.

First release.

- A **documentation site** (`docs-src/` built into `docs/` for GitHub Pages) with screenshots of the admin.

Connects kempo-products to kempo-inventory.

- A **Made from** tab on a product's form (global content pushed into kempo-products' `products-admin-product-tabs` location) links it to inventory items, each with an amount per unit, optionally only when one choice of an option is selected (a colour uses its own paint).
- A purchase takes the materials out of inventory all together or not at all, and a reversal puts back exactly what was taken.
- Each product's stock is how many can be made from what is on hand, and a colour is marked sold out when its paint runs short. Products that share materials all follow, and restocking in the inventory brings them back.
- **Make product from this item** on an inventory item's page starts a product for a piece you already made, linked one for one.
- A **Product Stock** page lists what is linked, shows what needs attention when materials could not be taken for a purchase that already stands, and can recalculate everything.
- An inventory item that products are made from cannot be deleted.

## [0.2.1] - 2026-10-26
### Changed
- The list of products made from inventory is a kempo-ui table.
- Requires kempo 4.9.7 (the admin lists use kempo-ui tables).
