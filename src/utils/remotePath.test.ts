import { describe, it, expect } from 'vitest';
import { joinRemote, basename } from './remotePath';

describe('joinRemote', () => {
  it('joins parent with child using a single slash', () => {
    expect(joinRemote('/home/user', 'file.txt')).toBe('/home/user/file.txt');
  });

  it('strips a trailing slash from the parent', () => {
    expect(joinRemote('/home/user/', 'file.txt')).toBe('/home/user/file.txt');
  });

  it('strips a leading slash from the child', () => {
    expect(joinRemote('/home/user', '/file.txt')).toBe('/home/user/file.txt');
  });

  it('handles parent of "/" without producing a double slash', () => {
    expect(joinRemote('/', 'file.txt')).toBe('/file.txt');
  });

  it('handles empty parent by anchoring to root', () => {
    expect(joinRemote('', 'file.txt')).toBe('/file.txt');
  });

  it('does not collapse a child that contains internal slashes', () => {
    expect(joinRemote('/home', 'a/b/c.txt')).toBe('/home/a/b/c.txt');
  });
});

describe('basename', () => {
  it('returns the last POSIX segment', () => {
    expect(basename('/a/b/c.txt')).toBe('c.txt');
  });

  it('handles Windows-style backslash separators (file dialog return)', () => {
    expect(basename('C:\\Users\\me\\file.txt')).toBe('file.txt');
  });

  it('handles a bare filename', () => {
    expect(basename('file.txt')).toBe('file.txt');
  });

  it('strips a trailing slash before extracting the segment', () => {
    expect(basename('/a/b/')).toBe('b');
  });

  it('handles multiple trailing slashes', () => {
    expect(basename('/a/b///')).toBe('b');
  });

  it('returns the input when no separator is present', () => {
    expect(basename('justaname')).toBe('justaname');
  });
});
