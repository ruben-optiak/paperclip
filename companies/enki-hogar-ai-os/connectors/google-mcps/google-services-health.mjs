const ports = [8010, 8011, 8012];
const results = await Promise.all(ports.map(async (port) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(2000)})).ok;
  } catch {
    return false;
  }
}));
if (!results.every(Boolean)) process.exit(1);
