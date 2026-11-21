/* Public Bitcoin search. Amounts and scripts. No names, no keys. */
(function (factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (typeof window !== "undefined") window.Chain = api;
})(function () {
    const API = "https://mempool.space/api";
    const SATS = 100000000;
    const WHALE = 10 * SATS;
    const WATCH_KEY = "btc-chain-watch";

    function classify(query) {
        const text = String(query || "").trim();
        if (/^[0-9a-fA-F]{64}$/.test(text)) return "tx";
        if ((text.startsWith("bc1") || text.startsWith("1") || text.startsWith("3")) && text.length >= 26 && text.length <= 90 && !text.includes(" ")) {
            return "address";
        }
        return "bad";
    }

    function btc(sats) {
        return (sats / SATS).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    }

    function confirmedBalance(payload) {
        const chain = payload.chain_stats || {};
        return (chain.funded_txo_sum || 0) - (chain.spent_txo_sum || 0);
    }

    function outputRows(tx) {
        return (tx.vout || []).map(function (vout) {
            return {
                address: vout.scriptpubkey_address || "",
                sats: vout.value || 0,
            };
        });
    }

    function whaleOutputs(txs, minSats) {
        const found = [];
        (txs || []).forEach(function (tx) {
            outputRows(tx).forEach(function (row) {
                if (row.sats >= minSats && row.address) {
                    found.push({ txid: tx.txid || "", address: row.address, sats: row.sats });
                }
            });
        });
        found.sort(function (a, b) { return b.sats - a.sats; });
        return found;
    }

    function loadWatch() {
        try {
            return JSON.parse(localStorage.getItem(WATCH_KEY) || "[]");
        } catch (error) {
            return [];
        }
    }

    function saveWatch(address, label) {
        const rows = loadWatch().filter(function (row) { return row.address !== address; });
        rows.push({ address: address, label: label || "" });
        localStorage.setItem(WATCH_KEY, JSON.stringify(rows));
        return rows;
    }

    function dropWatch(address) {
        const rows = loadWatch().filter(function (row) { return row.address !== address; });
        localStorage.setItem(WATCH_KEY, JSON.stringify(rows));
        return rows;
    }

    async function getJson(path) {
        const response = await fetch(API + path);
        if (!response.ok) throw new Error("chain " + response.status);
        return response.json();
    }

    return {
        classify: classify,
        btc: btc,
        confirmedBalance: confirmedBalance,
        outputRows: outputRows,
        whaleOutputs: whaleOutputs,
        loadWatch: loadWatch,
        saveWatch: saveWatch,
        dropWatch: dropWatch,
        getJson: getJson,
        WHALE: WHALE,
    };
});
