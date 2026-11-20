import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les essais de synchronisation parlent a un vrai serveur et a une
    // vraie base : ils doivent s'executer dans l'ordre, un seul a la fois.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
