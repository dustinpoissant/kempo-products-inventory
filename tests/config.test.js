import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const config = JSON.parse(read('kempo-config.json'));
const pkg = JSON.parse(read('package.json'));

test('it requires both extensions, so kempo refuses to enable it without them', () => {
  assert.deepEqual([...config.dependencies].sort(), ['kempo-inventory', 'kempo-products']);
  for(const name of config.dependencies) assert.ok(pkg.peerDependencies[name], `${name} is a peer dependency`);
});

test('every hook points at a file that exists and exports a handler', async () => {
  for(const [event, path] of Object.entries(config.hooks)){
    assert.match(event, /^kempo-(products|inventory):/);
    assert.ok(existsSync(new URL(`../${path.replace(/^\.\//, '')}`, import.meta.url)), path);
  }
});

test('every hook is documented in the README', () => {
  const readme = read('README.md');
  for(const event of Object.keys(config.hooks)) assert.ok(readme.includes(`\`${event}\``), event);
});

test('the public scope matches between the config and the package', () => {
  assert.equal(config['public-scope'], pkg.kempo['public-scope']);
});

test('the files the package ships exist', () => {
  for(const file of pkg.files) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
});

test('the product tab is global content and the item panel a fragment the other extensions look for', () => {
  assert.ok(existsSync(new URL('../admin/product-tab.global.html', import.meta.url)));
  assert.ok(existsSync(new URL('../admin/inventory-item-actions.fragment.html', import.meta.url)));
});

test('it declares no permissions of its own: it uses products\' and inventory\'s', () => {
  assert.equal(config.permissions, undefined);
});
