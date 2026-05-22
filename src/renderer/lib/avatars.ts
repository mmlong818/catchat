/**
 * Avatar 系统：
 *  - 预设：16 个 emoji 头像（涵盖不同性别/年龄/肤色/生物）+ 4 个渐变字母位
 *  - 自定义：用户可上传图片（dataURL，存 localStorage）
 *  - 头像通过 join 信令传播给其他参会者
 */

export type AvatarKind = 'preset' | 'letter' | 'image';

export interface Avatar {
  kind: AvatarKind;
  /** preset: emoji 字符 | letter: 渐变索引 | image: dataURL */
  value: string;
  /** 仅 preset/letter 用 — 背景色 */
  bg?: string;
}

export const PRESET_AVATARS: Avatar[] = [
  // 人物（不同性别/年龄/肤色/国籍/职业）
  { kind: 'preset', value: '👨', bg: '#ffd8a8' },
  { kind: 'preset', value: '👩', bg: '#ffc9c9' },
  { kind: 'preset', value: '🧑', bg: '#d8f5a2' },
  { kind: 'preset', value: '👴', bg: '#dee2e6' },
  { kind: 'preset', value: '👵', bg: '#fcc2d7' },
  { kind: 'preset', value: '👦', bg: '#a5d8ff' },
  { kind: 'preset', value: '👧', bg: '#ffdeeb' },
  { kind: 'preset', value: '👨‍💼', bg: '#b197fc' },
  { kind: 'preset', value: '👩‍🔬', bg: '#74c0fc' },
  { kind: 'preset', value: '🧑‍🎓', bg: '#ffe066' },
  // 生物
  { kind: 'preset', value: '🦊', bg: '#ff922b' },
  { kind: 'preset', value: '🐱', bg: '#ffa94d' },
  { kind: 'preset', value: '🐶', bg: '#c0a87a' },
  { kind: 'preset', value: '🐼', bg: '#e9ecef' },
  { kind: 'preset', value: '🦁', bg: '#ffd43b' },
  { kind: 'preset', value: '🐯', bg: '#ffa94d' },
];

function gradientFromHash(h: number): string {
  const hue1 = h % 360;
  const hue2 = (hue1 + 45) % 360;
  const sat = 70 + (h >> 8) % 20;     // 70-90% — 更鲜艳
  const l1 = 60 + (h >> 16) % 8;      // 60-68%
  const l2 = l1 - 14;
  return `linear-gradient(135deg, hsl(${hue1}, ${sat}%, ${l1}%) 0%, hsl(${hue2}, ${sat}%, ${l2}%) 100%)`;
}

const LETTER_PRESET_HASHES = [12345, 67890, 24680, 13579, 98765, 11111, 22222, 33333];

export function defaultAvatar(name: string): Avatar {
  const h = hashCode(name || 'U');
  return { kind: 'letter', value: String(h % 1000), bg: gradientFromHash(h) };
}

export function letterAvatars(name: string): Avatar[] {
  const baseHash = hashCode(name || 'U');
  // First option: name-derived; rest: a few fixed alternatives so user can pick
  return [
    { kind: 'letter' as const, value: '0', bg: gradientFromHash(baseHash) },
    ...LETTER_PRESET_HASHES.map((h, i) => ({ kind: 'letter' as const, value: String(i + 1), bg: gradientFromHash(h) })),
  ];
}

export function initialFor(name: string): string {
  const trimmed = (name || '?').trim();
  if (!trimmed) return '?';
  // 取首字符（中文取第一个汉字，英文取首字母大写）
  const ch = trimmed[0];
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function loadAvatar(): Avatar | null {
  try {
    const raw = localStorage.getItem('vm.avatar');
    return raw ? (JSON.parse(raw) as Avatar) : null;
  } catch { return null; }
}

export function saveAvatar(a: Avatar) {
  localStorage.setItem('vm.avatar', JSON.stringify(a));
}
