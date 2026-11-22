/* One candle history, then the sockets keep it current.
   Kraken allows one ohlc interval per symbol on a socket, so the 4h
   feed is its own public socket. The 1h feed rides the book socket.
   This page never sends an order. */
(function () {
    let h1 = [];
    let h4 = [];
    let seeding = false;
    let retryMs = 30000;
    let stopped = false;
    let four = null;

    function publish() {
        if (!Book.enoughCandles(h1, h4)) return false;
        try {
            const call = Desk.evaluate(Desk.splitLive(h1).closed, Desk.splitLive(h4).closed);
            const open = Book.sessionOpen(h1, Date.now());
            if (Number.isFinite(open)) call.dayOpen = open;
            Book.publishCall(call);
            return true;
        } catch (error) {
            Book.publishStall(Book.stallNote(!!(Book.currentCall() && Book.currentCall().call)));
            return false;
        }
    }

    function take(row) {
        const candle = Book.candleFromOhlc(row);
        if (!candle) return;
        const interval = Number(row.interval);
        if (interval === 60) h1 = Book.mergeCandle(h1, candle);
        if (interval === 240) h4 = Book.mergeCandle(h4, candle);
        publish();
    }

    Book.onOhlc(take);

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function pull(interval, series) {
        const rows = await Desk.fetchOhlc(interval);
        let next = series;
        for (let i = 0; i < rows.length; i++) next = Book.mergeCandle(next, rows[i]);
        return next;
    }

    async function seed() {
        if (stopped || seeding) return;
        seeding = true;
        let failed = false;
        try {
            if (h1.length < 70) h1 = await pull(60, h1);
            await delay(1600);
            if (stopped) return;
            if (h4.length < 58) h4 = await pull(240, h4);
            publish();
        } catch (error) {
            failed = true;
            Book.publishStall(Book.stallNote(!!(Book.currentCall() && Book.currentCall().call)));
        } finally {
            seeding = false;
        }
        if (stopped) return;
        if (failed || !Book.enoughCandles(h1, h4)) {
            retryMs = Math.min(120000, retryMs * 2);
            setTimeout(seed, retryMs);
        }
    }

    function connectFour() {
        if (stopped) return;
        if (four && (four.readyState === 0 || four.readyState === 1)) return;
        const ws = new WebSocket("wss://ws.kraken.com/v2");
        four = ws;
        ws.onopen = function () {
            ws.send(JSON.stringify({
                method: "subscribe",
                params: { channel: "ohlc", symbol: ["BTC/USD"], interval: 240, snapshot: true },
            }));
        };
        ws.onmessage = function (event) {
            let message;
            try { message = Book.parseWire(event.data); }
            catch (error) { return; }
            if (!message || message.channel !== "ohlc" || !message.data) return;
            for (let i = 0; i < message.data.length; i++) take(message.data[i]);
        };
        ws.onerror = function () { ws.close(); };
        ws.onclose = function () {
            if (four === ws) four = null;
            if (!stopped) setTimeout(connectFour, 2000);
        };
    }

    function start() {
        connectFour();
        setTimeout(seed, 8000);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
