/**
 * `pnpm verify:operacao` (e o alias `pnpm verify:foundation`): lint → typecheck → test (unit+integration) → build → E2E,
 * em sequência (unit/integration/E2E dividem lavaos_test) e parando no primeiro erro. O E2E reaproveita o build
 * recém-feito neste mesmo processo; `pnpm test:e2e` sozinho sempre recompila.
 * Recusa testes exclusivos, pulados ou condicionais: nenhum teste de segurança pode ficar de fora.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const nome = process.env.npm_lifecycle_event ?? 'verify:operacao'; // o nome do script pnpm que chamou (operacao ou o alias foundation)

const MARCADO =
  /\b(?:(?:it|test|describe)\.(?:only|skip|todo|fixme|skipIf|runIf)|concurrent\.(?:only|skip|todo)\b|(?:xit|xtest|xdescribe|fit|fdescribe)\s*\()/;
// autoverificação barata da regex: pega cada forma proibida e não acusa chamadas normais
for (const s of ['it.only(', 'test.skip(', 'test.describe.fixme(', 'describe.todo(', 'it.skipIf(x)(', 'test.runIf(x)(', 'it.concurrent.skip(', 'xit(', 'xdescribe (', 'fit(', 'fdescribe(']) {
  assert.ok(MARCADO.test(s), `regex não pega ${s}`);
}
for (const s of ['it(', 'test(', 'test.describe(', 'it.concurrent(', 'expect(x).toBe(', 'profit(', 'object-fit: cover', 'test.step(']) assert.ok(!MARCADO.test(s), `regex acusa ${s}`);

const marcados = readdirSync('tests', { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile() && /\.(test|spec)\.ts$/.test(f.name))
  .map((f) => `${f.parentPath}/${f.name}`)
  .filter((p) => MARCADO.test(readFileSync(p, 'utf8')));
if (marcados.length) {
  console.error(`${nome} recusado: testes pulados, condicionais ou exclusivos em ${marcados.join(', ')}`);
  process.exit(1);
}

const passos: [string, Record<string, string>?][] = [['lint'], ['typecheck'], ['test'], ['build'], ['test:e2e', { E2E_REUSE_BUILD: '1' }]];
for (const [script, env] of passos) {
  console.log(`\n▶ pnpm ${script}`);
  const r = spawnSync('pnpm', [script], { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\n✖ pnpm ${script} falhou (código ${r.status ?? r.signal})`);
    process.exit(r.status || 1);
  }
}
console.log(`\n✔ ${nome}: lint, typecheck, test, build e E2E verdes`);
