// Website notifications (Web Push: RFC 8291 encryption and RFC 8292 VAPID), using only built in crypto.
const enc = new TextEncoder();

export const b64urlDecode = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function join(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, length * 8);
  return new Uint8Array(bits);
}

/** Encrypts the message so only that browser can read it. */
export async function encryptPayload(plain: Uint8Array, p256dh: Uint8Array, auth: Uint8Array) {
  const server = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const clientKey = await crypto.subtle.importKey('raw', p256dh as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, server.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdf(auth, shared, join(enc.encode('WebPush: info\0'), p256dh, serverPublic), 32);
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, join(plain, new Uint8Array([2])) as BufferSource));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = serverPublic.length;
  return join(header, serverPublic, cipher);
}

/** Signed proof that this message comes from us. */
export async function vapidHeader(endpoint: string, publicKey: string, privateKey: string, subject: string) {
  const pub = b64urlDecode(publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: privateKey, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(signature)}, k=${publicKey}`;
}

// deno-lint-ignore no-explicit-any
export async function sendWebPush(db: any, userIds: string[], message: { title: string; body: string; url: string }) {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey || !userIds.length) return;
  const subject = `mailto:${Deno.env.get('GMAIL_USER') ?? 'uncommonintake.app@gmail.com'}`;
  const { data: subs } = await db.from('web_push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds);
  const payload = enc.encode(JSON.stringify(message));
  await Promise.all(
    (subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        const res = await fetch(s.endpoint, {
          method: 'POST',
          headers: {
            Authorization: await vapidHeader(s.endpoint, publicKey, privateKey, subject),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: '86400',
            Urgency: 'high',
          },
          body: await encryptPayload(payload, b64urlDecode(s.p256dh), b64urlDecode(s.auth)),
        });
        // The browser turned notifications off or the person cleared the site.
        if (res.status === 404 || res.status === 410) await db.from('web_push_subscriptions').delete().eq('id', s.id);
        else if (!res.ok) console.error('web push failed', res.status, await res.text());
      } catch (e) {
        console.error('web push failed', e);
      }
    }),
  );
}
