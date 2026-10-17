import { guardLedger } from '../server/utils/ledger.js';

/* An entry in kempo-products' ledger that sells (or puts back) a linked product: take its materials from inventory, or refuse the entry when they are not there. */
export default guardLedger;
