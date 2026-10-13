import type { Role } from '@jengalink/contracts';
import { createContext, useContext, useState, type ReactNode } from 'react';

// Demo-only role switch (More → Viewing as). Real roles come from project membership.
const RoleContext = createContext<{ role: Role; setRole: (r: Role) => void }>({
  role: 'owner',
  setRole: () => {},
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('owner');
  return <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>;
}

export const useRole = () => useContext(RoleContext);

export const roleLabel: Record<Role, string> = {
  owner: 'Owner',
  contractor: 'Contractor',
  supervisor: 'Site supervisor',
};
