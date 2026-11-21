const assert = require("assert");
const desk = require("./desk");

function snap(overrides) {
    return Object.assign({
        price: 100,
        candleTime: 1700000000,
        h4Close: 110,
        h4EmaFast: 105,
        h4EmaSlow: 100,
        h1Open: 99,
        h1Close: 101,
        h1EmaFast: 100,
        h1Rsi: 50,
        h1RsiPrev: 46,
        h1Atr: 2,
        recentLows: [99.5, 99.8, 100.2],
        recentHighs: [101, 101.5, 102],
    }, overrides);
}

const long = desk.decide(snap());
assert.strictEqual(long.call, "LONG");
assert.ok(long.invalid < 100);
assert.ok(long.reward2r > 100);

const range = desk.decide(snap({ h4Close: 100, h4EmaFast: 100.05, h4EmaSlow: 100 }));
assert.strictEqual(range.call, "STAND ASIDE");
assert.strictEqual(range.invalid, null);

const stretched = desk.decide(snap({
    h1Open: 110,
    h1Close: 112,
    price: 112,
    h1EmaFast: 100,
    h1Rsi: 72,
    h1RsiPrev: 70,
    recentLows: [109, 110, 111],
}));
assert.strictEqual(stretched.call, "WAIT");
assert.ok(stretched.why.includes("stretched"));

const short = desk.decide(snap({
    price: 100,
    h4Close: 90,
    h4EmaFast: 95,
    h4EmaSlow: 100,
    h1Open: 101,
    h1Close: 99,
    h1EmaFast: 100,
    h1Rsi: 48,
    h1RsiPrev: 54,
    recentLows: [98, 98.5, 99],
    recentHighs: [100.2, 100.5, 101],
}));
assert.strictEqual(short.call, "SHORT");
assert.ok(short.invalid > 100);

const flat = desk.ema(Array(30).fill(40), 10);
assert.strictEqual(flat[flat.length - 1], 40);
assert.strictEqual(desk.regime(110, 105, 100), "LONG");
assert.strictEqual(desk.regime(100.2, 100.1, 100), "RANGE");

const rows = [[1, "1", "2", "0.5", "1.5"], [2, "1.5", "2", "1", "1.8"]];
const split = desk.splitLive(rows.map(function (row) {
    return { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) };
}));
assert.strictEqual(split.closed.length, 1);
assert.strictEqual(split.live.time, 2);

const closes = [1, 2, 3, 4, 5];
const average = desk.sma(closes, 3);
assert.strictEqual(average[1], null);
assert.strictEqual(average[2], 2);
assert.strictEqual(average[4], 4);
assert.strictEqual(desk.sma(Array(200).fill(10), 200)[199], 10);

const days = closes.map(function (close, index) {
    return { time: index * 86400, close: close };
});
const line = desk.dailyLine(days, 3, 500000);
assert.strictEqual(line[0].value, 2);
assert.strictEqual(line[line.length - 1].time, 500000);
assert.strictEqual(line[line.length - 1].value, 4);
const clipped = desk.dailyLine(days, 3, 500000, 3 * 86400 + 3600);
assert.strictEqual(clipped[0].time, 3 * 86400 + 3600);
assert.strictEqual(clipped[0].value, 3);
assert.strictEqual(clipped[1].value, 4);
assert.ok(clipped.every(function (point) { return point.time >= 3 * 86400 + 3600; }));

const items = desk.bannerItems(long, { liveText: "$100.00", dayFast: "$90.00", daySlow: "$80.00" });
assert.strictEqual(items[0].kind, "call");
assert.strictEqual(items[0].text, "LONG");
assert.strictEqual(items[0].tone, "long");
assert.strictEqual(items[1].text, long.why);
assert.strictEqual(items[2].label, "Live");
assert.strictEqual(items[2].text, "$100.00");
assert.ok(items.some(function (item) { return item.label === "4h trend" && item.tone === "LONG"; }));
assert.ok(items.some(function (item) { return item.label === "21-day" && item.line === "day21"; }));
assert.ok(items.some(function (item) { return item.label === "Invalid"; }));

console.log("desk rules ok");
