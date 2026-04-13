import { json, type MetaFunction } from '@remix-run/cloudflare';
import { useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { SplashScreen } from '~/components/ui/SplashScreen';

export const meta: MetaFunction = () => {
  return [
    { title: 'Hack Cortex' },
    { name: 'description', content: 'Hack Cortex — AI-powered development environment' },
  ];
};

export const loader = () => json({});

// Show the splash only once per browser session
function shouldShowSplash(): boolean {
  if (typeof sessionStorage === 'undefined') {
    return false; // SSR — don't show
  }

  const key = 'hack_cortex_splash_shown';

  if (sessionStorage.getItem(key)) {
    return false;
  }

  sessionStorage.setItem(key, '1');

  return true;
}

/**
 * Landing page component for Hack Cortex
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  const [showSplash] = useState(shouldShowSplash);

  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <BackgroundRays position="bottom-right" />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      {showSplash && <ClientOnly>{() => <SplashScreen />}</ClientOnly>}
    </div>
  );
}
