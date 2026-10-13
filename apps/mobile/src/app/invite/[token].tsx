import type { InvitationView } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { useLocalSearchParams } from 'expo-router';
import { InvitationLoader } from '@/components/invitation';
import { api } from '@/lib/auth';

/** An invitation opened from the shared link (…/invite/<token>). Only its recipient can see it. */
export default function InviteLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return (
    <InvitationLoader
      fetch={(): Promise<InvitationView> =>
        request(() => api.GET('/v1/invitations/token/{token}', { params: { path: { token } } }))
      }
      deps={[token]}
    />
  );
}
