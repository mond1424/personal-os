# 새 앱 설계 — 가칭 pOS Lite

근거 표기 — 〔실측〕 현 pOS 저장소의 기록과 데이터(STATE.md·api-surface·schema, 2026-10-01 갱신본) · 〔연구〕 동료심사 논문과 현장 연구 · 〔문서〕 공식·제품 문서 · 〔판단〕 위 근거에서 끌어낸 이 문서의 추론. 대괄호 번호는 §16 근거 목록.

---

## 0. 결론

- 현 pOS는 고쳐 쓰지 않는다. 개발을 멈추고, 새 앱이 자리를 잡으면 보관한다.
- 새 앱은 pOS의 축소판이 아니라 다른 물건이다. **마감을 놓치지 않게 하고, 오늘 할 일을 한 화면에 보여 주고, 떠오른 일을 몇 초 안에 받아 적는다.** 하는 일은 셋 — 보기 · 넣기 · 알리기.
- 무거운 것은 이미 잘하는 곳으로 보낸다. 달력은 휴대폰 캘린더, 분석·장기 맥락·대화는 Claude, 밤의 제동은 안드로이드 수면 모드·앱 지연 도구·충전기 위치.
- 새 앱 안에는 AI 호출, 불변성·봉인, 네이티브 코드가 없다. PWA 하나(Workers + D1 + Web Push)를 폰과 태블릿에서 같이 쓴다.
- 현 코드에서는 uclass 수집, 과목명·제목 다듬기, 재촉 시각 규칙, 시간표 파서만 옮긴다.

---

## 1. 진단 — 왜 고쳐 쓰지 않는가

### 1.1 크기 〔실측〕

| 항목 | 값 |
|---|---|
| 테이블 / 트리거 / 뷰 | 23 / 23 / 2 |
| HTTP 엔드포인트 | 82 |
| ADR / 티켓 | 50 / 88 (티켓은 2026-07-30 이후) |
| STATE.md | 4,592줄 |
| 변경 하나가 거치는 층 | 마이그레이션(local → remote) · 서버 배포 · APK 설치. 반영 여부를 층마다 따로 확인 |

### 1.2 사람이 부딪히는 마찰

현 pOS의 원칙(원본/파생 분리, 과거 불변, 하루 봉인)은 나중의 분석을 위해 데이터 무결성을 지킨다. 그 값은 지금 쓰는 사람이 치른다.

| 상황 | 겪는 일 |
|---|---|
| uclass에서 온 할 일을 지움 | "기록까지 완전히 지워요" 확인 뒤 "다른 기록이 참조하고 있어 지울 수 없어요" 오류 〔실측〕 |
| uclass 과제가 들어옴 | '수락'해야 일정·할 일·재촉이 생긴다. 수락 전에는 알림이 없다 〔실측〕 |
| uclass에서 마감이 바뀜 | 수락한 일정이 따라가지 않아 재촉이 옛 마감을 본다 〔실측〕 |
| 지난 날을 고치려 함 | 봉인된 날의 기록·일정은 고칠 수 없고 memo만 붙는다 〔문서〕 |
| 날짜 없는 일이 쌓임 | 21일이 지나면 앱을 열 때 차단 팝업 〔문서〕 |
| 일을 끝내거나 치움 | 완료·미루기·재배정·취소·삭제가 각각 다른 규칙을 가진다 〔문서〕 |

〔연구〕 기능이 많은 제품은 고를 때 끌리고 쓸 때 지친다. 사용 전에는 66%가 기능이 가장 많은 모델을 골랐고, 직접 써 본 뒤에는 56%가 더 단순한 모델을 원했다[1].

### 1.3 밤 개입의 실제 〔실측〕

Guard 밤 감시, 2026-09의 두 구간(발동이 있던 밤 각 8):

| | 09-07 ~ 09-16 | 09-17 ~ 09-29 |
|---|---|---|
| 발동 (밤당 중앙값) | 63 (8) | 42 (5) |
| '알겠습니다' 수락 | 54 | 33 |
| 그중 같은 밤에 다시 발동 | 47 (87%) | 27 (82%) |
| 사유를 쓰고 계속(override) | 0 | 0 |

수락 뒤 재확인 발동은 매 밤 두 번 울렸다. 수락하고도 최소 12분을 더 썼다는 뜻이다. 문구를 바꾼 뒤에도 감시 L3 수락은 40/41에서 19/20으로 그대로였다.

〔판단〕 수락은 비용이 없고 아무것도 막지 않는다. 그래서 개입 화면이 '읽고 넘기는 화면'이 됐다. 〔연구〕 같은 경고를 반복해서 보면 주의 반응이 줄어드는 습관화가 fMRI로 관찰됐다[9]. one sec 연구의 온라인 실험(N=500)에서는 '생각해 보라'는 문구만으로는 효과가 없었고, '그만두기' 선택지와 지연이 효과를 냈다[10]. 문구를 다듬는 방향으로는 나아지기 어렵다.

### 1.4 다시 쓰기의 위험, 그래도 고르는 이유

〔문서〕 처음부터 다시 쓰기는 옛 코드에 쌓인 수정과 지식을 버리는 흔한 실수로 꼽히고[22], 두 번째 시스템은 첫 번째보다 부풀기 쉽다(second-system effect)[23].

〔판단〕 그래도 다시 쓴다.
1. 남길 기능이 전체의 일부라 옮길 양이 적다.
2. 무게가 화면이 아니라 스키마·트리거·네이티브 층에 있다. 화면을 숨겨도 §1.2의 마찰은 남는다.
3. 값진 지식(uclass 수집, 재촉 시각 규칙, 시간표 파서)은 모듈째 옮긴다(§9.4).
4. 부풀 위험은 §13의 상한으로 막는다.

---

## 2. 설계 원칙

**원칙 1 — 넣기는 몇 초, 분류는 없다.**
- 〔연구〕 할 일 도구는 형식적인 서술·분류 없이 빨리 넣을 수 있어야 하고, 버려진 낮은 우선순위 항목을 처리할 길이 있어야 한다[4].
- 〔연구〕 끝내지 못한 목표에 구체적 계획만 세워도(실행 전이라도) 그 목표에 대한 침투적 생각이 줄었다[18]. → '언제'를 한 번 탭으로 고르게 한다.
- 〔연구〕 행동은 동기·능력·계기가 동시에 있을 때 일어난다[24]. 의욕이 낮은 순간을 기준으로 잡고, 쉬움 쪽을 키운다.

**원칙 2 — 기록은 하나, 빠져도 벌하지 않는다.**
- 〔연구〕 자기추적의 흔한 실패는 너무 많은 것을 기록하다 지치는 것이다[3]. 경험표집 연구에서 질문지 길이는 부담·응답률·응답의 질을 해쳤고, 빈도는 그러지 않았다(n=163)[5].
- 〔연구〕 사람은 기록을 잊고, 건너뛰고, 쉬었다가 돌아온다. 도구는 중단과 재개를 기본으로 설계해야 한다[2]. 하루 빠뜨린 것은 습관 형성에 큰 영향이 없었다[6].
- → 하루 기록은 '오늘 한 줄 + 기분 1탭'뿐이다. 연속 기록, 빈 날 경고, 자동 마감이 없다.

**원칙 3 — 알림은 적게, 묶어서, 구체적으로.**
- 〔연구〕 알림을 하루 세 번 묶어 받은 집단이 덜 스트레스받고 더 집중했다. 한 시간 단위 묶음은 효과가 없었고, 알림을 아예 끈 집단은 불안이 오히려 늘었다(2주, 200여 명)[8].
- 〔연구〕 반복되는 같은 경고는 습관화된다[9].
- → 알림은 세 종류(아침 요약·마감 재촉·저녁 신호). 조건이 맞을 때만, 매번 다른 구체적 정보로 보낸다.

**원칙 4 — 확인창 대신 되돌리기.**
- 〔판단〕 확인창도 반복되면 습관적으로 눌린다(원칙 3과 같은 이유). 끝내기·지우기는 바로 실행하고 몇 초간 되돌리기를 준다. 지난 날을 포함해 모든 것을 고칠 수 있다.

**원칙 5 — 알림은 발판이다. 습관은 일상의 신호에 묶는다.**
- 〔연구〕 리마인더는 반복을 도왔지만 습관 형성은 방해했고, 일상 사건에 묶은 신호가 자동성을 키웠다[7]. 'if-then' 실행 의도는 94개 검증에서 평균 효과 크기 d = 0.65였다[19].
- → 저녁 신호는 "양치하고 나면 내일 할 일 적기" 같은 자기 루틴의 출발점이다. 루틴이 붙으면 끌 수 있다.

**원칙 6 — 밤에는 앱이 설득하지 않고 환경이 막는다.**
- 〔연구〕 잠자리 미루기는 '외부 사정 없이 의도한 시각에 잠자리에 들지 못하는 것'이며, 자기조절과 관련되고 수면 부족을 예측한다(n=177)[14]. 이를 겨냥한 MCII 개입은 계획과 실제 취침의 차이를 줄였지만 수면 시간을 늘리지는 못했다(n=510, 250)[15].
- 〔연구〕 잠금형 개입이 경고형보다 사용 시간을 더 줄였지만 좌절감도 컸고, 약한 잠금이 가장 선호됐다(52.8%, n=36)[12]. 앱을 열 때 지연과 '그만두기'를 넣은 one sec은 6주 동안 여는 시도의 36%를 그만두게 했고 실제 열기를 57% 줄였다(n=280, 앱 개발자 공저)[10]. 1,039명·평균 13.4주의 현장 데이터에서는 시도의 33%가 그만둠으로 끝났고, 여는 시도 자체가 기간 내내 줄었다. 그만두는 비율은 시간이 갈수록 낮아졌다[11]. 다만 이런 도구가 장기 습관을 만든다는 근거는 약하다[13].
- 〔연구·소표본〕 잠들기 30분 전 휴대폰을 쓰지 않게 한 4주 예비 RCT에서 입면 시간·수면 시간·수면의 질이 나아졌다(n=38)[16].
- 〔연구〕 잠들기 전 5분 동안 '내일 할 일'을 쓴 집단은 '한 일'을 쓴 집단보다 빨리 잠들었고(평균 약 15분 대 25분), 목록이 구체적일수록 빨랐다(n=57, 수면다원검사)[17].
- → 밤에 앱 알림을 늘리지 않는다. 저녁 신호 하나(내일 할 일 적기로 이끔)에 OS 수면 모드·앱 지연 도구·충전기 위치를 더한다(§8).

**원칙 7 — 마감 구조를 설계하지 않는다. 진짜 마감을 정확히 보여 준다.**
- 〔연구〕 마감을 나누거나 스스로 정하게 하면 미루기가 준다는 고전 연구는 2026년 재현에서 효과가 거의 없었고, 원 데이터의 조작 의혹도 제기됐다[20]. 실제 업무 관찰에서는 긴급성과 다른 사람의 기대가 완료를 예측했다(1주 안 완료: 긴급도 높음 93%, 낮음 44%)[4].
- 〔판단〕 미루기 2주 제한·대기 21일 만료 같은 자기 부과 장치는 효과 근거가 약하고 마찰은 확실하다. 새 앱은 uclass의 실제 마감을 놓치지 않게 하는 데 힘을 쓴다.

**원칙 8 — 필요한 최소한의 기술.**
- 〔문서〕 Calm Technology: "주의는 가능한 한 적게", "문제를 푸는 데 필요한 최소한의 기술"[21].

---

## 3. 하는 일과 하지 않는 일

| 일 | 내용 |
|---|---|
| 보기 | 오늘 화면 하나 — 다음 일정, 7일 안의 마감, 오늘 할 일, 밀린 것 한 줄, 오늘 수업, 오늘 한 줄 |
| 넣기 | 아이콘 길게 누르기 → 추가 · 다른 앱에서 공유 → 추가 · 앱 안 + 버튼. 날짜는 한 탭으로, 또는 글에서 읽는다("내일", "금", "10/12 23:59") |
| 알리기 | 마감 재촉(끝내면 바로 멈춤) · 아침 요약 · 저녁 신호 |
| 내보내기 | 이번 주를 Markdown으로 복사해 Claude에 붙인다 |

하지 않는 일 — AI 호출 · 다축 기분 척도와 하루 점수 · 하루 마감·봉인·과거 수정 금지 · 기간·목표·달성률 · 완료율 · 미루기 횟수와 제한 · 대기 만료 · 일정/할 일 구분 · 위치 · 앱 사용 감지 · 밤 개입 · 월간 달력 · 위젯 · 반복 할 일 · 오프라인 입력 대기열. 이 중 위젯·반복 할 일·오프라인 대기열은 §10의 다시 볼 조건이 생기면 검토한다.

---

## 4. 하루 (예시)

| 시각 | 앱이 하는 것 | 사람이 하는 것 |
|---|---|---|
| 08:00 | 아침 요약 — "오늘 수업 2 · 마감 1 · 할 일 3 / 수리물리 과제 2 오늘 23:59" | 훑어보거나 넘긴다 |
| 낮 | — | 아이콘 길게 누르기 → "전자기 연습 3장 금" → 엔터. 금요일 할 일이 된다 |
| 20:59 | 재촉 — "수리물리 과제 2 · 23:59 · 3시간 남음" [제출했어요] [열기] | 제출하고 [제출했어요]. 이 과제의 알림이 끝난다 |
| 22:30 | 저녁 신호 — "내일 10:00 전자기및연습1 · 7시간 자려면 01:30 전에 눕기" [내일 할 일 적기] | 내일 할 일 두세 개, 오늘 한 줄 |
| 01:30 | (앱이 아니라 휴대폰이) 수면 모드를 켠다 — 흑백, 방해 금지, 지정 앱은 열 때 지연 | 충전기에 꽂는다 |

---

## 5. 화면

화면은 둘(오늘·목록)에 추가 시트와 설정. 아래쪽에 두 탭과 + 버튼.

### 5.1 오늘 (예시 화면)

```
10월 7일 수                                   ⚙
다음 · 13:00 양자물리및연습2 (2시간 뒤)

마감
  수리물리 과제 2               오늘 23:59
  전자기 연습 4                 목 10:00
  ★ 전자기 중간고사             D-9

할 일
  □ 전자기 연습 3장
  □ 도서관 책 반납
  밀린 것 2  ›

수업
  10:00 역학및연습2 · 13:00 양자물리및연습2

오늘 한 줄
  기분 1 2 3 4 5    [한 줄 쓰기]
                                        [ + ]
```

- 내용이 없는 칸은 보이지 않는다.
- 마감 줄을 누르면 [제출했어요] [고치기] [숨기기].
- 할 일 체크 = 끝(줄이 그어지고 몇 초 뒤 사라짐, 되돌리기 토스트). 왼쪽으로 밀기 = 지우기(되돌리기). 길게 누르기 = 날짜 바꾸기.
- 밀린 것 = 날짜가 지난 미완료. 펼치면 줄마다 [오늘] [내일] [언젠가] [지우기], 위에 [모두 오늘로].
- 오늘 한 줄은 18시 이후 위로 올라온다.

### 5.2 추가 시트

- 열리자마자 키보드가 뜬다. 엔터 = 저장하고 다음 줄 대기(여러 개 연속). 아래로 쓸면 닫힌다.
- 날짜 칩: 오늘 · 내일 · 이번 주말 · 날짜 · 언젠가. 오늘 화면에서 열면 '오늘', 공유로 들어오면 '언젠가'가 기본이다.
- 글에서 읽는 것: 내일·모레, 요일(가장 가까운 그 요일), M/D, HH:MM. 읽힌 부분은 칩으로 바뀌어 보인다.
- 시각을 넣으면 재촉 대상이 된다. ★는 '중요' — D-day가 붙고, 전날 저녁 신호가 시험 모드가 된다.
- [할 일 | 메모] 전환. 메모는 오늘 한 줄 끝에 "HH:MM 내용"으로 붙는다. 시트는 늘 '할 일'로 열린다.

### 5.3 목록

다가오는 것(날짜순) → 언젠가 → 최근 7일 끝낸 것(되돌리기 가능). 언젠가가 15개를 넘거나 30일 넘은 항목이 있으면 맨 위에 "오래된 언젠가 n개 — 정리" 한 줄. 막지 않는다.

### 5.4 설정

uclass iCal 주소 · 이 기기에서 알림 받기 / 시험 발송 · 아침 요약 시각(08:00) · 저녁 신호 시각(22:30) · 수면 필요(7시간) · 준비+이동(90분) · 하루 경계(05:00) · 조용한 시간(01:00–08:00) · 시간표 붙여 넣기 · 요일별 권장 취침 시각(시간표에서 계산, 보기 전용) · 시험 전날 나에게 한 마디 · 내보내기(이번 주 Markdown / 전체 JSON).

### 5.5 공통 규칙

- 누르는 것은 화면 아래쪽, 한 손 엄지가 닿는 거리에 둔다.
- 화면에 시스템 용어(귀속일·재배정·이월·수락)가 없다.
- 빈 화면은 할 일을 하나 알려 준다 — "+를 눌러 할 일을 넣어 보세요", "설정에 uclass 주소를 넣으면 과제가 들어옵니다".
- 앱을 열면 마지막 화면을 캐시에서 바로 보여 주고 뒤에서 새로 고친다.
- 다크 모드는 기기를 따른다.

---

## 6. 알림

| 종류 | 시각 | 조건 | 내용 | 버튼 |
|---|---|---|---|---|
| 아침 요약 | 08:00 | 오늘 수업·마감·할 일 중 하나라도 있음 | 개수 + 가장 급한 마감 한 줄 | [열기] |
| 마감 재촉 | 마감 3시간 전, 1시간 전 | 시각이 있고 끝나지 않은 항목 | 제목·과목·남은 시간 | [제출했어요] [열기] |
| 저녁 신호 | 22:30 | 내일 12시 전 첫 일정이 있거나 24시간 안에 마감이 있음 | 내일 첫 일정, 눕기 마지노선, 내일 마감 | [내일 할 일 적기] [열기] |

- 현 재촉의 네 점(전날 저녁·당일 아침·3시간 전·1시간 전) 중 앞의 둘은 저녁 신호와 아침 요약에 실린다. 따로 울리는 것은 3시간 전·1시간 전 둘뿐이다.
- 같은 시각은 하나로 묶고, 1시간 미만 간격이면 늦은 쪽만 남긴다.
- 조용한 시간에는 보내지 않는다.
- 보낼 때마다 항목 상태를 다시 읽는다. 끝내거나 숨긴 항목은 그 뒤로 울리지 않는다. 따로 취소할 예약이 없다.
- 버튼은 앱을 열지 않고 서비스 워커가 바로 처리한다.
- 눕기 마지노선 = 내일 첫 일정 − 준비+이동 − 수면 필요. 예: 10:00 → 08:30 기상 → 01:30.
- 시험 전날(★, 또는 제목에 시험·중간·기말·퀴즈): 첫 줄이 "시험 전날"이 되고, '시험 전날 나에게 한 마디'를 그대로 붙인다.
- 보통의 하루: 아침 1 + 저녁 0~1 + 마감이 있는 날 2~4.

---

## 7. 다른 길로 보내는 것

| 현 pOS 기능 | 보내는 곳 | 이유 |
|---|---|---|
| 월간 달력 · 기간 형광펜 · 일정 관리 | 휴대폰 캘린더 | 달력 UI·위젯·반복 일정은 이미 성숙했다. 새 앱은 달력을 그리지 않는다 |
| 폰 캘린더 미러 | (선택) 구글 캘린더의 비밀 iCal 주소 읽기[33] | 내일 아침 약속을 저녁 신호에 넣을 때만 필요하다 |
| 시간표 보기·위젯 | 필요하면 학교 앱(예: 시대생[43]) | 새 앱은 저녁 신호 계산과 오늘 수업 한 줄에만 시간표를 쓴다 |
| Analysis · Me · Life Model · 관리인 chat | Claude 프로젝트 | 장기 맥락·대화·분석은 Claude가 한다. 새 앱은 재료만 넘긴다(§9.5) |
| AI 제공자·키·티어 | 없음 | 앱 안에 AI가 없다 |
| Guard 감시 · 개입 단계 · 모드 · 보호 규칙 · 위험도 | 수면 모드 + 앱 지연 도구 + 충전기 위치(§8) | 남이 유지보수하는 도구이고, 연구 근거가 있다[10][11][12] |
| Feelings 다축 · 하루 점수 · Log | 오늘 한 줄 + 기분 1탭 + 메모 | 원칙 2 |
| 하루 마감 · 봉인 · 불변 트리거 | 없음 | `updated_at`이면 충분하다 |
| 대기 21일 · 미루기 2주 · 재배정 · 취소/삭제 구분 · 완료율 | 날짜 있음/없음 + 밀린 것 한 줄 | 원칙 7 |
| 위치(Wi-Fi) · 감시 앱 목록 | 없음 | 쓰는 화면이 없다 |
| 홈 위젯('+', '오늘 찍기') | 아이콘 길게 누르기 바로가기 + 아침 요약 | 안드로이드에서 PWA는 홈 위젯을 만들 수 없다[26] |

---

## 8. 밤 — Guard를 대신하는 구성

'미리 정한 나'가 규칙을 만들고 집행은 자동으로 — 이 생각을 앱 밖에서 구현한다. 결정은 낮에, 설정할 때 한다. 집행은 휴대폰과 방이 한다.

1. **수면 모드**(삼성 디지털 웰빙) — 흑백·방해 금지, 시작·끝 시각 예약[37]. 시각은 새 앱 설정의 '요일별 권장 취침 시각'에서 가져온다. 요일마다 크게 다르지 않으면 가장 이른 것 하나로 통일하는 편이 단순하다.
2. **ScreenZen**(무료, 안드로이드) — 밤에 여는 앱 두세 개에 열기 전 지연을 걸고, 정한 시간대에는 막는다[38]. one sec도 같은 계열이다[10][11].
3. **충전기 위치** — 침대에서 손이 닿지 않는 곳[16].
4. **시험 전날 한 마디** — 낮에 미리 써 둔다. 시험 전날 저녁 신호가 그대로 보여 준다.
5. **Guard** — 1~3을 맞춘 뒤 야간 감시를 1주 꺼 본다. 차이가 없거나 나으면 APK를 지운다.

〔판단〕 이 구성이 Guard보다 밤 사용을 더 줄인다는 보장은 없다. 확실한 것은 둘이다. 지금의 Guard는 수락하고 계속 쓰는 경로로 소비되고 있다(§1.3). 이 구성은 유지보수가 거의 들지 않는다.

---

## 9. 기술 결정

### 9.1 형태 — PWA 하나

- Cloudflare Workers + Hono + D1 + 바닐라 JS. 익숙한 스택을 그대로 쓰되 새 리포, 새 D1.
- Chrome '앱 설치'로 홈 화면에 둔다. 아이콘을 길게 누르면 바로가기(추가)가 뜨고[42], 다른 앱의 공유 목록에 들어간다(설치된 PWA만)[27].
- 알림은 Web Push. PWA는 기기 안에서 알림을 예약할 수 없다 — Notification Triggers API 개발이 끝났다[25]. 그래서 서버가 보낸다. Workers cron이 매분 깨어[32] 보낼 것을 계산한다. VAPID 서명과 페이로드 암호화는 WebCrypto로 100줄 안팎이다[31].
- 안드로이드 Chrome의 Web Push는 FCM을 거친다. FCM은 높은 우선순위 메시지로 Doze 중인 기기를 깨울 수 있고, 보이는 알림을 띄우지 않는 메시지가 이어지면 우선순위를 강등한다[29]. 새 앱의 push는 모두 알림을 띄운다. 〔판단〕 Web Push의 Urgency 헤더가 이 우선순위로 어떻게 옮겨지는지, 이 휴대폰에서 실제 지연이 얼마인지는 확인하지 않았다 — 2단계에서 잰다.
- Chrome 알림 버튼은 두 개까지다[28].
- 같은 앱을 태블릿·PC에서도 쓴다. 알림은 '이 기기에서 알림 받기'를 켠 기기로만 간다.
- uclass·캘린더 주소는 토큰을 품은 비밀이다. 리포에 넣지 않고 D1 설정이나 Worker secret에 둔다. 리포가 공개여도 개인 정보가 없게 한다.

### 9.2 데이터 — 테이블 다섯

```
items      id, title, date?, time?, star, source(manual|uclass), source_uid?, course?,
           done_at?, hidden, title_edited, created_at, updated_at
notes      date PK, text, mood(1–5)?, updated_at
classes    weekday, start, end, subject       -- 한 학기. 학기 범위는 settings
push_subs  endpoint PK, p256dh, auth, label, created_at
settings   key PK, value                      -- uclass_url, 각종 시각, last_tick …
```

- `date`가 없으면 언젠가, `time`이 있으면 재촉 대상이다.
- uclass 항목은 `source_uid`로 갱신한다. 마감 날짜·시각은 원본을 따라가고(바뀌면 재촉도 바뀐다), 제목은 사용자가 고쳤으면(`title_edited`) 그대로 둔다.
- 지우기: 직접 넣은 것은 실제로 지운다(되돌리기 시간이 지난 뒤). uclass 것은 `hidden` — 다시 가져와도 뜨지 않는다.
- 트리거와 뷰가 없다.

### 9.3 uclass 가져오기

- 수락 단계가 없다. 가져온 과제는 바로 목록에 들어가고, 7일 안의 것이 오늘 화면 '마감'에 뜬다. 원치 않는 것은 숨긴다.
- 〔실측〕 iCal은 제출 여부를 모른다. 미리 제출한 과제도 마감 뒤 약 5일까지 피드에 남았다. 그래서 [제출했어요]가 재촉을 멈추는 유일한 신호다.
- 수집은 6시간 간격, 그리고 앱을 열었을 때 마지막 수집이 1시간보다 오래됐으면 한 번 더.
- 확인할 것 — Moodle 4.5부터 미제출자에게만 '마감 임박(48시간 전)·기한 초과' 알림이 간다[35]. 서울시립대 LMS의 모바일 앱은 코스모스다[36]. 이 알림이 실제로 온다면 제출 여부를 아는 보조 안전망이 하나 생긴다.

### 9.4 현 리포에서 옮길 것 (복사, 의존 없음)

| 모듈 | 새 앱에서 |
|---|---|
| uclass iCal 수집·파싱 | 그대로 |
| 과목명 자르기 · 제목 꼬리('기한') 떼기 | 그대로 |
| 재촉 시각 계산 | 3시간·1시간 점과 묶기 규칙만 |
| 시간표 텍스트 파서 | 한 학기로 단순화 |
| 하루 경계 계산 | '오늘'을 정할 때만 |

### 9.5 Claude로 가는 길

- 기본: 설정 → '이번 주 복사' → Markdown이 클립보드로 간다. Claude 프로젝트에 붙여 주간 돌아보기를 한다. 현 pOS의 Me·Life Model 내용은 Markdown으로 옮겨 그 프로젝트의 문서로 둔다.

  ```
  # 10/05–10/11
  끝낸 것 12 · 남은 것 4 · 밀린 것 2
  마감  수리물리 과제 2 (10/07 23:59) — 제출 표시 10/07 22:41
        전자기 연습 4 (10/09 10:00) — 표시 없음
  오늘 한 줄
  - 10/05 (3) 양자 과제 절반. 밤에 영상 오래 봄
  - 10/06 (4) …
  ```

- 선택: 같은 Worker에 읽기 전용 MCP 서버를 붙이면 Claude가 직접 읽는다. Cloudflare가 OAuth 공급자 라이브러리와 MCP 서버 클래스를 제공하고[40], Claude는 무료 플랜에서도 사용자 지정 커넥터 하나를 허용한다[39]. 쓰기 도구는 만들지 않는다.

---

## 10. 버린 대안

| 대안 | 버린 이유 | 다시 볼 조건 |
|---|---|---|
| A. 현 pOS 단순화(화면 숨기기) | 무게가 스키마·트리거·네이티브에 있어 숨겨도 남는다. §1.2의 마찰이 그대로다 | — |
| B. 기성 할 일 앱 + uclass → 할 일 변환기 | 화면을 만들지 않는 가장 가벼운 길이다. 대신 과목명·23:59 처리·한국어 날짜 해석·알림 개수를 남의 정책에 맡기고, Claude로 가는 길이 하나 더 생긴다 | 새 앱 손질이 주 1시간을 넘을 때. 수집 모듈만 떼어 그 앱의 API로 보낸다(예: TickTick Open API[41]) |
| C. 과제 알림 전용 앱 + pOS 유지 | 할 일이 두 곳으로 갈린다. 과제는 '시각 있는 할 일'일 뿐이다 | — |
| D. uclass iCal을 구글 캘린더에 구독 | 갱신 주기를 정할 수 없고(수 시간, 길게는 하루 가까이)[34], 항목별 완료가 없어 알림을 멈출 수 없다 | — |
| E. 네이티브(Compose) 새 앱 | 빌드·서명·설치 주기와 Kotlin 유지보수가 붙는다. 위젯 말고는 PWA로 된다 | 알림 지연이 반복되거나 위젯이 2주 내내 아쉬울 때. 안드로이드 14부터 정확한 알람 권한이 새 설치 앱에 기본 거부라는 점도 함께 본다[30] |
| F. Guard 개선(수락 = 실제 잠금) | 네이티브 작업이 더 는다. 같은 종류의 마찰을 수면 모드·ScreenZen이 이미 준다 | §8 구성 2주 뒤에도 밤 사용이 그대로일 때 |

---

## 11. 잃는 것

- 앱이 밤 사용을 감지하고 개입하는 능력. 감지 데이터도 사라진다.
- 분 단위 Log·다축 기분 같은 촘촘한 시계열. 분석 재료가 얇아진다.
- 과거 기록의 불변 보장. 고칠 수 있는 대신 '그날 그대로'를 증명하지 못한다.
- 홈 위젯. 아이콘 바로가기와 아침 요약으로 메운다.
- 7월 이후 기록을 화면에서 이어 보는 것. 현 D1은 지우지 않고 JSON으로 보관한다.

---

## 12. 전환 순서 — 단계마다 멈추고 확인

| 단계 | 내용 | 멈춤 기준 |
|---|---|---|
| 0 (코드 없음) | §8의 1~4를 설정한다. 현 pOS에는 새 티켓을 내지 않는다(APK 재촉 작업 포함). 앱은 과제가 Today에 보이도록 그대로 켜 둔다 | 수면 모드·ScreenZen이 하룻밤 실제로 동작한다 |
| 1 뼈대 | 새 리포·D1·토큰 인증 · items · 오늘·목록·추가 · PWA 설치(바로가기·공유) | 폰 홈 화면에서 할 일 하나를 5초 안에 넣고, 끝내고, 지우고, 되돌린다 |
| 2 마감 | uclass 이식(자동 추가·숨기기·마감 변경 반영) · Web Push(구독·발송·버튼) · 재촉 · 아침 요약 | 실제 과제 하나로 3시간·1시간 전 알림이 오고, [제출했어요] 뒤에는 오지 않는다 |
| 3 저녁 | 시간표 · 저녁 신호 · 오늘 한 줄·기분·메모 · 이번 주 복사 | 1주 실사용 |
| 4 정리 | 현 D1 전체를 JSON으로 보관 · Me·Life Model을 Markdown으로 Claude 프로젝트에 · 현 cron 정지 · Guard APK 제거(§8-5 결과에 따라) · 현 리포에 보관 표시 | 휴대폰에 이 일을 하는 앱이 하나만 남는다 |
| 5 (선택) | 구글 캘린더 비밀 iCal 읽기 · 읽기 전용 MCP · 네이티브 셸 | 각각 다시 볼 조건이 생길 때만 |

- 시험 주간에는 1~4를 하지 않는다. 0은 바로 할 수 있다.
- 〔판단〕 1~3은 주말 두 번 안팎의 크기다.
- 〔판단〕 첫 2주는 알림 본문 끝에 예정 시각을 작게 붙여 지연을 눈으로 확인한다. 문제가 없으면 뗀다.

---

## 13. 유지 규칙 — 복잡도 상한

〔판단〕 이 시스템이 생겨난 계기인 실패 — 다음 날 시험을 알면서 새 아이디어에 몰입해 밤을 새운 일 — 는 이 시스템을 설계하던 밤에 일어났다. 새 앱은 빨리 끝나고 손이 덜 가는 크기여야 한다.

- 상한: 화면 2 + 추가 시트 + 설정 · 테이블 5 · 알림 종류 3 · 설정 항목 12 · 확인창 0 · AI 호출 0 · 네이티브 코드 0.
- 상한을 넘기려면 먼저 하나를 뺀다.
- 새 기능은 같은 불편이 2주 안에 세 번 생겼을 때만 만든다. 불편은 메모로 "불편: …"이라고 적어 둔다.
- STATE는 100줄 안에 둔다. 지난 일은 git log에 남긴다.

---

## 14. 2주 뒤 점검

- 놓친 마감이 있었나?
- 귀찮아서 밀어 버린 알림은 어느 종류였나?
- 넣으려다 그만둔 적이 있었나? 어디서 막혔나?
- 앱을 열지 않은 날, 무엇이 부족했나?
- 시험 전날 밤은 어떻게 지나갔나?

---

## 15. 정해야 할 것

1. Guard — §8 구성 뒤 1주 끄기 시험을 할지.
2. 개인 일정이 구글 계정 캘린더에 있는지. 삼성 계정 전용 캘린더라면 5단계의 iCal 경로가 없다.
3. 새 앱으로 옮길 데이터 — 열린 할 일, 이번 학기 시간표, uclass 주소면 충분한지.
4. 이름.

---

## 16. 근거

**현 pOS** — 저장소 `STATE.md`, `docs/api-surface.md`, `docs/schema-current.sql` (2026-10-01 갱신본).

**연구**
1. Thompson, Hamilton & Rust (2005). Feature Fatigue: When Product Capabilities Become Too Much of a Good Thing. *Journal of Marketing Research*. — 요약: [UMD Smith School](https://www.rhsmith.umd.edu/news/feature-fatigue-research-proves-simpler-products-are-better-manufacturers-advised-lose-extra)
2. Epstein et al. (2015). A Lived Informatics Model of Personal Informatics. *UbiComp*. [PDF](https://my.eng.utah.edu/~cs5540/au16/readings/PersonalInformatics-Epstein2015.pdf)
3. Choe et al. (2014). Understanding Quantified-Selfers' Practices in Collecting and Exploring Personal Data. *CHI*. [PDF](https://my.eng.utah.edu/~cs5540/au16/readings/PersonalInformatics-Choe2014.pdf)
4. Bellotti et al. (2004). What a To-Do: Studies of Task Management Towards the Design of a Personal Task List Manager. *CHI*. [PDF](https://hci.rwth-aachen.de/materials/conferences/CHI2004/1p735.pdf)
5. Eisele et al. (2022). The Effects of Sampling Frequency and Questionnaire Length on Perceived Burden, Compliance, and Careless Responding in Experience Sampling Data. *Assessment*. [초록](https://cris.maastrichtuniversity.nl/en/publications/the-effects-of-sampling-frequency-and-questionnaire-length-on-per/)
6. Lally et al. (2010). How Are Habits Formed: Modelling Habit Formation in the Real World. *European Journal of Social Psychology*. — 해설: [The Behavioral Scientist](https://www.thebehavioralscientist.com/articles/how-long-to-form-a-habit)
7. Stawarz, Cox & Blandford (2015). Beyond Self-Tracking and Reminders: Designing Smartphone Apps That Support Habit Formation. *CHI*. [UCL Discovery](https://discovery.ucl.ac.uk/id/eprint/1468224/)
8. Fitz et al. (2019). Batching Smartphone Notifications Can Improve Well-Being. *Computers in Human Behavior*. — 해설: [Springer Nature Community](https://communities.springernature.com/posts/batching-notifications-can-improve-attention-well-being-and-productivity)
9. Anderson et al. (2016). From Warning to Wallpaper: Why the Brain Habituates to Security Warnings and What Can Be Done About It. *Journal of Management Information Systems*. [JMIS](https://jmis-web.org/articles/1304)
10. Grüning, Riedel & Lorenz-Spreen (2023). Directing Smartphone Use through the Self-Nudge App one sec. *PNAS*. [DOI](https://www.pnas.org/doi/10.1073/pnas.2213114120) — 공저자 Riedel은 one sec 개발자다([one sec 소개](https://one-sec.app/about/)).
11. Haliburton et al. (2024). A Longitudinal In-the-Wild Investigation of Design Frictions to Prevent Smartphone Overuse. *CHI*. [PDF](https://www.medien.ifi.lmu.de/pubdb/publications/pub/haliburton2024chi/haliburton2024chi.pdf)
12. Kim et al. (2019). GoalKeeper: Exploring Interaction Lockout Mechanisms for Regulating Smartphone Use. *IMWUT*. [PDF](https://ic.kaist.ac.kr/files/papers/kim2019goalkeeper.pdf)
13. Monge Roffarello & De Russis (2023). Achieving Digital Wellbeing Through Digital Self-control Tools: A Systematic Review and Meta-analysis. *ACM TOCHI*. [요약](https://elite.polito.it/news/2023/05/31/tochi-dscts)
14. Kroese et al. (2014). Bedtime Procrastination: Introducing a New Area of Procrastination. *Frontiers in Psychology*. [본문](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2014.00611)
15. Valshtein, Oettingen & Gollwitzer (2020). Using Mental Contrasting with Implementation Intentions to Reduce Bedtime Procrastination: Two Randomised Trials. *Psychology & Health*. — 해설: [Solving Procrastination](https://solvingprocrastination.com/study-bedtime-procrastination-mcii-technique/)
16. He et al. (2020). Effect of Restricting Bedtime Mobile Phone Use on Sleep, Arousal, Mood, and Working Memory: A Randomized Pilot Trial. *PLoS ONE*. [DOAJ](https://doaj.org/article/1198ff0a00b64c9e872d9e552a126928)
17. Scullin et al. (2018). The Effects of Bedtime Writing on Difficulty Falling Asleep: A Polysomnographic Study Comparing To-Do Lists and Completed Activity Lists. *Journal of Experimental Psychology: General*. — 해설: [BPS](https://bps.org.uk/node/2257), [Baylor](https://news.web.baylor.edu/news/story/2018/can-writing-your-dos-help-you-doze-baylor-study-suggests-jotting-down-tasks-can)
18. Masicampo & Baumeister (2011). Consider It Done! Plan Making Can Eliminate the Cognitive Effects of Unfulfilled Goals. *Journal of Personality and Social Psychology*. — 해설: [Psychology Today](https://www.psychologytoday.com/us/blog/tech-support/201310/why-your-to-do-list-drives-you-crazy)
19. Gollwitzer & Sheeran (2006). Implementation Intentions and Goal Achievement: A Meta-analysis of Effects and Processes. *Advances in Experimental Social Psychology*. — 해설: [The Behavioral Scientist](https://www.thebehavioralscientist.com/glossary/implementation-intentions)
20. Hyndman & Bisin (2026). Replication of "Procrastination, Deadlines, and Performance: Self-Control by Precommitment". *Psychological Science*. [DOI](https://journals.sagepub.com/doi/full/10.1177/09567976261460772) · 원 데이터 분석: [Data Colada 138](https://datacolada.org/138)

**원칙·실무**

21. Calm Technology 원칙. [calmtech.com](https://calmtech.com/)
22. Spolsky (2000). Things You Should Never Do, Part I. [Joel on Software](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/)
23. Brooks (1975). *The Mythical Man-Month* — second-system effect. [개요](https://en.wikipedia.org/wiki/The_Mythical_Man-Month)
24. Fogg Behavior Model (B = MAP). [behaviormodel.org](https://behaviormodel.org/)

**플랫폼·제품 문서**

25. Chrome — Notification Triggers API 개발 종료. [developer.chrome.com](https://developer.chrome.com/docs/web-platform/notification-triggers)
26. Microsoft — PWA 위젯은 Windows 11 위젯 보드에서만 동작. [Microsoft Learn](https://learn.microsoft.com/en-gb/microsoft-edge/progressive-web-apps-chromium/how-to/widgets)
27. Chrome — Web Share Target(안드로이드 Chrome 76+, 설치된 PWA). [developer.chrome.com](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)
28. Chrome — 알림 버튼 두 개(데스크톱·안드로이드). [developer.chrome.com](https://developer.chrome.com/blog/notification-actions)
29. Firebase — 안드로이드 메시지 우선순위와 Doze. [firebase.google.com](https://firebase.google.com/docs/cloud-messaging/android/message-priority)
30. Android 14 — 정확한 알람 권한 기본 거부. [developer.android.com](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)
31. Cloudflare Worker에서 WebCrypto로 Web Push 보내기. [DEV](https://dev.to/mfauveau/waking-a-dead-service-worker-with-web-push-from-a-cloudflare-worker-1jnm)
32. Cloudflare — Cron Triggers. [developers.cloudflare.com](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
33. Google 캘린더 — iCal 형식의 비밀 주소. [support.google.com](https://support.google.com/calendar/answer/37648)
34. 구독 캘린더(ICS)의 갱신 주기. [nocal](https://nocal.app/help/ics-and-subscriptions/why-subscribed-calendars-dont-update-instantly)
35. Moodle 4.5 새 기능(과제 임박·초과 알림)과 알림 문서. [4.5 New Features](https://docs.moodle.org/405/en/New_Features) · [Notifications](https://docs.moodle.org/503/en/Notifications)
36. 서울시립대 LMS 모바일 앱(코스모스). [UOS IT Helpdesk](https://cis.uos.ac.kr/ithelpdesk/html/started/foreign-sub8.do) · 코스모스 알림 기능(타 대학 매뉴얼): [GIST](https://lms.gist.ac.kr/local/ubion/manual/contents/manual_f_e/mobileAppKo.pdf)
37. Samsung — 디지털 웰빙(수면 모드·앱 타이머). [samsung.com](https://www.samsung.com/us/support/answer/ANS00085547)
38. ScreenZen 리뷰(무료, 안드로이드, 지연·시간대 차단). [WhistleOut](https://www.whistleout.ca/CellPhones/Guides/screenzen-app-review)
39. Claude — 원격 MCP 사용자 지정 커넥터. [support.claude.com](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
40. Cloudflare — 원격 MCP 서버와 OAuth. [blog.cloudflare.com](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
41. TickTick Developer. [developer.ticktick.com](https://developer.ticktick.com/)
42. Chrome 84 — PWA 앱 바로가기(안드로이드에서 아이콘 길게 누르기). [developer.chrome.com](https://developer.chrome.com/blog/new-in-chrome-84)
43. 시대생 — 서울시립대 학생 앱(시간표·위젯). [App Store](https://apps.apple.com/us/app/%EC%8B%9C%EB%8C%80%EC%83%9D-%EB%82%B4-%EC%86%90%EC%95%88%EC%9D%98-%EC%84%9C%EC%9A%B8%EC%8B%9C%EB%A6%BD%EB%8C%80%ED%95%99%EA%B5%90/id1514073192)
