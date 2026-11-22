/* Live Kraken book. Heatmap, prints, and the day's move.
   The desk call is a prior. This page never sends an order. */
(function (factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (typeof window !== "undefined") {
        window.Book = api;
        api.prepare(document);
        window.addEventListener("DOMContentLoaded", function () {
            if (document.getElementById("book")) api.mount(document);
        });
    }
})(function () {
    const BOOK_DEPTH = 1000;
    const REST_DEPTH = 500;
    const WINDOW_MS = 10 * 60 * 1000;
    const KEEP_MS = 30 * 60 * 1000;
    const SAMPLE_MS = 500;
    const TAPE_QTY = 2;
    const BIN = 1;
    const STORE_HALF = 800;
    const PRICE_WINDOW = { tight: 60, near: 200, wide: 500, far: 1000 };
    const TZ = "America/Phoenix";
    const PAIR = "BTC/USD";
    let latestCall = null;
    let latestStall = "";
    const callListeners = [];
    const ohlcListeners = [];

    function emitCall() {
        for (let i = 0; i < callListeners.length; i++) callListeners[i](latestCall, latestStall);
    }

    function publishCall(call) {
        latestCall = call;
        latestStall = "";
        emitCall();
    }

    function publishStall(message) {
        latestStall = message || stallNote(!!(latestCall && latestCall.call));
        emitCall();
    }

    function currentCall() {
        return latestCall;
    }

    function onCall(fn) {
        callListeners.push(fn);
        if (latestCall || latestStall) fn(latestCall, latestStall);
    }

    function onOhlc(fn) {
        ohlcListeners.push(fn);
    }

    function emitOhlc(row) {
        for (let i = 0; i < ohlcListeners.length; i++) ohlcListeners[i](row);
    }

    function deskLean(call) {
        if (!call) return "flat";
        if (call.call === "LONG") return "up";
        if (call.call === "SHORT") return "down";
        if (call.call === "WAIT" && call.regime === "LONG") return "up";
        if (call.call === "WAIT" && call.regime === "SHORT") return "down";
        return "flat";
    }

    function bookSource(share, deltaQty) {
        if (share == null || !Number.isFinite(share) || !Number.isFinite(deltaQty)) return "flat";
        if (share >= 0.55 && deltaQty >= 0) return "book";
        if (share <= 0.45 && deltaQty <= 0) return "book";
        if (Math.abs(deltaQty) >= TAPE_QTY && share > 0.45 && share < 0.55) return "tape";
        return "flat";
    }

    function bookLean(share, deltaQty) {
        const source = bookSource(share, deltaQty);
        if (source === "flat") return "flat";
        if (source === "tape") return deltaQty > 0 ? "up" : "down";
        if (share >= 0.55 && deltaQty >= 0) return "up";
        if (share <= 0.45 && deltaQty <= 0) return "down";
        return "flat";
    }

    function deskPhrase(call) {
        if (!call) return "The desk has not called yet";
        if (call.call === "LONG") return "The desk calls long";
        if (call.call === "SHORT") return "The desk calls short";
        if (call.call === "WAIT" && call.regime === "LONG") return "The desk is waiting on a long";
        if (call.call === "WAIT" && call.regime === "SHORT") return "The desk is waiting on a short";
        return "The desk is standing aside";
    }

    function prejudge(call, book) {
        const tape = book || {};
        const desk = deskLean(call);
        const side = bookLean(tape.share, tape.deltaQty);
        const from = bookSource(tape.share, tape.deltaQty);
        const phrase = deskPhrase(call);
        let path = "flat";
        let text;
        if (!call) {
            text = phrase + ".";
        } else if (desk === "flat" && side === "flat") {
            text = phrase + ", and the book is two-sided. No path yet.";
        } else if (desk === "flat") {
            path = side;
            text = phrase + ". The book alone leans " + side + ", so that is only a short-term read.";
        } else if (side === "flat") {
            path = desk;
            text = phrase + ". The book has not confirmed it.";
        } else if (desk === side) {
            path = desk;
            text = phrase + ", and the book agrees. Path is " + side + ".";
        } else {
            text = phrase + ", but the book is leaning " + side + ". The move is not confirmed.";
        }
        if (path === "down" && tape.bidWall) {
            text += " A bid wall at " + formatPrice(tape.bidWall.price) + " can catch the drop.";
        }
        if (path === "up" && tape.askWall) {
            text += " An ask wall at " + formatPrice(tape.askWall.price) + " can stall the rise.";
        }
        if (from === "tape") text += " The lean is from the tape.";
        return { desk: desk, book: side, path: path, from: from, text: text };
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function createBook(depth) {
        return {
            bids: new Map(),
            asks: new Map(),
            depth: depth || BOOK_DEPTH,
            wireBids: {},
            wireAsks: {},
        };
    }

    function createTape() {
        return { trades: [], seen: new Set() };
    }

    function createState() {
        return {
            book: createBook(BOOK_DEPTH),
            columns: [],
            tape: createTape(),
            grid: null,
            view: null,
            mode: "near",
            spanMs: WINDOW_MS,
            stall: "",
            daySource: null,
            peak: null,
            restored: null,
            historyApplied: false,
            anchor: null,
            open: null,
            last: null,
            mid: null,
        };
    }

    function setLevel(map, price, qty) {
        const p = Number(price);
        const q = Number(qty);
        if (!Number.isFinite(p) || !Number.isFinite(q)) return;
        if (q <= 0) map.delete(p);
        else map.set(p, q);
    }

    function applyLevels(map, levels) {
        if (!levels) return;
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            if (Array.isArray(level)) setLevel(map, level[0], level[1]);
            else setLevel(map, level.price, level.qty);
        }
    }

    function truncate(map, depth, descending) {
        if (map.size <= depth) return;
        const prices = Array.from(map.keys()).sort(function (a, b) {
            return descending ? b - a : a - b;
        });
        for (let i = depth; i < prices.length; i++) map.delete(prices[i]);
    }

    function applySnapshot(book, bids, asks) {
        book.bids = new Map();
        book.asks = new Map();
        applyLevels(book.bids, bids);
        applyLevels(book.asks, asks);
        truncate(book.bids, book.depth, true);
        truncate(book.asks, book.depth, false);
        return book;
    }

    function applyUpdate(book, bids, asks) {
        applyLevels(book.bids, bids);
        applyLevels(book.asks, asks);
        truncate(book.bids, book.depth, true);
        truncate(book.asks, book.depth, false);
        return book;
    }

    function bestBid(book) {
        let best = null;
        for (const price of book.bids.keys()) {
            if (best == null || price > best) best = price;
        }
        return best;
    }

    function bestAsk(book) {
        let best = null;
        for (const price of book.asks.keys()) {
            if (best == null || price < best) best = price;
        }
        return best;
    }

    function bookRange(book) {
        let bid = null;
        let ask = null;
        let low = null;
        let high = null;
        for (const price of book.bids.keys()) {
            if (bid == null || price > bid) bid = price;
            if (low == null || price < low) low = price;
        }
        for (const price of book.asks.keys()) {
            if (ask == null || price < ask) ask = price;
            if (high == null || price > high) high = price;
        }
        if (bid == null || ask == null) return null;
        return { bid: bid, ask: ask, low: low, high: high, mid: (bid + ask) / 2 };
    }

    function shiftArrays(src, rows, shift) {
        const dest = new Float32Array(rows);
        for (let i = 0; i < src.length; i++) {
            const j = i + shift;
            if (j >= 0 && j < rows) dest[j] = src[i];
        }
        return dest;
    }

    function settleGrid(grid, columns, view) {
        const rows = STORE_HALF * 2;
        const mid = (view.low + view.high) / 2;
        const low = Math.round(mid) - STORE_HALF;
        if (!grid) return { low: low, bin: BIN, rows: rows };
        const pad = 15;
        const inside = view.low >= grid.low + pad && view.high <= grid.low + grid.rows * grid.bin - pad;
        if (inside && grid.rows === rows && grid.bin === BIN) return grid;
        const shift = Math.round((grid.low - low) / BIN);
        if (shift !== 0 || grid.rows !== rows) {
            for (let i = 0; i < columns.length; i++) {
                columns[i].bids = shiftArrays(columns[i].bids, rows, shift);
                columns[i].asks = shiftArrays(columns[i].asks, rows, shift);
            }
        }
        return { low: low, bin: BIN, rows: rows };
    }

    function sampleColumn(book, grid, now, last) {
        const bids = new Float32Array(grid.rows);
        const asks = new Float32Array(grid.rows);
        function paint(map, dest) {
            for (const [price, qty] of map) {
                const i = Math.floor((price - grid.low) / grid.bin);
                if (i < 0 || i >= grid.rows) continue;
                dest[i] += qty;
            }
        }
        paint(book.bids, bids);
        paint(book.asks, asks);
        return {
            t: now,
            bids: bids,
            asks: asks,
            bestBid: bestBid(book),
            bestAsk: bestAsk(book),
            last: last,
        };
    }

    function sampleBook(state, now) {
        const span = bookRange(state.book);
        if (!span) return null;
        state.mid = span.mid;
        if (state.anchor == null) state.anchor = span.mid;
        state.view = holdView(state.view, span.mid, state.mode);
        const prevLow = state.grid ? state.grid.low : null;
        const prevRows = state.grid ? state.grid.rows : null;
        state.grid = settleGrid(state.grid, state.columns, state.view);
        if (state.peak && prevLow != null && (prevLow !== state.grid.low || prevRows !== state.grid.rows)) {
            const shift = Math.round((prevLow - state.grid.low) / BIN);
            state.peak.bids = shiftArrays(state.peak.bids, state.grid.rows, shift);
            state.peak.asks = shiftArrays(state.peak.asks, state.grid.rows, shift);
        }
        raisePeak(state);
        const mark = state.last == null ? span.mid : state.last;
        const column = sampleFromPeak(state, now, mark);
        if (state.restored && !state.historyApplied) {
            const older = unpackHistory(state.restored, state.grid).filter(function (col) {
                return col.t < column.t && col.t >= now - KEEP_MS;
            });
            state.columns = older.concat(state.columns);
            state.historyApplied = true;
            state.restored = null;
        }
        state.columns.push(column);
        decayPeak(state);
        const cutoff = now - KEEP_MS;
        while (state.columns.length && state.columns[0].t < cutoff) state.columns.shift();
        return column;
    }

    function viewBounds(mid, mode) {
        const span = PRICE_WINDOW[mode] || PRICE_WINDOW.near;
        const half = span / 2;
        return { low: mid - half, high: mid + half };
    }

    function holdView(current, mid, mode) {
        const next = viewBounds(mid, mode);
        if (!current) return next;
        const span = current.high - current.low;
        if (Math.abs(span - (next.high - next.low)) > 0.5) return next;
        const edge = span * 0.18;
        if (mid > current.low + edge && mid < current.high - edge) return current;
        return next;
    }

    function columnAtTime(columns, t) {
        let lo = 0;
        let hi = columns.length - 1;
        let ans = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (columns[mid].t <= t) {
                ans = mid;
                lo = mid + 1;
            } else hi = mid - 1;
        }
        return ans;
    }

    function timeWindow(columns, now, spanMs) {
        const minSpan = 15000;
        const want = spanMs || WINDOW_MS;
        if (!columns.length) return { t0: now - minSpan, t1: now };
        const recorded = Math.max(0, now - columns[0].t);
        const span = Math.min(want, Math.max(minSpan, recorded));
        return { t0: now - span, t1: now };
    }

    function percentile(values, p) {
        if (!values.length) return 1;
        const copy = values.slice().sort(function (a, b) { return a - b; });
        const idx = Math.min(copy.length - 1, Math.max(0, Math.ceil(p * copy.length) - 1));
        return copy[idx] || 1;
    }

    function visibleCap(columns, grid, view) {
        const values = [];
        const i0 = Math.max(0, Math.floor((view.low - grid.low) / grid.bin));
        const i1 = Math.min(grid.rows, Math.ceil((view.high - grid.low) / grid.bin));
        for (let c = 0; c < columns.length; c++) {
            const col = columns[c];
            for (let i = i0; i < i1; i++) {
                if (col.bids[i] > 0) values.push(col.bids[i]);
                if (col.asks[i] > 0) values.push(col.asks[i]);
            }
        }
        const cap = percentile(values, 0.95);
        return cap > 0 ? cap : 1;
    }

    function intensity(qty, cap) {
        if (qty <= 0) return 0;
        const denom = Math.log1p(Math.max(cap, qty));
        if (denom === 0) return 0;
        return Math.log1p(qty) / denom;
    }

    function heatColor(qty, cap) {
        const t = intensity(qty, cap);
        const stops = [
            [0, [12, 28, 72]],
            [0.35, [36, 92, 210]],
            [0.6, [150, 60, 190]],
            [0.82, [230, 60, 48]],
            [1, [255, 236, 160]],
        ];
        let i = 0;
        while (i < stops.length - 2 && t > stops[i + 1][0]) i += 1;
        const left = stops[i];
        const right = stops[i + 1];
        const u = (t - left[0]) / ((right[0] - left[0]) || 1);
        return [
            Math.round(lerp(left[1][0], right[1][0], u)),
            Math.round(lerp(left[1][1], right[1][1], u)),
            Math.round(lerp(left[1][2], right[1][2], u)),
        ];
    }

    function heatImage(width, height, grid, view, columns, t0, t1, cap) {
        const data = new Uint8ClampedArray(width * height * 4);
        const spanT = t1 - t0 || 1;
        const spanP = view.high - view.low || 1;
        for (let y = 0; y < height; y++) {
            const price = view.high - ((y + 0.5) / height) * spanP;
            const row = Math.floor((price - grid.low) / grid.bin);
            for (let x = 0; x < width; x++) {
                const t = t0 + ((x + 0.5) / width) * spanT;
                let idx = columnAtTime(columns, t);
                if (idx < 0 && columns.length) idx = 0;
                const o = (y * width + x) * 4;
                let color = [10, 10, 10];
                if (idx >= 0 && row >= 0 && row < grid.rows) {
                    const col = columns[idx];
                    const qty = Math.max(col.bids[row] || 0, col.asks[row] || 0);
                    if (qty > 0) color = heatColor(qty, cap);
                }
                data[o] = color[0];
                data[o + 1] = color[1];
                data[o + 2] = color[2];
                data[o + 3] = 255;
            }
        }
        return data;
    }

    function bandQty(map, low, high) {
        let qty = 0;
        for (const [price, q] of map) {
            if (price >= low && price <= high) qty += q;
        }
        return qty;
    }

    function bidShare(bidQty, askQty) {
        const total = bidQty + askQty;
        if (total <= 0) return null;
        return bidQty / total;
    }

    function topLevel(map, low, high) {
        let best = null;
        for (const [price, qty] of map) {
            if (price < low || price > high) continue;
            if (!best || qty > best.qty) best = { price: price, qty: qty };
        }
        return best;
    }

    function gains(open, last) {
        if (!Number.isFinite(open) || !Number.isFinite(last) || open === 0) return null;
        const usd = last - open;
        return { usd: usd, pct: (usd / open) * 100 };
    }

    function tradeKey(trade) {
        if (trade.id != null && trade.id !== "") return "id|" + trade.id;
        return [
            trade.side,
            trade.price.toFixed(1),
            trade.qty.toFixed(8),
            Math.round(trade.t / 1000),
        ].join("|");
    }

    function rememberTrades(tape, trades) {
        const added = [];
        for (let i = 0; i < trades.length; i++) {
            const trade = trades[i];
            const key = tradeKey(trade);
            if (tape.seen.has(key)) continue;
            tape.seen.add(key);
            tape.trades.push(trade);
            added.push(trade);
        }
        return added;
    }

function pruneTrades(tape, cutoff) {
    let stale = false;
    for (let i = 0; i < tape.trades.length; i++) {
        if (tape.trades[i].t < cutoff) {
            stale = true;
            break;
        }
    }
    if (!stale) return;
    tape.trades = tape.trades.filter(function (trade) { return trade.t >= cutoff; });
    tape.seen = new Set(tape.trades.map(tradeKey));
}

    function deltaInWindow(trades, t0, t1) {
        let qty = 0;
        let usd = 0;
        for (let i = 0; i < trades.length; i++) {
            const trade = trades[i];
            if (trade.t < t0 || trade.t > t1) continue;
            const sign = trade.side === "buy" ? 1 : -1;
            qty += sign * trade.qty;
            usd += sign * trade.qty * trade.price;
        }
        return { qty: qty, usd: usd };
    }

    function cvdSeries(trades, t0, t1, steps) {
        const sorted = trades.filter(function (trade) {
            return trade.t >= t0 && trade.t <= t1;
        }).sort(function (a, b) { return a.t - b.t; });
        const out = new Float64Array(steps);
        const span = t1 - t0 || 1;
        let i = 0;
        let sum = 0;
        for (let s = 0; s < steps; s++) {
            const t = t0 + ((s + 1) / steps) * span;
            while (i < sorted.length && sorted[i].t <= t) {
                sum += (sorted[i].side === "buy" ? 1 : -1) * sorted[i].qty;
                i += 1;
            }
            out[s] = sum;
        }
        return out;
    }

    function tradeRadius(qty, cap, dpr) {
        const scale = dpr || 1;
        const t = Math.sqrt(Math.min(1, qty / Math.max(cap, 1e-8)));
        return (1.6 + t * 6.5) * scale;
    }

    function priceStep(span) {
        const raw = span / 7;
        const steps = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500];
        for (let i = 0; i < steps.length; i++) {
            if (steps[i] >= raw) return steps[i];
        }
        return 2500;
    }

    function signOf(value) {
        if (value > 0) return "up";
        if (value < 0) return "down";
        return "flat";
    }

    function formatSignedMoney(value) {
        const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (value > 0) return "+$" + abs;
        if (value < 0) return "-$" + abs;
        return "$" + abs;
    }

    function formatPct(value) {
        const shown = Math.abs(value) < 0.005 ? 0 : value;
        const body = Math.abs(shown).toFixed(2) + "%";
        if (shown > 0) return "+" + body;
        if (shown < 0) return "-" + body;
        return body;
    }

    function formatGain(gain) {
        if (!gain) return "…";
        return formatSignedMoney(gain.usd) + " · " + formatPct(gain.pct);
    }

    function formatCoin(value, signed) {
        const abs = Math.abs(value);
        const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
        const body = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
        if (!signed) return body;
        if (value > 0) return "+" + body;
        if (value < 0) return "-" + body;
        return body;
    }

    function formatPrice(value, digits) {
        const places = digits == null ? (Math.abs(value) >= 1000 ? 1 : 2) : digits;
        return "$" + value.toLocaleString("en-US", {
            minimumFractionDigits: places,
            maximumFractionDigits: places,
        });
    }

    function resultPair(result) {
        const keys = Object.keys(result);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] !== "last") return keys[i];
        }
        return null;
    }

    function parseBookMessage(message) {
        if (!message || message.channel !== "book" || !message.data || !message.data.length) return null;
        const row = message.data[0];
        if (!row || (message.type !== "snapshot" && message.type !== "update")) return null;
        if (row.symbol && row.symbol !== PAIR) return null;
        return { type: message.type, bids: row.bids || [], asks: row.asks || [] };
    }

    function ingestBook(book, message) {
        const parsed = parseBookMessage(message);
        if (!parsed) return false;
        if (parsed.type === "snapshot") applySnapshot(book, parsed.bids, parsed.asks);
        else applyUpdate(book, parsed.bids, parsed.asks);
        return true;
    }

    function parseTradeMessage(message) {
        if (!message || message.channel !== "trade" || !message.data) return [];
        const out = [];
        for (let i = 0; i < message.data.length; i++) {
            const row = message.data[i];
            if (row.symbol && row.symbol !== PAIR) continue;
            const price = Number(row.price);
            const qty = Number(row.qty);
            const t = Date.parse(row.timestamp);
            if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(t)) continue;
            if (row.side !== "buy" && row.side !== "sell") continue;
            out.push({ side: row.side, price: price, qty: qty, t: t, id: row.trade_id });
        }
        return out;
    }

    function parseRestDepth(payload) {
        if (!payload || !payload.result) return null;
        const pair = resultPair(payload.result);
        if (!pair || !payload.result[pair]) return null;
        return { bids: payload.result[pair].bids || [], asks: payload.result[pair].asks || [] };
    }

    function parseRestTrades(payload) {
        if (!payload || !payload.result) return [];
        const pair = resultPair(payload.result);
        const rows = payload.result[pair];
        if (!rows || !rows.length) return [];
        const out = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const price = Number(row[0]);
            const qty = Number(row[1]);
            const t = Math.round(Number(row[2]) * 1000);
            const side = row[3] === "b" ? "buy" : row[3] === "s" ? "sell" : null;
            if (!side || !Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(t)) continue;
            out.push({ side: side, price: price, qty: qty, t: t });
        }
        return out;
    }

    function parseTicker(payload) {
        if (!payload || !payload.result) return null;
        const pair = Object.keys(payload.result)[0];
        if (!pair) return null;
        const row = payload.result[pair];
        const last = Number(row.c && row.c[0]);
        const open = Number(row.o);
        if (!Number.isFinite(last) || !Number.isFinite(open)) return null;
        return { last: last, open: open };
    }

    function hitTest(box, x, y, view, grid, columns, t0, t1) {
        if (!box || !view || !grid) return null;
        if (x < box.plotX || x >= box.plotX + box.plotW || y < box.plotY || y >= box.plotY + box.plotH) return null;
        const spanT = t1 - t0 || 1;
        const spanP = view.high - view.low || 1;
        const t = t0 + ((x - box.plotX) / box.plotW) * spanT;
        const price = view.high - ((y - box.plotY) / box.plotH) * spanP;
        let idx = columnAtTime(columns, t);
        if (idx < 0 && columns.length) idx = 0;
        let bidQty = 0;
        let askQty = 0;
        if (idx >= 0) {
            const col = columns[idx];
            const row = Math.floor((price - grid.low) / grid.bin);
            if (row >= 0 && row < col.bids.length) {
                bidQty = col.bids[row];
                askQty = col.asks[row];
            }
        }
        return { price: price, t: t, bidQty: bidQty, askQty: askQty };
    }

    function hoverText(hit, clock) {
        if (!hit) return "Hover the book. Brighter bands are more coin resting. Dots are trades.";
        const bid = hit.bidQty ? formatCoin(hit.bidQty) + " bid" : "no bid";
        const ask = hit.askQty ? formatCoin(hit.askQty) + " ask" : "no ask";
        return formatPrice(hit.price) + "  ·  " + clock + "  ·  " + bid + "  ·  " + ask;
    }

    function setDeskView(document, name) {
        if (name !== "chart" && name !== "book" && name !== "both") name = "both";
        if (document.body) document.body.dataset.view = name;
        const buttons = document.querySelectorAll(".views button");
        for (let i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute("aria-pressed", buttons[i].dataset.view === name ? "true" : "false");
        }
        return name;
    }

    function prepare(document) {
        if (!document.querySelector(".views button")) return null;
        let name = "both";
        try {
            const saved = sessionStorage.getItem("btc-desk-view");
            if (saved) name = saved;
        } catch (error) { /* storage off */ }
        return setDeskView(document, name);
    }

    function layoutBox(width, height, dpr) {
        const padL = Math.floor(10 * dpr);
        const padR = Math.floor(8 * dpr);
        const padT = Math.floor(8 * dpr);
        const priceW = Math.floor(86 * dpr);
        const depthW = Math.floor(70 * dpr);
        const timeH = Math.floor(18 * dpr);
        const cvdH = Math.floor(52 * dpr);
        const gap = Math.floor(6 * dpr);
        const plotX = padL;
        const plotY = padT;
        const plotRight = width - padR - priceW - depthW;
        const plotW = Math.max(1, plotRight - plotX);
        const cvdY = height - timeH - cvdH;
        const plotH = Math.max(1, cvdY - gap - plotY);
        const heatW = Math.max(1, Math.min(plotW, 900));
        const heatH = Math.max(1, Math.min(plotH, 500));
        return {
            plotX: plotX,
            plotY: plotY,
            plotW: plotW,
            plotH: plotH,
            plotRight: plotRight,
            depthW: depthW,
            priceW: priceW,
            cvdY: cvdY,
            cvdH: cvdH,
            timeY: height - timeH,
            dpr: dpr,
            width: width,
            height: height,
            heatW: heatW,
            heatH: heatH,
        };
    }

    function mount(document) {
        const canvas = document.getElementById("book-canvas");
        const feedEl = document.getElementById("book-status");
        const hoverEl = document.getElementById("book-hover");
        const dayEl = document.getElementById("gain-day");
        const loadEl = document.getElementById("gain-load");
        const deltaEl = document.getElementById("gain-delta");
        const bookEl = document.getElementById("gain-book");
        const spreadEl = document.getElementById("gain-spread");
        const bidWallEl = document.getElementById("wall-bid");
        const askWallEl = document.getElementById("wall-ask");
        if (!canvas || !feedEl) return;

        const state = createState();
        let source = "none";
        let socket = null;
        let retryMs = 1000;
        let restTimer = 0;
        let stopped = false;
        let depth = BOOK_DEPTH;
        let hover = null;
        let box = null;
        let scratch = null;
        let heatKey = "";
        let drawTimer = 0;
        let lastWire = 0;
        const clockFormat = new Intl.DateTimeFormat("en-US", {
            timeZone: TZ,
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
        });
        const clockFormatMin = new Intl.DateTimeFormat("en-US", {
            timeZone: TZ,
            hour: "numeric",
            minute: "2-digit",
        });

        try {
            const savedMode = sessionStorage.getItem("liquidity-book-mode");
            if (savedMode === "tight" || savedMode === "near" || savedMode === "wide" || savedMode === "far") state.mode = savedMode;
            if (sessionStorage.getItem("liquidity-book-span") === "30") state.spanMs = KEEP_MS;
            const rawHistory = sessionStorage.getItem("liquidity-book-v1");
            if (rawHistory) state.restored = JSON.parse(rawHistory);
        } catch (error) { /* storage off */ }

        function setFeed(name, text) {
            feedEl.dataset.state = name;
            feedEl.textContent = text;
        }

        function setSigned(el, text, value) {
            if (!el) return;
            el.textContent = text;
            el.dataset.sign = value == null || !Number.isFinite(value) ? "flat" : signOf(value);
        }

        function paintStats() {
            const now = Date.now();
            const day = gains(state.open, state.last);
            const since = gains(state.anchor, state.last == null ? state.mid : state.last);
            const flow = deltaInWindow(state.tape.trades, now - WINDOW_MS, now);
            const range = bookRange(state.book);
            let share = null;
            let bidWall = null;
            let askWall = null;
            if (range) {
                const low = state.view ? state.view.low : range.low;
                const high = state.view ? state.view.high : range.high;
                share = bidShare(bandQty(state.book.bids, low, high), bandQty(state.book.asks, low, high));
                const bidRead = wallRead(state.book.bids, low, high, range.mid, "Bid");
                const askRead = wallRead(state.book.asks, low, high, range.mid, "Ask");
                bidWall = bidRead.pick && bidRead.pick.wall ? bidRead.pick : null;
                askWall = askRead.pick && askRead.pick.wall ? askRead.pick : null;
                const bidLabel = document.getElementById("wall-bid-label");
                const askLabel = document.getElementById("wall-ask-label");
                const bookLabel = document.getElementById("book-label");
                const windowName = { tight: "±30", near: "±100", wide: "±250", far: "±500" };
                if (bookLabel) bookLabel.textContent = "Book " + (windowName[state.mode] || "±100");
                if (bidLabel) bidLabel.textContent = bidRead.label;
                if (askLabel) askLabel.textContent = askRead.label;
                if (bidWallEl) bidWallEl.textContent = bidRead.text;
                if (askWallEl) askWallEl.textContent = askRead.text;
                if (spreadEl) spreadEl.textContent = formatPrice(range.ask - range.bid);
            }
            setSigned(dayEl, day ? formatGain(day) : "…", day && day.usd);
            setSigned(loadEl, since ? formatGain(since) : "…", since && since.usd);
            setSigned(deltaEl, formatCoin(flow.qty, true) + " BTC", flow.qty);
            if (deltaEl) deltaEl.title = formatSignedMoney(flow.usd) + " over 10 minutes";
            if (bookEl) {
                bookEl.textContent = share == null ? "…" : Math.round(share * 100) + "% bid";
                bookEl.dataset.sign = share == null ? "flat" : signOf(share - 0.5);
            }
            paintLean(share, flow.qty, bidWall, askWall);
        }

        function paintLean(share, deltaQty, bidWall, askWall) {
            const callEl = document.getElementById("lean-call");
            const textEl = document.getElementById("lean-text");
            const whyEl = document.getElementById("lean-why");
            if (!textEl) return;
            const read = prejudge(state.call, {
                share: share,
                deltaQty: deltaQty,
                bidWall: bidWall,
                askWall: askWall,
            });
            const ready = bannerReady(state.call);
            if (callEl) {
                callEl.textContent = ready ? state.call.call : "…";
                callEl.dataset.tone = ready ? state.call.call.toLowerCase().replace(/\s+/g, "-") : "wait";
            }
            if (!ready) {
                textEl.textContent = state.stall || "The desk has not called yet.";
                textEl.dataset.path = "flat";
                delete textEl.dataset.ready;
            } else {
                textEl.textContent = read.text;
                textEl.dataset.path = read.path;
                textEl.dataset.ready = "yes";
            }
            if (whyEl) {
                const why = ready && state.call.why ? state.call.why : "";
                whyEl.textContent = ready && state.stall ? (why ? why + " " + state.stall : state.stall) : why;
            }
        }

        function markLevel(ctx, price, color, label) {
            if (price == null || price < state.view.low || price > state.view.high) return;
            const y = yOf(price);
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, box.dpr);
            ctx.setLineDash([6 * box.dpr, 4 * box.dpr]);
            ctx.beginPath();
            ctx.moveTo(box.plotX, y);
            ctx.lineTo(box.plotRight, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.textAlign = "left";
            ctx.textBaseline = "bottom";
            ctx.fillText(label, box.plotX + 8 * box.dpr, y - 3 * box.dpr);
            ctx.restore();
        }

        function fail(error) {
            if (source === "ws") return;
            setFeed("down", "reconnect");
            if (hoverEl && !hover) hoverEl.textContent = (error && error.message) || "Kraken book unavailable";
        }

        function scheduleDraw() {
            if (drawTimer) return;
            drawTimer = setTimeout(function () {
                drawTimer = 0;
                requestAnimationFrame(draw);
            }, 70);
        }

        function yOf(price) {
            const span = state.view.high - state.view.low || 1;
            return box.plotY + (1 - (price - state.view.low) / span) * box.plotH;
        }

        function draw() {
            if (!canvas || document.body.dataset.view === "chart") return;
            const cssW = canvas.clientWidth;
            const cssH = canvas.clientHeight;
            if (cssW < 20 || cssH < 20) return;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const width = Math.max(1, Math.floor(cssW * dpr));
            const height = Math.max(1, Math.floor(cssH * dpr));
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
                heatKey = "";
            }
            box = layoutBox(width, height, dpr);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#0a0a0a";
            ctx.fillRect(0, 0, width, height);
            const now = Date.now();
            const windowSpan = timeWindow(state.columns, now, state.spanMs);
            const t0 = windowSpan.t0;
            const t1 = windowSpan.t1;
            const spanMs = t1 - t0 || 1;
            ctx.font = Math.round(11 * dpr) + "px JetBrains Mono, ui-monospace, monospace";

            if (!state.grid || !state.view || !state.columns.length) {
                ctx.fillStyle = "#8d8d8d";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("Waiting for the Kraken book", width / 2, height / 2);
                return;
            }

            const cap = visibleCap(state.columns, state.grid, state.view);
            const key = [
                box.heatW, box.heatH,
                state.view.low.toFixed(2), state.view.high.toFixed(2),
                state.grid.low, state.grid.bin, state.grid.rows,
                state.columns.length,
                state.columns[state.columns.length - 1].t,
            ].join(":");
            if (!scratch || scratch.width !== box.heatW || scratch.height !== box.heatH) {
                scratch = document.createElement("canvas");
                scratch.width = box.heatW;
                scratch.height = box.heatH;
                heatKey = "";
            }
            if (key !== heatKey) {
                const pixels = heatImage(box.heatW, box.heatH, state.grid, state.view, state.columns, t0, t1, cap);
                scratch.getContext("2d").putImageData(new ImageData(pixels, box.heatW, box.heatH), 0, 0);
                heatKey = key;
            }
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(scratch, box.plotX, box.plotY, box.plotW, box.plotH);
            ctx.imageSmoothingEnabled = true;

            ctx.save();
            ctx.beginPath();
            ctx.rect(box.plotX, box.plotY, box.plotW, box.plotH);
            ctx.clip();

            const spanP = state.view.high - state.view.low;
            const step = priceStep(spanP);
            const digits = spanP >= 400 ? 0 : 1;
            ctx.lineWidth = Math.max(1, dpr);
            let price = Math.ceil(state.view.low / step) * step;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            for (; price <= state.view.high; price += step) {
                const y = yOf(price);
                ctx.strokeStyle = "rgba(255,255,255,0.05)";
                ctx.beginPath();
                ctx.moveTo(box.plotX, y);
                ctx.lineTo(box.plotRight, y);
                ctx.stroke();
            }

            function trail(pick, color) {
                ctx.beginPath();
                let started = false;
                for (let i = 0; i < state.columns.length; i++) {
                    const value = pick(state.columns[i]);
                    if (value == null) continue;
                    const x = box.plotX + ((state.columns[i].t - t0) / spanMs) * box.plotW;
                    const y = yOf(value);
                    if (!started) {
                        ctx.moveTo(x, y);
                        started = true;
                    } else ctx.lineTo(x, y);
                }
                if (!started) return;
                ctx.strokeStyle = color;
                ctx.stroke();
            }
            ctx.lineWidth = Math.max(1, dpr);
            trail(function (col) { return col.bestBid; }, "rgba(94, 177, 255, 0.9)");
            trail(function (col) { return col.bestAsk; }, "rgba(255, 51, 102, 0.9)");
            ctx.lineWidth = Math.max(1.25, 1.25 * dpr);
            trail(function (col) { return col.last; }, "#f4f4f4");

            const tradeCap = visibleTradeCap(state.tape.trades, t0, t1);
            for (let i = 0; i < state.tape.trades.length; i++) {
                const trade = state.tape.trades[i];
                if (trade.t < t0 || trade.t > t1) continue;
                if (trade.price < state.view.low || trade.price > state.view.high) continue;
                const x = box.plotX + ((trade.t - t0) / spanMs) * box.plotW;
                const y = yOf(trade.price);
                ctx.beginPath();
                ctx.fillStyle = trade.side === "buy" ? "#00ff88" : "#ff3366";
                ctx.arc(x, y, tradeRadius(trade.qty, tradeCap, dpr), 0, Math.PI * 2);
                ctx.fill();
            }
            if (state.call) {
                markLevel(ctx, state.call.h1EmaFast, "#f5c542", "1h EMA21");
                markLevel(ctx, state.call.invalid, "#ff3366", "invalid");
                markLevel(ctx, state.call.reward2r, "#00ff88", "2R");
            }
            ctx.restore();

            const range = bookRange(state.book);
            if (range) {
                const levels = [];
                let maxQty = 0;
                function take(map, side) {
                    for (const [levelPrice, qty] of map) {
                        if (levelPrice < state.view.low || levelPrice > state.view.high) continue;
                        levels.push({ price: levelPrice, qty: qty, side: side });
                        if (qty > maxQty) maxQty = qty;
                    }
                }
                take(state.book.bids, "bid");
                take(state.book.asks, "ask");
                const barH = Math.max(dpr, (state.grid.bin / spanP) * box.plotH * 0.92);
                for (let i = 0; i < levels.length; i++) {
                    const level = levels[i];
                    const w = (Math.log1p(level.qty) / Math.log1p(Math.max(maxQty, level.qty))) * (box.depthW - 4 * dpr);
                    const y = yOf(level.price) - barH / 2;
                    ctx.fillStyle = level.side === "bid" ? "rgba(94, 177, 255, 0.9)" : "rgba(255, 51, 102, 0.9)";
                    ctx.fillRect(box.plotRight + dpr, y, Math.max(dpr, w), barH);
                }
            }

            ctx.fillStyle = "#8d8d8d";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            price = Math.ceil(state.view.low / step) * step;
            for (; price <= state.view.high; price += step) {
                ctx.fillText(formatPrice(price, digits), box.plotRight + box.depthW + Math.floor(6 * dpr), yOf(price));
            }

            const series = cvdSeries(state.tape.trades, t0, t1, Math.max(2, Math.floor(box.plotW / dpr)));
            let peak = 0;
            for (let i = 0; i < series.length; i++) peak = Math.max(peak, Math.abs(series[i]));
            if (peak === 0) peak = 1;
            const midY = box.cvdY + box.cvdH / 2;
            ctx.strokeStyle = "#2a2a2a";
            ctx.beginPath();
            ctx.moveTo(box.plotX, midY);
            ctx.lineTo(box.plotRight, midY);
            ctx.stroke();
            ctx.beginPath();
            for (let i = 0; i < series.length; i++) {
                const x = box.plotX + (i / (series.length - 1)) * box.plotW;
                const y = midY - (series[i] / peak) * (box.cvdH / 2 - 3 * dpr);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = series[series.length - 1] >= 0 ? "#00ff88" : "#ff3366";
            ctx.lineWidth = Math.max(1.25, 1.25 * dpr);
            ctx.stroke();
            ctx.fillStyle = "#8d8d8d";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText("delta", box.plotX, box.cvdY + 2);

            const tickPlan = timeTickPlan(box.plotW, box.dpr, spanMs);
            drawTimeAxis(ctx, box, t0, t1, function (t) {
                return (tickPlan.seconds ? clockFormat : clockFormatMin).format(t);
            });

            if (hover) {
                const hit = hitTest(box, hover.x, hover.y, state.view, state.grid, state.columns, t0, t1);
                if (hit) {
                    ctx.save();
                    ctx.strokeStyle = "rgba(244,244,244,0.45)";
                    ctx.setLineDash([4 * dpr, 3 * dpr]);
                    ctx.beginPath();
                    ctx.moveTo(hover.x, box.plotY);
                    ctx.lineTo(hover.x, box.plotY + box.plotH);
                    ctx.moveTo(box.plotX, hover.y);
                    ctx.lineTo(box.plotRight, hover.y);
                    ctx.stroke();
                    ctx.restore();
                    if (hoverEl) hoverEl.textContent = hoverText(hit, clockFormat.format(hit.t));
                }
            }
        }

        function point(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height || !canvas.width) return;
            hover = {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top) * (canvas.height / rect.height),
            };
            scheduleDraw();
        }

        canvas.addEventListener("mousemove", function (event) { point(event.clientX, event.clientY); });
        canvas.addEventListener("mouseleave", function () {
            hover = null;
            if (hoverEl) hoverEl.textContent = hoverText(null);
            scheduleDraw();
        });
        canvas.addEventListener("touchstart", function (event) {
            if (!event.touches.length) return;
            point(event.touches[0].clientX, event.touches[0].clientY);
        }, { passive: true });
        canvas.addEventListener("touchmove", function (event) {
            if (!event.touches.length) return;
            event.preventDefault();
            point(event.touches[0].clientX, event.touches[0].clientY);
        }, { passive: false });

        const viewButtons = document.querySelectorAll(".views button");
        for (let i = 0; i < viewButtons.length; i++) {
            viewButtons[i].addEventListener("click", function () {
                setDeskView(document, viewButtons[i].dataset.view);
                try { sessionStorage.setItem("btc-desk-view", document.body.dataset.view); } catch (error) {}
                heatKey = "";
                scheduleDraw();
            });
        }
        const modeButtons = document.querySelectorAll("#price-ranges button");
        for (let i = 0; i < modeButtons.length; i++) {
            modeButtons[i].setAttribute("aria-pressed", modeButtons[i].dataset.mode === state.mode ? "true" : "false");
            modeButtons[i].addEventListener("click", function () {
                const mode = modeButtons[i].dataset.mode;
                if (mode === "tight" || mode === "near" || mode === "wide" || mode === "far") state.mode = mode;
                state.view = null;
                const span = bookRange(state.book);
                if (span) state.view = viewBounds(span.mid, state.mode);
                for (let j = 0; j < modeButtons.length; j++) {
                    modeButtons[j].setAttribute("aria-pressed", modeButtons[j].dataset.mode === state.mode ? "true" : "false");
                }
                try { sessionStorage.setItem("liquidity-book-mode", state.mode); } catch (error) {}
                heatKey = "";
                paintStats();
                scheduleDraw();
            });
        }
        const timeButtons = document.querySelectorAll("#time-ranges button");
        for (let i = 0; i < timeButtons.length; i++) {
            const chosen = state.spanMs === KEEP_MS ? "30" : "10";
            timeButtons[i].setAttribute("aria-pressed", timeButtons[i].dataset.span === chosen ? "true" : "false");
            timeButtons[i].addEventListener("click", function () {
                state.spanMs = timeButtons[i].dataset.span === "30" ? KEEP_MS : WINDOW_MS;
                for (let j = 0; j < timeButtons.length; j++) {
                    timeButtons[j].setAttribute("aria-pressed", timeButtons[j].dataset.span === timeButtons[i].dataset.span ? "true" : "false");
                }
                try { sessionStorage.setItem("liquidity-book-span", timeButtons[i].dataset.span); } catch (error) {}
                heatKey = "";
                scheduleDraw();
            });
        }

        async function pullJson(url) {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Kraken " + response.status);
            const payload = await response.json();
            if (payload.error && payload.error.length) throw new Error(payload.error.join(", "));
            return payload;
        }

        async function pullDepth() {
            const payload = await pullJson("https://api.kraken.com/0/public/Depth?pair=XBTUSD&count=" + REST_DEPTH);
            if (source === "ws") return;
            const parsed = parseRestDepth(payload);
            if (!parsed) return;
            applySnapshot(state.book, parsed.bids, parsed.asks);
            source = "rest";
            sampleBook(state, Date.now());
            setFeed("live", "book live");
            paintStats();
            scheduleDraw();
        }

        async function pullTrades() {
            const payload = await pullJson("https://api.kraken.com/0/public/Trades?pair=XBTUSD");
            rememberTrades(state.tape, parseRestTrades(payload));
            const price = newestPrice(state.tape.trades);
            if (price != null) state.last = price;
            paintStats();
            scheduleDraw();
        }

        async function pullTicker() {
            const payload = await pullJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
            const tick = parseTicker(payload);
            if (!tick) return;
            if (state.daySource !== "phoenix") state.open = tick.open;
            if (state.last == null) state.last = tick.last;
            paintStats();
        }

        function startRest() {
            if (restTimer || source === "ws") return;
            pullDepth().catch(fail);
            restTimer = setInterval(function () {
                pullDepth().catch(fail);
            }, 2000);
        }

        function stopRest() {
            if (!restTimer) return;
            clearInterval(restTimer);
            restTimer = 0;
        }

        state.call = latestCall;
        state.stall = latestStall;
        onCall(function (call, stall) {
            state.call = call;
            state.stall = stall || "";
            if (call && Number.isFinite(call.dayOpen)) {
                state.open = call.dayOpen;
                state.daySource = "phoenix";
            }
            paintStats();
            scheduleDraw();
        });

        function connect() {
            if (stopped) return;
            if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
            const ws = new WebSocket("wss://ws.kraken.com/v2");
            socket = ws;
            const ping = setInterval(function () {
                if (ws.readyState === 1) ws.send(JSON.stringify({ method: "ping" }));
            }, 20000);
            ws.onopen = function () {
                retryMs = 1000;
                ws.send(JSON.stringify({
                    method: "subscribe",
                    params: { channel: "book", symbol: [PAIR], depth: depth, snapshot: true },
                }));
                ws.send(JSON.stringify({
                    method: "subscribe",
                    params: { channel: "trade", symbol: [PAIR], snapshot: true },
                }));
                ws.send(JSON.stringify({
                    method: "subscribe",
                    params: { channel: "ohlc", symbol: [PAIR], interval: 60, snapshot: true },
                }));
            };
            ws.onmessage = function (event) {
                let message;
                try { message = parseWire(event.data); }
                catch (error) { return; }
                if (message && (message.success === false || message.error)) {
                    const err = String(message.error || "");
                    if (err.indexOf("ohlc") !== -1) return;
                    if (depth > 500) depth = 500;
                    ws.close();
                    return;
                }
                if (message && message.channel === "ohlc" && message.data) {
                    for (let i = 0; i < message.data.length; i++) emitOhlc(message.data[i]);
                    return;
                }
                if (message && message.channel === "book" && message.data && message.data.length) {
                    const row = message.data[0];
                    if (row.symbol && row.symbol !== PAIR) return;
                    const applied = applyWireBook(state.book, message.type, row);
                    if (!applied.ok) {
                        state.book = createBook(depth);
                        setFeed("down", "resync");
                        ws.close();
                        return;
                    }
                    lastWire = Date.now();
                    raisePeak(state);
                    if (message.type === "snapshot") {
                        source = "ws";
                        stopRest();
                        sampleBook(state, Date.now());
                    }
                    if (feedEl.dataset.state !== "live") setFeed("live", "book live");
                    paintStats();
                    scheduleDraw();
                    return;
                }
                const trades = parseTradeMessage(message);
                if (!trades.length) return;
                const added = rememberTrades(state.tape, trades);
                if (!added.length) return;
                state.last = added[added.length - 1].price;
                paintStats();
                scheduleDraw();
            };
            ws.onerror = function () { ws.close(); };
            ws.onclose = function () {
                clearInterval(ping);
                if (socket === ws) socket = null;
                lastWire = 0;
                if (stopped) return;
                if (source === "ws") source = "none";
                setFeed("down", "reconnecting");
                startRest();
                setTimeout(connect, retryMs);
                retryMs = Math.min(15000, retryMs * 2);
            };
        }

        connect();
        setTimeout(function () {
            if (source !== "ws") startRest();
        }, 2500);
        setTimeout(function () { pullTrades().catch(fail); }, 600);
        setTimeout(function () { pullTicker().catch(fail); }, 1200);
        setInterval(function () { pullTicker().catch(fail); }, 20000);
        setInterval(function () {
            const now = Date.now();
            sampleBook(state, now);
            pruneTrades(state.tape, now - KEEP_MS);
            if (source === "ws" && lastWire && now - lastWire > 5000 && document.visibilityState !== "hidden") {
                setFeed("down", "book stalled");
            }
            paintStats();
            scheduleDraw();
            if (!state.savedAt || now - state.savedAt > 5000) {
                saveHistory(state);
                state.savedAt = now;
            }
        }, SAMPLE_MS);
        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(function () {
                heatKey = "";
                scheduleDraw();
            });
            observer.observe(canvas);
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleDraw);
    }

    function stallNote(hasCall) {
        if (hasCall) return "Candles stalled. The last call is still up.";
        return "Candles stalled. Waiting for a fresh read.";
    }

    function bannerReady(call) {
        return !!(call && call.call);
    }

    function afterCandleFailure(previous) {
        const call = previous && previous.call ? previous : null;
        return { call: call, stall: stallNote(!!call) };
    }

    function phoenixMidnightMs(now) {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: TZ,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(new Date(now));
        function pick(type) {
            for (let i = 0; i < parts.length; i++) {
                if (parts[i].type === type) return Number(parts[i].value);
            }
            return NaN;
        }
        return Date.UTC(pick("year"), pick("month") - 1, pick("day"), 7, 0, 0);
    }

    function sessionOpen(candles, now) {
        if (!candles || !candles.length) return null;
        const start = Math.floor(phoenixMidnightMs(now) / 1000);
        for (let i = 0; i < candles.length; i++) {
            if (candles[i].time === start) return candles[i].open;
        }
        return null;
    }

    function candleFromOhlc(row) {
        if (!row) return null;
        const begin = row.interval_begin || row.timestamp;
        if (!begin) return null;
        const ms = Date.parse(String(begin).replace(/(\.\d{3})\d+/, "$1"));
        const open = Number(row.open);
        const high = Number(row.high);
        const low = Number(row.low);
        const close = Number(row.close);
        if (!Number.isFinite(ms) || ![open, high, low, close].every(Number.isFinite)) return null;
        return { time: Math.floor(ms / 1000), open: open, high: high, low: low, close: close };
    }

    function mergeCandle(series, candle) {
        const next = (series || []).slice();
        if (!candle) return next;
        for (let i = 0; i < next.length; i++) {
            if (next[i].time === candle.time) {
                next[i] = candle;
                return next;
            }
        }
        next.push(candle);
        next.sort(function (a, b) { return a.time - b.time; });
        return next;
    }

    function enoughCandles(h1, h4) {
        return !!(h1 && h4 && h1.length >= 70 && h4.length >= 58);
    }

    function timeTickPlan(plotW, dpr, spanMs) {
        const scale = dpr || 1;
        return {
            count: plotW < 420 * scale ? 2 : 3,
            seconds: spanMs < 60000,
        };
    }

    function drawTimeAxis(ctx, box, t0, t1, format) {
        const plan = timeTickPlan(box.plotW, box.dpr, t1 - t0);
        const stamps = plan.count === 2 ? [t0, t1] : [t0, (t0 + t1) / 2, t1];
        const labels = stamps.map(function (t) { return format(t); });
        const widths = labels.map(function (label) { return ctx.measureText(label).width; });
        const gap = 8 * box.dpr;
        const y = box.timeY + 2;
        ctx.fillStyle = "#8d8d8d";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText(labels[0], box.plotX, y);
        ctx.textAlign = "right";
        ctx.fillText(labels[labels.length - 1], box.plotRight, y);
        if (labels.length === 3) {
            const midX = box.plotX + box.plotW / 2;
            const leftEnd = box.plotX + widths[0] + gap;
            const rightStart = box.plotRight - widths[2] - gap;
            if (midX - widths[1] / 2 >= leftEnd && midX + widths[1] / 2 <= rightStart) {
                ctx.textAlign = "center";
                ctx.fillText(labels[1], midX, y);
            }
        }
    }

    function medianQty(values) {
        if (!values.length) return 0;
        const copy = values.slice().sort(function (a, b) { return a - b; });
        const mid = Math.floor(copy.length / 2);
        if (copy.length % 2) return copy[mid];
        return (copy[mid - 1] + copy[mid]) / 2;
    }

    function wallPick(levels) {
        if (!levels || !levels.length) return null;
        const sorted = levels.slice().sort(function (a, b) { return b.qty - a.qty; });
        const top = sorted[0];
        const med = medianQty(levels.map(function (level) { return level.qty; }));
        const next = sorted.length > 1 ? sorted[1].qty : 0;
        const wall = med > 0 && top.qty >= med * 4 && top.qty >= next * 2;
        return { price: top.price, qty: top.qty, wall: wall };
    }

    function levelsFrom(map, low, high, inside) {
        const out = [];
        for (const [price, qty] of map) {
            const inBand = price >= low && price <= high;
            if (inside === inBand) out.push({ price: price, qty: qty });
        }
        return out;
    }

    function formatDistance(price, mid) {
        const dist = price - mid;
        const away = Math.abs(dist);
        if (away < 0.05) return "at the price";
        const digits = away >= 100 ? 0 : away >= 10 ? 1 : 2;
        return formatPrice(away, digits) + (dist > 0 ? " above" : " below");
    }

    function wallRead(map, low, high, mid, name) {
        const inside = wallPick(levelsFrom(map, low, high, true));
        const outside = wallPick(levelsFrom(map, low, high, false));
        if (!inside) return { label: name + " top", text: "—", pick: null };
        let text = formatPrice(inside.price) + " · " + formatCoin(inside.qty) + " · " + formatDistance(inside.price, mid);
        if (outside && outside.qty > inside.qty) text += " · larger " + formatPrice(outside.price) + " outside";
        return { label: inside.wall ? name + " wall" : name + " top", text: text, pick: inside };
    }

    function alignPeak(state) {
        if (!state.grid) return;
        if (!state.peak || state.peak.bids.length !== state.grid.rows) {
            state.peak = {
                bids: new Float32Array(state.grid.rows),
                asks: new Float32Array(state.grid.rows),
            };
        }
    }

    function paintSum(map, dest, grid) {
        for (const [price, qty] of map) {
            const i = Math.floor((price - grid.low) / grid.bin);
            if (i < 0 || i >= dest.length) continue;
            dest[i] += qty;
        }
    }

    function raisePeak(state) {
        alignPeak(state);
        if (!state.peak) return;
        const bids = new Float32Array(state.grid.rows);
        const asks = new Float32Array(state.grid.rows);
        paintSum(state.book.bids, bids, state.grid);
        paintSum(state.book.asks, asks, state.grid);
        for (let i = 0; i < bids.length; i++) {
            if (bids[i] > state.peak.bids[i]) state.peak.bids[i] = bids[i];
            if (asks[i] > state.peak.asks[i]) state.peak.asks[i] = asks[i];
        }
    }

    function decayPeak(state) {
        if (!state.peak || !state.grid) return;
        const bids = new Float32Array(state.grid.rows);
        const asks = new Float32Array(state.grid.rows);
        paintSum(state.book.bids, bids, state.grid);
        paintSum(state.book.asks, asks, state.grid);
        for (let i = 0; i < state.peak.bids.length; i++) {
            const faded = state.peak.bids[i] * 0.65;
            state.peak.bids[i] = bids[i] > faded ? bids[i] : faded;
            if (state.peak.bids[i] < 0.0001) state.peak.bids[i] = 0;
            const fadedAsk = state.peak.asks[i] * 0.65;
            state.peak.asks[i] = asks[i] > fadedAsk ? asks[i] : fadedAsk;
            if (state.peak.asks[i] < 0.0001) state.peak.asks[i] = 0;
        }
    }

    function sampleFromPeak(state, now, last) {
        alignPeak(state);
        return {
            t: now,
            bids: new Float32Array(state.peak.bids),
            asks: new Float32Array(state.peak.asks),
            bestBid: bestBid(state.book),
            bestAsk: bestAsk(state.book),
            last: last,
        };
    }

    function rememberSize(state, price, qty, side) {
        if (!state.grid) return;
        alignPeak(state);
        const i = Math.floor((price - state.grid.low) / state.grid.bin);
        const dest = side === "ask" ? state.peak.asks : state.peak.bids;
        if (i < 0 || i >= dest.length) return;
        if (qty > dest[i]) dest[i] = qty;
    }

    function packSide(arr, grid) {
        const levels = [];
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] >= 0.05) levels.push([grid.low + i * grid.bin, Math.round(arr[i] * 1000) / 1000]);
        }
        levels.sort(function (a, b) { return b[1] - a[1]; });
        return levels.slice(0, 40);
    }

    function packHistory(columns, grid, limit) {
        const cap = limit || 240;
        const stride = Math.max(1, Math.ceil(columns.length / cap));
        const out = [];
        for (let i = 0; i < columns.length; i += stride) {
            const col = columns[i];
            out.push({
                t: col.t,
                bb: col.bestBid,
                ba: col.bestAsk,
                last: col.last,
                bids: packSide(col.bids, grid),
                asks: packSide(col.asks, grid),
            });
        }
        return { v: 1, columns: out };
    }

    function paintPacked(levels, dest, grid) {
        if (!levels) return;
        for (let i = 0; i < levels.length; i++) {
            const row = Math.floor((levels[i][0] - grid.low) / grid.bin);
            if (row < 0 || row >= dest.length) continue;
            if (levels[i][1] > dest[row]) dest[row] = levels[i][1];
        }
    }

    function unpackHistory(packed, grid) {
        if (!packed || !packed.columns || !grid) return [];
        const cols = [];
        for (let i = 0; i < packed.columns.length; i++) {
            const raw = packed.columns[i];
            const bids = new Float32Array(grid.rows);
            const asks = new Float32Array(grid.rows);
            paintPacked(raw.bids, bids, grid);
            paintPacked(raw.asks, asks, grid);
            cols.push({
                t: raw.t,
                bids: bids,
                asks: asks,
                bestBid: raw.bb,
                bestAsk: raw.ba,
                last: raw.last,
            });
        }
        return cols;
    }

    function saveHistory(state) {
        if (typeof sessionStorage === "undefined" || !state.grid || !state.columns.length) return;
        function write(limit) {
            sessionStorage.setItem("liquidity-book-v1", JSON.stringify(packHistory(state.columns, state.grid, limit)));
        }
        try { write(240); }
        catch (error) {
            try { write(60); }
            catch (again) { /* quota */ }
        }
    }

    function parseWire(text) {
        const tokens = [];
        const replaced = String(text).replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, function (tok) {
            if (tok[0] === "\"") return tok;
            const id = tokens.length;
            tokens.push(tok);
            return "\"__WIRE_" + id + "__\"";
        });
        const parsed = JSON.parse(replaced);
        function revive(node) {
            if (Array.isArray(node)) return node.map(revive);
            if (node && typeof node === "object") {
                const out = {};
                const keys = Object.keys(node);
                for (let i = 0; i < keys.length; i++) out[keys[i]] = revive(node[keys[i]]);
                return out;
            }
            if (typeof node === "string") {
                const match = /^__WIRE_(\d+)__$/.exec(node);
                if (match) return tokens[Number(match[1])];
            }
            return node;
        }
        return revive(parsed);
    }

    function wireToken(value) {
        const stripped = String(value).replace(".", "").replace(/^0+/, "");
        return stripped === "" ? "0" : stripped;
    }

    function crc32(str) {
        if (!crc32.table) {
            const table = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
                table[n] = c >>> 0;
            }
            crc32.table = table;
        }
        let crc = 0xffffffff;
        for (let i = 0; i < str.length; i++) crc = crc32.table[(crc ^ str.charCodeAt(i)) & 255] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function checksumSides(bids, asks) {
        const askPrices = Object.keys(asks).sort(function (a, b) { return Number(a) - Number(b); }).slice(0, 10);
        const bidPrices = Object.keys(bids).sort(function (a, b) { return Number(b) - Number(a); }).slice(0, 10);
        let body = "";
        for (let i = 0; i < askPrices.length; i++) body += wireToken(askPrices[i]) + wireToken(asks[askPrices[i]]);
        for (let i = 0; i < bidPrices.length; i++) body += wireToken(bidPrices[i]) + wireToken(bids[bidPrices[i]]);
        return crc32(body);
    }

    function applyWireLevels(map, levels) {
        if (!levels) return;
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const price = Array.isArray(level) ? String(level[0]) : String(level.price);
            const qty = Array.isArray(level) ? String(level[1]) : String(level.qty);
            if (!price || price === "undefined") continue;
            if (Number(qty) <= 0) delete map[price];
            else map[price] = qty;
        }
    }

    function truncateWire(map, depth, descending) {
        const prices = Object.keys(map).sort(function (a, b) {
            return descending ? Number(b) - Number(a) : Number(a) - Number(b);
        });
        const next = {};
        for (let i = 0; i < prices.length && i < depth; i++) next[prices[i]] = map[prices[i]];
        return next;
    }

    function rebuildNumeric(book) {
        book.bids = new Map();
        book.asks = new Map();
        const bidPrices = Object.keys(book.wireBids || {});
        for (let i = 0; i < bidPrices.length; i++) book.bids.set(Number(bidPrices[i]), Number(book.wireBids[bidPrices[i]]));
        const askPrices = Object.keys(book.wireAsks || {});
        for (let i = 0; i < askPrices.length; i++) book.asks.set(Number(askPrices[i]), Number(book.wireAsks[askPrices[i]]));
    }

    function applyWireBook(book, type, row) {
        const nextBids = type === "snapshot" ? {} : Object.assign({}, book.wireBids || {});
        const nextAsks = type === "snapshot" ? {} : Object.assign({}, book.wireAsks || {});
        applyWireLevels(nextBids, row && row.bids);
        applyWireLevels(nextAsks, row && row.asks);
        if (row && row.checksum != null && checksumSides(nextBids, nextAsks) !== Number(row.checksum)) {
            return { ok: false, resubscribe: true };
        }
        book.wireBids = truncateWire(nextBids, book.depth, true);
        book.wireAsks = truncateWire(nextAsks, book.depth, false);
        rebuildNumeric(book);
        return { ok: true, resubscribe: false };
    }

    function newestPrice(trades) {
        let best = null;
        for (let i = 0; i < trades.length; i++) {
            if (!best || trades[i].t >= best.t) best = trades[i];
        }
        return best ? best.price : null;
    }

    function visibleTradeCap(trades, t0, t1) {
        const values = [];
        for (let i = 0; i < trades.length; i++) {
            if (trades[i].t < t0 || trades[i].t > t1) continue;
            values.push(trades[i].qty);
        }
        const cap = percentile(values, 0.95);
        return cap > 0 ? cap : 1;
    }

    return {
        createBook: createBook,
        createState: createState,
        applySnapshot: applySnapshot,
        applyUpdate: applyUpdate,
        bestBid: bestBid,
        bestAsk: bestAsk,
        bookRange: bookRange,
        shiftArrays: shiftArrays,
        settleGrid: settleGrid,
        sampleColumn: sampleColumn,
        sampleBook: sampleBook,
        viewBounds: viewBounds,
        holdView: holdView,
        columnAtTime: columnAtTime,
        timeWindow: timeWindow,
        percentile: percentile,
        intensity: intensity,
        heatColor: heatColor,
        heatImage: heatImage,
        bandQty: bandQty,
        bidShare: bidShare,
        topLevel: topLevel,
        gains: gains,
        rememberTrades: rememberTrades,
        pruneTrades: pruneTrades,
        deltaInWindow: deltaInWindow,
        cvdSeries: cvdSeries,
        tradeRadius: tradeRadius,
        priceStep: priceStep,
        signOf: signOf,
        formatGain: formatGain,
        formatCoin: formatCoin,
        formatPrice: formatPrice,
        formatSignedMoney: formatSignedMoney,
        parseBookMessage: parseBookMessage,
        ingestBook: ingestBook,
        parseTradeMessage: parseTradeMessage,
        parseRestDepth: parseRestDepth,
        parseRestTrades: parseRestTrades,
        parseTicker: parseTicker,
        hitTest: hitTest,
        hoverText: hoverText,
        prejudge: prejudge,
        publishCall: publishCall,
        publishStall: publishStall,
        currentCall: currentCall,
        onOhlc: onOhlc,
        stallNote: stallNote,
        bannerReady: bannerReady,
        afterCandleFailure: afterCandleFailure,
        sessionOpen: sessionOpen,
        phoenixMidnightMs: phoenixMidnightMs,
        candleFromOhlc: candleFromOhlc,
        mergeCandle: mergeCandle,
        enoughCandles: enoughCandles,
        timeTickPlan: timeTickPlan,
        wallPick: wallPick,
        wallRead: wallRead,
        rememberSize: rememberSize,
        packHistory: packHistory,
        unpackHistory: unpackHistory,
        parseWire: parseWire,
        applyWireBook: applyWireBook,
        checksumSides: checksumSides,
        setDeskView: setDeskView,
        prepare: prepare,
        mount: mount,
        WINDOW_MS: WINDOW_MS,
    };
});
