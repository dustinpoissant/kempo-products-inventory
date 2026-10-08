import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import { getLinksForProduct, recalculateAll, getProblems, dismissProblem } from '/products-inventory/sdk.js';

/*
  The connector's own page: everything that is linked, what needs a person's attention, and the
  repair tool. Stock normally follows inventory by itself; "Recalculate everything" is for after
  something changed behind the system's back (a count done by hand in the database).
*/
export default class Status extends ShadowComponent {
  static properties = {
    data: { state: true },
    problems: { state: true },
    loading: { state: true },
    busy: { state: true },
    error: { state: true },
  };

  constructor(){
    super();
    this.data = null;
    this.problems = [];
    this.loading = true;
    this.busy = false;
    this.error = '';
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
    const [[error, data], [problemsError, problems]] = await Promise.all([
      fetch('/products-inventory/api/links').then(res => res.json().then(json => res.ok ? [null, json] : [{ msg: json.error }, null])),
      getProblems(),
    ]);
    this.loading = false;
    if(error || problemsError){
      this.error = (error ?? problemsError).msg;
      return;
    }
    this.data = data;
    this.problems = problems.problems;
  };

  /*
    Event handlers
  */
  recalculate = async () => {
    this.busy = true;
    const [error, result] = await recalculateAll();
    this.busy = false;
    if(error){
      Toast.error(error.msg);
      return;
    }
    Toast.success(`Recalculated ${result.recalculated} product${result.recalculated === 1 ? '' : 's'}`);
    this.load();
  };

  dismiss = async problem => {
    const [error] = await dismissProblem(problem.id);
    if(error){
      Toast.error(error.msg);
      return;
    }
    this.load();
  };

  /*
    View
  */
  render(){
    if(this.loading) return html`<k-spinner></k-spinner>`;
    if(this.error) return html`<p class="tc-danger">${this.error}</p>`;
    const { links, products, items } = this.data;
    const productIds = [...new Set(links.map(link => link.productId))];
    return html`<div>
      ${this.problems.length ? html`<section class="card mb" style="border-color: var(--c_danger);">
        <h4 class="tc-danger">Needs your attention</h4>
        ${this.problems.map(problem => html`<div class="d-f mbh" style="align-items: center; gap: var(--spacer_h);">
          <div class="flex">${problem.message}<small class="d-b tc-muted">${new Date(problem.created).toLocaleString()}</small></div>
          <button type="button" class="btn" @click=${() => this.dismiss(problem)}>Dismiss</button>
        </div>`)}
      </section>` : ''}
      <div class="d-f mb" style="gap: var(--spacer_h); align-items: center;">
        <p class="flex m0 tc-muted">Products made from inventory take it out when they sell, and show what can still be made.</p>
        <button type="button" class="btn" id="recalculate" ?disabled=${this.busy} @click=${this.recalculate}><k-icon name="repeat"></k-icon> ${this.busy ? 'Recalculating…' : 'Recalculate everything'}</button>
      </div>
      ${productIds.length ? html`<div class="table-wrapper"><table>
        <thead><tr><th>Product</th><th>Can make</th><th>Made from</th></tr></thead>
        <tbody>${productIds.map(id => {
          const product = products[id];
          const mine = links.filter(link => link.productId === id);
          return html`<tr>
            <td>${product ? html`<a href=${`/admin/extension/kempo-products/edit?id=${encodeURIComponent(id)}`}>${product.name}</a>` : '(deleted product)'}</td>
            <td>${product ? (product.stock === -1 ? 'Unlimited' : product.stock) : ''}</td>
            <td>${mine.map(link => `${link.quantity} × ${items[link.inventoryItemId]?.name ?? '(deleted item)'}${link.optionKey ? ` (${link.optionKey}: ${link.choiceKey})` : ''}`).join(', ')}</td>
          </tr>`;
        })}</tbody>
      </table></div>` : html`<p class="tc-muted">No product is made from inventory yet. Open a product and add what it is made from, or open an inventory item and choose "Make product from this item".</p>`}
    </div>`;
  }
}

customElements.define('k-pi-status', Status);
