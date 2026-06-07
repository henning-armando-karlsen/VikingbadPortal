import { useEffect, useState, forwardRef } from 'react';

type Props = {
  ready: boolean;
  html: string | null | undefined;
  /** Skjuler rammen uten å avmontere den, slik at iframe-tilstand bevares. */
  hidden?: boolean;
  emptyHint?: string;
  /** HTML/script som injiseres i <head> før innholdets egne skript kjører. */
  headInject?: string;
};

const PortalFrame = forwardRef<HTMLIFrameElement, Props>(
  ({ ready, html, hidden = false, emptyHint, headInject }, ref) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);

    useEffect(() => {
      if (!ready || typeof html !== 'string') return;

      const doc = headInject ? html.replace('</head>', headInject + '</head>') : html;
      const blob = new Blob([doc], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);

      return () => {
        URL.revokeObjectURL(url);
        setBlobUrl(null);
      };
    }, [ready, html, headInject]);

    const wrap = (children: React.ReactNode) => (
      <div
        className="absolute inset-0"
        style={{ display: hidden ? 'none' : 'block' }}
        aria-hidden={hidden}
      >
        {children}
      </div>
    );

    if (!ready || html === undefined) {
      return wrap(
        <div className="w-full h-full flex items-center justify-center bg-gray-50">
          <div className="w-8 h-8 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
        </div>
      );
    }

    if (html === null) {
      return wrap(
        <div className="w-full h-full flex items-center justify-center bg-gray-50">
          <div className="text-center px-6">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-gray-500 text-sm">Innhold ikke lastet inn.</p>
            {emptyHint && <p className="text-gray-400 text-xs mt-1">{emptyHint}</p>}
          </div>
        </div>
      );
    }

    return wrap(
      <iframe
        ref={ref}
        src={blobUrl ?? undefined}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        title="Vikingbad"
      />
    );
  }
);

PortalFrame.displayName = 'PortalFrame';
export default PortalFrame;
