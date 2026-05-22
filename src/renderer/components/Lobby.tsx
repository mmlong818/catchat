import { useEffect, useState } from 'react';
import type { InviteLink } from '../../shared/types';
import { buildInviteLink, parseInviteLink, randomToken } from '../lib/invite';
import { type Avatar as AvatarT, defaultAvatar, loadAvatar, saveAvatar } from '../lib/avatars';
import { AvatarPicker } from './AvatarPicker';
import { Settings } from './Settings';
import { Icon } from './Icon';

interface Props {
  incomingInvite: InviteLink | null;
  onHost: (name: string, avatar: AvatarT, invite: InviteLink) => void;
  onJoin: (name: string, avatar: AvatarT, invite: InviteLink) => void;
}

export function Lobby({ incomingInvite, onHost, onJoin }: Props) {
  const [name, setName] = useState(() => localStorage.getItem('vm.name') || '');
  const [avatar, setAvatar] = useState<AvatarT>(() => loadAvatar() || defaultAvatar(localStorage.getItem('vm.name') || ''));
  const [inviteUrl, setInviteUrl] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (incomingInvite) setInviteUrl(buildInviteLink(incomingInvite));
  }, [incomingInvite]);

  // First-run: open settings if API Key is not configured
  useEffect(() => {
    window.voiceMeet.settings.get().then((s) => {
      if (!s.apiKey) setSettingsOpen(true);
    });
  }, []);

  const saveName = (v: string) => {
    setName(v);
    localStorage.setItem('vm.name', v);
  };

  const updateAvatar = (a: AvatarT) => {
    setAvatar(a);
    saveAvatar(a);
  };

  const handleHost = async () => {
    if (!name.trim()) return alert('请输入昵称');
    const roomId = randomToken(6);
    const token = randomToken(16);
    const invite: InviteLink = { roomId, token };
    onHost(name, avatar, invite);
  };

  const handleJoin = () => {
    if (!name.trim()) return alert('请输入昵称');
    const invite = parseInviteLink(inviteUrl.trim());
    if (!invite) return alert('邀请链接无效');
    onJoin(name, avatar, invite);
  };

  return (
    <div className="lobby" style={{ position: 'relative' }}>
      <button
        className="ghost icon-btn"
        onClick={() => setSettingsOpen(true)}
        style={{ position: 'absolute', top: 16, right: 16 }}
        title="设置"
      >
        <Icon name="settings" size={20} />
      </button>
      <h1>CatChat</h1>
      <div className="subtitle">语音 · 转写 · P2P · 安全私享</div>

      <div className="field" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <AvatarPicker name={name || '?'} current={avatar} onChange={updateAvatar} />
        <div style={{ flex: 1 }}>
          <label>昵称</label>
          <input value={name} onChange={(e) => saveName(e.target.value)} placeholder="您的显示名称" />
        </div>
      </div>

      <div className="field">
        <label>邀请链接（加入会议时填入）</label>
        <input
          value={inviteUrl}
          onChange={(e) => setInviteUrl(e.target.value)}
          placeholder="aimeet://join?host=..."
        />
      </div>

      <div className="actions">
        <button className="primary" onClick={handleHost}>发起会议</button>
        <button onClick={handleJoin}>加入会议</button>
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} initialFocus="apiKey" />}
    </div>
  );
}
