import ProductTab from '/products/components/ProductTab.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Combobox.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import { getItems, getItem } from '/inventory/sdk.js';
import { getLinksForProduct, saveLinks } from '/products-inventory/sdk.js';

/*
  The "Link to Inventory" tab of the product form: which inventory items one unit uses up, and how much of each. Sell the product and those
  amounts come out of inventory; products that share the materials go out of stock when there is no longer enough for another.

  A material can be tied to one choice of an option ("Red" uses red paint), so the paint taken is the colour that was bought. Amounts
  are whole numbers in the item's own unit, so keep quantity in grams or millilitres.

  It is a tab the page contributes to the product form (the products-admin-product-tabs location), and it saves its own materials with
  its own button. A new product has to be saved first, because a material is tied to a saved product. From the address it reads
  ?fromInventoryItem= (an item to start with, from "Make product from this item").
*/
export default class ProductLinks extends ProductTab {
  static properties = {
    rows: { state: true },
    quantity: { state: true },
    linksLoaded: { state: true },
    error: { state: true },
  };

  constructor(){
    super();
    this.rows = [];
    this.quantity = {};
    this.linksLoaded = false;
    this.error = '';
  }

  /* The product's own options, as they are being edited. Only ones already saved have keys to tie a material to. */
  get options(){
    return this.draft.options;
  }

  /*
    Loading
  */
  requestUpdate(...args){
    super.requestUpdate(...args);
    if(this.form?.editing && !this.linksLoaded && !this.loadingLinks && (this.pane?.active ?? true)) this.loadLinks();
  }

  loadLinks = async () => {
    this.loadingLinks = true;
    const productId = this.form.original.id;
    const [error, linked] = await getLinksForProduct(productId);
    this.loadingLinks = false;
    if(error){
      this.error = error.msg;
      return;
    }
    const rows = [];
    const quantity = {};
    for(const link of linked.links){
      const item = linked.items[link.inventoryItemId];
      quantity[link.inventoryItemId] = item?.quantity;
      rows.push({ itemId: link.inventoryItemId, label: item ? `${item.name} (${item.sku})` : '(deleted item)', quantity: String(link.quantity), choice: link.optionKey ? `${link.optionKey}/${link.choiceKey}` : '' });
    }
    const from = new URLSearchParams(location.search).get('fromInventoryItem');
    if(from && !rows.some(row => row.itemId === from && !row.choice)){
      const [itemError, data] = await getItem(from);
      if(!itemError){
        quantity[from] = data.item.quantity;
        rows.push({ itemId: from, label: `${data.item.name} (${data.item.sku})`, quantity: '1', choice: '' });
      }
    }
    this.rows = rows;
    this.quantity = quantity;
    this.linksLoaded = true;
  };

  patch = (index, changes) => {
    this.rows = this.rows.map((row, i) => i === index ? { ...row, ...changes } : row);
  };

  /* A row with no material chosen yet is ignored; everything else is sent, so the server can say what is wrong. */
  toLinks = () => this.rows.filter(row => row.itemId).map(row => {
    const [optionKey = '', choiceKey = ''] = row.choice.split('/');
    return { inventoryItemId: row.itemId, quantity: Number(row.quantity), optionKey, choiceKey };
  });

  /* Saves with the product: the form says it has been stored, and the materials go with it. */
  saveWithProduct = async event => {
    if(!this.linksLoaded) return;
    const [error] = await saveLinks(event.detail.product.id, this.toLinks());
    if(error) Toast.error(`The product was saved, but what it is made from was not: ${error.msg}`);
  };

  connectedCallback(){
    super.connectedCallback();
    this.form?.addEventListener('product-saved', this.saveWithProduct);
    this.pane = this.closest('k-tab-content');
    this.closest('k-tabs')?.addEventListener('tab', () => this.requestUpdate());
  }

  disconnectedCallback(){
    this.form?.removeEventListener('product-saved', this.saveWithProduct);
    super.disconnectedCallback();
  }

  add = () => {
    this.rows = [...this.rows, { itemId: '', label: '', quantity: '1', choice: '' }];
  };

  remove = index => {
    this.rows = this.rows.filter((_, i) => i !== index);
  };

  search = async (event, index) => {
    const $combobox = event.currentTarget;
    const [error, data] = await getItems({ q: event.detail.value, limit: 10 });
    if(error) return;
    $combobox.setOptions(data.items.map(item => ({ label: `${item.name} (${item.sku})`, value: item.id })));
    this.quantity = { ...this.quantity, ...Object.fromEntries(data.items.map(item => [item.id, item.quantity])) };
  };

  select = (event, index) => {
    this.patch(index, { itemId: event.detail.value, label: event.detail.label });
  };

  /*
    View
  */
  choices(){
    return this.options.filter(option => option.key).flatMap(option => option.choices.map(choice => ({ value: `${option.key}/${choice.key}`, label: `${option.label}: ${choice.label}` })));
  }

  renderRow(row, index){
    const quantity = this.quantity[row.itemId];
    return html`<div class="d-f mbh" style="align-items: flex-start; gap: var(--spacer_h);">
      <div class="flex" style="min-width: 14rem;">
        <k-combobox class="full" placeholder="Search inventory…" aria-label="Material" .value=${row.label}
          empty-message="Type to search the inventory" no-results-message="Nothing found"
          @search=${event => this.search(event, index)} @select=${event => this.select(event, index)}></k-combobox>
        ${row.itemId && quantity !== undefined ? html`<small class="d-b tc-muted">${quantity} in stock</small>` : ''}
      </div>
      <input type="number" min="1" step="1" style="width: 7rem; margin: 0;" aria-label="Amount used per unit" placeholder="Amount" .value=${row.quantity}
        @input=${event => this.patch(index, { quantity: event.target.value })}>
      <select style="width: auto; margin: 0;" aria-label="When this is used" @change=${event => this.patch(index, { choice: event.target.value })}>
        <option value="" ?selected=${row.choice === ''}>Always</option>
        ${this.choices().map(choice => html`<option value=${choice.value} ?selected=${row.choice === choice.value}>Only with ${choice.label}</option>`)}
      </select>
      <button type="button" class="no-btn tc-danger" style="cursor: pointer;" aria-label="Remove this material" @click=${() => this.remove(index)}><k-icon name="delete"></k-icon></button>
    </div>`;
  }

  render(){
    if(!this.ready) return html`<k-spinner></k-spinner>`;
    if(this.error) return html`<p class="tc-danger">${this.error}</p>`;
    if(!this.form.editing) return html`<p class="tc-muted">Save the product first. Then the inventory it is made from can be added here.</p>`;
    if(!this.linksLoaded) return html`<k-spinner></k-spinner>`;
    return html`
      <p class="tc-muted mb">The inventory this product uses up, per unit sold. When it sells, these amounts come out of inventory, and products that share them go out of stock once there is not enough left. Use whole numbers in the item's unit (grams, millilitres).</p>
      ${this.options.some(option => !option.key) ? html`<small class="d-b tc-muted mb">Save the product's options first to tie a material to a new option's choices.</small>` : ''}
      ${this.rows.map((row, index) => this.renderRow(row, index))}
      <button type="button" class="btn mb" id="addMaterial" @click=${this.add}><k-icon name="add"></k-icon> Add material</button>
    `;
  }
}

customElements.define('k-products-inventory-links', ProductLinks);
