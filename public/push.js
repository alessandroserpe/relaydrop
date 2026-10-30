import { localDevices, enrollDevice, decode64 } from '/vault.js';
let registrationPromise;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export async function configurePushUI(user, devices, api, onChange) {
  const status = document.querySelector('#push-state');
  const enable = document.querySelector('#push-enable');
  const disable = document.querySelector('#push-disable');
  const install = document.querySelector('#push-install');
  const banner = document.querySelector('#push-banner');
  enable.hidden = disable.hidden = true;
  install.hidden = !(isIOS() && !standalone());
  const config = await api('/v1/push/config');
  banner.hidden = !config.enabled;
  if (!config.enabled) { status.textContent = 'Gli avvisi integrati non sono ancora configurati su questo server.'; return; }
  if (isIOS() && !standalone()) { status.textContent = 'Per gli avvisi, apri RelayDrop dall’icona sulla schermata Home. I file sono disponibili anche qui in Safari.'; return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    status.textContent = 'Questo browser non supporta gli avvisi. Su iPhone serve iOS 16.4 o successivo e RelayDrop sulla Home.'; return;
  }
  if (Notification.permission === 'denied') { status.textContent = 'Avvisi bloccati nelle impostazioni del dispositivo. Abilitali per RelayDrop, poi aggiorna la casella.'; return; }
  try {
    registrationPromise ||= navigator.serviceWorker.register('/v1/push/sw.js', { scope: '/', updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready);
    const registration = await registrationPromise;
    const local = (await localDevices()).filter(d => d.user_id === user.id && devices.some(remote => remote.id === d.id));
    const subscription = await registration.pushManager.getSubscription();
    const activeDevice = local.find(d => config.devices.includes(d.id));
    const enabled = Boolean(subscription && activeDevice && sameKey(subscription.options.applicationServerKey, config.public_key));
    banner.hidden = enabled;
    enable.hidden = enabled; disable.hidden = !enabled;
    status.textContent = enabled ? 'Avvisi attivi su questo dispositivo. L’agente può notificarti quando invia un file.' : 'Attiva gli avvisi per sapere quando arriva un file. Il messaggio non contiene nomi o contenuti.';
    enable.onclick = async () => {
      // Request permission directly inside the user gesture, before any awaited work (iOS).
      const permissionRequest = Notification.requestPermission();
      enable.disabled = true;
      let pushSubscription;
      try {
        if (await permissionRequest !== 'granted') throw new Error('Consenti le notifiche per attivare gli avvisi.');
        const device = local[0] || await enrollDevice(isIOS() ? 'iPhone · RelayDrop' : 'RelayDrop · questo browser', api);
        pushSubscription = await registration.pushManager.getSubscription();
        if (pushSubscription && !sameKey(pushSubscription.options.applicationServerKey, config.public_key)) {
          await pushSubscription.unsubscribe(); pushSubscription = null;
        }
        pushSubscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode64(config.public_key) });
        await api('/v1/push/subscriptions', { method: 'POST', body: JSON.stringify({ device_id: device.id, subscription: pushSubscription.toJSON() }) });
        await onChange();
      } catch (error) { status.textContent = error.message; }
      finally { enable.disabled = false; }
    };
    disable.onclick = async () => {
      disable.disabled = true;
      try {
        // Remove the server destination first so opting out does not depend on the push provider.
        for (const device of local.filter(d => config.devices.includes(d.id))) await api('/v1/push/subscriptions/' + device.id, { method: 'DELETE' });
        await subscription?.unsubscribe();
        await onChange();
      } catch (error) { status.textContent = error.message; }
      finally { disable.disabled = false; }
    };
  } catch { registrationPromise = null; status.textContent = 'Impossibile preparare gli avvisi. Verifica la connessione e aggiorna la casella.'; }
}

function sameKey(actual, expected) {
  if (!actual) return false;
  const bytes = new Uint8Array(actual), key = decode64(expected);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}
