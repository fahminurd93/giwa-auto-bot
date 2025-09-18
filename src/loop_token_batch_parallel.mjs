// src/loop_token_batch_parallel.mjs
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createPublicClient, createWalletClient, http,
  isAddress, parseEther, parseUnits, formatEther, formatUnits
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { giwaSepolia } from './config.mjs';
import {
  publicActionsL1, publicActionsL2,
  walletActionsL1, walletActionsL2,
  getL2TransactionHashes,
} from 'viem/op-stack';
import { createHud } from './notif.mjs';

// ---------- ENV ----------
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 30_000);
const L1_RPC = process.env.L1_RPC || 'https://rpc.sepolia.org';
const L2_RPC = process.env.L2_RPC || 'https://sepolia-rpc.giwa.io';

const ROUNDS_RAW = Number(process.env.ROUNDS || 1);
const LOOP_FOREVER =
  String(process.env.LOOP_FOREVER || '').toLowerCase() === 'true' || ROUNDS_RAW <= 0;
const ROUNDS = LOOP_FOREVER ? 0 : ROUNDS_RAW;
const ROUND_DELAY_MS = Number(process.env.ROUND_DELAY_MS || 0);

const BATCH_SIZE = 2; // hard-cap 2 paralel

const QUIET = String(process.env.QUIET || process.env.HUD_QUIET || '').toLowerCase() === 'true';
const HEADER_FILE = process.env.HEADER_FILE || 'shogun.txt';

const SKIP_DEPOSIT = String(process.env.SKIP_DEPOSIT || '').toLowerCase() === 'true';
const DEPOSIT_ETH = parseEther(String(process.env.DEPOSIT_ETH || '0.001'));
const DEPOSIT_L2_GAS = Number(process.env.DEPOSIT_L2_GAS || 200_000);

const ARTIFACT = process.env.ARTIFACT || 'artifacts/ERC20Lite.json';
const CONTRACT_PATH = process.env.CONTRACT_PATH || 'contracts/ERC20Lite.sol';
const TOKENS_PER_WALLET = Number(process.env.TOKENS_PER_WALLET || 1);
const NAME_BASE = process.env.NAME_BASE || 'GiwaToken';
const SYMBOL_BASE = process.env.SYMBOL_BASE || 'GIW';
const DECIMALS = Number(process.env.DECIMALS || 18);
const SUPPLY_HUMAN = String(process.env.SUPPLY_HUMAN || '1000000');

const AIRDROP_COUNT = Number(process.env.AIRDROP_COUNT || 5);
const AIRDROP_PER_ADDRESS = String(process.env.AIRDROP_PER_ADDRESS || '10');
const LOOKBACK_BLOCKS = Number(process.env.LOOKBACK_BLOCKS || 2000);
const MAX_SCAN = Number(process.env.MAX_SCAN || 600);
const AIRDROP_STRICT_EOA = String(process.env.AIRDROP_STRICT_EOA || '').toLowerCase() === 'true';
const AIRDROP_BLOCKLIST = (process.env.AIRDROP_BLOCKLIST || '0x0000000000000000000000000000000000000000,0x000000000000000000000000000000000000dead,0xdeaddead,0x420000')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const SLEEP_MS = Number(process.env.SLEEP_MS || 1500);
const JITTER_MS = Number(process.env.JITTER_MS || 300);

const KEYS_FILE = process.env.KEYS || 'data/keys.txt';
const L2_RECEIPT_TIMEOUT_MS = Number(process.env.L2_RECEIPT_TIMEOUT_MS || 600_000);
const L2_POLL_MS = Number(process.env.L2_POLL_MS || 3_000);

// --- HUD options (baru) ---
const HUD_FULL_ADDR     = String(process.env.HUD_FULL_ADDR ?? 'true').toLowerCase() === 'true';
const HUD_FULL_HASH     = String(process.env.HUD_FULL_HASH ?? 'true').toLowerCase() === 'true';
const HUD_TITLE1        = process.env.HUD_TITLE1 || 'Budak Pekerja 1';
const HUD_TITLE2        = process.env.HUD_TITLE2 || 'Budak Pekerja 2';
const HUD_MAX_BOX_WIDTH = Number(process.env.HUD_MAX_BOX_WIDTH || 90);

// ---------- ABIs ----------
const L1_STANDARD_BRIDGE_ABI = [
  { type:'function', name:'depositETHTo', stateMutability:'payable',
    inputs:[{name:'_to',type:'address'},{name:'_l2Gas',type:'uint32'},{name:'_data',type:'bytes'}], outputs:[] }
];
const ERC20_ABI = [
  { type:'function', name:'decimals', stateMutability:'view', inputs:[], outputs:[{type:'uint8'}] },
  { type:'function', name:'transfer', stateMutability:'nonpayable', inputs:[{name:'to',type:'address'},{name:'amt',type:'uint256'}], outputs:[{type:'bool'}] },
];

// ---------- utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jittered = (ms) => ms + (JITTER_MS > 0 ? Math.floor(Math.random() * (JITTER_MS + 1)) : 0);
const short = (s, n=6) => !s ? '--' : (s.startsWith('0x') && s.length > (2+n)) ? `${s.slice(0,2+n)}…${s.slice(-n)}` : String(s);

async function printHeaderOnce() {
  try {
    const p = path.resolve(process.cwd(), HEADER_FILE);
    const txt = await fs.readFile(p, 'utf8');
    console.log('\n' + txt + '\n');
  } catch {}
}

function makeClients(pk) {
  const account = privateKeyToAccount(pk);
  const publicClientL1 = createPublicClient({ chain: sepolia, transport: http(L1_RPC, { timeout: RPC_TIMEOUT_MS }) })
    .extend(publicActionsL1());
  const publicClientL2 = createPublicClient({ chain: giwaSepolia, transport: http(L2_RPC, { timeout: RPC_TIMEOUT_MS }) })
    .extend(publicActionsL2());
  const walletClientL1 = createWalletClient({ account, chain: sepolia, transport: http(L1_RPC, { timeout: RPC_TIMEOUT_MS }) })
    .extend(walletActionsL1());
  const walletClientL2 = createWalletClient({ account, chain: giwaSepolia, transport: http(L2_RPC, { timeout: RPC_TIMEOUT_MS }) })
    .extend(walletActionsL2());
  return { account, publicClientL1, publicClientL2, walletClientL1, walletClientL2 };
}

// ---------- compile artifact (auto) ----------
async function ensureArtifact() {
  try {
    const raw = await fs.readFile(ARTIFACT, 'utf8');
    const j = JSON.parse(raw);
    if (j?.abi && typeof j.bytecode === 'string' && j.bytecode.startsWith('0x')) return j;
    throw new Error('Artifact malformed');
  } catch {
    return await compileERC20Lite();
  }
}
async function compileERC20Lite() {
  let solc;
  try { ({ default: solc } = await import('solc')); }
  catch { throw new Error('solc not installed. Run: npm i solc'); }
  const source = await fs.readFile(CONTRACT_PATH, 'utf8').catch(() => {
    throw new Error(`Contract source not found at ${CONTRACT_PATH}`);
  });
  const input = {
    language: 'Solidity',
    sources: { [path.basename(CONTRACT_PATH)]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*':['abi','evm.bytecode.object'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((e) => e.severity === 'error') || [];
  if (errors.length) throw new Error(`solc compile failed:\n${errors.map(e=>e.formattedMessage||e.message).join('\n')}`);
  const fileKey = path.basename(CONTRACT_PATH);
  const names = Object.keys(output.contracts?.[fileKey] || {});
  if (!names.length) throw new Error('No contracts found in compile output');
  const name = names[0];
  const { abi, evm } = output.contracts[fileKey][name];
  const art = { abi, bytecode: '0x' + evm.bytecode.object };
  await fs.mkdir(path.dirname(ARTIFACT), { recursive: true });
  await fs.writeFile(ARTIFACT, JSON.stringify(art, null, 2), 'utf8');
  if (!QUIET) console.log(`🧩 Compiled & saved artifact → ${ARTIFACT}`);
  return art;
}

// ---------- core steps ----------
async function depositStep(c) {
  const bridgeAddr = giwaSepolia.contracts.l1StandardBridge[sepolia.id].address;
  const hash = await c.walletClientL1.writeContract({
    address: bridgeAddr, abi: L1_STANDARD_BRIDGE_ABI, functionName:'depositETHTo',
    args:[c.account.address, DEPOSIT_L2_GAS, '0x'], value: DEPOSIT_ETH,
  });
  const l1r = await c.publicClientL1.waitForTransactionReceipt({ hash });
  const [l2Hash] = getL2TransactionHashes(l1r);
  await c.publicClientL2.waitForTransactionReceipt({ hash: l2Hash, timeout: L2_RECEIPT_TIMEOUT_MS, pollingInterval: L2_POLL_MS });
  return { l1Hash: hash, l2Hash };
}

async function deployOneToken(publicClientL2, walletClientL2, account, name, symbol) {
  const { abi, bytecode } = await ensureArtifact();
  const supply = parseUnits(SUPPLY_HUMAN, DECIMALS);
  const hash = await walletClientL2.deployContract({ abi, bytecode, account, args:[name, symbol, DECIMALS, supply] });
  const rcpt = await publicClientL2.waitForTransactionReceipt({ hash });
  return { hash, address: rcpt.contractAddress };
}

async function discoverEOAs(publicClientL2, wantCount) {
  const tip = await publicClientL2.getBlockNumber();
  const candidates = new Set();
  for (let i = 0n; i < BigInt(MAX_SCAN); i++) {
    const bn = tip - i;
    if (bn < 1n || i >= BigInt(LOOKBACK_BLOCKS)) break;
    const block = await publicClientL2.getBlock({ blockNumber: bn, includeTransactions: true });
    for (const tx of block.transactions) {
      if (tx.from) candidates.add(tx.from);
      if (tx.to)   candidates.add(tx.to);
    }
    if (candidates.size > wantCount * 8) break;
    if (i % 50n === 0n && i !== 0n) await sleep(100);
  }
  const arr = Array.from(candidates)
    .filter((a)=>isAddress(a))
    .filter((a)=>!AIRDROP_BLOCKLIST.some((p)=>a.toLowerCase().startsWith(p)));

  const eoas = [];
  for (const a of arr) {
    try {
      const code = await publicClientL2.getBytecode({ address:a });
      const isEOA = code == null || code === '0x' || code === '0x0' || (typeof code === 'string' && code.length <= 2);
      if (isEOA) eoas.push(a);
    } catch {}
    if (eoas.length >= wantCount * 2) break;
  }
  const pick = (list, n) => {
    const out = []; const pool = list.slice();
    while (out.length < n && pool.length) out.push(...pool.splice(Math.floor(Math.random()*pool.length),1));
    return out.slice(0, n);
  };
  if (!eoas.length) return AIRDROP_STRICT_EOA ? [] : pick(arr, wantCount);
  return pick(eoas, wantCount);
}

async function airdropToken(publicClientL2, walletClientL2, token, perAddressHuman, count, onProgress) {
  const per = parseUnits(String(perAddressHuman), DECIMALS);
  const addrs = await discoverEOAs(publicClientL2, count);
  for (let i = 0; i < addrs.length; i++) {
    const to = addrs[i];
    const hash = await walletClientL2.writeContract({ address: token, abi: ERC20_ABI, functionName:'transfer', args:[to, per] });
    onProgress?.(i + 1, addrs.length, to, hash);
    await publicClientL2.waitForTransactionReceipt({ hash });
    if (i + 1 < addrs.length) await sleep(jittered(SLEEP_MS));
  }
  return addrs.length;
}

// ---------- HUD (imported) ----------
const hud = createHud({
  tokensPerWallet: TOKENS_PER_WALLET,
  airdropCount: AIRDROP_COUNT,
  airdropPerAddress: AIRDROP_PER_ADDRESS,
  refreshMs: 700,
  borderColor: 'green',
  banner: process.env.HUD_BANNER || 't.me/Airdropshogun',
  bannerColor: process.env.HUD_BANNER_COLOR || 'magenta',
  // baru:
  fullAddr: HUD_FULL_ADDR,
  fullHash: HUD_FULL_HASH,
  title1: HUD_TITLE1,
  title2: HUD_TITLE2,
  maxBoxWidth: HUD_MAX_BOX_WIDTH,
});

// ---------- per-wallet runner ----------
async function runWalletOnce(pk, walletAbsIndex, totalWallets, roundIndex, globalTokenStartIndex, slotIndex) {
  const { account, publicClientL1, publicClientL2, walletClientL1, walletClientL2 } = makeClients(pk);
  hud.set(slotIndex, {
    addr: account.address,
    pos: `W${walletAbsIndex + 1}/${totalWallets}  R${roundIndex + 1}`,
    phase: 'Starting',
    l1:'--', l2:'--',
    tokDone:0, tokTotal:TOKENS_PER_WALLET,
    dropDone:0, dropTotal:AIRDROP_COUNT, err:0,
    tokenBadge:'', dropBadge:''
  });

  try {
    if (!SKIP_DEPOSIT) {
      hud.set(slotIndex, { phase: `Deposit ${formatEther(DEPOSIT_ETH)} L1->L2` });
      const dep = await depositStep({ account, publicClientL1, publicClientL2, walletClientL1, walletClientL2 });
      hud.set(slotIndex, { l1: dep.l1Hash, l2: dep.l2Hash, phase: 'Ready' });
    } else {
      hud.set(slotIndex, { phase: 'Ready (no deposit)' });
    }

    for (let t = 0; t < TOKENS_PER_WALLET; t++) {
      const tokenOrdinal = globalTokenStartIndex + t;
      const name = `${NAME_BASE}${tokenOrdinal}`;
      const symbol = `${SYMBOL_BASE}${tokenOrdinal}`;

      hud.set(slotIndex, { phase: `Deploy ${symbol}`, tokenBadge: '' });
      const tok = await deployOneToken(publicClientL2, walletClientL2, account, name, symbol);
      hud.set(slotIndex, { tokDone: t+1, l1: tok.hash, l2: tok.address });

      // sub-notif deploy (full/short sesuai ENV)
      const tokenBadgeText = HUD_FULL_HASH
        ? `${symbol} → ${tok.address} | ${tok.hash}`
        : `${symbol} → ${short(tok.address)} | ${short(tok.hash)}`;
      hud.token(slotIndex, tokenBadgeText);

      if (AIRDROP_COUNT > 0) {
        hud.set(slotIndex, { phase: `Airdrop ${AIRDROP_PER_ADDRESS} x ${AIRDROP_COUNT}`, dropBadge: '' });
        const done = await airdropToken(
          publicClientL2, walletClientL2, tok.address, AIRDROP_PER_ADDRESS, AIRDROP_COUNT,
          (i, n, to, h) => {
            const line = HUD_FULL_HASH
              ? `[${i}/${n}] → ${to} | ${h}`
              : `[${i}/${n}] → ${short(to)} | ${short(h)}`;
            hud.drop(slotIndex, line);
          }
        );
        hud.set(slotIndex, { dropDone: done });
      }
      if (t + 1 < TOKENS_PER_WALLET) await sleep(jittered(SLEEP_MS));
    }
    hud.set(slotIndex, { phase: 'DONE' });
  } catch (e) {
    hud.set(slotIndex, { err: (hud.slots[slotIndex].err || 0) + 1, phase: `ERR: ${e?.shortMessage || e?.message || String(e)}` });
  }
}

// ---------- batch driver (2 parallel) ----------
async function runBatchTwo(keys, startIndex, totalWallets, roundIndex, globalRoundBase) {
  const roundLabel = LOOP_FOREVER ? `${roundIndex + 1}/∞` : `${roundIndex + 1}/${ROUNDS}`;
  hud.setHeader({ round: roundLabel, batch: `${startIndex + 1}..${startIndex + keys.length}` });

  const jobs = keys.map((pk, i) => {
    const w = startIndex + i;
    const myTokenStart = globalRoundBase + (w * TOKENS_PER_WALLET) + 1;
    return runWalletOnce(pk, w, totalWallets, roundIndex, myTokenStart, i);
  });
  await Promise.allSettled(jobs);
}

// ---------- main ----------
async function main() {
  await printHeaderOnce();

  const s = await fs.readFile(KEYS_FILE, 'utf8').catch(() => '');
  const keys = s.split(/\r?\n/).map(x => x.trim()).filter(Boolean).filter(x => /^0x[0-9a-fA-F]{64}$/.test(x));
  if (!keys.length) throw new Error(`No private keys in ${KEYS_FILE}`);

  if (!QUIET) {
    const neededPerToken = BigInt(AIRDROP_COUNT) * parseUnits(String(AIRDROP_PER_ADDRESS), DECIMALS);
    console.log(`Supply check: per token need >= ${formatUnits(neededPerToken, DECIMALS)} tokens.`);
    console.log(`CFG | BATCH_SIZE=${BATCH_SIZE}  ROUNDS=${LOOP_FOREVER ? '∞' : ROUNDS}  SKIP_DEPOSIT=${SKIP_DEPOSIT}`);
    console.log(`    | TOKENS_PER_WALLET=${TOKENS_PER_WALLET}  AIRDROP=${AIRDROP_COUNT}x${AIRDROP_PER_ADDRESS}  SUPPLY=${SUPPLY_HUMAN}`);
    console.log(`    | RPC_TIMEOUT_MS=${RPC_TIMEOUT_MS}  L2_POLL_MS=${L2_POLL_MS}`);
    console.log(`SRC | CONTRACT_PATH=${CONTRACT_PATH}  ARTIFACT=${ARTIFACT}  STRICT_EOA=${AIRDROP_STRICT_EOA}  BLOCKLIST=${AIRDROP_BLOCKLIST.join('|')}`);
    if (LOOP_FOREVER) console.log('♻️  Loop mode ON — tekan Ctrl+C untuk berhenti.');
  }

  // graceful Ctrl+C
  process.on('SIGINT', () => {
    try { hud.stop(); } catch {}
    console.log('\n👋 Stopped.');
    process.exit(0);
  });

  hud.start();

  let r = 0;
  while (LOOP_FOREVER || r < ROUNDS) {
    const tokensPerRound = keys.length * TOKENS_PER_WALLET;
    const globalRoundBase = r * tokensPerRound;

    for (let start = 0; start < keys.length; start += BATCH_SIZE) {
      const batch = keys.slice(start, start + BATCH_SIZE);
      await runBatchTwo(batch, start, keys.length, r, globalRoundBase);
    }

    r += 1;
    if (!LOOP_FOREVER && r >= ROUNDS) break;
    if (ROUND_DELAY_MS > 0) await sleep(ROUND_DELAY_MS);
  }

  hud.stop();
  if (!LOOP_FOREVER) console.log('\n🎉 All rounds & batches finished.');
}

main().catch((e) => { try { hud.stop(); } catch {}; console.error(e); process.exit(1); });
