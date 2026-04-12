import { useState, useEffect, useCallback } from 'react';
import { HackCortexLogo } from '~/components/ui/HackCortexLogo';
import styles from './styles.module.scss';

interface SplashScreenProps {
  /** Minimum time (ms) the splash stays visible. Default 2400. */
  minDuration?: number;

  /** Called after the splash is fully gone and unmounted. */
  onComplete?: () => void;
}

/**
 * Full-screen splash overlay with a clean fade-in/out loading animation.
 *
 * Lifecycle:
 *  1. Logo + text + loader fade in
 *  2. Loader bar fills over duration
 *  3. Entire overlay fades out
 *  4. Overlay unmounts
 */
export function SplashScreen({ minDuration = 2400, onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'showing' | 'fading' | 'done'>('showing');

  const startFadeOut = useCallback(() => {
    setPhase('fading');

    // After fade-out transition completes (600ms + buffer)
    setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, 650);
  }, [onComplete]);

  useEffect(() => {
    const timer = setTimeout(startFadeOut, minDuration);
    return () => clearTimeout(timer);
  }, [minDuration, startFadeOut]);

  // Don't render anything after animation completes
  if (phase === 'done') {
    return null;
  }

  const isFading = phase === 'fading';

  return (
    <div className={`${styles.splashOverlay} ${isFading ? styles.fadeOut : ''}`}>
      <div className={styles.centerContent}>
        {/* Logo with glow */}
        <div className={`${styles.logoWrap} ${!isFading ? styles.logoPulse : ''}`}>
          <HackCortexLogo size={72} />
        </div>

        {/* Brand text */}
        <span className={styles.brandText}>Hack Cortex</span>
        <span className={styles.tagline}>AI-Powered Development</span>

        {/* Loading bar */}
        <div className={styles.loaderWrap}>
          <div className={styles.loaderBar} />
        </div>
      </div>
    </div>
  );
}
