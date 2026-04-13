import styles from './styles.module.scss';

interface BackgroundRaysProps {
  /** "top-left" (default) or "bottom-right" — controls which corner the rays anchor to */
  position?: 'top-left' | 'bottom-right';
}

const BackgroundRays = ({ position = 'top-left' }: BackgroundRaysProps) => {
  const prefix = position === 'bottom-right' ? 'br' : 'ray';

  return (
    <div className={`${styles.rayContainer} `}>
      <div className={`${styles.lightRay} ${styles[`${prefix}1`]}`}></div>
      <div className={`${styles.lightRay} ${styles[`${prefix}2`]}`}></div>
      <div className={`${styles.lightRay} ${styles[`${prefix}3`]}`}></div>
      <div className={`${styles.lightRay} ${styles[`${prefix}4`]}`}></div>
      <div className={`${styles.lightRay} ${styles[`${prefix}5`]}`}></div>
      <div className={`${styles.lightRay} ${styles[`${prefix}6`]}`}></div>
      <div className={`${styles.lightRay} ${styles[`${prefix}7`]}`}></div>
      <div className={`${styles.lightRay} ${styles[`${prefix}8`]}`}></div>
    </div>
  );
};

export default BackgroundRays;
