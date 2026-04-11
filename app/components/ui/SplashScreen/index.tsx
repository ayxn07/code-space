import { useState, useEffect, useCallback } from 'react';
import { HackCortexLogo } from '~/components/ui/HackCortexLogo';
import styles from './styles.module.scss';

interface SplashScreenProps {
  /** Minimum time (ms) the splash stays visible. Default 2600. */
  minDuration?: number;
  /** Called after the splash is fully gone and unmounted. */
  onComplete?: () => void;
}

/**
 * Full-screen splash overlay with a "curtain open" reveal animation.
 *
 * Lifecycle:
 *  1. Logo + text + loader animate in (~1s)
 *  2. Loader fills (~1.6s)
 *  3. Center content fades out
 *  4. Curtains slide apart (1s CSS transition)
 *  5. Overlay unmounts
 */
export function SplashScreen({ minDuration = 2600, onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'showing' | 'opening' | 'done'>('showing');

  const startOpen = useCallback(() => {
    // Fade center content, then open curtains
    setPhase('opening');

    // After curtains finish sliding (1s transition + small buffer)
    setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, 1100);
  }, [onComplete]);

  useEffect(() => {
    const timer = setTimeout(startOpen, minDuration);
    return () => clearTimeout(timer);
  }, [minDuration, startOpen]);

  // Don't render anything after animation completes
  if (phase === 'done') {
    return null;
  }

  const isOpening = phase === 'opening';

  return (
    <div className={`${styles.splashOverlay} ${isOpening ? styles.dismissed : ''}`}>
      {/* Left curtain */}
      <div
        className={`${styles.curtain} ${styles.curtainLeft} ${isOpening ? styles.curtainOpen : ''}`}
      >
        <div className={styles.curtainAccent} />
      </div>

      {/* Right curtain */}
      <div
        className={`${styles.curtain} ${styles.curtainRight} ${isOpening ? styles.curtainOpen : ''}`}
      >
        <div className={styles.curtainAccent} />
      </div>

      {/* Center content */}
      <div className={`${styles.centerContent} ${isOpening ? styles.fadeOut : ''}`}>
        <div className={`${styles.logoWrap} ${!isOpening ? styles.logoPulse : ''}`}>
          <HackCortexLogo size={72} />
        </div>
        <span className={styles.brandText}>Hack Cortex</span>
        <span className={styles.tagline}>AI-Powered Development</span>
        <div className={styles.loaderWrap}>
          <div className={styles.loaderBar} />
        </div>
      </div>
    </div>
  );
}
