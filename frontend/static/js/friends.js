// 聊天功能实现
class ChatApp {
    constructor() {
        this.me = localStorage.getItem('chat-user');
        this.peer = document.getElementById('peername').textContent;
        this.messages = [];
        this.socket = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadTheme();
        this.loadChatHistory();
        this.scrollToBottom();
        this.initWebSocket();
    }

    setupEventListeners() {
        // 发送按钮事件
        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        // 回车发送消息
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // 主题切换
        document.getElementById('theme-cb').addEventListener('change', (e) => {
            const html = document.documentElement;
            html.classList.toggle('theme-dark', e.target.checked);
            localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
        });
    }

    loadTheme() {
        const themeCb = document.getElementById('theme-cb');
        const html = document.documentElement;
        if (localStorage.getItem('theme') === 'dark') {
            html.classList.add('theme-dark');
            themeCb.checked = true;
        }
    }

    initWebSocket() {
        // 注意：在实际部署时，需要根据部署环境调整WebSocket服务器地址
        this.socket = io('' + window.location, {reconnection: true});
        
        // 连接成功事件
        this.socket.on('connect', () => {
            console.log('WebSocket连接成功');
            // 加入聊天室
            this.socket.emit('join', {
                username: this.me,
                friend: this.peer
            });
        });
        
        // 接收新消息事件
        this.socket.on('new_message', (data) => {
            console.log('收到新消息:', data);
            // 只处理与当前聊天相关的新消息
            if ((data.sender === this.me && data.recipient === this.peer) || 
                (data.sender === this.peer && data.recipient === this.me)) {
                const message = {
                    sender: data.sender,
                    content: data.content,
                    timestamp: new Date(data.timestamp)
                };
                this.addMessageToUI(message, data.sender === this.me);
                this.scrollToBottom();
            }
        });
        
        // 状态消息事件
        this.socket.on('status', (data) => {
            console.log('状态消息:', data.msg);
        });
        
        // 连接错误事件
        this.socket.on('connect_error', (error) => {
            console.error('WebSocket连接错误:', error);
        });
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();

        if (content) {
            // 通过WebSocket发送消息
            if (this.socket && this.socket.connected) {
                this.socket.emit('send_message', {
                    sender: this.me,
                    recipient: this.peer,
                    content: content
                });
                
                // 在本地立即显示消息
                const message = {
                    sender: this.me,
                    content: content,
                    timestamp: new Date()
                };
                
                this.addMessageToUI(message, true);
                input.value = '';
                this.scrollToBottom();
            } else {
                // 如果WebSocket不可用，回退到HTTP请求
                const response = await fetch('/api/send-message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User': this.me
                    },
                    body: JSON.stringify({
                        recipient: this.peer,
                        content: content
                    })
                });

                const result = await response.json();
                if (result.ok) {
                    const message = {
                        sender: this.me,
                        content: content,
                        timestamp: new Date()
                    };

                    this.addMessageToUI(message, true);
                    input.value = '';
                    this.scrollToBottom();
                } else {
                    alert(result.msg || '发送消息失败');
                }
            }
        }
    }

    addMessageToUI(message, isOwnMessage = false) {
        const container = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = `message-bubble ${isOwnMessage ? 'me' : 'peer'}`;

        const timeString = new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        messageElement.innerHTML = `
            <div class="message-content">${this.escapeHtml(message.content)}</div>
            <div class="message-time">${timeString}</div>
        `;

        container.appendChild(messageElement);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async loadChatHistory() {
        try {
            const response = await fetch(`/api/chat-history?friend=${this.peer}`, {
                headers: {
                    'X-User': this.me
                }
            });

            const result = await response.json();
            if (result.ok) {
                const container = document.getElementById('chat-messages');
                container.innerHTML = '';

                result.history.forEach(msg => {
                    const message = {
                        sender: msg.sender,
                        content: msg.content,
                        timestamp: new Date(msg.timestamp)
                    };
                    const isOwnMessage = msg.sender === this.me;
                    this.addMessageToUI(message, isOwnMessage);
                });

                this.scrollToBottom();
            } else {
                console.error('加载聊天历史失败:', result.msg);
            }
        } catch (error) {
            console.error('加载聊天历史出错:', error);
        }
    }

    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;
    }

    destroy() {
        // 离开聊天室
        if (this.socket) {
            this.socket.emit('leave', {
                username: this.me,
                friend: this.peer
            });
            this.socket.disconnect();
        }
    }
}

// 页面加载完成后初始化聊天应用
let chatApp = null;

document.addEventListener('DOMContentLoaded', () => {
    chatApp = new ChatApp();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (chatApp) {
        chatApp.destroy();
    }
});