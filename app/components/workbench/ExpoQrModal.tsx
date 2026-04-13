import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogDescription, DialogRoot } from '~/components/ui/Dialog';
import { useStore } from '@nanostores/react';
import { expoUrlAtom, snackSessionAtom, snackModalOpenAtom } from '~/lib/stores/qrCodeStore';
import { QRCode } from 'react-qrcode-logo';
import { toast } from 'react-toastify';

interface ConnectedDevice {
  id: string;
  name: string;
  platform: string;
  status: string;
}

export const ExpoQrModal: React.FC = () => {
  const expoUrl = useStore(expoUrlAtom);
  const session = useStore(snackSessionAtom);
  const isOpen = useStore(snackModalOpenAtom);
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const [copied, setCopied] = useState(false);

  // Subscribe to session state changes for connected clients
  useEffect(() => {
    if (!session) {
      setConnectedDevices([]);
      return undefined;
    }

    // Set initial state
    const clients = session.connectedClients;
    setConnectedDevices(Object.values(clients));

    const unsubscribe = session.addStateListener((state) => {
      const devices = Object.values(state.connectedClients);
      setConnectedDevices(devices);
    });

    return unsubscribe;
  }, [session]);

  const handleClose = useCallback(() => {
    snackModalOpenAtom.set(false);
  }, []);

  const handleDisconnect = useCallback(() => {
    if (session) {
      session.dispose();
      snackSessionAtom.set(null);
      expoUrlAtom.set(null);
      setConnectedDevices([]);
      toast.info('Snack session disconnected');
    }

    snackModalOpenAtom.set(false);
  }, [session]);

  const handleCopyUrl = useCallback(async () => {
    if (!expoUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(expoUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy URL');
    }
  }, [expoUrl]);

  const handleReload = useCallback(() => {
    if (session && !session.isDisposed) {
      session.reloadClients();
      toast.info('Reloading connected devices...');
    }
  }, [session]);

  return (
    <DialogRoot open={isOpen} onOpenChange={(v) => !v && handleClose()}>
      <Dialog
        className="text-center !flex-col !mx-auto !text-center !max-w-md"
        showCloseButton={true}
        onClose={handleClose}
      >
        <div className="border !border-bolt-elements-borderColor flex flex-col gap-4 justify-center items-center p-6 bg-bolt-elements-background-depth-2 rounded-md">
          <div className="i-bolt:expo-brand h-10 w-full invert dark:invert-none"></div>

          <DialogTitle className="text-bolt-elements-textTertiary text-lg font-semibold leading-6">
            Preview on your device
          </DialogTitle>

          <DialogDescription className="bg-bolt-elements-background-depth-3 max-w-sm rounded-md p-2 border border-bolt-elements-borderColor text-sm">
            Scan this QR code with <strong>Expo Go</strong> on your phone. Your project runs natively — no redirect
            needed.
          </DialogDescription>

          {/* QR Code */}
          <div className="my-4 flex flex-col items-center">
            {expoUrl ? (
              <QRCode
                logoImage="/favicon.svg"
                removeQrCodeBehindLogo={true}
                logoPadding={3}
                logoHeight={50}
                logoWidth={50}
                logoPaddingStyle="square"
                style={{
                  borderRadius: 16,
                  padding: 2,
                  backgroundColor: '#8a5fff',
                }}
                value={expoUrl}
                size={200}
              />
            ) : (
              <div className="text-bolt-elements-textTertiary text-center py-8">
                <div className="i-svg-spinners:90-ring-with-bg text-2xl mx-auto mb-2"></div>
                Creating session...
              </div>
            )}
          </div>

          {/* Connection status */}
          <div className="w-full max-w-sm">
            {connectedDevices.length > 0 ? (
              <div className="flex flex-col gap-2">
                {connectedDevices.map((device) => (
                  <div
                    key={device.id}
                    className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-md px-3 py-2 text-sm"
                  >
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-bolt-elements-textPrimary font-medium">{device.name || 'Device'}</span>
                    <span className="text-bolt-elements-textTertiary text-xs ml-auto">{device.platform}</span>
                    {device.status === 'error' && <span className="text-red-400 text-xs">Error</span>}
                  </div>
                ))}
              </div>
            ) : expoUrl ? (
              <div className="flex items-center justify-center gap-2 text-sm text-bolt-elements-textTertiary">
                <div className="i-svg-spinners:pulse-3 text-lg"></div>
                Waiting for device to connect...
              </div>
            ) : null}
          </div>

          {/* Copyable URL */}
          {expoUrl && (
            <button
              onClick={handleCopyUrl}
              className="w-full max-w-sm bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded-md px-3 py-2 text-xs text-bolt-elements-textTertiary font-mono truncate hover:bg-bolt-elements-background-depth-4 transition-colors cursor-pointer text-left"
              title="Click to copy"
            >
              {copied ? 'Copied!' : expoUrl}
            </button>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 mt-2 w-full max-w-sm">
            {connectedDevices.length > 0 && (
              <button
                onClick={handleReload}
                className="flex-1 flex items-center justify-center gap-1.5 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor text-bolt-elements-textPrimary rounded-md px-3 py-2 text-sm hover:bg-bolt-elements-background-depth-4 transition-colors cursor-pointer"
              >
                <div className="i-ph:arrow-clockwise text-sm"></div>
                Reload
              </button>
            )}
            <button
              onClick={handleDisconnect}
              className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-md px-3 py-2 text-sm hover:bg-red-500/20 transition-colors cursor-pointer"
            >
              <div className="i-ph:power text-sm"></div>
              Disconnect
            </button>
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
};
