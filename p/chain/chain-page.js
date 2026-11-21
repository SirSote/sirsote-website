(function () {
    const result = document.getElementById("result");
    const query = document.getElementById("query");
    const watch = document.getElementById("watch");

    function show(text) {
        result.textContent = text;
    }

    function paintWatch() {
        const rows = Chain.loadWatch();
        watch.replaceChildren();
        if (!rows.length) {
            const empty = document.createElement("li");
            empty.textContent = "None yet.";
            watch.appendChild(empty);
            return;
        }
        rows.forEach(function (row) {
            const item = document.createElement("li");
            const open = document.createElement("button");
            open.type = "button";
            open.textContent = row.label || "Open";
            const addr = document.createElement("div");
            addr.className = "addr";
            addr.textContent = row.address;
            const drop = document.createElement("button");
            drop.type = "button";
            drop.textContent = "Remove";
            open.addEventListener("click", function () {
                query.value = row.address;
                searchAddress(row.address);
            });
            drop.addEventListener("click", function () {
                Chain.dropWatch(row.address);
                paintWatch();
            });
            item.append(open, addr, drop);
            watch.appendChild(item);
        });
    }

    function txLines(tx) {
        const status = tx.status || {};
        const state = status.confirmed ? "block " + status.block_height : "unconfirmed";
        const lines = [tx.txid || "", state, "", "Out"];
        Chain.outputRows(tx).forEach(function (row) {
            lines.push("  " + Chain.btc(row.sats) + "  " + (row.address || "unknown"));
        });
        lines.push("", "A transaction does not name the holder.");
        return lines.join("\n");
    }

    async function searchAddress(address) {
        show("Reading " + address);
        const [payload, txs] = await Promise.all([
            Chain.getJson("/address/" + address),
            Chain.getJson("/address/" + address + "/txs"),
        ]);
        const lines = [
            payload.address || address,
            "Confirmed   " + Chain.btc(Chain.confirmedBalance(payload)) + " BTC",
            "Transactions " + ((payload.chain_stats || {}).tx_count || 0),
            "",
        ];
        (txs || []).slice(0, 8).forEach(function (tx) {
            const status = tx.status || {};
            const when = status.confirmed ? "block " + status.block_height : "unconfirmed";
            lines.push((tx.txid || "") + "  " + when);
        });
        lines.push("", "A balance is not a name.");
        const track = document.createElement("button");
        track.type = "button";
        track.textContent = "Track this address";
        track.addEventListener("click", function () {
            const label = window.prompt("Label for this address", "") || "";
            Chain.saveWatch(address, label);
            paintWatch();
        });
        show(lines.join("\n"));
        result.appendChild(document.createElement("br"));
        result.appendChild(track);
    }

    async function searchTx(txid) {
        show("Reading transaction");
        show(txLines(await Chain.getJson("/tx/" + txid)));
    }

    async function searchWhales() {
        show("Reading the latest block");
        const blocks = await Chain.getJson("/blocks");
        const block = blocks && blocks[0];
        if (!block) throw new Error("no block");
        const txs = await Chain.getJson("/block/" + block.id + "/txs");
        const rows = Chain.whaleOutputs(txs, Chain.WHALE);
        const lines = ["Outputs of 10 BTC or more in block " + block.height, ""];
        if (!rows.length) lines.push("None in this block.");
        rows.slice(0, 30).forEach(function (row) {
            lines.push(Chain.btc(row.sats) + " BTC  " + row.address);
        });
        lines.push("", "Size is not identity.");
        show(lines.join("\n"));
    }

    document.getElementById("search").addEventListener("submit", function (event) {
        event.preventDefault();
        const kind = Chain.classify(query.value);
        const run = kind === "tx" ? searchTx(query.value.trim()) : kind === "address" ? searchAddress(query.value.trim()) : Promise.reject(new Error("Paste an address or a transaction id"));
        run.catch(function (error) { show(error.message); });
    });
    document.getElementById("whales").addEventListener("click", function () {
        searchWhales().catch(function (error) { show(error.message); });
    });
    paintWatch();
})();
