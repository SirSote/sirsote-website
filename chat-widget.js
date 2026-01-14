/**
 * SirSote-Echo Chat Widget
 * Matrix-themed floating chat interface
 * Embeds n8n chat with custom styling
 */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        chatUrl: 'https://n8n.sirsote.com/webhook/a73623b9-ba80-4f92-8ae1-28b8dff8d324/chat',
        botName: 'SirSote-Echo'
    };

    // Inject styles
    const styles = `
        #sirsote-chat-widget {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 99999;
            font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        #sirsote-chat-toggle {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: #00ff88;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 20px rgba(0, 255, 136, 0.4);
            transition: transform 0.3s, box-shadow 0.3s;
        }

        #sirsote-chat-toggle:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 30px rgba(0, 255, 136, 0.6);
        }

        #sirsote-chat-toggle svg {
            width: 28px;
            height: 28px;
            fill: #0a0a0a;
        }

        #sirsote-chat-toggle.open svg.chat-icon { display: none; }
        #sirsote-chat-toggle.open svg.close-icon { display: block; }
        #sirsote-chat-toggle svg.close-icon { display: none; }

        #sirsote-chat-window {
            position: absolute;
            bottom: 80px;
            right: 0;
            width: 400px;
            height: 550px;
            background: #0a0a0a;
            border: 1px solid #2a2a2a;
            border-radius: 12px;
            display: none;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        }

        #sirsote-chat-window.open {
            display: flex;
            animation: slideUp 0.3s ease-out;
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        #sirsote-chat-header {
            padding: 16px 20px;
            background: #111111;
            border-bottom: 1px solid #2a2a2a;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        #sirsote-chat-header .avatar {
            width: 40px;
            height: 40px;
            background: rgba(0, 255, 136, 0.2);
            border: 2px solid #00ff88;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'JetBrains Mono', monospace;
            color: #00ff88;
            font-weight: bold;
            font-size: 14px;
        }

        #sirsote-chat-header .info h3 {
            color: #ffffff;
            font-size: 14px;
            font-weight: 600;
            margin: 0;
        }

        #sirsote-chat-header .info span {
            color: #00ff88;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        #sirsote-chat-header .info span::before {
            content: '';
            width: 8px;
            height: 8px;
            background: #00ff88;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        #sirsote-chat-iframe {
            flex: 1;
            width: 100%;
            border: none;
            background: #0a0a0a;
        }

        @media (max-width: 480px) {
            #sirsote-chat-window {
                width: calc(100vw - 40px);
                height: calc(100vh - 140px);
                bottom: 80px;
                right: 0;
            }
        }
    `;

    // Inject HTML
    const html = `
        <div id="sirsote-chat-widget">
            <button id="sirsote-chat-toggle" aria-label="Toggle chat">
                <svg class="chat-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
                    <path d="M7 9h10v2H7zm0-3h10v2H7z"/>
                </svg>
                <svg class="close-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
            <div id="sirsote-chat-window">
                <div id="sirsote-chat-header">
                    <div class="avatar">&gt;_</div>
                    <div class="info">
                        <h3>${CONFIG.botName}</h3>
                        <span>Online</span>
                    </div>
                </div>
                <iframe id="sirsote-chat-iframe" src="" title="SirSote-Echo Chat"></iframe>
            </div>
        </div>
    `;

    // Initialize widget
    function init() {
        // Add styles
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);

        // Add HTML
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper.firstElementChild);

        // Get elements
        const toggle = document.getElementById('sirsote-chat-toggle');
        const chatWindow = document.getElementById('sirsote-chat-window');
        const iframe = document.getElementById('sirsote-chat-iframe');
        let loaded = false;

        // Toggle chat
        toggle.addEventListener('click', () => {
            const isOpen = chatWindow.classList.toggle('open');
            toggle.classList.toggle('open', isOpen);

            // Lazy load iframe
            if (isOpen && !loaded) {
                iframe.src = CONFIG.chatUrl;
                loaded = true;
            }
        });
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
