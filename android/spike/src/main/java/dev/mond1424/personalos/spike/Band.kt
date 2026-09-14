package dev.mond1424.personalos.spike

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import java.time.LocalDate
import kotlin.math.min

// 배경 밴드 경계선 모델 (설계 2.2) 를 Compose Path 로 옮긴 것.
//
// 규칙은 웹과 같다:
//   밴드는 셀 높이를 꽉 채운다 / 활성 기간 n 개면 n 등분, created_at 순으로 위에서 아래 /
//   이웃 날과 배치가 달라지는 지점에서만 반 칸 폭 S 곡선으로 이동 /
//   이웃이 없으면 수직 절단, 단 기간이 진짜 시작하거나 끝나는 면만 둥글게.
//
// 넘어오면서 없어진 것 하나: 웹은 viewBox 700x96 을 preserveAspectRatio=none 으로 늘려서
// 가로만 비균등 확대된다. 그래서 둥근 마감 반지름을 가로만 700/실제폭 만큼 키우는 보정이
// 있었다(capRx). Compose 는 실제 픽셀에 직접 그리므로 그 보정이 통째로 사라진다.

class Band(val path: Path, val color: Color)

private fun key(p: Period) = p.createdAt + "|" + p.id

fun bandsFor(
    dates: List<LocalDate>,
    periods: List<Period>,
    cellW: Float,
    h: Float,
    capR: Float,
): List<Band> {
    val active = dates.map { date ->
        periods.filter { !date.isBefore(it.start) && !date.isAfter(it.end) }.sortedBy { key(it) }
    }
    val out = ArrayList<Band>()
    val half = cellW / 4f

    for (p in periods) {
        var a = -1
        var b = -1
        dates.indices.forEach { i ->
            if (active[i].contains(p)) {
                if (a < 0) a = i
                b = i
            }
        }
        if (a < 0) continue

        val top = FloatArray(dates.size)
        val bot = FloatArray(dates.size)
        for (i in a..b) {
            val n = active[i].size
            val k = active[i].indexOf(p)
            top[i] = h * k / n
            bot[i] = h * (k + 1) / n
        }

        // 이웃 날에서 이 기간이 들어갈 자리. 그 날 기간이 하나도 없으면 null = 수직 절단.
        fun collapseAt(j: Int): Float? {
            if (j < 0 || j >= dates.size || active[j].isEmpty()) return null
            val above = active[j].count { key(it) < key(p) }
            return h * above / active[j].size
        }

        val cl = collapseAt(a - 1)
        val cr = collapseAt(b + 1)
        val xL = a * cellW
        val xR = (b + 1) * cellW
        val rx = min(capR, (xR - xL) / 2f)
        val capYa = min(capR, (bot[a] - top[a]) / 2f)
        val capYb = min(capR, (bot[b] - top[b]) / 2f)
        val roundL = cl == null && dates[a] == p.start
        val roundR = cr == null && dates[b] == p.end

        val path = Path()
        fun s(xa: Float, ya: Float, xb: Float, yb: Float) {
            val m = (xa + xb) / 2f
            path.cubicTo(m, ya, m, yb, xb, yb)
        }

        if (cl != null) {
            path.moveTo(xL - half, cl)
            s(xL - half, cl, xL + half, top[a])
        } else if (roundL) {
            path.moveTo(xL + rx, top[a])
        } else {
            path.moveTo(xL, top[a])
        }

        for (i in a until b) {                      // 위 가장자리, 왼쪽에서 오른쪽
            val x = (i + 1) * cellW
            path.lineTo(x - half, top[i])
            if (top[i + 1] != top[i]) s(x - half, top[i], x + half, top[i + 1])
            else path.lineTo(x + half, top[i + 1])
        }

        if (cr != null) {
            path.lineTo(xR - half, top[b])
            s(xR - half, top[b], xR + half, cr)
            s(xR + half, cr, xR - half, bot[b])
        } else if (roundR) {
            path.lineTo(xR - rx, top[b])
            path.quadraticTo(xR, top[b], xR, top[b] + capYb)
            path.lineTo(xR, bot[b] - capYb)
            path.quadraticTo(xR, bot[b], xR - rx, bot[b])
        } else {
            path.lineTo(xR, top[b])
            path.lineTo(xR, bot[b])
        }

        for (i in b downTo a + 1) {                 // 아래 가장자리, 오른쪽에서 왼쪽
            val x = i * cellW
            path.lineTo(x + half, bot[i])
            if (bot[i - 1] != bot[i]) s(x + half, bot[i], x - half, bot[i - 1])
            else path.lineTo(x - half, bot[i - 1])
        }

        if (cl != null) {
            path.lineTo(xL + half, bot[a])
            s(xL + half, bot[a], xL - half, cl)
            path.close()
        } else if (roundL) {
            path.lineTo(xL + rx, bot[a])
            path.quadraticTo(xL, bot[a], xL, bot[a] - capYa)
            path.lineTo(xL, top[a] + capYa)
            path.quadraticTo(xL, top[a], xL + rx, top[a])
            path.close()
        } else {
            path.lineTo(xL, bot[a])
            path.close()
        }

        out.add(Band(path, p.color))
    }
    return out
}
