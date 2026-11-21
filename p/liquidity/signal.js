/* Pull the same closed-candle call the BTC desk uses and hand it to the book.
   A call is a prior. This page never sends an order. */
(function () {
    async function poll() {
        const text = document.getElementById("lean-text");
        try {
            const [h1, h4] = await Promise.all([Desk.fetchOhlc(60), Desk.fetchOhlc(240)]);
            const call = Desk.evaluate(Desk.splitLive(h1).closed, Desk.splitLive(h4).closed);
            Book.publishCall(call);
        } catch (error) {
            if (text && text.dataset.ready !== "yes") text.textContent = error.message;
        }
    }

    function start() {
        setTimeout(poll, 1000);
        setInterval(poll, 15000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
