/**
 * `pnpm verify:foundation`: lint → typecheck → test (unit+integration) → build → E2E, em sequência
 * (unit/integration/E2E dividem lavaos_test) e parando no primeiro erro. O E2E reaproveita o build
 * recém-feito neste mesmo processo; `pnpm test:e2e` sozinho sempre recompila.
 * Recusa testes marcados .only/.skip/.todo/.fixme: nenhum teste de segurança pode ficar de fora.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const marcados = readdirSync('tests', { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile() && /\.(test|spec)\.ts$/.test(f.name))
  .map((f) => `${f.parentPath}/${f.name}`)
  .filter((p) => /\b(it|test|describe)\.(only|skip|todo|fixme)\b/.test(readFileSync(p, 'utf8')));
if (marcados.length) {
  console.error(`verify:foundation recusado: testes pulados ou exclusivos em ${marcados.join(', ')}`);
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
console.log('\n✔ Fundação verificada: lint, typecheck, test, build e E2E');
