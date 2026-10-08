# Changelog

All notable changes to `kempo-products-inventory` are documented in this file.

## [Unreleased]

First release.

- A **documentation site** (`docs-src/` built into `docs/` for GitHub Pages) with screenshots of the admin, and tests that keep it honest.

Connects kempo-products to kempo-inventory.

- A **Made from** panel on a product's form links it to inventory items, each with an amount per unit, optionally only when one choice of an option is selected (a colour uses its own paint).
- A purchase takes the materials out of inventory all together or not at all, and a reversal puts back exactly what was taken.
- Each product's stock is how many can be made from what is on hand, and a colour is marked sold out when its paint runs short. Products that share materials all follow, and restocking in the inventory brings them back.
- **Make product from this item** on an inventory item's page starts a product for a piece you already made, linked one for one.
- A **Product Stock** page lists what is linked, shows what needs attention when materials could not be taken for a purchase that already stands, and can recalculate everything.
- An inventory item that products are made from cannot be deleted.
