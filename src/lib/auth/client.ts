import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Cliente do navegador: nunca importa db/env/server. baseURL = origem atual.
export const authClient = createAuthClient({ plugins: [organizationClient()] });
