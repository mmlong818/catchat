import type { InviteLink } from '../../shared/types';

export function buildInviteLink(invite: InviteLink): string {
  const params = new URLSearchParams({
    room: invite.roomId,
    token: invite.token,
  });
  if (invite.signal) params.set('s', invite.signal);
  return `aimeet://join?${params.toString()}`;
}

export function parseInviteLink(url: string): InviteLink | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'aimeet:') return null;
    const room = u.searchParams.get('room');
    const token = u.searchParams.get('token');
    if (!room || !token) return null;
    const signal = u.searchParams.get('s') || undefined;
    return { roomId: room, token, signal };
  } catch {
    return null;
  }
}

export function randomToken(len = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
