// 聊天功能实现
class ChatApp {
    constructor() {
        this.me = localStorage.getItem('chat-user');
        this.peer = document.getElementById('peername').textContent;
        this.messages = [];
        this.pollingInterval = null;
        this.lastMessageCount = 0;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadTheme();
        this.loadChatHistory();
        this.scrollToBottom();
        // 启动轮询机制，每2秒检查一次新消息
        this.startPolling();
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

    async sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();

        if (content) {
            // 发送到服务器
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
                // 添加到UI
                const message = {
                    sender: this.me,
                    content: content,
                    timestamp: new Date()
                };

                this.addMessageToUI(message, true);
                input.value = '';
                this.scrollToBottom();
                
                // 立即检查新消息以确保显示最新内容
                setTimeout(() => this.checkForNewMessages(), 100);
            } else {
                alert(result.msg || '发送消息失败');
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

                this.lastMessageCount = result.history.length;
                this.scrollToBottom();
            } else {
                console.error('加载聊天历史失败:', result.msg);
            }
        } catch (error) {
            console.error('加载聊天历史出错:', error);
        }
    }

    // 新增：轮询获取新消息
    async checkForNewMessages() {
        try {
            const response = await fetch(`/api/chat-history?friend=${this.peer}`, {
                headers: {
                    'X-User': this.me
                }
            });

            const result = await response.json();
            if (result.ok) {
                // 检查是否有新消息
                if (result.history.length > this.lastMessageCount) {
                    // 有新消息，更新显示
                    this.lastMessageCount = result.history.length;
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
                }
            }
        } catch (error) {
            console.error('检查新消息出错:', error);
        }
    }

    // 新增：启动轮询
    startPolling() {
        this.pollingInterval = setInterval(() => {
            this.checkForNewMessages();
        }, 2000); // 每2秒检查一次新消息
    }

    // 新增：停止轮询
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;
    }

    destroy() {
        // 停止轮询
        this.stopPolling();
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