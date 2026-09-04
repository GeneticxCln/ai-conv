import { describe, it, expect } from 'vitest';
import { isPrivateIp } from './urlFetcher';

describe('isPrivateIp (SSRF protection)', () => {
  // ── Loopback ──────────────────────────────────────────────────────
  it('blocks 127.0.0.1 (loopback)', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
  });

  it('blocks 127.0.0.0 and 127.255.255.255 (loopback boundaries)', () => {
    expect(isPrivateIp('127.0.0.0')).toBe(true);
    expect(isPrivateIp('127.255.255.255')).toBe(true);
    expect(isPrivateIp('127.0.0.53')).toBe(true); // systemd-resolved
  });

  // ── Private 10.x ──────────────────────────────────────────────────
  it('blocks 10.0.0.0/8 range', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.0.0.0')).toBe(true);
    expect(isPrivateIp('10.255.255.255')).toBe(true);
    expect(isPrivateIp('10.10.10.10')).toBe(true);
    expect(isPrivateIp('10.0.0.2')).toBe(true); // common Docker host
  });

  // ── Private 172.16-31.x ───────────────────────────────────────────
  it('blocks 172.16.0.0/12 range', () => {
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.16.0.0')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('172.20.0.1')).toBe(true); // common Docker bridge
  });

  it('allows 172.15.x.x and 172.32.x.x (outside /12 range)', () => {
    expect(isPrivateIp('172.15.255.255')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('172.0.0.1')).toBe(false);
  });

  // ── Private 192.168.x ─────────────────────────────────────────────
  it('blocks 192.168.0.0/16 range', () => {
    expect(isPrivateIp('192.168.0.1')).toBe(true);
    expect(isPrivateIp('192.168.0.0')).toBe(true);
    expect(isPrivateIp('192.168.255.255')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true); // common home router
  });

  it('allows 192.169.x.x and 192.167.x.x (outside /16 range)', () => {
    expect(isPrivateIp('192.169.0.1')).toBe(false);
    expect(isPrivateIp('192.167.255.255')).toBe(false);
  });

  // ── Link-local ────────────────────────────────────────────────────
  it('blocks 169.254.0.0/16 (link-local)', () => {
    expect(isPrivateIp('169.254.0.1')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true); // AWS metadata
    expect(isPrivateIp('169.254.255.255')).toBe(true);
  });

  it('allows 169.253.x.x and 169.255.x.x', () => {
    expect(isPrivateIp('169.253.255.255')).toBe(false);
    expect(isPrivateIp('169.255.0.1')).toBe(false);
  });

  // ── Current network ───────────────────────────────────────────────
  it('blocks 0.0.0.0/8 (current network)', () => {
    expect(isPrivateIp('0.0.0.0')).toBe(true);
    expect(isPrivateIp('0.0.0.1')).toBe(true);
    expect(isPrivateIp('0.255.255.255')).toBe(true);
  });

  // ── CGNAT ─────────────────────────────────────────────────────────
  it('blocks 100.64.0.0/10 (CGNAT)', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('100.100.0.1')).toBe(true);
    expect(isPrivateIp('100.127.255.255')).toBe(true);
  });

  it('allows 100.63.x.x and 100.128.x.x (outside CGNAT)', () => {
    expect(isPrivateIp('100.63.255.255')).toBe(false);
    expect(isPrivateIp('100.128.0.1')).toBe(false);
  });

  // ── Benchmark ─────────────────────────────────────────────────────
  it('blocks 198.18.0.0/15 (benchmark)', () => {
    expect(isPrivateIp('198.18.0.1')).toBe(true);
    expect(isPrivateIp('198.19.255.255')).toBe(true);
  });

  it('allows 198.17.x.x and 198.20.x.x (outside benchmark)', () => {
    expect(isPrivateIp('198.17.255.255')).toBe(false);
    expect(isPrivateIp('198.20.0.1')).toBe(false);
  });

  // ── Public IPs (negative tests) ───────────────────────────────────
  it('allows public IP addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);       // Google DNS
    expect(isPrivateIp('1.1.1.1')).toBe(false);       // Cloudflare DNS
    expect(isPrivateIp('93.184.216.34')).toBe(false);  // example.com
    expect(isPrivateIp('151.101.1.140')).toBe(false);  // reddit.com
    expect(isPrivateIp('203.0.113.1')).toBe(false);    // TEST-NET-3 (documentation)
    expect(isPrivateIp('198.51.100.1')).toBe(false);   // TEST-NET-2
  });

  // ── Malformed inputs ──────────────────────────────────────────────
  it('blocks malformed IPv4 strings (non-numeric octets)', () => {
    expect(isPrivateIp('foo')).toBe(true);
    expect(isPrivateIp('1.2.3.abc')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });

  it('blocks addresses with wrong number of octets', () => {
    expect(isPrivateIp('1.2.3')).toBe(true);
    expect(isPrivateIp('1.2.3.4.5')).toBe(true);
  });

  it('blocks addresses with out-of-range octets', () => {
    expect(isPrivateIp('256.0.0.1')).toBe(true);
    expect(isPrivateIp('-1.0.0.0')).toBe(true);
    expect(isPrivateIp('1.2.3.256')).toBe(true);
  });
});