import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useCallback, useEffect, useRef, useMemo } from 'react';

const PREVIEW_CHANNEL = 'preview-updates';

export async function loader({ params }: LoaderFunctionArgs) {
  const previewId = params.id;

  if (!previewId) {
    throw new Response('Preview ID is required', { status: 400 });
  }

  return json({ previewId });
}

export default function WebContainerPreview() {
  const { previewId } = useLoaderData<typeof loader>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const broadcastChannelRef = useRef<BroadcastChannel>();

  // URL is deterministic from previewId — no state needed
  const previewUrl = useMemo(() => `https://${previewId}.local-credentialless.webcontainer-api.io`, [previewId]);

  // Use a ref so the broadcast handler always sees the latest URL without re-subscribing
  const previewUrlRef = useRef(previewUrl);
  previewUrlRef.current = previewUrl;

  // Handle preview refresh — stable ref, never changes identity
  const handleRefresh = useCallback(() => {
    if (iframeRef.current && previewUrlRef.current) {
      // Force a clean reload
      iframeRef.current.src = '';
      requestAnimationFrame(() => {
        if (iframeRef.current) {
          iframeRef.current.src = previewUrlRef.current;
        }
      });
    }
  }, []);

  // Notify other tabs that this preview is ready — stable ref
  const notifyPreviewReady = useCallback(() => {
    if (broadcastChannelRef.current && previewUrlRef.current) {
      broadcastChannelRef.current.postMessage({
        type: 'preview-ready',
        previewId,
        url: previewUrlRef.current,
        timestamp: Date.now(),
      });
    }
  }, [previewId]);

  useEffect(() => {
    const supportsBroadcastChannel = typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function';

    if (supportsBroadcastChannel) {
      broadcastChannelRef.current = new window.BroadcastChannel(PREVIEW_CHANNEL);

      // Listen for preview updates
      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data.previewId === previewId) {
          if (event.data.type === 'refresh-preview' || event.data.type === 'file-change') {
            handleRefresh();
          }
        }
      };
    } else {
      broadcastChannelRef.current = undefined;
    }

    // Set the iframe src once on mount
    if (iframeRef.current) {
      iframeRef.current.src = previewUrl;
    }

    // Cleanup
    return () => {
      broadcastChannelRef.current?.close();
    };
  }, [previewId, previewUrl, handleRefresh]);

  return (
    <div className="w-full h-full">
      <iframe
        ref={iframeRef}
        title="WebContainer Preview"
        className="w-full h-full border-none"
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
        allow="cross-origin-isolated"
        loading="eager"
        onLoad={notifyPreviewReady}
      />
    </div>
  );
}
