import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontPreload, { fontPreloadTags, PRELOADED_FACES } from '../tools/vite_font_preload.mjs';

const repoPath = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

// The shape Vite hands to transformIndexHtml: output file name -> output.
const asset = (fileName) => [fileName, { type: 'asset', fileName, source: '' }];
const chunk = (fileName) => [fileName, { type: 'chunk', fileName, code: '' }];
const builtFonts = [
  'assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2',
  'assets/barlow-condensed-latin-700-normal-v1xN8_Wq.woff2',
  'assets/barlow-condensed-latin-700-italic-DjyOzRJ7.woff2',
];
const siteBundle = () => Object.fromEntries([
  chunk('assets/index-CtMPjknS.js'),
  asset('assets/index-nseX-CP7.css'),
  ...builtFonts.map(asset),
  asset('index.html'),
]);
const link = (href) => ({
  tag: 'link',
  attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href },
  // Ahead of the script tag, so the fonts are asked for before the script.
  injectTo: 'head-prepend',
});

test('a build gets one preload link for each Barlow Condensed file, bold italic first', () => {
  const tags = fontPreloadTags(siteBundle(), '/');
  assert.deepEqual(tags, [
    link('/assets/barlow-condensed-latin-700-italic-DjyOzRJ7.woff2'),
    link('/assets/barlow-condensed-latin-700-normal-v1xN8_Wq.woff2'),
    link('/assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2'),
  ]);
  // Vite writes the attributes in this order; `true` becomes a bare attribute:
  // <link rel="preload" as="font" type="font/woff2" crossorigin href="...">
  for (const tag of tags) assert.deepEqual(Object.keys(tag.attrs), ['rel', 'as', 'type', 'crossorigin', 'href']);
});

test('the order of the links does not depend on the order of the bundle', () => {
  const expected = fontPreloadTags(siteBundle(), '/');
  const reversed = Object.fromEntries(Object.entries(siteBundle()).reverse());
  assert.deepEqual(fontPreloadTags(reversed, '/'), expected);
});

test('everything else in the bundle is left alone', () => {
  const others = Object.fromEntries([
    chunk('assets/index-CtMPjknS.js'),
    asset('assets/index-nseX-CP7.css'),
    asset('assets/hero-Bx81kQ2z.webp'),
    asset('assets/logo-Dq0aa71x.svg'),
    asset('assets/inter-latin-400-normal-Ab3dE6gh.woff2'),
    // Same family, but a weight the stylesheet does not declare.
    asset('assets/barlow-condensed-latin-500-normal-Zz3dE6gh.woff2'),
    // A chosen face in an older format, and a longer name that only starts like one.
    asset('assets/barlow-condensed-latin-700-normal-v1xN8_Wq.woff'),
    asset('assets/barlow-condensed-latin-700-normal-v1xN8_Wq.woff2.map'),
    asset('assets/barlow-condensed-latin-700-italic-wide-DjyOzRJ7.woff2'),
    // A script that happens to carry a font's name is not a font file.
    chunk('assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2'),
    asset('index.html'),
  ]);
  assert.deepEqual(fontPreloadTags(others, '/'), []);

  const mixed = { ...others, ...Object.fromEntries([asset(builtFonts[1])]) };
  assert.deepEqual(fontPreloadTags(mixed, '/'), [link('/assets/barlow-condensed-latin-700-normal-v1xN8_Wq.woff2')]);
});

test('no bundle, as in the dev server, means no links', () => {
  assert.deepEqual(fontPreloadTags(undefined, '/'), []);
  assert.deepEqual(fontPreloadTags(null, '/'), []);
  assert.deepEqual(fontPreloadTags({}, '/'), []);
  assert.deepEqual(fontPreloadTags(), []);
});

test('the links follow the path the site is served from', () => {
  const hrefs = (base) => fontPreloadTags(siteBundle(), base).map((tag) => tag.attrs.href);
  assert.deepEqual(hrefs('/play/'), [
    '/play/assets/barlow-condensed-latin-700-italic-DjyOzRJ7.woff2',
    '/play/assets/barlow-condensed-latin-700-normal-v1xN8_Wq.woff2',
    '/play/assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2',
  ]);
  assert.equal(hrefs('/play')[0], '/play/assets/barlow-condensed-latin-700-italic-DjyOzRJ7.woff2');
  assert.equal(hrefs('https://cdn.example.com/jq/')[0], 'https://cdn.example.com/jq/assets/barlow-condensed-latin-700-italic-DjyOzRJ7.woff2');
  assert.equal(hrefs('./')[0], './assets/barlow-condensed-latin-700-italic-DjyOzRJ7.woff2');
  assert.equal(hrefs('')[0], 'assets/barlow-condensed-latin-700-italic-DjyOzRJ7.woff2');
  assert.equal(fontPreloadTags(siteBundle())[0].attrs.href, '/assets/barlow-condensed-latin-700-italic-DjyOzRJ7.woff2');
});

test('every preloaded face is a font file the stylesheet really declares', () => {
  const css = readFileSync(repoPath('src/premium.css'), 'utf8');
  assert.equal(PRELOADED_FACES.length, 3);
  assert.equal(new Set(PRELOADED_FACES).size, PRELOADED_FACES.length);
  for (const face of PRELOADED_FACES) {
    assert.ok(existsSync(repoPath(`src/assets/fonts/${face}.woff2`)), `${face}.woff2 is in src/assets/fonts`);
    assert.ok(css.includes(`url('./assets/fonts/${face}.woff2') format('woff2')`), `${face} is an @font-face source`);
  }
  assert.throws(() => { PRELOADED_FACES.push('another'); }, TypeError);
});

test('the plugin runs only in a build, where the bundle is known', () => {
  const warnings = [];
  const plugin = fontPreload();
  assert.equal(plugin.apply, 'build');
  assert.equal(plugin.transformIndexHtml.order, 'post');
  plugin.configResolved({ base: '/play/', logger: { warn: (message) => warnings.push(message) } });

  const html = '<!doctype html><html><head></head><body></body></html>';
  assert.deepEqual(
    plugin.transformIndexHtml.handler(html, { bundle: siteBundle() }),
    fontPreloadTags(siteBundle(), '/play/'),
  );
  assert.deepEqual(warnings, [], 'a complete build says nothing');

  // A font file that was renamed or dropped must not lose its preload quietly.
  const twoFonts = Object.fromEntries(builtFonts.slice(1).map(asset));
  assert.equal(plugin.transformIndexHtml.handler(html, { bundle: twoFonts }).length, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /found 2 of 3 Barlow Condensed files/);
});
