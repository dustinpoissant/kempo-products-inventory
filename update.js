import install from './install.js';

/* Indexes are re-asserted on update; any column added to an existing table would be added here too, idempotently. */
export default async () => {
  await install();
};
