const messages = {
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  EACCES: 'Permission denied',
  ELOOP: 'Too many levels of symbolic links',
  EINVAL: 'Invalid argument',
  EPERM: 'Operation not permitted',
  EBUSY: 'Device or resource busy',
} as const;

export type ErrCode = keyof typeof messages;

export class FsError extends Error {
  readonly code: ErrCode;
  readonly path: string;

  constructor(code: ErrCode, path: string) {
    super(messages[code]);
    this.code = code;
    this.path = path;
  }
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
