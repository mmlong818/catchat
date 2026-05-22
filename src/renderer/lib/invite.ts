import type { InviteLink } from '../../shared/types';

export function buildInviteLink(invite: InviteLink): string {
  const params = new URLSearchParams({
    room: invite.roomId,
    token: invite.token,
  });
  if (invite.signal) params.set('s', invite.signal);
  return `aimeet://join?${params.toString()}`;
}

/** 容错版本：兼容 aimeet://join?... 和 aimeet:?... 两种格式，去空白 */
export function parseInviteLink(url: string): InviteLink | null {
  if (!url) return null;
  const cleaned = url.trim().replace(/[​-‍﻿]/g, ''); // strip zero-width chars

  // 路径 1：标准 URL parser
  try {
    const u = new URL(cleaned);
    if (u.protocol === 'aimeet:') {
      const room = u.searchParams.get('room');
      const token = u.searchParams.get('token');
      if (room && token) {
        return {
          roomId: room,
          token,
          signal: u.searchParams.get('s') || undefined,
        };
      }
    }
  } catch { /* fall through */ }

  // 路径 2：regex 回退（处理某些自定义 URL 解析异常的环境）
  const m = cleaned.match(/^aimeet:(?:\/\/[^?#]*)?[?#]?(.*)$/i);
  if (!m) return null;
  const params = new URLSearchParams(m[1]);
  const room = params.get('room');
  const token = params.get('token');
  if (!room || !token) return null;
  return {
    roomId: room,
    token,
    signal: params.get('s') || undefined,
  };
}

export function randomToken(len = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
