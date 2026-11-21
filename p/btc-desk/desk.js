/* Same rules as ~/Documents/.vault/btc-signal/signal.py.
   A call is a readout. This page never sends an order. */
(function (factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (typeof window !== "undefined") {
        window.Desk = api;
        window.addEventListener("DOMContentLoaded", function () {
            api.mount(document);
        });
    }
})(function () {
    const EMA_FAST = 21;
    const EMA_SLOW = 55;
    const RSI_PERIOD = 14;
    const ATR_PERIOD = 14;
    const TREND_GAP = 0.0015;
    const RSI_LOW = 38;
    const RSI_HIGH = 62;
    const RSI_STRETCHED = 68;
    const EMA_TAG = 0.001;
    const STOP_PAD_ATR = 0.25;
    const TZ = "America/Phoenix";

    const DAY_FAST = 21;
    const DAY_SLOW = 200;

    function sma(values, period) {
        const out = new Array(values.length).fill(null);
        if (values.length < period || period < 1) return out;
        let sum = 0;
        for (let i = 0; i < period; i++) sum += values[i];
        out[period - 1] = sum / period;
        for (let i = period; i < values.length; i++) {
            sum += values[i] - values[i - period];
            out[i] = sum / period;
        }
        return out;
    }

    function dailyLine(days, period, extendTo, fromTime) {
        const averages = sma(days.map(function (day) { return day.close; }), period);
        const points = [];
        let prior = null;
        for (let i = 0; i < days.length; i++) {
            if (averages[i] == null) continue;
            const point = { time: days[i].time, value: averages[i] };
            if (fromTime && point.time < fromTime) {
                prior = point;
                continue;
            }
            if (prior) {
                if (point.time > fromTime) points.push({ time: fromTime, value: prior.value });
                prior = null;
            }
            points.push(point);
        }
        if (!points.length && prior) {
            points.push({ time: fromTime, value: prior.value });
        }
        if (points.length && extendTo > points[points.length - 1].time) {
            points.push({ time: extendTo, value: points[points.length - 1].value });
        }
        return points;
    }

    function ema(values, period) {
        const out = new Array(values.length).fill(null);
        if (values.length < period || period < 1) return out;
        const k = 2 / (period + 1);
        let prev = 0;
        for (let i = 0; i < period; i++) prev += values[i];
        prev /= period;
        out[period - 1] = prev;
        for (let i = period; i < values.length; i++) {
            prev = values[i] * k + prev * (1 - k);
            out[i] = prev;
        }
        return out;
    }

    function rsi(closes, period) {
        const out = new Array(closes.length).fill(null);
        if (closes.length <= period) return out;
        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
            const delta = closes[i] - closes[i - 1];
            gains += Math.max(delta, 0);
            losses += Math.max(-delta, 0);
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        const reading = function (gain, loss) {
            if (loss === 0) return 100;
            const rs = gain / loss;
            return 100 - 100 / (1 + rs);
        };
        out[period] = reading(avgGain, avgLoss);
        for (let i = period + 1; i < closes.length; i++) {
            const delta = closes[i] - closes[i - 1];
            avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
            avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
            out[i] = reading(avgGain, avgLoss);
        }
        return out;
    }

    function atr(candles, period) {
        const out = new Array(candles.length).fill(null);
        if (candles.length <= period) return out;
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
            const prev = candles[i - 1].close;
            const bar = candles[i];
            trs.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prev), Math.abs(bar.low - prev)));
        }
        let prevAtr = 0;
        for (let i = 0; i < period; i++) prevAtr += trs[i];
        prevAtr /= period;
        out[period] = prevAtr;
        for (let i = period; i < trs.length; i++) {
            prevAtr = (prevAtr * (period - 1) + trs[i]) / period;
            out[i + 1] = prevAtr;
        }
        return out;
    }

    function regime(close, fast, slow) {
        const gap = slow ? (fast - slow) / slow : 0;
        if (close > fast && fast > slow && gap >= TREND_GAP) return "LONG";
        if (close < fast && fast < slow && gap <= -TREND_GAP) return "SHORT";
        return "RANGE";
    }

    function levels(side, price, swing, barAtr) {
        const pad = STOP_PAD_ATR * barAtr;
        if (side === "LONG") {
            let invalid = swing - pad;
            if (invalid >= price) invalid = price - barAtr;
            const risk = price - invalid;
            return { invalid: invalid, reward2r: price + 2 * risk };
        }
        let invalid = swing + pad;
        if (invalid <= price) invalid = price + barAtr;
        const risk = invalid - price;
        return { invalid: invalid, reward2r: price - 2 * risk };
    }

    function unconfirmed(withTrend, rsiMid, rsiTurning, rsiValue, up) {
        const gaps = [];
        if (!withTrend) gaps.push("the hour closed the wrong way");
        if (!rsiMid) gaps.push("RSI is " + rsiValue.toFixed(1) + ", outside 38–62");
        if (!rsiTurning) gaps.push("RSI is not turning " + (up ? "up" : "down"));
        if (!gaps.length) return "the 1h bar did not confirm.";
        if (gaps.length === 1) return gaps[0] + ".";
        return gaps.slice(0, -1).join(", ") + ", and " + gaps[gaps.length - 1] + ".";
    }

    function decide(snap) {
        const trend = regime(snap.h4Close, snap.h4EmaFast, snap.h4EmaSlow);
        const base = {
            regime: trend,
            price: snap.price,
            candleTime: snap.candleTime,
            h4EmaFast: snap.h4EmaFast,
            h4EmaSlow: snap.h4EmaSlow,
            h1EmaFast: snap.h1EmaFast,
            h1Rsi: snap.h1Rsi,
            h1Atr: snap.h1Atr,
            invalid: null,
            reward2r: null,
        };
        if (trend === "RANGE") {
            return Object.assign({}, base, {
                call: "STAND ASIDE",
                why: "4h has no trend. EMA21 and EMA55 are tangled, or price is sitting between them. Longs and shorts both get chopped up here.",
            });
        }
        const bullish = snap.h1Close > snap.h1Open;
        const bearish = snap.h1Close < snap.h1Open;
        const rsiUp = snap.h1Rsi > snap.h1RsiPrev;
        const rsiDown = snap.h1Rsi < snap.h1RsiPrev;
        const rsiMid = snap.h1Rsi >= RSI_LOW && snap.h1Rsi <= RSI_HIGH;
        const taggedSupport = Math.min.apply(null, snap.recentLows) <= snap.h1EmaFast * (1 + EMA_TAG);
        const taggedResistance = Math.max.apply(null, snap.recentHighs) >= snap.h1EmaFast * (1 - EMA_TAG);
        const backAbove = snap.h1Close > snap.h1EmaFast;
        const backBelow = snap.h1Close < snap.h1EmaFast;

        if (trend === "LONG") {
            if (taggedSupport && backAbove && bullish && rsiMid && rsiUp) {
                const sketch = levels("LONG", snap.price, Math.min.apply(null, snap.recentLows), snap.h1Atr);
                return Object.assign({}, base, sketch, {
                    call: "LONG",
                    why: "4h trend is up. On the 1h, price tagged EMA21 and closed back above it on a bullish bar, with RSI turning up inside 38–62.",
                });
            }
            let why;
            if (snap.h1Rsi >= RSI_STRETCHED && snap.h1Close > snap.h1EmaFast) {
                why = "4h is up, but 1h RSI is stretched. Wait for a pullback to EMA21.";
            } else if (!backAbove && snap.h1Rsi < RSI_LOW) {
                why = "4h is up, but the 1h pullback is deep and RSI is weak. Wait for a bullish close back above EMA21 with RSI turning up.";
            } else if (!backAbove) {
                why = "4h is up and price is under the 1h EMA21. Wait for a bullish close back above it.";
            } else if (!taggedSupport) {
                why = "4h is up, and price has not come back to the 1h EMA21 yet.";
            } else {
                why = "4h is up and price tagged the 1h EMA21, but " + unconfirmed(bullish, rsiMid, rsiUp, snap.h1Rsi, true);
            }
            return Object.assign({}, base, { call: "WAIT", why: why });
        }

        if (taggedResistance && backBelow && bearish && rsiMid && rsiDown) {
            const sketch = levels("SHORT", snap.price, Math.max.apply(null, snap.recentHighs), snap.h1Atr);
            return Object.assign({}, base, sketch, {
                call: "SHORT",
                why: "4h trend is down. On the 1h, price tagged EMA21 and closed back below it on a bearish bar, with RSI turning down inside 38–62.",
            });
        }
        let why;
        if (snap.h1Rsi <= 100 - RSI_STRETCHED && snap.h1Close < snap.h1EmaFast) {
            why = "4h is down, but 1h RSI is washed out. Wait for a bounce to EMA21.";
        } else if (!backBelow && snap.h1Rsi > 100 - RSI_LOW) {
            why = "4h is down, but the 1h bounce is strong and RSI is hot. Wait for a bearish close back under EMA21 with RSI turning down.";
        } else if (!backBelow) {
            why = "4h is down and price is above the 1h EMA21. Wait for a bearish close back under it.";
        } else if (!taggedResistance) {
            why = "4h is down, and price has not bounced to the 1h EMA21 yet.";
        } else {
            why = "4h is down and price tagged the 1h EMA21, but " + unconfirmed(bearish, rsiMid, rsiDown, snap.h1Rsi, false);
        }
        return Object.assign({}, base, { call: "WAIT", why: why });
    }

    function indicators(candles) {
        const closes = candles.map(function (c) { return c.close; });
        return {
            emaFast: ema(closes, EMA_FAST),
            emaSlow: ema(closes, EMA_SLOW),
            rsi: rsi(closes, RSI_PERIOD),
            atr: atr(candles, ATR_PERIOD),
        };
    }

    function h4IndexFor(h4, hourOpen) {
        const hourClose = hourOpen + 3600;
        let idx = -1;
        for (let j = 0; j < h4.length; j++) {
            if (h4[j].time + 14400 <= hourClose) idx = j;
            else break;
        }
        return idx;
    }

    function snapshotAt(h1, h4, i, h1x, h4x, j) {
        const bar = h1[i];
        const window = h1.slice(Math.max(0, i - 2), i + 1);
        return {
            price: bar.close,
            candleTime: bar.time,
            h4Close: h4[j].close,
            h4EmaFast: h4x.emaFast[j],
            h4EmaSlow: h4x.emaSlow[j],
            h1Open: bar.open,
            h1Close: bar.close,
            h1EmaFast: h1x.emaFast[i],
            h1Rsi: h1x.rsi[i],
            h1RsiPrev: h1x.rsi[i - 1],
            h1Atr: h1x.atr[i],
            recentLows: window.map(function (c) { return c.low; }),
            recentHighs: window.map(function (c) { return c.high; }),
        };
    }

    function usable(snap) {
        return [snap.h4EmaFast, snap.h4EmaSlow, snap.h1EmaFast, snap.h1Rsi, snap.h1RsiPrev, snap.h1Atr]
            .every(function (v) { return v != null; });
    }

    function splitLive(rows) {
        if (rows.length < 2) return { closed: rows.slice(), live: null };
        return { closed: rows.slice(0, -1), live: rows[rows.length - 1] };
    }

    function evaluate(h1Closed, h4Closed) {
        if (h1Closed.length < EMA_SLOW + RSI_PERIOD || h4Closed.length < EMA_SLOW + 2) {
            throw new Error("not enough closed candles");
        }
        const h1x = indicators(h1Closed);
        const h4x = indicators(h4Closed);
        const i = h1Closed.length - 1;
        const j = h4Closed.length - 1;
        const snap = snapshotAt(h1Closed, h4Closed, i, h1x, h4x, j);
        if (!usable(snap)) throw new Error("indicators are not warmed up");
        return decide(snap);
    }

    function markers(h1Closed, h4Closed) {
        const h1x = indicators(h1Closed);
        const h4x = indicators(h4Closed);
        const marks = [];
        for (let i = RSI_PERIOD + 1; i < h1Closed.length; i++) {
            const j = h4IndexFor(h4Closed, h1Closed[i].time);
            if (j < EMA_SLOW) continue;
            const snap = snapshotAt(h1Closed, h4Closed, i, h1x, h4x, j);
            if (!usable(snap) || snap.recentLows.length < 3) continue;
            const call = decide(snap);
            if (call.call !== "LONG" && call.call !== "SHORT") continue;
            marks.push({
                time: h1Closed[i].time,
                position: call.call === "LONG" ? "belowBar" : "aboveBar",
                color: call.call === "LONG" ? "#00ff88" : "#ff3366",
                shape: call.call === "LONG" ? "arrowUp" : "arrowDown",
            });
        }
        return marks;
    }

    function rowsToCandles(rows) {
        return rows.map(function (row) {
            return {
                time: Number(row[0]),
                open: Number(row[1]),
                high: Number(row[2]),
                low: Number(row[3]),
                close: Number(row[4]),
            };
        });
    }

    async function fetchOhlc(interval) {
        const response = await fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=" + interval);
        if (!response.ok) throw new Error("Kraken OHLC " + response.status);
        const payload = await response.json();
        if (payload.error && payload.error.length) throw new Error(payload.error.join(", "));
        const pair = Object.keys(payload.result).find(function (key) { return key !== "last"; });
        return rowsToCandles(payload.result[pair]);
    }

    async function fetchTicker() {
        const response = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
        if (!response.ok) throw new Error("Kraken ticker " + response.status);
        const payload = await response.json();
        if (payload.error && payload.error.length) throw new Error(payload.error.join(", "));
        const pair = Object.keys(payload.result)[0];
        return Number(payload.result[pair].c[0]);
    }

    function money(value) {
        return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function when(epoch) {
        return new Intl.DateTimeFormat("en-US", {
            timeZone: TZ,
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
        }).format(new Date(epoch * 1000));
    }

    function bannerItems(call, extras) {
        const live = extras || {};
        const items = [
            { kind: "call", text: call.call, tone: call.call.toLowerCase().replace(/\s+/g, "-") },
            { kind: "why", text: call.why },
            { kind: "fact", label: "Live", text: live.liveText || "…" },
            { kind: "fact", label: "Closed hour", text: money(call.price) },
            { kind: "fact", label: "Hour", text: when(call.candleTime) },
            { kind: "fact", label: "4h trend", text: call.regime, tone: call.regime },
            { kind: "fact", label: "4h EMA21", text: money(call.h4EmaFast) },
            { kind: "fact", label: "4h EMA55", text: money(call.h4EmaSlow) },
            { kind: "fact", label: "1h EMA21", text: money(call.h1EmaFast) },
            { kind: "fact", label: "21-day", text: live.dayFast || "…", line: "day21" },
            { kind: "fact", label: "200-day", text: live.daySlow || "…", line: "day200" },
            { kind: "fact", label: "1h RSI", text: call.h1Rsi.toFixed(1) },
            { kind: "fact", label: "1h ATR", text: money(call.h1Atr) },
        ];
        if (call.invalid != null) {
            items.push({ kind: "fact", label: "Invalid", text: money(call.invalid) });
            items.push({ kind: "fact", label: "2R sketch", text: money(call.reward2r) });
        }
        items.push({
            kind: "why",
            text: "Yellow is the 1-hour EMA21. Blue is the 21-day. White is the 200-day. Nothing on this page sends an order.",
        });
        return items;
    }

    function mount(document) {
        const chartEl = document.getElementById("chart");
        if (!chartEl || typeof LightweightCharts === "undefined") return;
        const tickerEl = document.getElementById("ticker");
        const tickerLiveEl = document.getElementById("ticker-live");
        const statusEl = document.getElementById("status");
        const chart = LightweightCharts.createChart(chartEl, {
            autoSize: true,
            layout: {
                background: { color: "#0a0a0a" },
                textColor: "#9a9a9a",
                fontFamily: "JetBrains Mono, ui-monospace, monospace",
            },
            grid: {
                vertLines: { color: "#1c1c1c" },
                horzLines: { color: "#1c1c1c" },
            },
            rightPriceScale: { borderColor: "#2a2a2a" },
            timeScale: { borderColor: "#2a2a2a", timeVisible: true, secondsVisible: false },
            localization: {
                timeFormatter: function (timestamp) { return when(timestamp); },
            },
            crosshair: {
                vertLine: { color: "#3a3a3a" },
                horzLine: { color: "#3a3a3a" },
            },
        });
        const series = chart.addCandlestickSeries({
            upColor: "#00ff88",
            downColor: "#ff3366",
            borderUpColor: "#00ff88",
            borderDownColor: "#ff3366",
            wickUpColor: "#00ff88",
            wickDownColor: "#ff3366",
        });
        const emaLine = chart.addLineSeries({
            color: "#f5c542",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        const dayFastLine = chart.addLineSeries({
            color: "#5eb1ff",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        const daySlowLine = chart.addLineSeries({
            color: "#f4f4f4",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
        });

        const view = {
            h1: [],
            call: null,
            seen: false,
        };

        function renderTicker(items) {
            if (!tickerEl) return;
            tickerEl.replaceChildren();
            for (let copy = 0; copy < 2; copy++) {
                const seq = document.createElement("div");
                seq.className = "ticker-seq";
                if (copy === 1) seq.setAttribute("aria-hidden", "true");
                items.forEach(function (item) {
                    const span = document.createElement("span");
                    span.className = "ticker-item " + item.kind;
                    if (item.label) {
                        const label = document.createElement("span");
                        label.className = "k";
                        label.textContent = item.label;
                        span.append(label);
                    }
                    const value = document.createElement("span");
                    value.textContent = item.text;
                    if (item.tone) value.dataset.tone = item.tone;
                    if (item.line) value.dataset.line = item.line;
                    span.append(value);
                    seq.append(span);
                });
                tickerEl.append(seq);
            }
            if (tickerLiveEl) {
                const callItem = items.filter(function (item) { return item.kind === "call"; })[0];
                const priceItem = items.filter(function (item) { return item.label === "Live"; })[0];
                const parts = [];
                if (callItem) parts.push(callItem.text);
                if (priceItem) parts.push(priceItem.label + " " + priceItem.text);
                tickerLiveEl.textContent = parts.join(". ");
            }
        }

        function paint(call) {
            view.call = call;
            renderTicker(bannerItems(call, {
                liveText: view.livePrice == null ? "…" : money(view.livePrice),
                dayFast: view.dayFast == null ? "…" : money(view.dayFast),
                daySlow: view.daySlow == null ? "…" : money(view.daySlow),
            }));
        }

        function barsForChart() {
            const bars = view.forming ? view.h1.concat([Object.assign({}, view.forming)]) : view.h1.map(function (bar) {
                return Object.assign({}, bar);
            });
            if (view.livePrice != null && view.forming && bars.length) {
                const last = bars[bars.length - 1];
                last.high = Math.max(last.high, view.livePrice);
                last.low = Math.min(last.low, view.livePrice);
                last.close = view.livePrice;
            }
            return bars;
        }

        function drawCandles() {
            const bars = barsForChart();
            series.setData(bars);
            const fast = ema(view.h1.map(function (c) { return c.close; }), EMA_FAST);
            emaLine.setData(view.h1.map(function (c, i) {
                return fast[i] == null ? null : { time: c.time, value: fast[i] };
            }).filter(Boolean));
            const extendTo = bars.length ? bars[bars.length - 1].time : 0;
            const fromTime = view.h1.length ? view.h1[0].time : 0;
            const dayFast = dailyLine(view.days || [], DAY_FAST, extendTo, fromTime);
            const daySlow = dailyLine(view.days || [], DAY_SLOW, extendTo, fromTime);
            dayFastLine.setData(dayFast);
            daySlowLine.setData(daySlow);
            view.dayFast = dayFast.length ? dayFast[dayFast.length - 1].value : null;
            view.daySlow = daySlow.length ? daySlow[daySlow.length - 1].value : null;
            if (view.marks) series.setMarkers(view.marks);
            if (!view.seen && bars.length) {
                chart.timeScale().setVisibleLogicalRange({
                    from: Math.max(0, bars.length - 96),
                    to: bars.length + 2,
                });
                view.seen = true;
            }
            if (view.call) paint(view.call);
        }

        function drawLive() {
            const bars = barsForChart();
            if (!bars.length) return;
            series.update(bars[bars.length - 1]);
            if (view.call) paint(view.call);
        }

        async function refreshCandles() {
            const [h1, h4, days] = await Promise.all([fetchOhlc(60), fetchOhlc(240), fetchOhlc(1440)]);
            const hour = splitLive(h1);
            const four = splitLive(h4);
            view.h1 = hour.closed;
            view.forming = hour.live;
            view.h4 = four.closed;
            view.days = splitLive(days).closed;
            view.call = evaluate(hour.closed, four.closed);
            view.marks = markers(hour.closed, four.closed);
            statusEl.textContent = "live";
            statusEl.dataset.state = "live";
            drawCandles();
        }

        async function refreshTicker() {
            view.livePrice = await fetchTicker();
            if (!view.h1.length) return;
            if (view.call && statusEl.dataset.state !== "live") {
                statusEl.textContent = "live";
                statusEl.dataset.state = "live";
            }
            drawLive();
        }

        async function tick(kind) {
            try {
                if (kind === "candles") await refreshCandles();
                else await refreshTicker();
            } catch (error) {
                statusEl.textContent = "reconnect";
                statusEl.dataset.state = "down";
                renderTicker([{ kind: "why", text: error.message }]);
            }
        }

        tick("candles");
        tick("ticker");
        setInterval(function () { tick("candles"); }, 15000);
        setInterval(function () { tick("ticker"); }, 5000);
    }

    return {
        sma: sma,
        dailyLine: dailyLine,
        ema: ema,
        rsi: rsi,
        atr: atr,
        regime: regime,
        decide: decide,
        evaluate: evaluate,
        markers: markers,
        splitLive: splitLive,
        bannerItems: bannerItems,
        fetchOhlc: fetchOhlc,
        mount: mount,
    };
});
