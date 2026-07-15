import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const scriptMatches = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert(scriptMatches.length, 'script block is missing');
const appScript = scriptMatches.at(-1)[1];

const requiredSnippets = [
  'function tacoPosts()',
  'tacoDraftConsumption',
  'pointerStartCat',
  'pointerStartTask',
  'onpointerdown="App.pointerStartCat',
  'onpointerdown="App.pointerStartTask',
  'startEditContact',
  'commitEditContact',
  'startEditTemplate',
  'commitEditTemplate',
  'Slackに貼り付けた後',
];

for (const snippet of requiredSnippets) {
  assert(html.includes(snippet), `missing snippet: ${snippet}`);
}

assert(!html.includes('draggable="true"'), 'HTML5 draggable remains in report rows');
assert(!appScript.includes("text: '＠' +"), 'split taco output still prefixes a recipient');
assert(!appScript.includes("r => '＠'"), 'merge taco output still prefixes recipients');
assert(!appScript.includes("map(r => '＠'"), 'merge taco output still prefixes recipients');

const localStorageData = new Map();
const fakeApp = {
  dataset: {},
  innerHTML: '',
  querySelector() { return null; },
};
const sandbox = {
  window: { isSecureContext: false, CSS: { escape: (value) => String(value) } },
  document: {
    readyState: 'loading',
    documentElement: { style: { setProperty() {} } },
    body: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) { return id === 'app' ? fakeApp : null; },
    createElement() {
      return {
        style: {},
        focus() {},
        select() {},
        remove() {},
      };
    },
    execCommand() { return true; },
  },
  localStorage: {
    getItem(key) { return localStorageData.get(key) || null; },
    setItem(key, value) { localStorageData.set(key, String(value)); },
  },
  navigator: { clipboard: null },
  fetch: async () => ({ ok: true }),
  setTimeout,
  clearTimeout,
  console,
};
sandbox.globalThis = sandbox;

vm.runInNewContext(`${appScript}\nthis.__test = { state, App, tacoPosts, tacoDraftConsumption };`, sandbox, { filename: 'index-app-script.js' });
const { state, App, tacoPosts, tacoDraftConsumption } = sandbox.__test;

state.contacts = [
  { id: 1, name: 'Alice', memberId: 'U000TEST1', freq: 0 },
  { id: 2, name: 'Bob', memberId: 'U000TEST2', freq: 0 },
];
state.templates = [{ id: 'tpl1', label: 'Thanks', body: 'Thanks!' }];
state.blocks = [{ id: 101, recipients: ['Alice', 'Bob'], count: 2, body: 'Nice work' }];
state.tacoMode = 'merge';

const merged = tacoPosts();
assert(merged.length === 1, 'merge mode should group same-count recipients into one post');
assert(merged[0].text === `Alice\nBob\nNice work\n${'🌮'.repeat(2)}`, 'merge mode taco text format is wrong');
assert(tacoDraftConsumption() === 4, 'draft taco meter should count recipients times count');

state.tacoMode = 'split';
const split = tacoPosts();
assert(split.length === 2, 'split mode should create one post per recipient');
assert(split[0].text === `Alice\nNice work\n${'🌮'.repeat(2)}`, 'split mode taco text format is wrong');

App.startEditContact(1);
App.setEditContactName('Alice New');
App.commitEditContact(1);
assert(state.contacts.find(c => c.id === 1).name === 'Alice New', 'contact edit did not update contact name');
assert(state.blocks[0].recipients.includes('Alice'), 'contact edit should keep the existing selected recipient unchanged');
assert(!state.blocks[0].recipients.includes('Alice New'), 'contact edit should not propagate to selected recipients');

App.startEditTemplate('tpl1');
App.setEditTemplateLabel('Great');
App.setEditTemplateBody('Great job!');
App.commitEditTemplate('tpl1');
assert(state.templates[0].label === 'Great', 'template edit did not update label');
assert(state.templates[0].body === 'Great job!', 'template edit did not update body');

const docs = [
  'docs/日報ジェネレーター_要件定義書_v6.md',
  'docs/日報ジェネレーター_詳細設計書.md',
  'docs/リリース前検証チェックリスト.md',
];
for (const doc of docs) {
  assert(fs.existsSync(path.join(root, doc)), `missing doc: ${doc}`);
}

console.log('v6 verification passed');
