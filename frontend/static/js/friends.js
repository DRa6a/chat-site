// 聊天功能实现
class ChatApp {
    constructor() {
        try {
            this.me = sessionStorage.getItem('chat-user');
        } catch(e) {
            console.error('获取用户信息时出错:', e);
            this.me = null;
        }
        this.peer = document.getElementById('peername').textContent;
        this.messages = [];
        this.pollingInterval = null;
        this.lastMessageCount = 0;
        this.hasNewMessage = false;
        this.originalTitle = document.title;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadTheme();
        this.loadChatHistory();
        this.markMessagesAsRead(); // 标记当前聊天为已读
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
            try {
                localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
            } catch(e) {
                console.log('无法访问localStorage:', e);
            }
        });

        // 页面获得焦点时清除新消息提示
        window.addEventListener('focus', () => {
            this.clearNewMessageIndicator();
        });
    }

    loadTheme() {
        const themeCb = document.getElementById('theme-cb');
        const html = document.documentElement;
        try {
            if (localStorage.getItem('theme') === 'dark') {
                html.classList.add('theme-dark');
                themeCb.checked = true;
            }
        } catch(e) {
            console.log('无法访问localStorage:', e);
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
                // 不再在这里直接添加消息到UI，而是等待下一次轮询
                input.value = '';
                this.scrollToBottom();
                
                // 立即检查新消息以确保显示最新内容
                setTimeout(() => this.checkForNewMessages(), 100);
            } else {
                alert(result.msg || '发送消息失败');
            }
        }
    }

    addMessageToUI(message, isOwnMessage = false, showTime = true) {
        const container = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = `message-bubble ${isOwnMessage ? 'me' : 'peer'}`;

        let timeHTML = '';
        if (showTime) {
            const timeString = new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
            });
            timeHTML = `<div class="message-time">${timeString}</div>`;
        }

        messageElement.innerHTML = `
            <div class="message-content">${this.escapeHtml(message.content)}</div>
            ${timeHTML}
        `;

        container.appendChild(messageElement);
        
        // 确保消息容器滚动到底部
        container.scrollTop = container.scrollHeight;
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

                result.history.forEach((msg, index) => {
                    const message = {
                        sender: msg.sender,
                        content: msg.content,
                        timestamp: new Date(msg.timestamp)
                    };
                    const isOwnMessage = msg.sender === this.me;
                    
                    // 判断是否显示时间戳
                    let showTime = true;
                    if (index > 0) {
                        const previousMsg = result.history[index - 1];
                        const previousTime = new Date(previousMsg.timestamp);
                        const currentTime = new Date(msg.timestamp);
                        
                        // 计算时间差（毫秒）
                        const timeDiff = Math.abs(currentTime - previousTime);
                        
                        // 如果时间差小于5分钟（300,000毫秒），不显示时间戳
                        if (timeDiff < 300000) {
                            showTime = false;
                        }
                    }
                    
                    this.addMessageToUI(message, isOwnMessage, showTime);
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

    // 标记当前聊天消息为已读
    async markMessagesAsRead() {
        try {
            await fetch('/api/mark-messages-as-read', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User': this.me
                },
                body: JSON.stringify({
                    friend: this.peer
                })
            });
        } catch (error) {
            console.error('标记消息为已读出错:', error);
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
                    const newMessageCount = result.history.length - this.lastMessageCount;
                    const container = document.getElementById('chat-messages');

                    // 只处理新增的消息，而不是清空整个容器
                    const startIndex = this.lastMessageCount;
                    for (let i = startIndex; i < result.history.length; i++) {
                        const msg = result.history[i];
                        const message = {
                            sender: msg.sender,
                            content: msg.content,
                            timestamp: new Date(msg.timestamp)
                        };
                        const isOwnMessage = msg.sender === this.me;
                        
                        // 判断是否显示时间戳
                        let showTime = true;
                        if (i > 0) {
                            const previousMsg = result.history[i - 1];
                            const previousTime = new Date(previousMsg.timestamp);
                            const currentTime = new Date(msg.timestamp);
                            
                            // 计算时间差（毫秒）
                            const timeDiff = Math.abs(currentTime - previousTime);
                            
                            // 如果时间差小于5分钟（300,000毫秒），不显示时间戳
                            if (timeDiff < 300000) {
                                showTime = false;
                            }
                        }
                        
                        this.addMessageToUI(message, isOwnMessage, showTime);
                    }

                    this.lastMessageCount = result.history.length;
                    this.scrollToBottom();
                    
                    // 如果不是自己发送的消息，则显示新消息提示
                    const lastMessage = result.history[result.history.length - 1];
                    if (lastMessage.sender !== this.me) {
                        this.showNewMessageIndicator(newMessageCount);
                    }
                }
            }
        } catch (error) {
            console.error('检查新消息出错:', error);
        }
    }

    // 显示新消息提示
    showNewMessageIndicator(newMessageCount) {
        // 只有在页面不处于焦点状态时才显示提示
        if (!document.hasFocus()) {
            this.hasNewMessage = true;
            // 更新页面标题显示新消息提示
            document.title = `(${newMessageCount}) ${this.originalTitle}`;
            
            // 尝试使用浏览器通知（如果支持且已授权）
            this.showNotification(newMessageCount);
        }
    }

    // 清除新消息提示
    clearNewMessageIndicator() {
        if (this.hasNewMessage) {
            this.hasNewMessage = false;
            document.title = this.originalTitle;
        }
    }

    // 显示浏览器通知
    showNotification(newMessageCount) {
        // 检查浏览器是否支持通知
        if ('Notification' in window) {
            // 检查用户是否已授权显示通知
            if (Notification.permission === 'granted') {
                new Notification('新消息', {
                    body: `您有${newMessageCount}条来自${this.peer}的新消息`,
                    icon: '/favicon.ico'
                });
            } else if (Notification.permission !== 'denied') {
                // 请求用户授权
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification('新消息', {
                            body: `您有${newMessageCount}条来自${this.peer}的新消息`,
                            icon: '/favicon.ico'
                        });
                    }
                });
            }
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

    // 删除好友
    async removeFriend() {
        if (confirm(`确定要删除好友 ${this.peer} 吗？`)) {
            try {
                const response = await fetch('/api/remove-friend', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User': this.me
                    },
                    body: JSON.stringify({
                        friendName: this.peer
                    })
                });

                const result = await response.json();
                if (result.ok) {
                    alert('好友删除成功');
                    // 跳转回好友列表页面
                    location.href = '/';
                } else {
                    alert(result.msg || '删除好友失败');
                }
            } catch (error) {
                console.error('删除好友出错:', error);
                alert('删除好友失败');
            }
        }
    }

    // 清空聊天记录
    async clearChatHistory() {
        if (confirm(`确定要清空与 ${this.peer} 的所有聊天记录吗？此操作不可恢复！`)) {
            try {
                const response = await fetch('/api/clear-chat-history', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User': this.me
                    },
                    body: JSON.stringify({
                        friendName: this.peer
                    })
                });

                const result = await response.json();
                if (result.ok) {
                    alert('聊天记录已清空');
                    // 清空聊天界面
                    document.getElementById('chat-messages').innerHTML = '';
                    this.lastMessageCount = 0;
                } else {
                    alert(result.msg || '清空聊天记录失败');
                }
            } catch (error) {
                console.error('清空聊天记录出错:', error);
                alert('清空聊天记录失败');
            }
        }
    }

    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        // 使用平滑滚动到底部
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
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
    
    // 添加聊天设置相关事件监听
    const chatSettingsBtn = document.getElementById('chat-settings-btn');
    const chatSettingsModal = document.getElementById('chat-settings-modal');
    const closeChatSettings = document.getElementById('close-chat-settings');
    const editNicknameBtn = document.getElementById('edit-nickname-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    const deleteFriendBtn = document.getElementById('delete-friend-btn');
    const peerName = document.getElementById('peername').textContent;

    if (chatSettingsBtn && chatSettingsModal) {
        // 打开设置模态框
        chatSettingsBtn.addEventListener('click', function() {
            chatSettingsModal.style.display = 'block';
        });

        // 关闭设置模态框的统一方法
        function closeSettings() {
            chatSettingsModal.style.display = 'none';
        }

        // 绑定关闭事件
        closeChatSettings.addEventListener('click', closeSettings);

        // 点击模态框外部关闭
        window.addEventListener('click', function(event) {
            if (event.target === chatSettingsModal) {
                closeSettings();
            }
        });

        // 修改好友昵称
        editNicknameBtn.addEventListener('click', function() {
            const newNickname = prompt('请输入新的昵称:', peerName);
            if (newNickname && newNickname.trim() !== '' && newNickname !== peerName) {
                // 这里应该调用后端API来保存昵称
                alert('功能开发中：修改好友昵称功能');
            }
            closeSettings();
        });

        // 清空聊天记录
        clearChatBtn.addEventListener('click', function() {
            if (chatApp) {
                chatApp.clearChatHistory();
            }
            closeSettings();
        });

        // 删除好友
        deleteFriendBtn.addEventListener('click', function() {
            if (chatApp) {
                chatApp.removeFriend();
            }
            closeSettings();
        });
    }
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (chatApp) {
        chatApp.destroy();
    }
});