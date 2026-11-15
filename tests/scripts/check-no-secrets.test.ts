// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(__dirname, '../../scripts/check-no-secrets.sh');
let dir: string;

function run() {
  return spawnSync('bash', [join(dir, 'scripts/check-no-secrets.sh')], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() },
  });
}
function git(...args: string[]) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  expect(r.status).toBe(0);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nosecrets-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(script, join(dir, 'scripts/check-no-secrets.sh'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('check-no-secrets.sh', () => {
  test('fails closed (exit 2) when git ls-files cannot run', () => {
    const r = run(); // temp dir is not a git repository
    expect(r.status).toBe(2);
    expect(r.stdout).not.toMatch(/OK/);
    expect(r.stderr).toMatch(/git ls-files failed/);
  });

  test('exits 0 on a clean tracked tree', () => {
    git('init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    git('add', '-A');
    expect(run().status).toBe(0);
  });

  test('exits 1 and names the file when a single file leaks a key', () => {
    git('init', '-q');
    // Built at runtime so this tracked file never contains a literal the guard matches.
    const fakeKey = ['sk', 'abcdefghijklmnopqrstuv'].join('-');
    writeFileSync(join(dir, 'a.ts'), `x = "${fakeKey}"\n`);
    git('add', 'a.ts');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('a.ts:1:');
  });
});
