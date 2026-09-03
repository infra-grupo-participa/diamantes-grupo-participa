import EquipeClient from '@/components/admin/EquipeClient';
import DriftBanner from '@/components/admin/DriftBanner';

export const metadata = { title: 'Equipe — Admin Diamantes' };

export default function AdminHome() {
  return (
    <>
      <DriftBanner />
      <EquipeClient />
    </>
  );
}
