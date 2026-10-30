import { describe, expect, it } from 'vitest';
import { travarLavaosTest } from '../helpers/test-db';

describe('lock mútuo de suítes sobre lavaos_test', () => {
  // o globalSetup do Vitest já segura o lock: uma segunda suíte concorrente aborta
  it('segunda tentativa concorrente aborta com mensagem clara', async () => {
    await expect(travarLavaosTest()).rejects.toThrow('outra suíte está usando lavaos_test');
  });
});
