import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Combobox.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import { getProduct } from '/products/sdk.js';
import { getItems, getItem } from '/inventory/sdk.js';
import { getLinksForProduct, saveLinks } from '/products-inventory/sdk.js';

/*
  The "Made from" panel on a product's form: which inventory items one unit uses up, and how much
  of each. Sell the product and those amounts come out of inventory; products that share the
  materials go out of stock when there is no longer enough for another.

  A material can be tied to one choice of an option ("Red" uses red paint), so the paint taken is
  the colour that was bought. Amounts are whole numbers in the item's own unit, so keep stock in
  grams or millilitres.

  It is the "Made from" tab of the product form (a <k-prod-tab>, see the kempo-products form) and saves with it: when
  the form fires `product-saved` this saves the materials too. From the address it reads ?id= (the
  product being edited) and ?fromInventoryItem= (an item to start with, from "Make product from this
  item").
*/
export default class ProductLinks extends ShadowComponent {
  static properties = {
    rows: { state: true },
    options: { state: true },
    stock: { state: true },
    loading: { state: true },
    error: { state: true },
  };

  constructor(){
    super();
    this.rows = [];
    this.options = [];
    this.stock = {};
    this.loading = true;
    this.error = '';
    this.productId = '';
    this.touched = false;
    this.form = null;
  }

  /*
    Lifecycle callbacks
  */
  connectedCallback(){
    super.connectedCallback();
    this.form = this.closest('k-prod-form');
    this.form?.addEventListener('draft-change', this.handleDraft);
    this.form?.addEventListener('product-saved', this.handleSaved);
    this.load();
  }

  disconnectedCallback(){
    this.form?.removeEventListener('draft-change', this.handleDraft);
    this.form?.removeEventListener('product-saved', this.handleSaved);
    super.disconnectedCallback();
  }

  /*
    Utility functions
  */
  load = async () => {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const from = params.get('fromInventoryItem');
    const rows = [];
    const stock = {};

    if(id){
      const [error, data] = await getProduct(id);
      if(error){
        this.error = error.msg;
        this.loading = false;
        return;
      }
      this.productId = data.product.id;
      this.options = data.product.options;
      const [linksError, linked] = await getLinksForProduct(this.productId);
      if(linksError){
        this.error = linksError.msg;
        this.loading = false;
        return;
      }
      for(const link of linked.links){
        const item = linked.items[link.inventoryItemId];
        stock[link.inventoryItemId] = item?.quantity;
        rows.push({ itemId: link.inventoryItemId, label: item ? `${item.name} (${item.sku})` : '(deleted item)', quantity: String(link.quantity), choice: link.optionKey ? `${link.optionKey}/${link.choiceKey}` : '' });
      }
    }
    if(from && !rows.some(row => row.itemId === from && !row.choice)){
      const [error, data] = await getItem(from);
      if(!error){
        stock[from] = data.item.quantity;
        rows.push({ itemId: from, label: `${data.item.name} (${data.item.sku})`, quantity: '1', choice: '' });
        this.touched = true;
      }
    }
    this.rows = rows;
    this.stock = stock;
    this.loading = false;
  };

  /* The form's own options, as they are being edited. Only ones already saved have keys to tie a material to. */
  handleDraft = event => {
    if(event.detail.changed.includes('options')) this.options = event.detail.draft.options;
  };

  patch = (index, changes) => {
    this.rows = this.rows.map((row, i) => i === index ? { ...row, ...changes } : row);
    this.touched = true;
  };

  /* A row with no material chosen yet is ignored; everything else is sent, so the server can say what is wrong. */
  toLinks = () => this.rows.filter(row => row.itemId).map(row => {
    const [optionKey = '', choiceKey = ''] = row.choice.split('/');
    return { inventoryItemId: row.itemId, quantity: Number(row.quantity), optionKey, choiceKey };
  });

  /*
    Event handlers
  */
  handleSaved = event => {
    const { product } = event.detail;
    if(!this.touched && this.productId) return;
    this.productId = product.id;
    event.detail.waitUntil((async () => {
      const [error] = await saveLinks(product.id, this.toLinks());
      if(error) Toast.error(`The product was saved, but what it is made from was not: ${error.msg}`);
      else this.touched = false;
    })());
  };

  add = () => {
    this.rows = [...this.rows, { itemId: '', label: '', quantity: '1', choice: '' }];
    this.touched = true;
  };

  remove = index => {
    this.rows = this.rows.filter((_, i) => i !== index);
    this.touched = true;
  };

  search = async (event, index) => {
    const $combobox = event.currentTarget;
    const [error, data] = await getItems({ q: event.detail.value, limit: 10 });
    if(error) return;
    $combobox.setOptions(data.items.map(item => ({ label: `${item.name} (${item.sku})`, value: item.id })));
    this.stock = { ...this.stock, ...Object.fromEntries(data.items.map(item => [item.id, item.quantity])) };
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
    const quantity = this.stock[row.itemId];
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
    if(this.loading) return html`<k-spinner></k-spinner>`;
    if(this.error) return html`<p class="tc-danger">${this.error}</p>`;
    return html`<section class="card mt" style="max-width: 48rem;">
      <h4>Made from</h4>
      <p class="tc-muted">The inventory this product uses up, per unit sold. When it sells, these amounts come out of inventory, and products that share them go out of stock once there is not enough left. Use whole numbers in the item's unit (grams, millilitres).</p>
      ${this.rows.map((row, index) => this.renderRow(row, index))}
      <button type="button" class="btn mbh" id="addMaterial" @click=${this.add}><k-icon name="add"></k-icon> Add material</button>
      ${this.options.some(option => !option.key) ? html`<small class="d-b tc-muted">Save the product first to tie a material to a new option's choices.</small>` : ''}
    </section>`;
  }
}

customElements.define('k-pi-links', ProductLinks);
