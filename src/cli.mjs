import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import chalk from 'chalk';

async function printHeader() {
  const headerFile = process.env.HEADER_FILE || 'shogun.txt';
  try {
    const txt = await fs.readFile(path.resolve(process.cwd(), headerFile), 'utf8');
    console.log('\n' + txt + '\n');
  } catch { /* no-op */ }
}
const toYes = (s, def = false) => {
  if (!s) return def;
  const t = String(s).trim().toLowerCase();
  return t === 'y' || t === 'yes';
};

await printHeader();

const rl = createInterface({ input, output });
const defaultSkip = String(process.env.SKIP_DEPOSIT || '').toLowerCase() === 'true';

const q = `Sertakan proses deposit L1->L2? ${chalk.gray(defaultSkip ? '(default: tidak)' : '(default: ya)')} [y/N]: `;
const ans = await rl.question(q);
await rl.close();

const includeDeposit = toYes(ans, !defaultSkip);
const env = { ...process.env, SKIP_DEPOSIT: includeDeposit ? 'false' : 'true' };

console.log(`\nℹ️  SKIP_DEPOSIT=${env.SKIP_DEPOSIT}`);
const child = spawn(process.execPath, ['src/loop_token_batch_parallel.mjs'], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code) => process.exit(code ?? 0));
