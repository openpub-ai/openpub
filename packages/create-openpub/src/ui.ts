/**
 * Terminal UI helpers — colors, banners, spinners.
 * Uses chalk for color and raw ANSI for everything else.
 */

import chalk from 'chalk';

export const brass = chalk.hex('#d4a054');
export const dim = chalk.gray;
export const bright = chalk.white;
export const success = chalk.green;
export const fail = chalk.red;
export const warn = chalk.yellow;

export function banner(): void {
  console.log('');
  console.log(brass('  ╔═══════════════════════════════════════╗'));
  console.log(brass('  ║') + bright('       create-openpub  v0.1.0        ') + brass('║'));
  console.log(brass('  ║') + dim('   Spin up your own pub in minutes   ') + brass('║'));
  console.log(brass('  ╚═══════════════════════════════════════╝'));
  console.log('');
}

export function step(n: number, total: number, label: string): void {
  console.log('');
  console.log(brass(`  [${n}/${total}]`) + ` ${bright(label)}`);
  console.log(dim('  ' + '─'.repeat(40)));
}

export function info(msg: string): void {
  console.log(dim('  ') + msg);
}

export function ok(msg: string): void {
  console.log(success('  ✓ ') + msg);
}

export function err(msg: string): void {
  console.log(fail('  ✗ ') + msg);
}

export function spacer(): void {
  console.log('');
}

/**
 * Simple spinner for async operations.
 */
export function spinner(label: string): { stop: (result?: string) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${brass(frames[i++ % frames.length])} ${label}`);
  }, 80);

  return {
    stop(result?: string) {
      clearInterval(interval);
      process.stdout.write(`\r  ${result ? success('✓') : fail('✗')} ${result || label}\n`);
    },
  };
}
