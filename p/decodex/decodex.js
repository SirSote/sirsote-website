(function () {
    var plainEl = document.getElementById("plain");
    var cipherEl = document.getElementById("cipher");
    var shiftEl = document.getElementById("shift");
    var roomsEl = document.getElementById("rooms");
    var titleEl = document.getElementById("chat-title");
    var modeEl = document.getElementById("chat-mode");
    var logEl = document.getElementById("log");
    var statusEl = document.getElementById("chat-status");
    var draftEl = document.getElementById("draft");
    var chatShiftEl = document.getElementById("chat-shift");
    var nameEl = document.getElementById("chat-name");

    var KEY = "decodex.v1";
    var lastSide = "plain";
    var state = load();
    var shifts = new Map();

    function load() {
        try {
            return DecodeX.unpack(JSON.parse(localStorage.getItem(KEY) || "null"));
        } catch (err) {
            return DecodeX.unpack(null);
        }
    }

    function persist() {
        localStorage.setItem(KEY, JSON.stringify(DecodeX.pack(state)));
    }

    function say(text) {
        statusEl.textContent = text;
    }

    function benchShift() {
        var n = DecodeX.normalizeShift(shiftEl.value);
        return n === null ? 0 : n;
    }

    function applyBench() {
        var k = benchShift();
        if (lastSide === "cipher") plainEl.value = DecodeX.decode(cipherEl.value, k);
        else cipherEl.value = DecodeX.encode(plainEl.value, k);
    }

    function stepBench(delta) {
        var n = (benchShift() + delta + 26) % 26;
        shiftEl.value = String(n);
        applyBench();
    }

    function copyText(text, ok) {
        if (!text) {
            say("Nothing to copy.");
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { say(ok); }, function () { say("Copy failed."); });
            return;
        }
        say("Copy failed.");
    }

    function activeRoom() {
        for (var i = 0; i < state.rooms.length; i++) {
            if (state.rooms[i].id === state.activeId) return state.rooms[i];
        }
        return null;
    }

    function roomShift(room) {
        if (!room) return null;
        return shifts.has(room.id) ? shifts.get(room.id) : null;
    }

    function stamp(at) {
        try {
            return new Date(at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            });
        } catch (err) {
            return "";
        }
    }

    function render() {
        var room = activeRoom();
        roomsEl.replaceChildren();
        state.rooms.forEach(function (item) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = item.id === state.activeId ? "room active" : "room";
            btn.textContent = item.name;
            btn.addEventListener("click", function () { openRoom(item.id); });
            roomsEl.appendChild(btn);
        });

        var shift = roomShift(room);
        var locked = !room || shift === null;
        titleEl.textContent = room ? room.name : "No chat open";
        if (!room) {
            modeEl.textContent = "A chat stays in this browser. The shift is not saved.";
        } else if (locked) {
            var n = room.messages.length;
            modeEl.textContent = n
                ? n + " encoded " + (n === 1 ? "line" : "lines") + " kept in this browser. Enter the shift to read."
                : "Empty chat. Set a shift, then send. The shift is not saved.";
        } else {
            modeEl.textContent = "Readable on this screen. Stored as code. Clear all convo puts the code back.";
        }

        if (document.activeElement !== chatShiftEl) {
            chatShiftEl.value = shift === null || shift === undefined ? "" : String(shift);
        }

        logEl.replaceChildren();
        if (room) {
            room.messages.forEach(function (m) {
                var item = document.createElement("li");
                item.className = "msg " + (m.who === "you" ? "you" : "in");
                var who = document.createElement("span");
                who.className = "who";
                who.textContent = (m.who === "you" ? "You" : "Them") + " · " + stamp(m.at);
                var body = document.createElement("p");
                body.textContent = locked ? m.cipher : DecodeX.decode(m.cipher, shift);
                if (locked) {
                    body.className = "code";
                    body.translate = false;
                }
                var copy = document.createElement("button");
                copy.type = "button";
                copy.textContent = "Copy line";
                copy.addEventListener("click", function () {
                    copyText(m.cipher, "Encoded line copied.");
                });
                item.append(who, body, copy);
                logEl.appendChild(item);
            });
            logEl.scrollTop = logEl.scrollHeight;
        }
    }

    function openRoom(id) {
        state.activeId = id;
        persist();
        render();
    }

    plainEl.addEventListener("input", function () {
        lastSide = "plain";
        cipherEl.value = DecodeX.encode(plainEl.value, benchShift());
    });
    cipherEl.addEventListener("input", function () {
        lastSide = "cipher";
        plainEl.value = DecodeX.decode(cipherEl.value, benchShift());
    });
    shiftEl.addEventListener("input", applyBench);
    document.getElementById("shift-down").addEventListener("click", function () { stepBench(-1); });
    document.getElementById("shift-up").addEventListener("click", function () { stepBench(1); });
    document.getElementById("copy-plain").addEventListener("click", function () {
        copyText(plainEl.value, "Plain copied.");
    });
    document.getElementById("copy-cipher").addEventListener("click", function () {
        copyText(cipherEl.value, "Cipher copied.");
    });
    document.getElementById("clear-bench").addEventListener("click", function () {
        plainEl.value = "";
        cipherEl.value = "";
        lastSide = "plain";
    });

    document.getElementById("new-chat").addEventListener("submit", function (event) {
        event.preventDefault();
        var id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        state = DecodeX.createRoom(state, nameEl.value, Date.now(), id);
        nameEl.value = "";
        persist();
        render();
        chatShiftEl.focus();
    });

    chatShiftEl.addEventListener("input", function () {
        var room = activeRoom();
        if (!room) return;
        var n = DecodeX.normalizeShift(chatShiftEl.value);
        if (n === null) shifts.delete(room.id);
        else shifts.set(room.id, n);
        render();
    });

    document.getElementById("clear-convo").addEventListener("click", function () {
        var room = activeRoom();
        if (!room) {
            say("Open a chat first.");
            return;
        }
        shifts = DecodeX.forgetShift(shifts, room.id);
        draftEl.value = "";
        chatShiftEl.value = "";
        render();
        say("Readable text cleared. The encoded convo is still in this browser.");
    });

    document.getElementById("copy-convo").addEventListener("click", function () {
        var room = activeRoom();
        copyText(DecodeX.exportThread(room), "Encoded convo copied.");
    });

    document.getElementById("delete-chat").addEventListener("click", function () {
        var room = activeRoom();
        if (!room) {
            say("Open a chat first.");
            return;
        }
        if (!confirm("Delete this chat and its encoded messages from this browser?")) return;
        shifts = DecodeX.forgetShift(shifts, room.id);
        state = DecodeX.deleteRoom(state, room.id);
        draftEl.value = "";
        persist();
        render();
        say("Chat deleted from this browser.");
    });

    document.getElementById("composer").addEventListener("submit", function (event) {
        event.preventDefault();
        var room = activeRoom();
        if (!room) {
            say("Open a chat first.");
            return;
        }
        var shift = roomShift(room);
        if (shift === null) {
            say("Set a chat shift first. It stays in this session only.");
            chatShiftEl.focus();
            return;
        }
        var before = room.messages.length;
        var id = "m" + Date.now().toString(36);
        state = DecodeX.addMine(state, room.id, draftEl.value, shift, Date.now(), id);
        var after = activeRoom().messages.length;
        if (after === before) {
            say("Write a line first.");
            return;
        }
        draftEl.value = "";
        persist();
        render();
        say("Stored encoded.");
    });

    draftEl.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            document.getElementById("composer").requestSubmit();
        }
    });

    document.getElementById("add-encoded").addEventListener("click", function () {
        var room = activeRoom();
        if (!room) {
            say("Open a chat first.");
            return;
        }
        var before = room.messages.length;
        var id = "m" + Date.now().toString(36);
        state = DecodeX.addEncoded(state, room.id, draftEl.value, Date.now(), id);
        if (activeRoom().messages.length === before) {
            say("Paste an encoded line first.");
            return;
        }
        draftEl.value = "";
        persist();
        render();
        say("Encoded line kept.");
    });

    render();
})();
