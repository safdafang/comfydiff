import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const CLI = join(PKG, 'dist', 'cli.js');
const FIX = join(PKG, '..', '..', 'fixtures');
const fx = (p: string) => join(FIX, p);

function run(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, NO_COLOR: '1', ...opts.env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  execFileSync(process.execPath, [join(PKG, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'], { cwd: PKG });
}, 60_000);

describe('comfydiff <a> <b>', () => {
  it('prints the report and exits 1 when something matters', () => {
    const r = run([fx('example/a.png'), fx('example/b.png')]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('KSampler:');
    expect(r.out).toContain('steps 20 → 30, cfg 7 → 5.5, seed changed');
    expect(r.out).toContain('+ added:');
    expect(r.out).not.toContain('\x1b[');
  });

  it('exits 0 when only the layout changed', () => {
    const r = run([fx('pairs/moved-only/a.workflow.json'), fx('pairs/moved-only/b.workflow.json')]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('No differences that affect the output.');
  });

  it('--json is parseable and complete', () => {
    const r = run(['--json', fx('pairs/node-added/a.api.json'), fx('pairs/node-added/b.api.json')]);
    expect(r.code).toBe(1);
    const j = JSON.parse(r.out);
    expect(j.significant).toBe(true);
    expect(j.added[0].node.type).toBe('LoraLoader');
  });

  it('--markdown', () => {
    const r = run(['--markdown', fx('pairs/param-changed/a.api.json'), fx('pairs/param-changed/b.api.json')]);
    expect(r.out).toContain('**ComfyUI workflow diff:** `a.api.json` → `b.api.json`');
    expect(r.out).toContain('- **KSampler**: steps `20` → `30`');
  });

  it('--color forces ANSI colors', () => {
    const r = run(['--color', fx('pairs/param-changed/a.api.json'), fx('pairs/param-changed/b.api.json')]);
    expect(r.out).toContain('\x1b[1m');
  });

  it('explains errors and exits 2', () => {
    const r = run([fx('images/no-metadata.png'), fx('example/a.png')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/no-metadata\.png: This PNG has no ComfyUI workflow inside/);
    expect(run([fx('example/a.png')]).code).toBe(2);
    expect(run(['--bogus', 'a', 'b']).err).toMatch(/unknown option --bogus/);
    expect(run([fx('example/a.png'), 'does-not-exist.png']).err).toMatch(/no such file/);
  });

  it('--help and --version', () => {
    expect(run(['--help']).out).toContain('comfydiff textconv <file>');
    expect(run(['--version']).out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('comfydiff textconv', () => {
  it('prints the canonical form', () => {
    const r = run(['textconv', fx('example/a.png')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^# ComfyUI workflow/);
    expect(r.out).toContain('[3] KSampler');
  });

  it('never fails: passes other JSON through and summarises images without a workflow', () => {
    const j = run(['textconv', fx('images/not-a-workflow.json')]);
    expect(j.code).toBe(0);
    expect(j.out).toBe(readFileSync(fx('images/not-a-workflow.json'), 'utf8'));
    const p = run(['textconv', fx('images/no-metadata.png')]);
    expect(p.code).toBe(0);
    expect(p.out).toMatch(/no ComfyUI workflow \(png, \d+ bytes, fnv1a [0-9a-f]{8}\)/);
  });
});

describe('git integration (temporary repository)', () => {
  let repo = '';
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_PAGER: 'cat', NO_COLOR: '1' } });
  const cli = `"${process.execPath.replace(/\\/g, '/')}" "${CLI.replace(/\\/g, '/')}"`;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'comfydiff-git-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(join(repo, '.gitattributes'), '*.json diff=comfyui\n*.png diff=comfyui\n');
    git('config', 'diff.comfyui.textconv', `${cli} textconv`);
    copyFileSync(fx('pairs/param-changed/a.workflow.json'), join(repo, 'flow.json'));
    copyFileSync(fx('example/a.png'), join(repo, 'render.png'));
    git('add', '.');
    git('commit', '-q', '-m', 'init');
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('textconv: a moved-and-retuned workflow diffs as a few meaningful lines', () => {
    const wf = JSON.parse(readFileSync(fx('pairs/param-changed/b.workflow.json'), 'utf8'));
    for (const n of wf.nodes) n.pos = [n.pos[0] + 300, n.pos[1] + 120];
    writeFileSync(join(repo, 'flow.json'), JSON.stringify(wf, null, 2));
    const raw = git('diff', '--no-ext-diff', '--no-textconv', '--stat', 'flow.json');
    expect(raw).toMatch(/flow\.json/);
    const d = git('diff', 'flow.json');
    const changed = d.split('\n').filter((l) => /^[+-](?![+-])/.test(l));
    expect(changed.sort()).toEqual(
      ['-    cfg = 7', '+    cfg = 5.5', '-    sampler_name = "euler"', '+    sampler_name = "dpmpp_2m"', '-    scheduler = "normal"', '+    scheduler = "karras"', '-    seed = 156680208700286', '+    seed = 987654321', '-    steps = 20', '+    steps = 30'].sort(),
    );
    expect(d).not.toMatch(/pos/);
  });

  it('textconv works for PNG renders too', () => {
    copyFileSync(fx('example/b.png'), join(repo, 'render.png'));
    const d = git('diff', 'render.png');
    expect(d).toContain('+    steps = 30');
    expect(d).toContain('-    steps = 20');
    expect(d).not.toMatch(/Binary files/);
  });

  it('external diff driver prints the comfydiff report inside git diff', () => {
    git('config', 'diff.comfyui.command', `${cli} git-diff`);
    const d = git('diff', 'render.png');
    expect(d).toContain('comfydiff render.png');
    expect(d).toContain('steps 20 → 30, cfg 7 → 5.5, seed changed');
    git('config', '--unset', 'diff.comfyui.command');
  });
});
