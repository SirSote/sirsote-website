const assert = require("assert");
const book = require("./book");

const stateBook = book.createBook(2);
book.applySnapshot(stateBook, [["10", "1"], ["9", "1"], ["8", "5"]], [[11, "1"], [12, "1"]]);
assert.strictEqual(stateBook.bids.size, 2);
assert.strictEqual(stateBook.bids.has(8), false);
assert.strictEqual(stateBook.bids.get(10), 1);
assert.strictEqual(book.bestBid(stateBook), 10);
assert.strictEqual(book.bestAsk(stateBook), 11);

book.applyUpdate(stateBook, [[10, 0], [7, 3]], []);
assert.strictEqual(stateBook.bids.has(10), false);
assert.strictEqual(stateBook.bids.get(7), 3);
assert.strictEqual(stateBook.bids.has(9), true);
book.applyUpdate(stateBook, [[6, 4]], []);
assert.strictEqual(stateBook.bids.has(6), false);
assert.strictEqual(stateBook.bids.size, 2);

assert.deepStrictEqual(book.viewBounds(150, "near"), { low: 50, high: 250 });
assert.deepStrictEqual(book.viewBounds(150, "tight"), { low: 120, high: 180 });
const current = book.viewBounds(150, "near");
assert.strictEqual(book.holdView(current, 150, "near"), current);
assert.deepStrictEqual(book.holdView(current, 230, "near"), book.viewBounds(230, "near"));

const columns = [{ bids: new Float32Array(1600), asks: new Float32Array(1600), t: 1 }];
columns[0].bids[800] = 5;
const nextGrid = book.settleGrid({ low: 1000, bin: 1, rows: 1600 }, columns, { low: 2500, high: 2700 });
assert.strictEqual(nextGrid.low, 1800);
assert.strictEqual(nextGrid.rows, 1600);
assert.strictEqual(columns[0].bids[0], 5);
const held = book.settleGrid(nextGrid, columns, { low: 2500, high: 2700 });
assert.strictEqual(held, nextGrid);

const sampled = book.createBook(10);
book.applySnapshot(sampled, [[100, 2], [105, 3]], [[120, 1.5]]);
const column = book.sampleColumn(sampled, { low: 100, bin: 10, rows: 4 }, 50, 110);
assert.strictEqual(column.bids[0], 5);
assert.strictEqual(column.asks[2], 1.5);
assert.strictEqual(column.bestBid, 105);
assert.strictEqual(column.last, 110);

const live = book.createState();
book.applySnapshot(live.book, [[100, 1], [99, 2]], [[101, 1.5]]);
const first = book.sampleBook(live, 1000);
assert.ok(first);
assert.strictEqual(live.anchor, 100.5);
assert.strictEqual(live.columns.length, 1);
assert.strictEqual(live.view.high - live.view.low, 200);
assert.strictEqual(live.grid.bin, 1);
assert.strictEqual(live.grid.rows, 1600);
book.sampleBook(live, 2000);
assert.strictEqual(live.anchor, 100.5);
assert.strictEqual(live.columns.length, 2);

assert.strictEqual(book.columnAtTime([{ t: 1000 }, { t: 2000 }], 500), -1);
assert.strictEqual(book.columnAtTime([{ t: 1000 }, { t: 2000 }], 1500), 0);
assert.strictEqual(book.columnAtTime([{ t: 1000 }, { t: 2000 }], 2500), 1);

const grid = { low: 100, bin: 10, rows: 4 };
const bids = new Float32Array(4);
bids[1] = 5;
const heatCol = { t: 1000, bids: bids, asks: new Float32Array(4) };
const view = { low: 100, high: 140 };
const image = book.heatImage(2, 4, grid, view, [heatCol], 500, 1500, 5);
function pixel(x, y) {
    const o = (y * 2 + x) * 4;
    return [image[o], image[o + 1], image[o + 2]];
}
const before = pixel(0, 2);
const after = pixel(1, 2);
const empty = pixel(1, 0);
assert.ok(before[0] > before[2]);
assert.ok(after[0] > after[2]);
assert.ok(empty[0] + empty[1] + empty[2] < 40);

const early = book.timeWindow([{ t: 10000 }], 11000);
assert.strictEqual(early.t1 - early.t0, 15000);
assert.strictEqual(book.timeWindow([{ t: 0 }], 60000).t1, 60000);
assert.strictEqual(book.timeWindow([{ t: 0 }], 20 * 60 * 1000).t0, 20 * 60 * 1000 - book.WINDOW_MS);

const cool = book.heatColor(0.01, 10);
const hot = book.heatColor(10, 10);
assert.ok(hot[0] + hot[1] + hot[2] > cool[0] + cool[1] + cool[2]);
assert.ok(hot[0] > hot[2]);
assert.ok(cool[2] > cool[0]);

assert.strictEqual(book.bidShare(3, 1), 0.75);
assert.strictEqual(book.bidShare(0, 0), null);
const wall = book.topLevel(new Map([[100, 1], [90, 4], [70, 9]]), 80, 110);
assert.deepStrictEqual(wall, { price: 90, qty: 4 });

const move = book.gains(100, 110);
assert.strictEqual(move.usd, 10);
assert.strictEqual(move.pct, 10);
assert.strictEqual(book.formatGain(move), "+$10.00 · +10.00%");
assert.strictEqual(book.formatGain(book.gains(58000, 57999.21)), "-$0.79 · 0.00%");
assert.strictEqual(book.formatGain(book.gains(100, 90)), "-$10.00 · -10.00%");
assert.strictEqual(book.formatCoin(1.2, true), "+1.20");
assert.strictEqual(book.formatCoin(-0.004, true), "-0.004");
assert.strictEqual(book.signOf(-2), "down");

const tape = { trades: [], seen: new Set() };
const print = { side: "buy", price: 100, qty: 0.5, t: 5_000 };
assert.strictEqual(book.rememberTrades(tape, [print, print]).length, 1);
const flow = book.deltaInWindow([
    print,
    { side: "sell", price: 100, qty: 0.2, t: 6_000 },
    { side: "buy", price: 100, qty: 1, t: 500 },
], 4_000, 7_000);
assert.strictEqual(flow.qty, 0.3);
assert.strictEqual(flow.usd, 30);
const series = book.cvdSeries([
    { side: "buy", price: 10, qty: 1, t: 1000 },
    { side: "sell", price: 10, qty: 0.25, t: 3000 },
], 0, 4000, 4);
assert.strictEqual(series[0], 1);
assert.strictEqual(series[1], 1);
assert.strictEqual(series[3], 0.75);
assert.ok(book.tradeRadius(5, 5, 1) > book.tradeRadius(0.2, 5, 1));

const snapshot = book.ingestBook(book.createBook(10), {
    channel: "book",
    type: "snapshot",
    data: [{
        symbol: "BTC/USD",
        bids: [{ price: 100, qty: 2 }],
        asks: [{ price: 101, qty: 1 }],
    }],
});
assert.strictEqual(snapshot, true);
const trades = book.parseTradeMessage({
    channel: "trade",
    type: "update",
    data: [{ symbol: "BTC/USD", side: "sell", price: 100.5, qty: 0.1, timestamp: "2026-11-21T12:00:00.000Z", trade_id: 7 }],
});
assert.strictEqual(trades[0].side, "sell");
assert.strictEqual(trades[0].qty, 0.1);
assert.ok(trades[0].t > 0);

const depth = book.parseRestDepth({
    result: { XXBTZUSD: { bids: [["100.0", "1.5", 1]], asks: [["101.0", "2", 1]] }, last: "nope" },
});
assert.strictEqual(depth.bids[0][0], "100.0");
const restTrades = book.parseRestTrades({
    result: { XXBTZUSD: [["100.0", "0.2", "1700000000.125", "b", "m", ""]], last: "1" },
});
assert.strictEqual(restTrades[0].side, "buy");
assert.strictEqual(restTrades[0].t, 1700000000125);
const ticker = book.parseTicker({ result: { XXBTZUSD: { c: ["105.5", "1"], o: "100" } } });
assert.deepStrictEqual(ticker, { last: 105.5, open: 100 });

const box = { plotX: 0, plotY: 0, plotW: 100, plotH: 100 };
const hit = book.hitTest(box, 10, 10, { low: 100, high: 200 }, grid, [heatCol], 0, 1000);
assert.ok(hit.price < 200);
assert.ok(hit.price > 100);
assert.strictEqual(book.hitTest(box, 200, 10, view, grid, [], 0, 1000), null);
assert.ok(book.hoverText(null).includes("Hover"));
assert.ok(book.hoverText({ price: 100, t: 1, bidQty: 2, askQty: 0 }, "1:00 PM").includes("bid"));

const shortWait = { call: "WAIT", regime: "SHORT", why: "waiting under the average" };
const agreed = book.prejudge(shortWait, { share: 0.3, deltaQty: -1.2, bidWall: { price: 59000, qty: 4 } });
assert.strictEqual(agreed.path, "down");
assert.strictEqual(agreed.book, "down");
assert.ok(agreed.text.includes("waiting on a short"));
assert.ok(agreed.text.includes("book agrees"));
assert.ok(agreed.text.includes("59,000"));
const fight = book.prejudge({ call: "SHORT", regime: "SHORT" }, { share: 0.7, deltaQty: 2 });
assert.strictEqual(fight.path, "flat");
assert.ok(fight.text.includes("not confirmed"));
const quiet = book.prejudge({ call: "STAND ASIDE", regime: "RANGE" }, { share: 0.5, deltaQty: 0.1 });
assert.strictEqual(quiet.path, "flat");
assert.ok(quiet.text.includes("No path"));
const bookOnly = book.prejudge({ call: "STAND ASIDE", regime: "RANGE" }, { share: 0.8, deltaQty: 1 });
assert.strictEqual(bookOnly.path, "up");
assert.ok(bookOnly.text.includes("short-term"));

assert.strictEqual(book.priceStep(700), 100);

assert.strictEqual(book.bannerReady(null), false);
assert.strictEqual(book.bannerReady({}), false);
assert.strictEqual(book.bannerReady({ call: "WAIT" }), true);
const keptCall = book.afterCandleFailure({ call: "WAIT", why: "still the last hour" });
assert.strictEqual(keptCall.call.call, "WAIT");
assert.ok(keptCall.stall.includes("last call is still up"));
const missed = book.afterCandleFailure(null);
assert.strictEqual(missed.call, null);
assert.ok(missed.stall.includes("Waiting for a fresh read"));

function sheetLine(text) {
    const low = text.toLowerCase();
    if (low.includes("book agrees")) return "agrees";
    if (low.includes("book is leaning") && low.includes("not confirmed")) return "fights";
    return null;
}
assert.strictEqual(sheetLine(agreed.text), "agrees");
assert.strictEqual(sheetLine(fight.text), "fights");
assert.strictEqual(sheetLine(quiet.text), null);
const tapeLean = book.prejudge(
    { call: "SHORT", regime: "SHORT", why: "4h is down" },
    { share: 0.5, deltaQty: -3 },
);
assert.strictEqual(tapeLean.from, "tape");
assert.strictEqual(tapeLean.book, "down");
assert.strictEqual(tapeLean.path, "down");
assert.ok(tapeLean.text.includes("The lean is from the tape."));
assert.strictEqual(sheetLine(tapeLean.text), "agrees");
const tapeFight = book.prejudge({ call: "SHORT", regime: "SHORT" }, { share: 0.5, deltaQty: 3 });
assert.strictEqual(tapeFight.from, "tape");
assert.strictEqual(sheetLine(tapeFight.text), "fights");

const ordinary = book.wallPick([
    { price: 100, qty: 15 },
    { price: 101, qty: 5 },
    { price: 102, qty: 5.8 },
    { price: 103, qty: 5.8 },
    { price: 104, qty: 5.8 },
]);
assert.strictEqual(ordinary.wall, false);
const realWall = book.wallPick([
    { price: 100, qty: 40 },
    { price: 101, qty: 5 },
    { price: 102, qty: 5 },
    { price: 103, qty: 6 },
    { price: 104, qty: 5 },
]);
assert.strictEqual(realWall.wall, true);
assert.strictEqual(realWall.price, 100);
const outsideBook = new Map([[100, 5], [101, 5], [102, 6], [103, 5], [90, 40]]);
const outsideRead = book.wallRead(outsideBook, 99, 110, 105, "Bid");
assert.ok(outsideRead.text.includes("outside"));
assert.strictEqual(outsideRead.pick.wall, false);

const widePlan = book.timeTickPlan(800, 1, 10 * 60 * 1000);
assert.strictEqual(widePlan.count, 3);
assert.strictEqual(widePlan.seconds, false);
assert.strictEqual(book.timeTickPlan(300, 1, 10 * 60 * 1000).count, 2);
assert.strictEqual(book.timeTickPlan(800, 1, 20000).seconds, true);

const sameSecond = { trades: [], seen: new Set() };
const firstPrint = { side: "buy", price: 100, qty: 0.5, t: 5000, id: 11 };
const secondPrint = { side: "buy", price: 100, qty: 0.5, t: 5000, id: 12 };
assert.strictEqual(book.rememberTrades(sameSecond, [firstPrint, secondPrint]).length, 2);
assert.strictEqual(book.deltaInWindow(sameSecond.trades, 0, 9000).qty, 1);

const seeded = book.mergeCandle([], { time: 10, open: 1, high: 2, low: 1, close: 1.5 });
const replaced = book.mergeCandle(seeded, { time: 10, open: 1, high: 4, low: 1, close: 3 });
assert.strictEqual(replaced.length, 1);
assert.strictEqual(replaced[0].close, 3);
const longer = book.mergeCandle(replaced, { time: 5, open: 1, high: 1, low: 1, close: 1 });
assert.strictEqual(longer[0].time, 5);
assert.strictEqual(book.enoughCandles(longer, longer), false);
const exchangeNoon = Date.UTC(2026, 10, 21, 20, 0, 0);
const exchangeOpen = book.exchangeMidnightMs(exchangeNoon);
assert.strictEqual(exchangeOpen, Date.UTC(2026, 10, 21, 5, 0, 0));
assert.strictEqual(book.sessionOpen([{ time: exchangeOpen / 1000, open: 60000 }], exchangeNoon), 60000);
const wireCandle = book.candleFromOhlc({
    interval: "60",
    interval_begin: "2026-11-21T16:00:00.000000000Z",
    open: "100",
    high: "110",
    low: "90",
    close: "105",
});
assert.strictEqual(wireCandle.time, 1795276800);
assert.strictEqual(wireCandle.close, 105);

const flashed = book.createState();
book.applySnapshot(flashed.book, [[100, 1], [99, 1]], [[101, 1]]);
book.sampleBook(flashed, 1000);
book.rememberSize(flashed, 100, 9, "bid");
book.applyUpdate(flashed.book, [[100, 0]], []);
const flashedColumn = book.sampleBook(flashed, 2000);
const flashedRow = Math.floor((100 - flashed.grid.low) / flashed.grid.bin);
assert.ok(flashedColumn.bids[flashedRow] >= 9);
const packed = book.packHistory(flashed.columns, flashed.grid, 10);
const unpacked = book.unpackHistory(packed, flashed.grid);
assert.strictEqual(unpacked.length, flashed.columns.length);
assert.ok(unpacked[1].bids[flashedRow] >= 9);

const docAsks = [
    { price: "45285.2", qty: "0.00100000" },
    { price: "45286.4", qty: "1.54571953" },
    { price: "45286.6", qty: "1.54571109" },
    { price: "45289.6", qty: "1.54560911" },
    { price: "45290.2", qty: "0.15890660" },
    { price: "45291.8", qty: "1.54553491" },
    { price: "45294.7", qty: "0.04454749" },
    { price: "45296.1", qty: "0.35380000" },
    { price: "45297.5", qty: "0.09945542" },
    { price: "45299.5", qty: "0.18772827" },
];
const docBids = [
    { price: "45283.5", qty: "0.10000000" },
    { price: "45283.4", qty: "1.54582015" },
    { price: "45282.1", qty: "0.10000000" },
    { price: "45281.0", qty: "0.10000000" },
    { price: "45280.3", qty: "1.54592586" },
    { price: "45279.0", qty: "0.07990000" },
    { price: "45277.6", qty: "0.03310103" },
    { price: "45277.5", qty: "0.30000000" },
    { price: "45277.3", qty: "1.54602737" },
    { price: "45276.6", qty: "0.15445238" },
];
const wired = book.createBook(10);
const snap = book.applyWireBook(wired, "snapshot", { bids: docBids, asks: docAsks, checksum: 3310070434 });
assert.strictEqual(snap.ok, true);
assert.strictEqual(snap.resubscribe, false);
assert.strictEqual(book.bestBid(wired), 45283.5);
const keptQty = wired.wireBids["45283.5"];
const bad = book.applyWireBook(wired, "update", {
    bids: [{ price: "45283.5", qty: "9.00000000" }],
    asks: [],
    checksum: 1,
});
assert.strictEqual(bad.ok, false);
assert.strictEqual(bad.resubscribe, true);
assert.strictEqual(wired.wireBids["45283.5"], keptQty);

console.log("book liquidity ok");
