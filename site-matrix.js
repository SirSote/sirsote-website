(function () {
    var canvas = document.getElementById("matrix");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var chars = "01".split("");
    var fontSize = 14;
    var drops = [];

    function size() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        var columns = Math.ceil(canvas.width / fontSize);
        drops = [];
        for (var i = 0; i < columns; i++) drops[i] = Math.random() * 40;
    }

    function draw() {
        ctx.fillStyle = "rgba(10, 10, 10, 0.05)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#00ff88";
        ctx.font = fontSize + "px JetBrains Mono";
        for (var i = 0; i < drops.length; i++) {
            var text = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillText(text, i * fontSize, drops[i] * fontSize);
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
            drops[i]++;
        }
    }

    size();
    setInterval(draw, 35);
    window.addEventListener("resize", size);
})();
