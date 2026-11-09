export type ComfyDiffErrorCode =
  | 'no-metadata'
  | 'not-workflow'
  | 'unsupported-format'
  | 'invalid-json'
  | 'corrupt-file';

export class ComfyDiffError extends Error {
  readonly code: ComfyDiffErrorCode;
  constructor(code: ComfyDiffErrorCode, message: string) {
    super(message);
    this.name = 'ComfyDiffError';
    this.code = code;
  }
}

export function isComfyDiffError(e: unknown): e is ComfyDiffError {
  return e instanceof Error && (e as { name?: string }).name === 'ComfyDiffError';
}
