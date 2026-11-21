const assert = require("assert");
const chain = require("./chain");

assert.strictEqual(chain.classify("ab".repeat(32)), "tx");
assert.strictEqual(chain.classify("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"), "address");
assert.strictEqual(chain.classify("send the coins"), "bad");

const payload = {
    chain_stats: { funded_txo_sum: 500000000, spent_txo_sum: 100000000 },
};
assert.strictEqual(chain.confirmedBalance(payload), 400000000);
assert.strictEqual(chain.btc(400000000), "4");

const tx = {
    txid: "cd".repeat(32),
    vout: [
        { scriptpubkey_address: "bc1qexample", value: 1500000000 },
        { scriptpubkey_address: "3change", value: 49000000 },
    ],
};
const whales = chain.whaleOutputs([tx], chain.WHALE);
assert.strictEqual(whales.length, 1);
assert.strictEqual(whales[0].address, "bc1qexample");

console.log("chain tests ok");
