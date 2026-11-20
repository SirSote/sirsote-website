const assert = require("assert");
const x = require("./cipher");

assert.strictEqual(x.encode("attack at dawn", 3), "dwwdfn dw gdzq");
assert.strictEqual(x.decode("dwwdfn dw gdzq", 3), "attack at dawn");
assert.strictEqual(x.encode("Hello, world!", 3), "Khoor, zruog!");
assert.strictEqual(x.decode("Khoor, zruog!", 3), "Hello, world!");
assert.strictEqual(x.encode("Zebra", 1), "Afcsb");
assert.strictEqual(x.encode("a", 25), "z");
assert.strictEqual(x.encode("Keep 7.", 0), "Keep 7.");
assert.strictEqual(x.encode("Abc", 26), "Abc");
assert.strictEqual(x.encode("A", -1), "Z");
assert.strictEqual(x.normalizeShift(""), null);
assert.strictEqual(x.normalizeShift(" 4 "), 4);
assert.strictEqual(x.normalizeShift(3.9), 3);

const plain = "pineapple";
let state = x.createRoom(x.blank(), "dusk", 1000, "r1");
state = x.addMine(state, "r1", plain, 5, 1001, "m1");
state = x.addMine(state, "r1", "   ", 5, 1002, "m2");
assert.strictEqual(state.rooms[0].messages.length, 1);
assert.strictEqual(state.rooms[0].messages[0].cipher, x.encode(plain, 5));
assert.ok(!JSON.stringify(x.pack(state)).includes(plain));

const dirty = x.pack({
    activeId: "r1",
    rooms: [{
        id: "r1",
        name: "dusk",
        created: 1,
        shift: 5,
        messages: [{ id: "m1", who: "you", cipher: "unsjfuuqj", plain: plain, at: 1 }]
    }]
});
assert.ok(!JSON.stringify(dirty).includes("shift"));
assert.ok(!JSON.stringify(dirty).includes(plain));
assert.strictEqual(dirty.rooms[0].messages[0].cipher, "unsjfuuqj");

state = x.addEncoded(state, "r1", "in\tdwwdfn\nyou\tkhoor", 1003, "m3");
assert.strictEqual(state.rooms[0].messages.length, 3);
assert.strictEqual(state.rooms[0].messages[1].who, "in");
assert.strictEqual(state.rooms[0].messages[2].who, "you");
assert.strictEqual(x.exportThread(state.rooms[0]).split("\n")[0], "you\t" + x.encode(plain, 5));

const shifts = x.forgetShift(new Map([["r1", 5], ["r2", 9]]), "r1");
assert.strictEqual(shifts.has("r1"), false);
assert.strictEqual(shifts.get("r2"), 9);
assert.strictEqual(state.rooms[0].messages.length, 3);

state = x.deleteRoom(state, "r1");
assert.strictEqual(state.rooms.length, 0);
assert.strictEqual(state.activeId, null);

console.log("cipher.test.js ok");
