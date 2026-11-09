import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import {
  compareFiles,
  formatMarkdown,
  formatText,
  isComfyDiffError,
  loadWorkflow,
  plainStyle,
  sniff,
  textconv,
  type Style,
} from '@comfydiff/core';
import pkg from '../package.json';

const HELP = `comfydiff ${pkg.version}: readable diffs for ComfyUI workflows

Usage:
  comfydiff <a> <b> [--json | --markdown] [--color | --no-color]
      Compare two workflows: PNG / WebP images saved by ComfyUI, or .json files
      (editor "Save" format or "Export (API)" format, auto-detected).
      Exit code: 0 = no differences that affect the output, 1 = differences, 2 = error.

  comfydiff textconv <file>
      Print a stable, layout-free text form of a workflow, for git's textconv.

  comfydiff git-diff <path> <old-file> <old-hex> <old-mode> <new-file> <new-hex> <new-mode>
      Git external diff driver (diff.<driver>.command): prints the comfydiff report.

Options:
  --json        machine-readable report
  --markdown    Markdown for Discord / Reddit / GitHub issues
  --color       force colors (default: on when stdout is a terminal and NO_COLOR is unset)
  --no-color    disable colors
  -h, --help    show this help
  -v, --version show the version

Everything runs locally; no file contents are sent anywhere.`;

const esc = (code: string) => (s: string) => (s ? `\x1b[${code}m${s}\x1b[0m` : s);

export const ansiStyle: Style = {
  bold: esc('1'),
  dim: esc('2'),
  add: esc('32'),
  del: esc('31'),
  warn: esc('33'),
  insWord: esc('1;32'),
  delWord: esc('9;31'),
};

function readInput(path: string): Uint8Array {
  if (!existsSync(path)) throw new UsageError(`${path}: no such file`);
  return new Uint8Array(readFileSync(path));
}

class UsageError extends Error {}

function useColor(flags: Set<string>): boolean {
  if (flags.has('--no-color')) return false;
  if (flags.has('--color')) return true;
  if ('NO_COLOR' in process.env) return false;
  if (process.env['FORCE_COLOR'] && process.env['FORCE_COLOR'] !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

async function cmdCompare(a: string, b: string, flags: Set<string>): Promise<number> {
  const report = await compareWithNames(a, b);
  if (flags.has('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else if (flags.has('--markdown')) process.stdout.write(formatMarkdown(report, { a: basename(a), b: basename(b) }) + '\n');
  else process.stdout.write(formatText(report, useColor(flags) ? ansiStyle : plainStyle) + '\n');
  return report.significant ? 1 : 0;
}

async function compareWithNames(a: string, b: string) {
  const ba = readInput(a);
  const bb = readInput(b);
  try {
    await loadWorkflow(ba);
  } catch (e) {
    throw prefix(e, a);
  }
  try {
    await loadWorkflow(bb);
  } catch (e) {
    throw prefix(e, b);
  }
  return compareFiles(ba, bb);
}

function prefix(e: unknown, file: string): Error {
  if (e instanceof Error) e.message = `${basename(file)}: ${e.message}`;
  return e as Error;
}


function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}


// git shows textconv output in place of the file, so this must never fail.
async function cmdTextconv(file: string): Promise<number> {
  const bytes = readInput(file);
  try {
    process.stdout.write(await textconv(bytes));
  } catch (e) {
    if (!isComfyDiffError(e)) throw e;
    const kind = sniff(bytes);
    if (kind === 'json') process.stdout.write(new TextDecoder().decode(bytes));
    else process.stdout.write(`# ${basename(file)}: no ComfyUI workflow (${kind}, ${bytes.length} bytes, fnv1a ${fnv1a(bytes)})\n`);
  }
  return 0;
}


// git aborts the whole diff when an external diff driver exits non-zero.
async function cmdGitDiff(args: string[], flags: Set<string>): Promise<number> {
  const [path, oldFile, , , newFile] = args;
  if (!path || !oldFile || !newFile) throw new UsageError('git-diff expects the 7 arguments git passes to an external diff');
  const missing = (f: string) => f === '/dev/null' || f.toLowerCase() === 'nul' || !existsSync(f);
  const st = useColor(flags) ? ansiStyle : plainStyle;
  process.stdout.write(st.bold(`comfydiff ${path}`) + '\n');
  if (missing(oldFile) || missing(newFile)) {
    process.stdout.write(missing(oldFile) ? '(new file)\n' : '(file deleted)\n');
    return 0;
  }
  try {
    const report = await compareFiles(readInput(oldFile), readInput(newFile));
    process.stdout.write(formatText(report, st) + '\n');
  } catch (e) {
    process.stdout.write(`(cannot compare: ${e instanceof Error ? e.message : String(e)})\n`);
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith('-') && a !== '-'));
  const args = argv.filter((a) => !a.startsWith('-') || a === '-');
  const known = new Set(['--json', '--markdown', '--color', '--no-color', '-h', '--help', '-v', '--version']);
  for (const f of flags) if (!known.has(f)) throw new UsageError(`unknown option ${f}`);

  if (flags.has('-h') || flags.has('--help')) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  if (flags.has('-v') || flags.has('--version')) {
    process.stdout.write(pkg.version + '\n');
    return 0;
  }
  if (flags.has('--json') && flags.has('--markdown')) throw new UsageError('choose one of --json and --markdown');

  const [cmd, ...rest] = args;
  if (cmd === 'textconv' && rest.length === 1) return cmdTextconv(rest[0]!);
  if (cmd === 'git-diff' && rest.length >= 5) return cmdGitDiff(rest, flags);
  if (args.length === 2) return cmdCompare(args[0]!, args[1]!, flags);
  throw new UsageError(args.length ? 'expected two files to compare' : 'no files given');
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    if (e instanceof UsageError) {
      process.stderr.write(`comfydiff: ${e.message}\nTry 'comfydiff --help'.\n`);
    } else if (isComfyDiffError(e)) {
      process.stderr.write(`comfydiff: ${e.message}\n`);
    } else {
      process.stderr.write(`comfydiff: unexpected error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    }
    process.exitCode = 2;
  },
);
