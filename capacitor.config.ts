import type { CapacitorConfig } from '@capacitor/cli';

/* Personal OS — Android 셸.
 *
 * 웹은 원격 로드한다(server.url). 프런트를 고치면 `wrangler deploy`만으로
 * 앱에 반영되고 APK 재빌드가 없다 — 8월에 프런트를 자주 고치므로 반복 속도가 중요하다.
 *
 * 대가: 네트워크가 없으면 화면이 뜨지 않는다.
 * 단 Guard 발동은 네이티브 알람이라 웹과 무관하게 동작한다 (ADR-021).
 *
 * webDir는 server.url이 있어도 Capacitor가 존재를 요구한다. 런타임에는 쓰이지 않는다.
 */

const config: CapacitorConfig = {
  // ⚠️ appId는 영구적이다. 바꾸면 다른 앱이 되어 업데이트 설치가 안 되고
  //    keystore 연결도 끊긴다. 지금 확정한다.
  appId: 'dev.mond1424.personalos',
  appName: 'Personal OS',
  webDir: 'public',

  server: {
    // ⚠️ 배포된 Worker 주소로 교체 — 끝에 슬래시 없이
    url: 'https://personal-os.mai-pos.workers.dev',
    cleartext: false,
    androidScheme: 'https',
  },

  android: {
    allowMixedContent: false,
    // 부팅 순간의 흰 번쩍임 방지 (style.css의 --bg와 맞춤)
    backgroundColor: '#FBFAF7',
  },
};

export default config;
