import type { Avatar as AvatarT } from '../lib/avatars';
import { initialFor } from '../lib/avatars';

interface Props {
  avatar?: AvatarT | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar({ avatar, name, size = 'md' }: Props) {
  const cls = 'avatar' + (size !== 'md' ? ` ${size}` : '');

  if (avatar?.kind === 'image') {
    return (
      <span className={cls}>
        <img src={avatar.value} alt={name} />
      </span>
    );
  }

  if (avatar?.kind === 'preset') {
    return (
      <span className={cls} style={{ background: avatar.bg }}>
        {avatar.value}
      </span>
    );
  }

  return (
    <span className={cls} style={{ background: avatar?.bg || 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
      {initialFor(name)}
    </span>
  );
}
