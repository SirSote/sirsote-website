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

assert.strictEqual(book.priceStep(700), 100);

console.log("book liquidity ok");
