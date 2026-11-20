(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.DecodeX = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function normalizeShift(value) {
        if (value === null || value === undefined) return null;
        var text = String(value).trim();
        if (text === "") return null;
        var n = Number(text);
        if (!isFinite(n)) return null;
        return ((Math.trunc(n) % 26) + 26) % 26;
    }

    function caesar(text, shift, decode) {
        var n = normalizeShift(shift);
        if (n === null) n = 0;
        var k = decode ? (26 - n) % 26 : n;
        return String(text == null ? "" : text).replace(/[A-Za-z]/g, function (ch) {
            var base = ch <= "Z" ? 65 : 97;
            return String.fromCharCode(base + ((ch.charCodeAt(0) - base + k) % 26));
        });
    }

    function encode(text, shift) {
        return caesar(text, shift, false);
    }

    function decode(text, shift) {
        return caesar(text, shift, true);
    }

    function blank() {
        return { rooms: [], activeId: null };
    }

    function createRoom(state, name, now, id) {
        var room = {
            id: id,
            name: String(name || "").trim().slice(0, 40) || "Chat",
            created: now,
            messages: []
        };
        return {
            rooms: state.rooms.concat([room]),
            activeId: id
        };
    }

    function append(state, roomId, message) {
        return {
            activeId: state.activeId,
            rooms: state.rooms.map(function (room) {
                if (room.id !== roomId) return room;
                return {
                    id: room.id,
                    name: room.name,
                    created: room.created,
                    messages: room.messages.concat([message])
                };
            })
        };
    }

    function addMine(state, roomId, plain, shift, now, id) {
        var text = String(plain || "");
        if (!text.trim()) return state;
        if (normalizeShift(shift) === null) return state;
        return append(state, roomId, {
            id: id,
            who: "you",
            cipher: encode(text, shift),
            at: now
        });
    }

    function parseThread(text) {
        return String(text || "").replace(/\r/g, "").split("\n").map(function (line) {
            return line.trimEnd();
        }).filter(function (line) {
            return line.trim() !== "";
        }).map(function (line) {
            var tab = line.indexOf("\t");
            if (tab === -1) return { who: "in", cipher: line.trim() };
            var side = line.slice(0, tab).trim().toLowerCase();
            var who = side === "you" || side === "me" ? "you" : "in";
            return { who: who, cipher: line.slice(tab + 1) };
        }).filter(function (line) {
            return line.cipher !== "";
        });
    }

    function addEncoded(state, roomId, text, now, id) {
        var lines = parseThread(text);
        if (!lines.length) return state;
        var next = state;
        lines.forEach(function (line, i) {
            next = append(next, roomId, {
                id: lines.length === 1 ? id : id + "-" + i,
                who: line.who,
                cipher: line.cipher,
                at: now
            });
        });
        return next;
    }

    function exportThread(room) {
        if (!room) return "";
        return room.messages.map(function (m) {
            return (m.who === "you" ? "you" : "in") + "\t" + m.cipher;
        }).join("\n");
    }

    function deleteRoom(state, roomId) {
        var rooms = state.rooms.filter(function (room) { return room.id !== roomId; });
        var activeId = state.activeId === roomId ? (rooms[0] ? rooms[0].id : null) : state.activeId;
        return { rooms: rooms, activeId: activeId };
    }

    function pack(state) {
        return {
            activeId: state.activeId || null,
            rooms: (state.rooms || []).map(function (room) {
                return {
                    id: String(room.id),
                    name: String(room.name || "Chat").slice(0, 40),
                    created: Number(room.created) || 0,
                    messages: (room.messages || []).filter(function (m) {
                        return m && typeof m.cipher === "string";
                    }).map(function (m) {
                        return {
                            id: String(m.id),
                            who: m.who === "you" ? "you" : "in",
                            cipher: String(m.cipher),
                            at: Number(m.at) || 0
                        };
                    })
                };
            })
        };
    }

    function unpack(raw) {
        if (!raw || !Array.isArray(raw.rooms)) return blank();
        var packed = pack(raw);
        var known = packed.rooms.some(function (room) { return room.id === packed.activeId; });
        if (!known) packed.activeId = packed.rooms[0] ? packed.rooms[0].id : null;
        return packed;
    }

    function forgetShift(shifts, roomId) {
        var next = new Map(shifts);
        next.delete(roomId);
        return next;
    }

    return {
        normalizeShift: normalizeShift,
        encode: encode,
        decode: decode,
        blank: blank,
        createRoom: createRoom,
        addMine: addMine,
        addEncoded: addEncoded,
        parseThread: parseThread,
        exportThread: exportThread,
        deleteRoom: deleteRoom,
        pack: pack,
        unpack: unpack,
        forgetShift: forgetShift
    };
});
