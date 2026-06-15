import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Toaster from '@/components/ui/Toaster';
import { PrefsProvider } from '@/lib/theme';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Portal Diamantes — Grupo Participa',
  description: 'Portal do programa Diamantes (Grupo Participa).',
};

// Anti-FOUC: aplica data-theme no <html> antes da hidratação, lendo a
// preferência salva (light|dark|auto) e resolvendo 'auto' pelo SO.
const themeBootstrap = `(function(){try{var k='diamantes.theme';var t=localStorage.getItem(k)||'light';var d=t==='dark'||(t==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} data-theme="light">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <PrefsProvider>
          {children}
          <Toaster />
        </PrefsProvider>
      </body>
    </html>
  );
}
