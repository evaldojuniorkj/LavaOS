import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { contextoOuNull } from '@/lib/auth/context';

export default async function Home() {
  redirect((await contextoOuNull(await headers())) ? '/inicio' : '/login');
}
