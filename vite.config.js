import { defineConfig } from 'vite';
import { graveyard } from './vite.js';

export default defineConfig({
  plugins: [graveyard({ config: 'graveyard.config.json', middleware: 'middleware.js', api: 'api' })],
  server: { port: 8765, host: '127.0.0.1' },
});
