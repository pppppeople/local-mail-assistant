import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function environment(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['MAIL_ASSISTANT_BASE', 'MAIL_ASSISTANT_HOME', 'MAIL_ASSISTANT_CONFIG']) delete env[key];
  return { ...env, ...overrides };
}
function run(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: os.tmpdir(), env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('default mail configuration resolves to the owner private home independent of cwd', () => {
  const output = run(['--input-type=module', '-e', `
    const {RUNTIME,CONFIG_FILE}=await import(process.argv[1]);
    console.log(JSON.stringify({runtime:RUNTIME,config:CONFIG_FILE}));
  `, path.join(root, 'src/config.js')], environment());
  const expected = path.join(os.homedir(), '.local/share/pp-mail-assistant/runtime');
  assert.deepEqual(JSON.parse(output), { runtime: expected, config: path.join(expected, 'config', 'config.json') });
});

test('initialization and private writers use the selected runtime without contacting mail or WeChat', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-layout-test-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const privateHome = path.join(fixture, 'private');
  const env = environment({ MAIL_ASSISTANT_BASE: privateHome });
  run([path.join(root, 'src/cli.js'), 'init'], env);
  const runtime = path.join(privateHome, 'pp-mail-assistant/runtime');
  const configFile = path.join(runtime, 'config', 'config.json');
  const initial = fs.readFileSync(configFile);
  run([path.join(root, 'src/cli.js'), 'init'], env);
  assert.deepEqual(fs.readFileSync(configFile), initial);
  run([path.join(root, 'src/cli.js'), 'status'], env);
  assert.equal(fs.existsSync(path.join(runtime, 'mail.sqlite')), false);
  run(['--input-type=module', '-e', `
    const root=process.argv[1];
    const path=await import('node:path');
    const {RUNTIME,savePrivateJson}=await import(path.join(root,'src/config.js'));
    const {Store}=await import(path.join(root,'src/store.js'));
    const {MicrosoftAuth}=await import(path.join(root,'src/mail/oauth.js'));
    const {portalAccessCode}=await import(path.join(root,'src/portal.js'));
    const store=new Store(path.join(RUNTIME,'state','mail.sqlite'));store.close();
    savePrivateJson(new MicrosoftAuth({id:'fixture'},RUNTIME).file,{synthetic:true});
    portalAccessCode(RUNTIME);
  `, root], env);
  for (const relative of ['config/config.json', 'state/mail.sqlite', 'config/oauth/fixture.json', 'config/web-access.json']) {
    const file = path.join(runtime, relative);
    assert.ok(fs.existsSync(file));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.equal(fs.existsSync(path.join(privateHome, 'artifacts')), false);
  const custom = path.join(fixture, 'custom-runtime');
  run([path.join(root, 'src/cli.js'), 'init'], environment({ MAIL_ASSISTANT_BASE: privateHome, MAIL_ASSISTANT_HOME: custom }));
  assert.ok(fs.existsSync(path.join(custom, 'config', 'config.json')));
  const explicitConfig = path.join(fixture, 'explicit-config/config.json');
  run([path.join(root, 'src/cli.js'), 'init'], environment({ MAIL_ASSISTANT_HOME: custom, MAIL_ASSISTANT_CONFIG: explicitConfig }));
  assert.ok(fs.existsSync(explicitConfig));
});

test('demo reports and its synthetic database are written to separate task directories', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-demo-layout-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  for (const directory of ['src', 'scripts', 'config']) fs.cpSync(path.join(root, directory), path.join(fixture, directory), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  run([path.join(fixture, 'scripts/demo.js')], environment());
  const task = path.join(fixture, 'artifacts/demo');
  for (const file of ['outputs/flow-preview.md', 'outputs/flow-evidence.json', 'tmp/runtime/state/mail.sqlite']) assert.ok(fs.existsSync(path.join(task, file)));
  assert.deepEqual(fs.readdirSync(task).sort(), ['outputs', 'tmp']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(task, 'outputs/flow-evidence.json'))).realMailOrWechatContacted, false);
});
