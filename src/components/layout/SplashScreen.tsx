interface Props {
  onDone: () => void;
}

export function SplashScreen({ onDone }: Props) {
  return (
    <div
      onAnimationEnd={onDone}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(ellipse at center, rgba(0, 237, 100, 0.12) 0%, #001E2B 65%)',
        backgroundColor: '#001E2B',
        animation: 'splashFade 1000ms ease forwards',
      }}
    >
      <style>{`
        @keyframes splashFade {
          0%   { opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
      <img src="/logo_with_text.svg" alt="Mongo Lens" style={{ width: 200 }} />
    </div>
  );
}
