import { giveBack } from '../server/utils/ledger.js';

/* An entry this extension agreed to did not happen: give back what was taken for it. */
export default ({ ref }) => giveBack(ref);
