/** Uint8Array with Buffer's little-endian accessors, for archive headers. */
export class LEBytes extends Uint8Array {
  static over(b: Uint8Array): LEBytes {
    return new LEBytes(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
  }

  readUInt16LE(o: number): number {
    return this[o] | (this[o + 1] << 8);
  }

  readUInt32LE(o: number): number {
    return (this[o] | (this[o + 1] << 8) | (this[o + 2] << 16)) + this[o + 3] * 0x1000000;
  }

  writeUInt16LE(v: number, o: number): void {
    this[o] = v;
    this[o + 1] = v >>> 8;
  }

  writeUInt32LE(v: number, o: number): void {
    this.writeUInt16LE(v & 0xffff, o);
    this.writeUInt16LE(v >>> 16, o + 2);
  }
}
