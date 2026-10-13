import DashboardWidget from '/kempo/components/DashboardWidget.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import { getProblems, recalculateAll } from '/products-inventory/sdk.js';

/*
  Whether product availability is in step with inventory, listing the problems when it is not.
*/
export default class LinksWidget extends DashboardWidget {
  static properties = {
    ...DashboardWidget.properties,
    problems: { state: true }
  };

  constructor(){
    super();
    this.problems = [];
    this.cta = { label: 'Recalculate', icon: 'restart_alt', permission: 'products:update', onClick: () => this.recalculate() };
  }

  /*
    Public Methods
  */

  load = async () => {
    this.problems = (await this.unwrap(getProblems())).problems;
  };

  /*
    Event Handlers
  */

  recalculate = async () => {
    const [error] = await recalculateAll();
    if(error){
      this.failure = error.msg;
      return;
    }
    await this.refresh();
  };

  /*
    Rendering
  */

  renderContent(){
    if(!this.problems.length) return html`<p class="mb0">No problems. Product availability matches inventory.</p>`;
    return html`
      <p class="tc-danger" role="alert">${this.problems.length} ${this.problems.length === 1 ? 'problem needs' : 'problems need'} attention</p>
      ${this.problems.slice(0, this.height * 3).map(problem => html`
        <div class="pyq bb">${problem.message}${problem.ref ? html` <span class="small tc-muted">${problem.ref}</span>` : nothing}</div>
      `)}
    `;
  }
}

customElements.define('k-pi-widget', LinksWidget);
