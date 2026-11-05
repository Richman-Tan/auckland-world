import { describe, expect, it } from 'vitest';
import { htmlModules, resolveSpecifier, staticImports } from '../scripts/lib/bundle';

describe('bundle check parsing', () => {
  it('finds module scripts and modulepreloads in any attribute order, not other scripts or styles', () => {
    const html = `<script type="module" crossorigin src="/assets/main-1.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/dep-2.js">
      <script src="/assets/a-3.js" type="module"></script>
      <link href="/assets/b-4.js" rel="modulepreload">
      <script type=module src=/assets/c-5.js></script>
      <link rel="stylesheet" href="/assets/main.css"><script src="/legacy.js"></script>`;
    expect(htmlModules(html)).toEqual(['/assets/main-1.js', '/assets/a-3.js', '/assets/c-5.js', '/assets/dep-2.js', '/assets/b-4.js']);
  });

  it('reads static imports inside inline module scripts', () => {
    expect(htmlModules('<script type="module">import"/assets/three.module-X.js";</script>')).toEqual(['/assets/three.module-X.js']);
  });

  it('follows static imports and re-exports but not lazy import() or the preload table', () => {
    const code =
      'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/three.module-X.js"])))=>i.map(i=>d[i]);' +
      'import{a as b,c}from"./shared-1.js";import"./side-2.js";export{d}from"../up-3.js";import{e}from"/assets/abs-4.js";' +
      'const w=()=>import("./world-4.js");const v=__vitePreload(()=>import("./three.module-X.js"),__vite__mapDeps([0]));';
    expect(staticImports(code).sort()).toEqual(['../up-3.js', './shared-1.js', './side-2.js', '/assets/abs-4.js']);
  });

  it('handles namespace imports', () => {
    expect(staticImports('import*as T from"./t-5.js";')).toEqual(['./t-5.js']);
  });

  it('resolves relative, absolute and query-string specifiers to dist paths', () => {
    expect(resolveSpecifier('index.html', '/assets/main-1.js')).toBe('assets/main-1.js');
    expect(resolveSpecifier('page/index.html', '../assets/x.js')).toBe('assets/x.js');
    expect(resolveSpecifier('assets/main-1.js', './dep.js?v=2')).toBe('assets/dep.js');
  });
});
