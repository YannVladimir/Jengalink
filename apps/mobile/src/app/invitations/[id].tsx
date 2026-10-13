import type { InvitationView } from '@jengalink/contracts';
import { request } from '@jengalink/contracts/client';
import { useLocalSearchParams } from 'expo-router';
import { InvitationLoader } from '@/components/invitation';
import { api } from '@/lib/auth';

/** An invitation opened from the in-app list. */
export default function InvitationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <InvitationLoader
      fetch={(): Promise<InvitationView> => request(() => api.GET('/v1/invitations/{id}', { params: { path: { id } } }))}
      deps={[id]}
    />
  );
}
