import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const APP_ID = "dev.mond1424.personalos";
const CDP_PORT = 9222;
const COMMAND_TIMEOUT_MS = 5_000;
const ADB_START_TIMEOUT_MS = 15_000;
const CDP_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 4 * 1024 * 1024;

function bounded(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 시간 초과 (${timeoutMs}ms)`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function adbCandidates() {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  ].filter(Boolean);
  return [...new Set(roots.map((root) => path.join(root, "platform-tools", executable)))];
}

function resolveAdb() {
  const candidates = adbCandidates();
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;

  const probe = spawnSync("adb", ["version"], {
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (!probe.error && probe.status === 0) return "adb";

  const fallback = process.platform === "win32"
    ? "%LOCALAPPDATA%\\Android\\Sdk\\platform-tools\\adb.exe"
    : "$ANDROID_HOME/platform-tools/adb";
  throw new Error(
    `adb를 찾을 수 없습니다. 확인한 경로: ${candidates.join(", ") || "(환경변수 없음)"}. ` +
    `기본 설치 경로 ${fallback}를 확인하세요.`,
  );
}

function runAdb(adb, args, { allowFailure = false, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  const result = spawnSync(adb, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  });
  const command = `adb ${args.join(" ")}`;
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`${command} 시간 초과 (${timeoutMs}ms)`);
    }
    throw new Error(`${command} 실행 실패: ${result.error.message}`);
  }
  if (!allowFailure && result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`${command} 실패: ${detail}`);
  }
  return result;
}

function startAdbServer(adb) {
  // Windows에서 cold start를 spawnSync로 기다리면 adb 데몬이 자식 핸들을 쥔 채 남아
  // 클라이언트가 끝나도 호출부가 돌아오지 않는다. 직접 자식의 exit만 비동기로 기다린다.
  return new Promise((resolve, reject) => {
    const child = spawn(adb, ["start-server"], { stdio: "ignore", windowsHide: true });
    let settled = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    child.once("error", (error) => finish(reject,
      new Error(`adb 데몬 기동이 안 됩니다: adb start-server 실행 실패: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) finish(resolve);
      else finish(reject, new Error(`adb 데몬 기동이 안 됩니다: adb start-server 실패: ${signal || `exit ${code}`}`));
    });
    timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`adb 데몬 기동이 안 됩니다: adb start-server 시간 초과 (${ADB_START_TIMEOUT_MS}ms)`));
    }, ADB_START_TIMEOUT_MS);
  });
}

function connectedDevice(adb) {
  const result = runAdb(adb, ["devices"]);
  const serials = result.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^(\S+)\s+device$/)?.[1])
    .filter(Boolean);
  if (serials.length === 0) {
    throw new Error(`기기 없음. adb devices 출력:\n${result.stdout.trim() || "(비어 있음)"}`);
  }
  return serials[0];
}

function webViewSocket(adb, serial) {
  const prefix = ["-s", serial];
  const pidResult = runAdb(adb, [...prefix, "shell", "pidof", APP_ID], { allowFailure: true });
  const pids = pidResult.stdout.trim().split(/\s+/).filter((value) => /^\d+$/.test(value));
  const unixResult = runAdb(adb, [...prefix, "shell", "cat", "/proc/net/unix"]);
  const sockets = [...unixResult.stdout.matchAll(/@?(webview_devtools_remote_\d+)/g)]
    .map((match) => match[1]);
  const socket = pids
    .map((pid) => `webview_devtools_remote_${pid}`)
    .find((candidate) => sockets.includes(candidate));

  if (!socket) {
    throw new Error(
      `WebView 소켓 없음 — 앱이 안 떠 있다. Personal OS를 열고 다시 실행하세요. (package=${APP_ID})`,
    );
  }
  return socket;
}

async function cdpTarget(port, socket) {
  const url = `http://127.0.0.1:${port}/json`;
  let response;
  try {
    response = await bounded(fetch(url, { signal: AbortSignal.timeout(CDP_TIMEOUT_MS) }), CDP_TIMEOUT_MS, "CDP HTTP 연결");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const targets = await bounded(response.json(), CDP_TIMEOUT_MS, "CDP target 목록 읽기");
    const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
      ?? targets.find((item) => item.webSocketDebuggerUrl);
    if (!target) throw new Error("webSocketDebuggerUrl이 있는 target 없음");
    return target;
  } catch (error) {
    throw new Error(`CDP 연결 실패 (port=${port}, socket=${socket}): ${error.message}`);
  }
}

function openWebSocket(url) {
  return bounded(new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", (event) => {
      reject(new Error(event.error?.message || "WebSocket 연결 오류"));
    }, { once: true });
  }), CDP_TIMEOUT_MS, "CDP WebSocket 연결");
}

function evaluate(socket, expression) {
  const id = 1;
  const asyncExpression = `(async () => (${expression}))()`;
  const response = bounded(new Promise((resolve, reject) => {
    const onMessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      resolve(message);
    };
    const onClose = () => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Runtime.evaluate 응답 전에 WebSocket이 닫혔습니다"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose, { once: true });
    try {
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression: asyncExpression,
          awaitPromise: true,
          returnByValue: true,
        },
      }));
    } catch (error) {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      reject(error);
    }
  }), CDP_TIMEOUT_MS, "Runtime.evaluate");

  return response.then((message) => {
    if (message.error) {
      throw new Error(`Runtime.evaluate 예외: ${message.error.message}`);
    }
    const details = message.result?.exceptionDetails;
    if (details) {
      const description = details.exception?.description || details.text || "알 수 없는 JS 예외";
      throw new Error(`Runtime.evaluate 예외: ${description}`);
    }
    const remote = message.result?.result;
    if (!remote) throw new Error("Runtime.evaluate 결과가 비어 있습니다");
    if (Object.hasOwn(remote, "value")) return remote.value;
    return remote.unserializableValue ?? remote.description ?? null;
  });
}

async function main() {
  const expression = process.argv.slice(2).join(" ").trim();
  if (!expression) {
    throw new Error('사용법: node test/device.mjs "await Capacitor.Plugins.Guard.state()"');
  }
  if (typeof WebSocket !== "function") {
    throw new Error("내장 WebSocket이 없습니다. Node.js 22 이상이 필요합니다.");
  }

  const adb = resolveAdb();
  await startAdbServer(adb);
  const serial = connectedDevice(adb);
  const socketName = webViewSocket(adb, serial);
  let forwarded = false;
  let socket;

  try {
    try {
      runAdb(adb, ["-s", serial, "forward", `tcp:${CDP_PORT}`, `localabstract:${socketName}`]);
      forwarded = true;
    } catch (error) {
      throw new Error(`CDP 연결 실패 (port=${CDP_PORT}, socket=${socketName}): ${error.message}`);
    }
    const target = await cdpTarget(CDP_PORT, socketName);
    try {
      socket = await openWebSocket(target.webSocketDebuggerUrl);
    } catch (error) {
      throw new Error(`CDP 연결 실패 (port=${CDP_PORT}, socket=${socketName}): ${error.message}`);
    }
    return await evaluate(socket, expression);
  } finally {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (forwarded) {
      runAdb(adb, ["-s", serial, "forward", "--remove", `tcp:${CDP_PORT}`], { allowFailure: true });
    }
  }
}

function writeAndExit(stream, text, code) {
  const fallback = setTimeout(() => process.exit(code), 1_000);
  stream.write(`${text}\n`, () => {
    clearTimeout(fallback);
    process.exit(code);
  });
}

main().then(
  (value) => writeAndExit(process.stdout, JSON.stringify(value) ?? "null", 0),
  (error) => writeAndExit(process.stderr, `[device] ${error.message}`, 1),
);
