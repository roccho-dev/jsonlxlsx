const PORT_KEYS = Object.freeze(['deflateRaw', 'inflateRaw', 'sha256']);

function missingPortKeys(port = {}) {
  return PORT_KEYS.filter(key => typeof port[key] !== 'function');
}

function isPort(port = {}) {
  return missingPortKeys(port).length === 0;
}

function assertPort(port = {}) {
  const missing = missingPortKeys(port);
  if (missing.length) throw new Error(`port adapter is missing: ${missing.join(', ')}`);
  return port;
}

export { PORT_KEYS, missingPortKeys, isPort, assertPort };
