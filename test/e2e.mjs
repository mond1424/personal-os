// 격리 E2E 러너 — 실제 dev DB와 테스트 데이터를 절대 섞지 않는다.
//
//   1) OS 임시 폴더에 일회용 D1 을 만들고 (마이그레이션 적용)
//   2) 그 DB 로 dev 서버를 자식 프로세스로 띄우고 (임의 빈 포트)
//   3) 픽스처를 시드하고 (그 임시 DB 에만)
//   4) front.mjs 검사를 그 워커에 붙여 실행하고
//   5) 서버 프로세스 트리를 종료하고 임시 폴더를 통째로 삭제한다 → 흔적 0
//
// 즉 `.wrangler/state`(실제 로컬 dev DB)는 건드리지 않는다. 사용: npm run front
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { seedFixtures } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// npx.cmd 는 Node 20+ 에서 shell 없이 EINVAL — wrangler CLI 를 node 로 직접 부른다
// (경로에 공백/한글이 있어도 안전).
const wranglerCli = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 빈 포트 하나 받기 (고정 포트 충돌 회피)
const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

// 프로세스 트리 종료 — wrangler dev(node) + 자식 workerd 까지 확실히 정리
const killTree = (pid) => {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(pid, "SIGKILL"); } catch { /* 이미 죽음 */ }
  }
};

const persistDir = mkdtempSync(join(tmpdir(), "personal-os-e2e-"));

/**
 * wrangler가 **사용자 홈에 쓰는 것들**을 이 임시 디렉터리로 몬다.
 *
 * 왜 — 디버그 로그의 기본 위치는 전역 설정 디렉터리(Windows에서는
 * `%APPDATA%\xdg.config\.wrangler\logs`)다. 그 경로가 안 써지는 셸에서는 검사가
 * 시작도 못 하고 죽는다(Codex 셸에서 EPERM으로 세 번 물렸다 — T-01·T-03·T-05).
 * **격리 러너가 임시 D1을 쓰면서 로그만 홈에 남길 이유가 없다.**
 *
 * 셸마다 환경을 맞추라고 하는 대신 러너가 자기 경로를 정한다 — 지시는 다음 셸에서 또 깨진다.
 *
 * `WRANGLER_LOG_PATH`가 로그를 직접 정하고(전역 설정 경로 계산을 건너뛴다),
 * `XDG_*`는 설정·캐시까지 덮는다. `XDG_CONFIG_HOME`은 `~/.wrangler`가 **디렉터리로 존재하면**
 * 그쪽에 밀리므로(wrangler의 legacy 폴백) 로그는 `WRANGLER_LOG_PATH`가 지고 있어야 한다.
 * 메트릭은 아예 끈다 — 전역 설정에 쓰기를 시도할 이유가 없다.
 *
 * `--local` 전용이라 인증이 필요 없다. 원격 명령을 이 env로 돌리면 토큰을 못 찾는다.
 */
const wEnv = {
  ...process.env,
  // CI=true — wrangler 4.1x부터 --local 마이그레이션에도 확인 프롬프트가 붙는다.
  // stdio:inherit이라 TTY가 그대로 넘어가 검사가 입력을 기다리다 멈춘다.
  // 여기 DB는 매번 새로 만드는 임시본이라 물어볼 것이 없다.
  CI: "true",
  WRANGLER_LOG_PATH: join(persistDir, "wrangler-logs"),
  XDG_CONFIG_HOME: join(persistDir, "xdg", "config"),
  WRANGLER_SEND_METRICS: "false",
  // `XDG_CACHE_HOME`·`XDG_DATA_HOME`·`XDG_STATE_HOME`은 **일부러 건드리지 않는다.**
  // 관측된 실패는 설정 디렉터리 쓰기(로그)뿐이었고, 캐시까지 매 실행 비우면 wrangler가
  // 무언가를 새로 가져오려 할 수 있다 — 근거 없이 넓힌 통제가 새 실패를 만든다.
};

// 마이그레이션 단계의 상한. 이 리포에서 실측 **11.5초**다(0014까지 14개).
// 상한을 두는 것은 느림을 덮으려는 게 아니라 **막힘이 스스로 이름을 말하게** 하려는 것이다 —
// 없으면 여기서 블록됐을 때 러너가 아무 말 없이 바깥 제한 시간까지 먹는다(T-05가 그랬다).
const MIGRATE_TIMEOUT_MS = 120_000;

/**
 * front.mjs 안전망.
 *
 * 180초였고, 매 실행마다 여기 걸려 ETIMEDOUT이 찍혔다 — 그런데 **검사가 느려서가 아니었다.**
 * front.mjs가 성공 경로에서 종료하지 않아(rAF 타이머가 남는다) 요약을 찍고도 살아 있었고,
 * 이 SIGKILL이 **유일한 종료 수단**이었다. 그래서 전부 통과해도 `npm run front`가 exit 1이었다.
 * 실측: 검사 자체 ~75초 · 마이그레이션 ~12초. 옛 180초 창의 나머지는 전부 hang이었다.
 *
 * front.mjs에 `process.exit(0)`을 넣어 이제 스스로 끝난다. 그래서 이 상한은 **순수한 hang 방지**다 —
 * 여기 걸리면 정말로 멈춘 것이고, teardown(임시 DB 삭제)이 막히지 않게만 하면 된다.
 * 실제 소요는 매 실행 찍는다 — 늘어나는 것이 보이게.
 */
const FRONT_TIMEOUT_MS = 420_000;

/** 픽스처 시드 상한. 실측 ~2초 — 여기 걸리면 워커가 응답을 안 주는 것이다. */
const SEED_TIMEOUT_MS = 60_000;

let server = null;
let code = 0;

try {
  // 실패했을 때 어디에 쓰려 했는지가 보여야 한다 — 이 두 줄이 T-01의 진단을 대신한다.
  console.log(`[e2e] 일회용 DB: ${persistDir}`);
  console.log(`[e2e] wrangler 로그·설정도 같은 임시 폴더로 (${wEnv.WRANGLER_LOG_PATH})`);

  // 1) 임시 DB 에 스키마 적용
  const startedMigrate = Date.now();
  try {
    execFileSync(
      process.execPath,
      [wranglerCli, "d1", "migrations", "apply", "personal-os", "--local", "--persist-to", persistDir],
      { cwd: root, stdio: "inherit", env: wEnv, timeout: MIGRATE_TIMEOUT_MS },
    );
  } catch (e) {
    // ETIMEDOUT이면 '느린' 것이 아니라 어딘가에서 막힌 것이다(정상 11.5초).
    // 무엇이 막혔는지 모른 채 상한만 늘리지 않는다 — 원인을 보고하고 멈춘다.
    throw new Error(
      e?.signal || e?.code === "ETIMEDOUT"
        ? `마이그레이션이 ${MIGRATE_TIMEOUT_MS / 1000}초 안에 끝나지 않았다(정상 ~12초). `
          + `느린 것이 아니라 막힌 것이다 — 위 출력과 ${wEnv.WRANGLER_LOG_PATH} 를 확인한다.`
        : `마이그레이션 실패: ${e?.message ?? e}`,
    );
  }
  // **마이그레이션 표 다음에 이 줄이 나오는지가 진단을 가른다.**
  // 표는 wrangler가 찍고 이 줄은 러너가 찍는다 — 표가 있고 이 줄이 없으면
  // 마이그레이션 자식이 표를 찍고도 끝나지 않은 것이고, 둘 다 있으면 막힌 곳은 그 뒤다.
  console.log(`[e2e] 마이그레이션 완료 ${((Date.now() - startedMigrate) / 1000).toFixed(1)}초`);

  // 2) 임시 DB 로 dev 서버 기동 (자식 프로세스)
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [wranglerCli, "dev", "--local", "--persist-to", persistDir, "--ip", "127.0.0.1", "--port", String(port)],
    { cwd: root, stdio: "ignore", env: wEnv, windowsHide: true },
  );
  server.on("error", (e) => console.error("[e2e] dev 서버 spawn 실패:", e));

  // 3) 헬스 대기 (최대 ~30초)
  //
  // ⚠️ **매 시도에 상한이 있어야 이 루프가 실제로 30초로 끝난다.**
  // 전엔 `fetch`에 상한이 없어서, 서버가 포트는 열었는데 응답을 안 주면(연결은 되고
  // 대기만 하는 상태) 그 한 번의 `fetch`가 영원히 걸렸다 — 반복 횟수로 감싼 상한이
  // 상한이 아니게 된다. 러너가 아무 말 없이 바깥 제한 시간까지 도는 자리 중 하나였다.
  let up = false;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + "/api/health", { signal: AbortSignal.timeout(2000) });
      if (r.ok) { up = true; break; }
    } catch { /* 아직 준비 안 됨 — 타임아웃도 여기로 온다 */ }
    await sleep(250);
  }
  if (!up) {
    throw new Error(
      "dev 서버가 30초 안에 /api/health에 응답하지 않았다. "
      + `포트 ${port}는 잡혔는지, wrangler dev가 컴파일에서 막혔는지 확인한다 `
      + `(로그: ${wEnv.WRANGLER_LOG_PATH}).`,
    );
  }
  console.log(`[e2e] 워커 기동 @ ${base}`);

  // 4) 픽스처 시드 (이 임시 DB 에만)
  //
  // 상한이 없던 두 번째 자리. `seed.mjs`의 `fetch`도 상한이 없어서 한 번 걸리면
  // 영원히 기다린다. seed.mjs를 고치지 않고 **호출부에서** 상한을 씌운다 —
  // 목적은 시드를 빠르게 만드는 것이 아니라 **막혔을 때 어디서 막혔는지 말하게** 하는 것이다.
  await Promise.race([
    seedFixtures(base),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(
        `픽스처 시드가 ${SEED_TIMEOUT_MS / 1000}초 안에 끝나지 않았다. `
        + "워커는 떴는데 요청이 돌아오지 않는다 — 서버 로그를 확인한다.",
      )), SEED_TIMEOUT_MS).unref(),
    ),
  ]);
  console.log("[e2e] 픽스처 시드 완료");

  // 5) 프론트 검사 — front.mjs 를 별도 프로세스로, 이 워커에 붙여 실행
  //    (front.mjs 가 혹시 안 끝나도 teardown 이 막히지 않도록 타임아웃 안전망)
  const startedFront = Date.now();
  const res = spawnSync(process.execPath, [join(here, "front.mjs"), base], {
    cwd: root, stdio: "inherit", timeout: FRONT_TIMEOUT_MS, killSignal: "SIGKILL",
  });
  const frontMs = Date.now() - startedFront;
  console.log(`[e2e] front 검사 ${(frontMs / 1000).toFixed(1)}초 (안전망 ${FRONT_TIMEOUT_MS / 1000}초)`);
  if (res.error) {
    // **무해하지 않다.** 안전망이 걸리면 SIGKILL이므로 위에 찍힌 숫자가 전부인지 알 수 없다.
    console.error(
      res.error.code === "ETIMEDOUT"
        ? `[e2e] front가 안전망(${FRONT_TIMEOUT_MS / 1000}초)에 걸려 강제 종료됐다 — `
          + "위 통과 수는 도중까지의 것일 수 있다. 검사가 늘어 시간이 는 것이면 안전망을 올린다."
        : `[e2e] front 실행 오류: ${res.error.message}`,
    );
    code = 1;
  } else code = res.status ?? 1;
} catch (e) {
  console.error("[e2e] 오류:", e?.stack || e);
  code = 1;
} finally {
  // 6) 정리 — 서버 트리 종료 + 임시 DB 삭제 (파일 잠금은 재시도로 흡수)
  killTree(server?.pid);
  await sleep(500);
  try {
    rmSync(persistDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  } catch (e) {
    console.warn("[e2e] 임시 DB 삭제 실패(무해 — OS 임시폴더라 곧 정리됨):", e?.message);
  }
  console.log("[e2e] 정리 완료 — 임시 DB 삭제, 실제 dev DB(.wrangler/state)는 그대로.");
  process.exit(code);
}
