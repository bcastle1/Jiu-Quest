// The stage components, run outside React. Vite's esbuild (a dependency of
// the site) compiles a component file's JSX into plain element objects, and
// each of its imports is swapped for the real module or a stand-in. 'react'
// becomes the small hook runner below, so a test can render, call an element's
// handler as the browser would (a video's error event), and see exactly when
// effects run. Shared by tests/unrealTechniquePicture.test.js and
// tests/unrealMatchMoments.test.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

export const asModule = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
export const repoModule = (path) => new URL(`../../${path}`, import.meta.url).href;
const STAND_IN_JSX = asModule(`export const __Fragment = 'fragment';
export const __h = (type, props, ...children) => ({ type, props: children.length ? { ...props, children: children.length > 1 ? children : children[0] } : { ...props } });`);
export const STAND_IN_REACT = asModule(['useEffect', 'useId', 'useReducer', 'useRef', 'useState'].map((name) => `export const ${name} = (...args) => globalThis.__hookRunner.${name}(...args);`).join('\n'));
export const standInComponent = (name) => asModule(`export default function ${name}() { return null; }`);

export async function loadComponent(path, imports) {
  const { transformWithEsbuild } = await import('vite');
  const code = source(path).replaceAll('import.meta.env', 'globalThis.__componentEnv');
  const compiled = (await transformWithEsbuild(code, path, { loader: 'jsx', jsx: 'transform', jsxFactory: '__h', jsxFragment: '__Fragment', sourcemap: false })).code;
  const swapped = [];
  const body = compiled.replace(/^import (?:(.+) from )?"([^"]+)";$/gm, (line, names, specifier) => {
    assert.ok(Object.hasOwn(imports, specifier), `${path} imports ${specifier}, which the test has no stand-in for`);
    swapped.push(specifier);
    return imports[specifier] === null ? '' : `import ${names ? `${names} from ` : ''}${JSON.stringify(imports[specifier])};`;
  });
  assert.deepEqual(swapped.sort(), Object.keys(imports).sort(), `${path}: its imports`);
  return import(asModule(`import { __h, __Fragment } from ${JSON.stringify(STAND_IN_JSX)};\n${body}`));
}

// Hooks for one component at a time. render() is one commit: the component
// runs, then the effects whose inputs changed, again while an effect changes
// state. A handler called between renders changes state as an event would.
export function createHookRunner() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let changed = false;
  const runner = {
    rendering: false,
    useReducer(reducer, initialArg, init) {
      const slot = slots[cursor] ??= { state: init ? init(initialArg) : initialArg };
      cursor += 1;
      slot.reducer = reducer;
      slot.dispatch ??= (action) => {
        const next = slot.reducer(slot.state, action);
        if (!Object.is(next, slot.state)) { slot.state = next; changed = true; }
      };
      return [slot.state, slot.dispatch];
    },
    useState: (initial) => runner.useReducer((state, action) => (typeof action === 'function' ? action(state) : action), initial, (value) => (typeof value === 'function' ? value() : value)),
    useRef(current) {
      const slot = slots[cursor] ??= { current };
      cursor += 1;
      return slot;
    },
    useEffect(effect, deps) {
      const slot = slots[cursor] ??= {};
      cursor += 1;
      if (slot.deps && deps && deps.length === slot.deps.length && deps.every((dep, index) => Object.is(dep, slot.deps[index]))) return;
      effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); slot.deps = deps; });
    },
    useId: () => ':clip:',
    render(component, props) {
      for (let pass = 0; pass < 10; pass += 1) {
        cursor = 0;
        effects = [];
        changed = false;
        runner.rendering = true;
        let tree;
        try { tree = component(props); } finally { runner.rendering = false; }
        for (const effect of effects) effect();
        if (!changed) return tree;
      }
      throw new Error('the component keeps changing its own state');
    },
  };
  return runner;
}

export const findElement = (node, test) => {
  if (Array.isArray(node)) return node.map((child) => findElement(child, test)).find(Boolean) ?? null;
  if (!node || typeof node !== 'object') return null;
  return test(node) ? node : findElement(node.props?.children, test);
};

// Globals for the length of one test.
export const useGlobals = (t, values) => {
  const before = Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.assign(globalThis, values);
  t.after(() => {
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
};

// One published view of a clip, shaped like an entry of the clip list.
export const clipView = (moveId, performerSide, camera) => Object.freeze({
  moveId, performerSide, camera, video: `/assets/unreal-clips/${moveId}/${performerSide}-${camera}.mp4`, poster: `/assets/unreal-clips/${moveId}/${performerSide}-${camera}.webp`,
  width: 1280, height: 720, fps: 30, frames: 54, durationSeconds: 1.8, loops: false, posterFrame: 0, choreographyReviewed: false,
});
export const viewsOf = (published) => (moveId, performerSide = 'fighter') => (Object.hasOwn(published, moveId) ? published[moveId][performerSide] ?? [] : []).map((camera) => clipView(moveId, performerSide, camera));
