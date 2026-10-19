import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { isIP as nodeIsIP } from 'node:net';
import { test } from 'node:test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { deflateRaw } from '../src/lib/deflate.ts';
import { DIGESTS } from '../src/lib/digest.ts';
import { inflateRaw } from '../src/lib/inflate.ts';
import { isIP } from '../src/platform/dns.ts';
import { MiniUrl } from '../src/platform/url.ts';
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from '../src/vfs/bytes.ts';

const samples = [new Uint8Array(0), Buffer.from('abc'), Buffer.from('a'.repeat(56)), Buffer.from('b'.repeat(112)), randomBytes(70000), Buffer.from('hello world\n'.repeat(5000))];

test('pure-JS digests match node:crypto', () => {
  for (const s of samples) for (const [algo, f] of Object.entries(DIGESTS)) assert.equal(f(s), createHash(algo).update(s).digest('hex'), `${algo} ${s.length}`);
});

test('pure-JS deflate and inflate interoperate with zlib', () => {
  for (const s of samples) {
    for (const level of [0, 1, 6, 9]) {
      assert.deepEqual(inflateRawSync(deflateRaw(s, level)), Buffer.from(s));
      const packed = deflateRawSync(s, { level });
      const back = inflateRaw(packed);
      assert.deepEqual(Buffer.from(back.out), Buffer.from(s));
      assert.equal(back.end, packed.length);
    }
  }
});

test('URL fallback parses like WHATWG URL', () => {
  const cases: [string, string?][] = [
    ['https://User:Pa ss@Example.COM:443/a/./b/../c?x=1 2#frag'], ['http://example.com:8080/p'], ['/abs?q', 'http://h.com/dir/file'],
    ['rel/x', 'http://h.com/dir/file'], ['../up', 'http://h.com/a/b/c'], ['//other.org/z', 'https://h.com/'], ['?only', 'http://h.com/p/q?old'],
    ['mailto:a@b.c'], ['http://[::1]:80/'], ['http://h.com/ü path?b=ü'], ['http://h.com:99999/'], ['http://'], ['file:///etc/passwd'],
  ];
  const parts = (C: typeof URL | typeof MiniUrl, input: string, base?: string) => {
    try {
      const u = new C(input, base);
      return [u.href, u.protocol, u.username, u.password, u.host, u.hostname, u.port, u.pathname, u.search, u.hash];
    } catch {
      return 'invalid';
    }
  };
  for (const [input, base] of cases) assert.deepEqual(parts(MiniUrl, input, base), parts(URL, input, base), input);
});

test('isIP, UTF-8 and base64 helpers', () => {
  for (const ip of ['1.2.3.4', '255.255.255.255', '::1', '::', 'fe80::1', '2001:db8::ff00:42:8329', '::ffff:1.2.3.4', '1.2.3', '256.1.1.1', '1::2::3', 'abc', '']) {
    assert.equal(isIP(ip), nodeIsIP(ip), ip);
  }
  for (const s of ['', 'ascii', 'héllo wörld', '😀 emoji', '﻿bom']) assert.equal(utf8Decode(utf8Encode(s)), s);
  assert.equal(utf8Decode(Uint8Array.from([0xff, 0x41]), true), null);
  assert.equal(base64Encode(utf8Encode('hi there')), 'aGkgdGhlcmU=');
  assert.equal(utf8Decode(base64Decode('aGkgdGhlcmU=')), 'hi there');
});
