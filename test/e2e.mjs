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
let server = null;
let code = 0;

try {
  console.log(`[e2e] 일회용 DB: ${persistDir}`);

  // 1) 임시 DB 에 스키마 적용
  execFileSync(
    process.execPath,
    [wranglerCli, "d1", "migrations", "apply", "personal-os", "--local", "--persist-to", persistDir],
    { cwd: root, stdio: "inherit" },
  );

  // 2) 임시 DB 로 dev 서버 기동 (자식 프로세스)
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [wranglerCli, "dev", "--local", "--persist-to", persistDir, "--ip", "127.0.0.1", "--port", String(port)],
    { cwd: root, stdio: "ignore", env: { ...process.env, CI: "1" }, windowsHide: true },
  );
  server.on("error", (e) => console.error("[e2e] dev 서버 spawn 실패:", e));

  // 3) 헬스 대기 (최대 ~30초)
  let up = false;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) { up = true; break; }
    } catch { /* 아직 준비 안 됨 */ }
    await sleep(250);
  }
  if (!up) throw new Error("dev 서버가 제한 시간 내에 응답하지 않음");
  console.log(`[e2e] 워커 기동 @ ${base}`);

  // 4) 픽스처 시드 (이 임시 DB 에만)
  await seedFixtures(base);
  console.log("[e2e] 픽스처 시드 완료");

  // 5) 프론트 검사 — front.mjs 를 별도 프로세스로, 이 워커에 붙여 실행
  //    (front.mjs 가 혹시 안 끝나도 teardown 이 막히지 않도록 타임아웃 안전망)
  const res = spawnSync(process.execPath, [join(here, "front.mjs"), base], {
    cwd: root, stdio: "inherit", timeout: 180000, killSignal: "SIGKILL",
  });
  if (res.error) { console.error("[e2e] front 실행 오류:", res.error.message); code = 1; }
  else code = res.status ?? 1;
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
