import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Use Node 22+ (Node 24 LTS recommended).');
  if (process.platform !== 'darwin') throw new Error('Run this iOS preparation step on macOS with Xcode 26+. See IOS_START_HERE.md.');
  const config = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
  if (config.webDir !== 'dist-ios' || config.server?.url) throw new Error('Expected local dist-ios assets, without server.url.');
  for (const packageName of ['@capacitor/core', '@capacitor/cli', '@capacitor/ios']) {
    const packagePath = path.join('node_modules', packageName, 'package.json');
    if (!existsSync(packagePath)) throw new Error(`Install ${packageName}@8 first; see IOS_START_HERE.md.`);
    const info = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (!info.version.startsWith('8.')) throw new Error(`Expected Capacitor 8: ${packageName}`);
  }
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-b']);
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'native']);
  if (!existsSync('dist-ios/index.html')) throw new Error('Native web build is missing.');
  const cap = 'node_modules/@capacitor/cli/bin/capacitor';
  if (!existsSync('ios')) run(process.execPath, [cap, 'add', 'ios']);
  run(process.execPath, [cap, 'sync', 'ios']);
  console.log('Ready to open in Xcode: npx cap open ios');
  console.log('Set your signing team and verify the bundle identifier before running.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
