#!/usr/bin/env node

/**
 * docker-local-client-smoke.cjs
 *
 * Proves the LOCAL_CLIENT_CIDRS path in a real container, which the unit tests
 * (loopback only) cannot: a published container port rewrites the host
 * browser's source address to the Docker bridge gateway. If that address is
 * not treated as local, users:list is rejected and the profile picker is
 * unreachable from the host.
 *
 * Usage (inside a container on the same Docker network as both backends):
 *   node docker-local-client-smoke.cjs <trusted-url> <untrusted-url>
 *
 * <trusted-url>   backend started with LOCAL_CLIENT_CIDRS=<its network subnet>
 * <untrusted-url> backend started with a CIDR that cannot match (TEST-NET-1)
 *
 * Both connect over socket.io from a container, so both are non-loopback: the
 * only difference is the CIDR configuration. Trusted must receive the profile
 * list; untrusted must be rejected.
 */

const { io } = require('socket.io-client');

const [trustedUrl, untrustedUrl] = process.argv.slice(2);
if (!trustedUrl || !untrustedUrl) {
  console.error('usage: docker-local-client-smoke.cjs <trusted-url> <untrusted-url>');
  process.exit(2);
}

const CONNECT_TIMEOUT_MS = 90_000;

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      timeout: 10_000,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`timed out connecting to ${url}`));
    }, CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', () => { /* keep retrying until the timer fires */ });
  });
}

async function listProfiles(url) {
  const socket = await connect(url);
  try {
    return await socket.timeout(10_000).emitWithAck('users:list:bootstrap');
  } finally {
    socket.close();
  }
}

(async () => {
  const trusted = await listProfiles(trustedUrl);
  if (!Array.isArray(trusted)) {
    throw new Error(
      `client inside LOCAL_CLIENT_CIDRS was not served the profile list: ${JSON.stringify(trusted)}`,
    );
  }

  const untrusted = await listProfiles(untrustedUrl);
  if (Array.isArray(untrusted) || untrusted?.ok !== false) {
    throw new Error(
      `client outside LOCAL_CLIENT_CIDRS was served the profile list: ${JSON.stringify(untrusted)}`,
    );
  }

  console.log(
    `container local-client check passed (trusted profile count: ${trusted.length})`,
  );
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
