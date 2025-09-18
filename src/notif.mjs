// src/notif.mjs
// HUD 2 kolom stabil; judul di dalam box, footer banner center.
// Bisa full/short untuk addr & L1/L2 + custom title & lebar box.

import boxen from 'boxen';
import chalk from 'chalk';
import logUpdate from 'log-update';

const short = (s, n = 6) =>
  !s ? '--' : (s.startsWith?.('0x') && s.length > (2 + n))
    ? `${s.slice(0, 2 + n)}…${s.slice(-n)}`
    : String(s);

export function createHud({
  tokensPerWallet = 1,
  airdropCount = 0,
  airdropPerAddress = '0',
  refreshMs = 700,
  borderColor = 'green',
  banner = 't.me/Airdropshogun',
  bannerColor = 'magenta',

  // === opsi baru ===
  fullAddr = true,          // tampilkan alamat (di judul) full?
  fullHash = true,          // tampilkan L1/L2 full?
  title1 = 'Wallet 1',      // judul slot kiri
  title2 = 'Wallet 2',      // judul slot kanan
  maxBoxWidth = 80,         // batas lebar box (biar muat hash 66 char)
} = {}) {
  // pilih styler untuk banner (nama warna chalk atau hex)
  let bannerStyler = chalk.magenta;
  if (/^#?[0-9a-f]{6}$/i.test(bannerColor)) {
    const hex = bannerColor.replace(/^#/, '');
    bannerStyler = chalk.hex(hex);
  } else if (chalk[bannerColor]) {
    bannerStyler = chalk[bannerColor];
  }

  const hud = {
    slots: [
      { title: title1, addr: '-', pos:'', phase:'Idle', l1:'--', l2:'--',
        tokDone:0, tokTotal:tokensPerWallet, tokenBadge:'',
        dropDone:0, dropTotal:airdropCount,  dropBadge:'', err:0 },
      { title: title2, addr: '-', pos:'', phase:'Idle', l1:'--', l2:'--',
        tokDone:0, tokTotal:tokensPerWallet, tokenBadge:'',
        dropDone:0, dropTotal:airdropCount,  dropBadge:'', err:0 },
    ],
    header: { round:'-', batch:'-' },

    set(i, patch){ Object.assign(this.slots[i], patch); },
    token(i, text){ this.slots[i].tokenBadge = text || ''; },
    drop(i,  text){ this.slots[i].dropBadge  = text || ''; },
    setHeader(patch){ Object.assign(this.header, patch); },

    _makeBox(slot, width) {
      const addrView = fullAddr ? (slot.addr || '-') : short(slot.addr || '-');
      const L1View   = fullHash ? (slot.l1   || '--') : short(slot.l1);
      const L2View   = fullHash ? (slot.l2   || '--') : short(slot.l2);

      let body =
        `${chalk.bold(slot.title)}  ${chalk.gray(addrView)}\n` +
        (slot.pos ? `• Wallet : ${slot.pos}\n` : '') +
        `• Phase  : ${slot.phase}\n` +
        `• L1     : ${L1View}\n` +
        `• L2     : ${L2View}\n` +
        `• Tokens : ${slot.tokDone}/${slot.tokTotal}` +
        (slot.tokenBadge ? `\n  ↳ ${slot.tokenBadge}` : '') + `\n` +
        `• Drops  : ${slot.dropDone}/${slot.dropTotal}` +
        (slot.dropBadge ? `\n  ↳ ${slot.dropBadge}` : '') + `\n` +
        `• Errors : ${slot.err}`;

      // footer banner center-ish
      const interior = Math.max(10, (width ?? 40) - 4);
      const padL = Math.max(0, Math.floor((interior - banner.length) / 2));
      body += `\n${' '.repeat(padL)}${bannerStyler(banner)}`;

      return boxen(body, {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        borderStyle: 'round',
        borderColor,
        width,
      });
    },

    _joinSideBySide(leftStr, rightStr, gap = 2) {
      const A = leftStr.split('\n');
      const B = rightStr.split('\n');
      const h = Math.max(A.length, B.length);
      const pad = (arr) => { while (arr.length < h) arr.push(' '.repeat(arr[0]?.length || 0)); return arr; };
      pad(A); pad(B);
      const spacer = ' '.repeat(gap);
      return A.map((l, i) => `${l}${spacer}${B[i]}`).join('\n');
    },

    render() {
      const cols = Math.max(60, process.stdout.columns || 120);
      const gap  = 2;
      const minW = 36;
      const half = Math.floor((cols - gap) / 2);
      const twoCols = half >= minW;

      // header center di garis
      const headLine = `${chalk.cyan('Round ' + this.header.round)}   ${chalk.cyan('Batch ' + this.header.batch)}`;
      const barWidth = Math.max(0, Math.floor((cols - headLine.length) / 2) - 1);
      const rule = '—'.repeat(Math.max(0, barWidth));
      const head = `${rule} ${headLine} ${rule}`;

      if (!twoCols) {
        const oneWidth = Math.min(cols - 2, maxBoxWidth);
        const left  = this._makeBox(this.slots[0], oneWidth);
        const right = this._makeBox(this.slots[1], oneWidth);
        return `${head}\n\n${left}\n\n${right}`;
      }

      const width = Math.max(minW, Math.min(maxBoxWidth, half));
      const left  = this._makeBox(this.slots[0], width);
      const right = this._makeBox(this.slots[1], width);
      return `${head}\n\n${this._joinSideBySide(left, right, gap)}`;
    },

    start(){ if (!this._timer) this._timer = setInterval(() => logUpdate(this.render()), refreshMs); },
    stop(){
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      logUpdate.clear();
      console.log(this.render());
    },
  };

  return hud;
}
