import fs from 'node:fs/promises';
import { publicClientL2, walletClientL2, account } from './config.mjs';
async function main(){if(!account)throw new Error('TEST_PRIVATE_KEY is not set.');const artifactPath=process.env.ARTIFACT||'artifacts/Contract.json';const argsRaw=process.env.CONSTRUCTOR_ARGS||'[]';
const {abi,bytecode}=JSON.parse(await fs.readFile(artifactPath,'utf8'));const args=JSON.parse(argsRaw);if(!abi||!bytecode?.startsWith('0x'))throw new Error(`Artifact invalid: ${artifactPath}`);
console.log('Deployer :',account.address);console.log('Artifact :',artifactPath);console.log('Args     :',args);
const hash=await walletClientL2.deployContract({abi,bytecode,account,args});console.log('Deploy tx:',hash);
const receipt=await publicClientL2.waitForTransactionReceipt({hash});console.log('L2 confirmed. Contract address:',receipt.contractAddress);}main().catch(e=>{console.error(e);process.exit(1);});
