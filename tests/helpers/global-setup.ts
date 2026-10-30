import { travarLavaosTest } from './test-db';

/** Vitest segura o lock de lavaos_test durante a execução toda; o retorno é o teardown. */
export default travarLavaosTest;
