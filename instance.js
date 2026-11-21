// Binds the engine to this deployment: configuration, classification and the folder with the data files.
// Used by middleware.js and api/*.js. An instance in its own repository has the same file next to its config.
import config from './graveyard.config.json' with { type: 'json' };

export const instance = { config, classification: {}, dataFolder: new URL('./data/', import.meta.url) };
