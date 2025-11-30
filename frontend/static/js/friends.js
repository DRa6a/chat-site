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
        
        // 图片查看器相关属性
        this.imageMessages = []; // 存储所有图片消息
        this.currentImageIndex = 0; // 当前查看的图片索引
        
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
        
        // 创建图片查看器
        this.createImageViewer();
    }

    setupEventListeners() {
        // 发送按钮事件
        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        // 图片上传按钮事件
        document.getElementById('upload-btn').addEventListener('click', () => {
            document.getElementById('image-upload').click();
        });

        // 图片选择事件
        document.getElementById('image-upload').addEventListener('change', (e) => {
            this.uploadImage(e.target.files[0]);
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
        
        // 图片查看器事件监听器 (推迟到图片查看器创建后再设置)
        // 这些监听器将在 createImageViewer 方法中设置
    }
    
    // 创建图片查看器
    createImageViewer() {
        const imageViewerModal = document.createElement('div');
        imageViewerModal.id = 'image-viewer-modal';
        imageViewerModal.className = 'modal';
        imageViewerModal.innerHTML = `
            <div class="image-viewer-content">
                <span class="close-btn" id="close-image-viewer">&times;</span>
                <div class="image-container">
                    <img id="viewer-image" src="" alt="图片查看">
                </div>
                <div class="image-navigation">
                    <button id="prev-image" class="nav-btn">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <div class="image-info">
                        <span id="current-image-index">1</span>/<span id="total-images">1</span>
                    </div>
                    <button id="next-image" class="nav-btn">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
                <div class="image-actions">
                    <button id="download-image" class="action-btn">
                        <i class="fas fa-download"></i> 下载
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(imageViewerModal);
        
        // 现在设置图片查看器的事件监听器
        this.setupImageViewerListeners();
    }
    
    setupImageViewerListeners() {
        // 确保图片查看器元素存在
        const imageViewerModal = document.getElementById('image-viewer-modal');
        if (!imageViewerModal) {
            console.error('图片查看器模态框未找到');
            return;
        }
        
        const closeImageViewer = document.getElementById('close-image-viewer');
        const prevImageBtn = document.getElementById('prev-image');
        const nextImageBtn = document.getElementById('next-image');
        const downloadImageBtn = document.getElementById('download-image');
        
        // 关闭图片查看器
        if (closeImageViewer) {
            closeImageViewer.addEventListener('click', () => {
                this.closeImageViewer();
            });
        }
        
        // 点击模态框外部关闭
        imageViewerModal.addEventListener('click', (event) => {
            if (event.target === imageViewerModal) {
                this.closeImageViewer();
            }
        });
        
        // 上一张图片
        if (prevImageBtn) {
            prevImageBtn.addEventListener('click', () => {
                this.showPrevImage();
            });
        }
        
        // 下一张图片
        if (nextImageBtn) {
            nextImageBtn.addEventListener('click', () => {
                this.showNextImage();
            });
        }
        
        // 下载图片
        if (downloadImageBtn) {
            downloadImageBtn.addEventListener('click', () => {
                this.downloadCurrentImage();
            });
        }
        
        // 键盘事件（ESC关闭，左右箭头切换图片）
        document.addEventListener('keydown', (event) => {
            const imageViewerModal = document.getElementById('image-viewer-modal');
            if (imageViewerModal && imageViewerModal.style.display === 'block') {
                switch (event.key) {
                    case 'Escape':
                        this.closeImageViewer();
                        break;
                    case 'ArrowLeft':
                        this.showPrevImage();
                        break;
                    case 'ArrowRight':
                        this.showNextImage();
                        break;
                }
            }
        });
    }
    
    // 打开图片查看器
    openImageViewer(imageId, imageElement) {
        // 收集所有图片消息
        this.collectImageMessages();
        
        // 找到点击的图片在数组中的位置
        this.currentImageIndex = this.imageMessages.findIndex(msg => 
            msg.element === imageElement || msg.id === imageId);
        
        if (this.currentImageIndex === -1) {
            this.currentImageIndex = 0;
        }
        
        // 显示图片查看器
        this.showCurrentImage();
        const imageViewerModal = document.getElementById('image-viewer-modal');
        if (imageViewerModal) {
            imageViewerModal.style.display = 'block';
            document.body.style.overflow = 'hidden'; // 防止背景滚动
        }
    }
    
    // 关闭图片查看器
    closeImageViewer() {
        const imageViewerModal = document.getElementById('image-viewer-modal');
        if (imageViewerModal) {
            imageViewerModal.style.display = 'none';
            document.body.style.overflow = ''; // 恢复背景滚动
        }
    }
    
    // 收集所有图片消息
    collectImageMessages() {
        const messageElements = document.querySelectorAll('.message-image img');
        this.imageMessages = Array.from(messageElements).map((img, index) => {
            // 从图片src中提取图片ID
            const src = img.src;
            const urlParts = src.split('/');
            const imageId = urlParts[urlParts.length - 1];
            
            return {
                id: imageId,
                element: img,
                src: src
            };
        });
    }
    
    // 显示当前图片
    showCurrentImage() {
        if (this.imageMessages.length === 0) return;
        
        const currentImage = this.imageMessages[this.currentImageIndex];
        const viewerImage = document.getElementById('viewer-image');
        if (viewerImage) {
            viewerImage.src = currentImage.src;
        }
        
        // 更新图片信息
        const currentImageIndexElement = document.getElementById('current-image-index');
        const totalImagesElement = document.getElementById('total-images');
        if (currentImageIndexElement && totalImagesElement) {
            currentImageIndexElement.textContent = this.currentImageIndex + 1;
            totalImagesElement.textContent = this.imageMessages.length;
        }
        
        // 控制导航按钮的显示
        const prevImageBtn = document.getElementById('prev-image');
        const nextImageBtn = document.getElementById('next-image');
        if (prevImageBtn && nextImageBtn) {
            prevImageBtn.disabled = this.currentImageIndex === 0;
            nextImageBtn.disabled = this.currentImageIndex === this.imageMessages.length - 1;
        }
    }
    
    // 显示上一张图片
    showPrevImage() {
        if (this.currentImageIndex > 0) {
            this.currentImageIndex--;
            this.showCurrentImage();
        }
    }
    
    // 显示下一张图片
    showNextImage() {
        if (this.currentImageIndex < this.imageMessages.length - 1) {
            this.currentImageIndex++;
            this.showCurrentImage();
        }
    }
    
    // 下载当前图片
    downloadCurrentImage() {
        if (this.imageMessages.length === 0) return;
        
        const currentImage = this.imageMessages[this.currentImageIndex];
        const link = document.createElement('a');
        link.href = currentImage.src;
        link.download = `image_${currentImage.id}.jpg`; // 默认文件名
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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

    async uploadImage(imageFile) {
        if (!imageFile) return;

        // 创建FormData对象用于上传文件
        const formData = new FormData();
        formData.append('image', imageFile);

        try {
            // 显示上传中提示
            const sendButton = document.getElementById('send-btn');
            const uploadButton = document.getElementById('upload-btn');
            const originalSendText = sendButton.innerHTML;
            const originalUploadText = uploadButton.innerHTML;
            
            sendButton.disabled = true;
            uploadButton.disabled = true;
            sendButton.innerHTML = '上传中...';
            uploadButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            // 上传图片
            const uploadResponse = await fetch('/api/upload-image', {
                method: 'POST',
                headers: {
                    'X-User': this.me
                },
                body: formData
            });

            const uploadResult = await uploadResponse.json();
            
            // 恢复按钮状态
            sendButton.disabled = false;
            uploadButton.disabled = false;
            sendButton.innerHTML = originalSendText;
            uploadButton.innerHTML = originalUploadText;
            
            if (uploadResult.ok) {
                // 上传成功，发送图片消息
                const imageMessage = `Pic_${uploadResult.image_id}`;
                const response = await fetch('/api/send-message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User': this.me
                    },
                    body: JSON.stringify({
                        recipient: this.peer,
                        content: imageMessage
                    })
                });

                const result = await response.json();
                if (result.ok) {
                    // 清空文件选择
                    document.getElementById('image-upload').value = '';
                    // 立即检查新消息以确保显示最新内容
                    setTimeout(() => this.checkForNewMessages(), 100);
                } else {
                    alert(result.msg || '发送图片消息失败');
                }
            } else {
                alert(uploadResult.msg || '图片上传失败');
            }
        } catch (error) {
            console.error('上传图片出错:', error);
            alert('图片上传失败: ' + error.message);
            
            // 恢复按钮状态
            const sendButton = document.getElementById('send-btn');
            const uploadButton = document.getElementById('upload-btn');
            sendButton.disabled = false;
            uploadButton.disabled = false;
            sendButton.innerHTML = '发送';
            uploadButton.innerHTML = '<i class="fas fa-image"></i>';
        }
    }

    addMessageToUI(message, isOwnMessage = false) {
        const container = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');

        // 检查是否是图片消息
        if (message.content.startsWith('Pic_')) {
            // 提取图片ID
            const imageId = message.content.substring(4);
            // 图片消息不使用气泡样式，直接显示图片
            messageElement.className = 'message-image';
            messageElement.innerHTML = `
                <img src="/api/get-image/${imageId}" alt="图片" style="max-width: 200px; max-height: 200px; border-radius: 10px; border: 1px solid rgba(0, 0, 0, 0.1);">
            `;
            // 根据发送者设置对齐方式
            if (isOwnMessage) {
                messageElement.style.alignSelf = 'flex-end';
            } else {
                messageElement.style.alignSelf = 'flex-start';
            }
            
            // 为图片添加点击事件，打开图片查看器
            const img = messageElement.querySelector('img');
            img.addEventListener('click', () => {
                this.openImageViewer(imageId, img);
            });
            
            // 处理图片加载完成后的滚动
            img.onload = () => {
                // 图片加载完成后重新滚动到底部
                this.scrollToBottom();
            };
            img.onerror = () => {
                // 图片加载失败时也确保滚动到底部
                this.scrollToBottom();
            };
        } else {
            // 文字消息使用气泡样式
            messageElement.className = `message-bubble ${isOwnMessage ? 'me' : 'peer'}`;
            messageElement.innerHTML = `
                <div class="message-content">${this.escapeHtml(message.content)}</div>
            `;
        }

        container.appendChild(messageElement);
        
        // 返回创建的元素，以便调用者可以进一步处理
        return messageElement;
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

                // 创建一个Promise数组来跟踪所有图片加载
                const imagePromises = [];
                
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
                    
                    // 如果需要显示时间，则添加时间分隔符
                    if (showTime) {
                        this.addTimeDivider(message.timestamp);
                    }
                    
                    // 添加消息到UI
                    const messageElement = this.addMessageToUI(message, isOwnMessage);
                    
                    // 如果是图片消息，将图片加载Promise添加到数组中
                    if (message.content.startsWith('Pic_')) {
                        const img = messageElement.querySelector('img');
                        const imgPromise = new Promise((resolve) => {
                            img.onload = () => {
                                resolve();
                            };
                            img.onerror = () => {
                                resolve(); // 即使加载失败也继续
                            };
                        });
                        imagePromises.push(imgPromise);
                    }
                });

                this.lastMessageCount = result.history.length;
                
                // 等待所有图片加载完成后再滚动到底部
                if (imagePromises.length > 0) {
                    Promise.all(imagePromises).then(() => {
                        this.scrollToBottom();
                    });
                } else {
                    this.scrollToBottom();
                }
            } else {
                console.error('加载聊天历史失败:', result.msg);
            }
        } catch (error) {
            console.error('加载聊天历史出错:', error);
        }
    }

    // 新增：添加时间分隔符
    addTimeDivider(timestamp) {
        const container = document.getElementById('chat-messages');
        const dividerElement = document.createElement('div');
        dividerElement.className = 'time-divider';
        
        const timeString = new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        dividerElement.textContent = timeString;
        container.appendChild(dividerElement);
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
            
            // 通知首页更新未读消息计数
            try {
                localStorage.setItem('unread_updated', Date.now().toString());
            } catch (e) {
                console.error('无法更新localStorage:', e);
            }
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
                        
                        // 如果需要显示时间，则添加时间分隔符
                        if (showTime) {
                            this.addTimeDivider(message.timestamp);
                        }
                        
                        // 添加消息到UI
                        this.addMessageToUI(message, isOwnMessage);
                    }

                    this.lastMessageCount = result.history.length;
                    
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
        // 标记消息为已读
        this.markMessagesAsRead();
        // 关闭图片查看器
        this.closeImageViewer();
    }
}

// 页面加载完成后初始化聊天应用
let chatApp = null;

document.addEventListener('DOMContentLoaded', () => {
    chatApp = new ChatApp();
    
    // 监听返回按钮点击事件
    const backBtn = document.querySelector('.back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (chatApp) {
                chatApp.markMessagesAsRead();
            }
        });
    }
    
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
