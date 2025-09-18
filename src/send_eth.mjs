import fs from 'node:fs/promises';import path from 'node:path';import { publicClientL2, walletClientL2, account } from './config.mjs';import { isAddress, parseEther, formatEther } from 'viem';
const TARGETS=process.env.TARGETS||'data/targets.txt';const COUNT=Number(process.env.COUNT||10);const SEND_ETH=parseEther(String(process.env.SEND_ETH||'0.00001'));const SLEEP_MS=Number(process.env.SLEEP_MS||3000);const JITTER_MS=Number(process.env.JITTER_MS||0);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function loadTargets(){const p=path.resolve(TARGETS);const txt=await fs.readFile(p,'utf8').catch(()=> '');return txt.split(/\r?\n/).map(x=>x.trim()).filter(x=>isAddress(x));}
async function main(){if(!account)throw new Error('TEST_PRIVATE_KEY is not set.');const targets=await loadTargets();if(targets.length===0)throw new Error(`No valid targets in ${TARGETS}`);
console.log('Sender :',account.address);console.log('Count  :',COUNT,'| Amount :',formatEther(SEND_ETH),'ETH each');console.log('Targets:',targets.length);
for(let i=1;i<=COUNT;i++){const to=targets[Math.floor(Math.random()*targets.length)];const hash=await walletClientL2.sendTransaction({to,value:SEND_ETH});console.log(`[${i}/${COUNT}] -> ${to} | tx: ${hash}`);
await publicClientL2.waitForTransactionReceipt({hash});if(i<COUNT){const jitter=JITTER_MS>0?Math.floor(Math.random()*(JITTER_MS+1)):0;await sleep(SLEEP_MS+jitter);}}
console.log('✅ Done');}
main().catch(e=>{console.error(e);process.exit(1);});
