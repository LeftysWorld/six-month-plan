// Reminders on this device: service worker registration, web push subscribe/unsubscribe,
// and the home-screen icon badge. The server side is supabase/functions/send-reminders.
import { getSupabase } from './data/supabase.ts';

const MIGRATION = 'supabase/migrations/20261021000000_reminders_and_cues.sql';

type NavigatorExtras = Navigator & {
  standalone?: boolean;
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as NavigatorExtras).standalone === true
  );
}

/** Registers /sw.js in production builds (offline shell + notifications). Safe to call more than once. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // offline caching and reminders just stay off
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Whether this browser can get reminders, and whether it first needs to be added to the Home Screen (iPhone/iPad). */
export function pushSupport(): { supported: boolean; needsInstall: boolean; reason?: string } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, needsInstall: false, reason: 'Not available here.' };
  }
  if (isIOS() && !isStandalone()) {
    return {
      supported: false,
      needsInstall: true,
      reason: 'On iPhone, reminders work once the app is added to your Home Screen.',
    };
  }
  if (!window.isSecureContext) {
    return { supported: false, needsInstall: false, reason: 'Reminders need a secure (https) address.' };
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { supported: false, needsInstall: false, reason: "This browser can't show reminders." };
  }
  if (!import.meta.env.PROD) {
    return { supported: false, needsInstall: false, reason: 'Reminders turn on in the deployed app, not in local development.' };
  }
  return { supported: true, needsInstall: false };
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) registerServiceWorker();
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('The app is still installing its offline files. Reload the page and try again.')), 10000),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

function friendlyDbError(message: string): Error {
  if (/push_subscriptions/i.test(message) && /does not exist|could not find|schema cache/i.test(message)) {
    return new Error(`Your database needs the reminders update. In Supabase → SQL Editor, run ${MIGRATION}.`);
  }
  return new Error(`Couldn't save this device for reminders: ${message}`);
}

/** Asks for permission, subscribes this device and saves it so the server can send reminders. */
export async function enablePush(): Promise<void> {
  const support = pushSupport();
  if (!support.supported) throw new Error(support.reason ?? "This browser can't show reminders.");
  const publicKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();
  if (!publicKey) {
    throw new Error('Reminders aren’t set up yet: add VITE_VAPID_PUBLIC_KEY to the app’s environment (see the README).');
  }
  const sb = getSupabase();
  if (!sb) throw new Error('Reminders need you to be signed in to your Supabase account.');

  // Ask first, while the tap still counts as a user gesture (Safari requires this).
  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    throw new Error('Notifications are blocked for this app. Allow them in your browser or phone settings, then try again.');
  }
  if (permission !== 'granted') throw new Error('Notifications weren’t allowed. Tap the button again to choose Allow.');

  const { data: auth } = await sb.auth.getSession();
  const userId: string | undefined = auth?.session?.user?.id;
  if (!userId) throw new Error('You’re signed out. Sign in again, then turn on reminders.');

  const reg = await readyRegistration();
  const key = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe(); // made with an old key; the server couldn't use it
    sub = null;
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch (e) {
      throw new Error(`This device couldn't sign up for reminders: ${(e as Error).message}`);
    }
  }

  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const authKey = json.keys?.auth;
  if (!json.endpoint || !p256dh || !authKey) throw new Error('This browser returned an incomplete subscription. Try again.');

  const { error } = await sb.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: json.endpoint, p256dh, auth: authKey, user_agent: navigator.userAgent.slice(0, 300) },
    { onConflict: 'endpoint' },
  );
  if (error) throw friendlyDbError(error.message);
}

/** Stops reminders on this device (other devices keep theirs). */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    if (error && !/does not exist|could not find|schema cache/i.test(error.message)) {
      throw new Error(`Couldn't turn off reminders: ${error.message}`);
    }
  }
  await sub.unsubscribe();
}

/** True when this device has permission and an active push subscription. */
export async function pushEnabled(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

/** Shows a number on the installed app's icon (0 clears it). Ignored where unsupported. */
export function setAppBadge(count: number): void {
  try {
    const nav = navigator as NavigatorExtras;
    if (count > 0 && typeof nav.setAppBadge === 'function') {
      nav.setAppBadge(Math.round(count)).catch(() => undefined);
    } else if (count <= 0 && typeof nav.clearAppBadge === 'function') {
      nav.clearAppBadge().catch(() => undefined);
    }
  } catch {
    // unsupported
  }
}
