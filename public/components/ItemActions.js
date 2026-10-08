import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import { getItem } from '/inventory/sdk.js';
import { getAllCurrentUserPermissions } from '/kempo/sdk.js';
import { getLinksForItem } from '/products-inventory/sdk.js';

/*
  On an inventory item's page: the products made from this item, and a button to make a product
  from it (for a finished piece you sell as it is). The button opens the new product form with
  the item's name filled in and the item already listed as the product's material, one for one.
  The item comes from ?id= in the address.
*/
export default class ItemActions extends ShadowComponent {
  static properties = {
    item: { state: true },
    links: { state: true },
    products: { state: true },
    canCreate: { state: true },
    loading: { state: true },
  };

  constructor(){
    super();
    this.item = null;
    this.links = [];
    this.products = {};
    this.canCreate = false;
    this.loading = true;
  }

  /*
    Lifecycle callbacks
  */
  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  /*
    Utility functions
  */
  load = async () => {
    const id = new URLSearchParams(location.search).get('id');
    if(!id){
      this.loading = false;
      return;
    }
    const [[itemError, itemData], [linksError, linked], [, permissions]] = await Promise.all([getItem(id), getLinksForItem(id), getAllCurrentUserPermissions()]);
    this.loading = false;
    if(itemError) return;
    this.item = itemData.item;
    this.canCreate = new Set(permissions?.permissions ?? []).has('products:create');
    if(!linksError){
      this.links = linked.links;
      this.products = linked.products;
    }
  };

  /*
    View
  */
  render(){
    if(this.loading || !this.item) return html``;
    const productIds = [...new Set(this.links.map(link => link.productId))];
    const makeUrl = `/admin/extension/kempo-products/new?name=${encodeURIComponent(this.item.name)}&fromInventoryItem=${encodeURIComponent(this.item.id)}`;
    return html`<section class="card mt" style="max-width: 44rem;">
      <h4>Products</h4>
      ${productIds.length ? html`<p>Used by:</p><ul>${productIds.map(id => {
        const product = this.products[id];
        const amount = this.links.filter(link => link.productId === id).map(link => link.quantity).join(' + ');
        return html`<li>${product ? html`<a href=${`/admin/extension/kempo-products/edit?id=${encodeURIComponent(id)}`}>${product.name}</a>` : '(deleted product)'} <span class="tc-muted">(${amount} per unit)</span></li>`;
      })}</ul>` : html`<p class="tc-muted">No products use this item yet.</p>`}
      ${this.canCreate ? html`<a href=${makeUrl} class="btn primary" id="makeProduct"><k-icon name="add"></k-icon> Make product from this item</a>` : ''}
    </section>`;
  }
}

customElements.define('k-pi-item-actions', ItemActions);
