import { useEffect, useState } from 'react';
import { Lobby } from './components/Lobby';
import { Room } from './components/Room';
import type { InviteLink } from '../shared/types';
import { parseInviteLink } from './lib/invite';
import { type Avatar as AvatarT } from './lib/avatars';

type View =
  | { kind: 'lobby' }
  | { kind: 'room'; mode: 'host' | 'guest'; invite: InviteLink; name: string; avatar: AvatarT };

export function App() {
  const [view, setView] = useState<View>({ kind: 'lobby' });
  const [incomingInvite, setIncomingInvite] = useState<InviteLink | null>(null);

  useEffect(() => {
    window.voiceMeet.onDeepLink((url) => {
      const invite = parseInviteLink(url);
      if (invite) setIncomingInvite(invite);
    });
  }, []);

  if (view.kind === 'lobby') {
    return (
      <Lobby
        incomingInvite={incomingInvite}
        onHost={(name, avatar, invite) => setView({ kind: 'room', mode: 'host', invite, name, avatar })}
        onJoin={(name, avatar, invite) => setView({ kind: 'room', mode: 'guest', invite, name, avatar })}
      />
    );
  }

  return (
    <Room
      mode={view.mode}
      invite={view.invite}
      name={view.name}
      avatar={view.avatar}
      onLeave={() => {
        setView({ kind: 'lobby' });
        setIncomingInvite(null);
      }}
    />
  );
}
