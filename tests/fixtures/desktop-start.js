import { startDesktop } from '../../src/desktop/main.js';
process.once('message', async ({ directory }) => {
  try {
    const app = await startDesktop({ directory, assetsDirectory: directory });
    process.send({ ready: true, origin: app.origin });
  } catch {
    process.send({ ready: false }); process.exit(1);
  }
});
