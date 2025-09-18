import readline from 'readline/promises';
import { publicClientL1, publicClientL2, walletClientL1, account, giwaSepolia } from './config.mjs';
import { formatEther, parseEther } from 'viem';
import { publicActionsL1, publicActionsL2, walletActionsL1, getL2TransactionHashes } from 'viem/op-stack';
import { sepolia } from 'viem/chains';
const L2_GAS=Number(process.env.DEPOSIT_L2_GAS||200000);const AUTO_CONFIRM=String(process.env.AUTO_CONFIRM||'').toLowerCase()==='true';
const l1=publicClientL1.extend(publicActionsL1());const l2=publicClientL2.extend(publicActionsL2());const wl1=walletClientL1.extend(walletActionsL1());
const ABI=[{type:'function',name:'depositETHTo',stateMutability:'payable',inputs:[{name:'_to',type:'address'},{name:'_l2Gas',type:'uint32'},{name:'_data',type:'bytes'}],outputs:[]}];
async function main(){if(!account)throw new Error('TEST_PRIVATE_KEY is not set.');const amount=parseEther(process.env.DEPOSIT_ETH||'0.001');
console.log('=== GIWA Deposit (L1StandardBridge) ===');console.log('From (L1):',account.address);console.log('To   (L2):',account.address);
console.log('Chain L1  : Sepolia',sepolia.id);console.log('Chain L2  : GIWA Sepolia',giwaSepolia.id);console.log('Amount    :',formatEther(amount),'ETH');
const l1Balance=await l1.getBalance({address:account.address});console.log(`L1 Balance: ${formatEther(l1Balance)} ETH`);
if(!AUTO_CONFIRM){const rl=readline.createInterface({input:process.stdin,output:process.stdout});const tail=account.address.slice(-6);const ans=await rl.question(`Type last 6 chars of your address to confirm [${tail}]: `);rl.close();if(ans.trim().toLowerCase()!==tail.toLowerCase())throw new Error('Confirmation failed.');}
const bridgeAddr=giwaSepolia.contracts.l1StandardBridge[sepolia.id].address;const depositHash=await wl1.writeContract({address:bridgeAddr,abi:ABI,functionName:'depositETHTo',args:[account.address,L2_GAS,'0x'],value:amount});
console.log('Deposit tx (L1):',depositHash);const l1r=await l1.waitForTransactionReceipt({hash:depositHash});console.log('L1 confirmed:',l1r.transactionHash);
const [l2Hash]=getL2TransactionHashes(l1r);console.log('Predicted L2 tx:',l2Hash||'(pending index)');
const l2r=await l2.waitForTransactionReceipt({hash:l2Hash,timeout:600000,pollingInterval:3000});console.log('L2 confirmed:',l2r.transactionHash);console.log('✅ Deposit done');}
main().catch(e=>{console.error(e);process.exit(1);});
